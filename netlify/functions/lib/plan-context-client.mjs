import { geometryCenter } from './geo.mjs';

const CACHE = globalThis.__PLANLAMASYON_PLAN_CONTEXT_CACHE__ || new Map();
globalThis.__PLANLAMASYON_PLAN_CONTEXT_CACHE__ = CACHE;

const DEFAULT_LAYERS = [
  {
    id: 'eplan-public-uip-boundary', type: 'UIP', role: 'coverage', shortLabel: 'Uygulama İmar Planı kapsamı', title: 'Kesinleşmiş Uygulama İmar Planı kapsamı',
    endpoint: 'https://tucbs-public-api.csb.gov.tr/trk_eplan_kesinlesmis_uip_wms', layer: 'tucbsPlanSinir_UIP'
  },
  {
    id: 'eplan-public-uip-detail', type: 'UIP', role: 'metadata', shortLabel: 'Uygulama İmar Planı metaverisi', title: 'Kesinleşmiş Uygulama İmar Planı katmanı',
    endpoint: 'https://tucbs-public-api.csb.gov.tr/trk_eplan_kesinlesmis_uip_wms', layer: 'tucbs_UIP'
  },
  {
    id: 'eplan-public-nip-boundary', type: 'NIP', role: 'coverage', shortLabel: 'Nazım İmar Planı kapsamı', title: 'Kesinleşmiş Nazım İmar Planı kapsamı',
    endpoint: 'https://tucbs-public-api.csb.gov.tr/trk_eplan_kesinlesmis_nip_wms', layer: 'tucbsPlanSinir_NIP'
  },
  {
    id: 'eplan-public-nip-detail', type: 'NIP', role: 'metadata', shortLabel: 'Nazım İmar Planı metaverisi', title: 'Kesinleşmiş Nazım İmar Planı katmanı',
    endpoint: 'https://tucbs-public-api.csb.gov.tr/trk_eplan_kesinlesmis_nip_wms', layer: 'tucbs_NIP'
  }
];

export async function discoverPublicPlanContext({ geometry, env = process.env, fetchImpl = globalThis.fetch }) {
  const center = geometryCenter(geometry);
  if (!center) return unavailable('Parsel merkez koordinatı hesaplanamadı.');
  const enabled = String(env.PUBLIC_PLAN_COVERAGE_ENABLED ?? 'true').toLowerCase() === 'true';
  if (!enabled) return unavailable('Kamuya açık plan kapsamı kontrolü kapalı.', center);
  if (typeof fetchImpl !== 'function') return unavailable('Plan kapsamı kontrolü için ağ erişimi bulunmuyor.', center);

  const layers = configuredLayers(env);
  const cacheDisabled = String(env.PUBLIC_PLAN_COVERAGE_CACHE_DISABLED ?? 'false').toLowerCase() === 'true';
  const cacheKey = `${center.lat.toFixed(5)}:${center.lon.toFixed(5)}:${layers.map((item) => item.layer).join('|')}`;
  if (!cacheDisabled) {
    const cached = CACHE.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.value;
  }

  const timeoutMs = clampInt(env.PUBLIC_PLAN_COVERAGE_TIMEOUT_MS, 1200, 20000, 3800);
  const settled = await Promise.allSettled(layers.map((item) => queryLayer(item, center, timeoutMs, fetchImpl)));
  const rawMatches = [];
  const diagnostics = [];
  let successfulQueries = 0;

  settled.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      successfulQueries += 1;
      if (result.value?.matched) rawMatches.push(result.value.match);
    } else {
      diagnostics.push({ connector: layers[index].id, message: clean(result.reason?.message || result.reason, 400) });
    }
  });

  const matches = mergeMatches(rawMatches);
  const metadata = mergeMetadata(matches.map((match) => match.metadata));
  const sources = matches.map((match) => ({
    id: match.sourceId,
    title: match.title,
    provider: 'Çevre, Şehircilik ve İklim Değişikliği Bakanlığı / TUCBS',
    url: match.serviceUrl,
    kind: match.role === 'metadata' || Object.keys(match.metadata || {}).length ? 'official-plan-metadata' : 'official-plan-coverage',
    trust: 'public-information',
    note: Object.keys(match.metadata || {}).length
      ? 'Kamuya açık TUCBS/e-Plan WMS katmanından plan kapsamı ve mevcut metaveri okundu. Bu sonuç tek başına TAKS, emsal, kat veya özel plan notu değildir.'
      : 'Kamuya açık WMS plan sınırı katmanında parsel merkezi için kapsam bilgisi bulundu. Bu sonuç TAKS, emsal, kat veya plan notu değildir.'
  }));

  const value = matches.length
    ? {
        status: 'available',
        center,
        matches,
        metadata,
        sources,
        diagnostics,
        message: Object.keys(metadata).length
          ? 'Kamuya açık kesinleşmiş plan katmanında kapsam ve plan metaverisi bulundu.'
          : 'Kamuya açık kesinleşmiş plan sınırı katmanında kapsam bulundu.'
      }
    : successfulQueries
      ? { status: 'not-found', center, matches: [], metadata: {}, sources: [], diagnostics, message: 'Kamuya açık plan katmanlarında parsel merkezine ait kapsam kaydı bulunamadı.' }
      : unavailable('Kamuya açık plan kapsamı servisleri geçici olarak yanıt vermedi.', center, diagnostics);

  if (!cacheDisabled) {
    CACHE.set(cacheKey, { value, expiresAt: Date.now() + 6 * 60 * 60 * 1000 });
    trimCache();
  }
  return value;
}

async function queryLayer(definition, center, timeoutMs, fetchImpl) {
  const endpoint = allowedPublicWmsUrl(definition.endpoint);
  const attempts = ['application/json', 'text/html', 'text/xml'];
  const errors = [];
  const startedAt = Date.now();

  for (const infoFormat of attempts) {
    const remaining = timeoutMs - (Date.now() - startedAt);
    if (remaining < 500) break;
    const url = buildFeatureInfoUrl(endpoint, definition.layer, center, infoFormat);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), remaining);
    try {
      const response = await fetchImpl(url, {
        headers: {
          Accept: `${infoFormat}, application/vnd.ogc.gml;q=0.9, */*;q=0.1`,
          'User-Agent': 'Planlamasyon/3.8.0 (+https://planlamasyon.truva-ai.com)'
        },
        signal: controller.signal
      });
      if (!response.ok) {
        const error = new Error(`${definition.shortLabel} servisi ${response.status} yanıtı verdi.`);
        error.status = response.status;
        throw error;
      }
      const text = await response.text();
      const parsed = parseFeatureInfo(text, response.headers?.get?.('content-type') || infoFormat);
      if (!parsed.matched) return { matched: false };
      return {
        matched: true,
        match: {
          type: definition.type,
          role: definition.role,
          shortLabel: definition.shortLabel,
          title: definition.title,
          sourceId: definition.id,
          serviceUrl: endpoint,
          layer: definition.layer,
          attributes: parsed.attributes,
          metadata: normalizePlanMetadata(parsed.attributes)
        }
      };
    } catch (error) {
      const normalized = error?.name === 'AbortError' ? new Error(`${definition.shortLabel} kontrolü zaman aşımına uğradı.`) : error;
      if (error?.status) normalized.status = error.status;
      errors.push(normalized);
      if (![400, 406, 415].includes(Number(error?.status))) break;
    } finally {
      clearTimeout(timer);
    }
  }
  throw errors.at(-1) || new Error(`${definition.shortLabel} kontrol edilemedi.`);
}

function buildFeatureInfoUrl(endpoint, layer, center, infoFormat) {
  const delta = 0.0012;
  const bbox = [center.lon - delta, center.lat - delta, center.lon + delta, center.lat + delta].map((value) => value.toFixed(7)).join(',');
  const url = new URL(endpoint);
  const params = {
    SERVICE: 'WMS', VERSION: '1.1.1', REQUEST: 'GetFeatureInfo', LAYERS: layer, QUERY_LAYERS: layer,
    STYLES: '', SRS: 'EPSG:4326', BBOX: bbox, WIDTH: '101', HEIGHT: '101', X: '50', Y: '50',
    FORMAT: 'image/png', INFO_FORMAT: infoFormat, FEATURE_COUNT: '10', TRANSPARENT: 'true'
  };
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url.toString();
}

export function parseFeatureInfo(text, contentType = '') {
  const source = String(text || '').trim();
  if (!source) return { matched: false, attributes: {} };
  if (/ServiceException|ExceptionReport|LayerNotDefined|InvalidFormat|OperationNotSupported/i.test(source)) {
    const error = new Error('Plan WMS servisi sorguyu kabul etmedi.');
    error.status = 406;
    throw error;
  }

  if (/json/i.test(contentType) || /^[\[{]/.test(source)) {
    try {
      const json = JSON.parse(source);
      const features = Array.isArray(json?.features) ? json.features : Array.isArray(json) ? json : [];
      if (!features.length) return { matched: false, attributes: {} };
      return { matched: true, attributes: sanitizeAttributes(features[0]?.properties || features[0] || {}) };
    } catch {
      // Sonraki ayrıştırıcılara geçilir.
    }
  }

  const htmlAttributes = parseHtmlTable(source);
  if (Object.keys(htmlAttributes).length) return { matched: true, attributes: htmlAttributes };

  const countMatch = source.match(/(?:numberOfFeatures|numberMatched)=["'](\d+)["']/i);
  if (countMatch && Number(countMatch[1]) === 0) return { matched: false, attributes: {} };

  const xmlAttributes = parseXmlAttributes(source);
  const matched = (countMatch && Number(countMatch[1]) > 0) || /<(?:gml:featureMember|wfs:member|featureMember)\b/i.test(source) || Object.keys(xmlAttributes).length > 0;
  return { matched: Boolean(matched), attributes: xmlAttributes };
}

function parseHtmlTable(source) {
  const output = {};
  const rowPattern = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  let row;
  while ((row = rowPattern.exec(source))) {
    const cells = [...row[1].matchAll(/<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/gi)].map((match) => stripMarkup(match[1]));
    if (cells.length >= 2 && cells[0] && cells[1]) output[cells[0]] = cells[1];
  }
  return sanitizeAttributes(output);
}

function parseXmlAttributes(source) {
  const output = {};
  const pattern = /<([A-Za-z_][\w.-]*(?::[A-Za-z_][\w.-]*)?)\b[^>]*>([^<]{1,800})<\/\1>/g;
  let match;
  while ((match = pattern.exec(source))) {
    const key = match[1].split(':').at(-1);
    const value = decodeEntities(match[2]);
    if (/^(boundedBy|coordinates|posList|pos|geometry|the_geom|geom)$/i.test(key)) continue;
    if (key && value) output[key] = value;
    if (Object.keys(output).length >= 60) break;
  }
  return sanitizeAttributes(output);
}

function normalizePlanMetadata(attributes = {}) {
  const lookup = new Map(Object.entries(attributes).map(([key, value]) => [normalizeKey(key), clean(value, 500)]));
  const pick = (...keys) => {
    for (const key of keys) {
      const value = lookup.get(normalizeKey(key));
      if (value) return value;
    }
    return null;
  };
  const metadata = {
    planName: pick('planAdi', 'plan_adi', 'planName', 'planBasligi', 'planAciklama', 'adi'),
    planScale: normalizeScale(pick('planOlcegi', 'plan_olcegi', 'olcek', 'scale')),
    planNumber: pick('planIslemNumarasi', 'plan_islem_numarasi', 'planNo', 'plan_no', 'kararNo', 'karar_no', 'islemNo'),
    planDate: normalizeDate(pick('onayTarihi', 'onay_tarihi', 'planOnayTarihi', 'planTarihi', 'tarih')),
    authority: pick('kurumAdi', 'kurum_adi', 'yetkiliIdare', 'idareAdi', 'onaylayanKurum', 'kurum'),
    planType: pick('planTuru', 'plan_turu', 'planTipi', 'plan_tipi', 'tur'),
    landUseHint: pick('fonksiyon', 'kullanimKarari', 'kullanim_karari', 'araziKullanimi', 'lejant', 'planFonksiyonu')
  };
  return Object.fromEntries(Object.entries(metadata).filter(([, value]) => value));
}

function mergeMatches(rawMatches) {
  const groups = new Map();
  for (const item of rawMatches) {
    const key = item.type;
    const current = groups.get(key) || {
      type: item.type,
      role: item.role,
      shortLabel: item.type === 'UIP' ? 'Uygulama İmar Planı kapsamı' : 'Nazım İmar Planı kapsamı',
      title: item.type === 'UIP' ? 'Kesinleşmiş Uygulama İmar Planı' : 'Kesinleşmiş Nazım İmar Planı',
      sourceId: `eplan-public-${item.type.toLowerCase()}`,
      serviceUrl: item.serviceUrl,
      layers: [],
      attributes: {},
      metadata: {}
    };
    current.layers.push(item.layer);
    current.attributes = { ...current.attributes, ...(item.attributes || {}) };
    current.metadata = { ...current.metadata, ...(item.metadata || {}) };
    if (item.role === 'metadata') current.role = 'metadata';
    groups.set(key, current);
  }
  return [...groups.values()];
}

function mergeMetadata(list) {
  const result = {};
  for (const metadata of list) for (const [key, value] of Object.entries(metadata || {})) if (!result[key] && value) result[key] = value;
  return result;
}

function sanitizeAttributes(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const output = {};
  for (const [key, item] of Object.entries(value).slice(0, 60)) {
    const safeKey = clean(key, 120);
    const safeValue = clean(Array.isArray(item) ? item.join(', ') : item, 500);
    if (safeKey && safeValue) output[safeKey] = safeValue;
  }
  return output;
}

function configuredLayers(env) {
  return DEFAULT_LAYERS.map((item) => {
    const isUip = item.type === 'UIP';
    const endpoint = isUip ? (env.EPLAN_PUBLIC_UIP_WMS_URL || item.endpoint) : (env.EPLAN_PUBLIC_NIP_WMS_URL || item.endpoint);
    const layer = item.role === 'coverage'
      ? isUip ? (env.EPLAN_PUBLIC_UIP_BOUNDARY_LAYER || env.EPLAN_PUBLIC_UIP_LAYER || item.layer) : (env.EPLAN_PUBLIC_NIP_BOUNDARY_LAYER || env.EPLAN_PUBLIC_NIP_LAYER || item.layer)
      : isUip ? (env.EPLAN_PUBLIC_UIP_DETAIL_LAYER || item.layer) : (env.EPLAN_PUBLIC_NIP_DETAIL_LAYER || item.layer);
    return { ...item, endpoint, layer };
  });
}

function allowedPublicWmsUrl(value) {
  const url = new URL(String(value));
  if (url.protocol !== 'https:') throw new Error('Plan WMS adresi HTTPS olmalıdır.');
  if (isPrivateHost(url.hostname)) throw new Error('Özel ağ adresine plan WMS isteği gönderilemez.');
  return url.toString();
}
function isPrivateHost(hostname) {
  const host = String(hostname).toLowerCase();
  if (host === 'localhost' || host.endsWith('.local')) return true;
  if (/^(127\.|10\.|192\.168\.|169\.254\.)/.test(host)) return true;
  const match = host.match(/^172\.(\d+)\./);
  return Boolean(match && Number(match[1]) >= 16 && Number(match[1]) <= 31);
}
function stripMarkup(value) { return clean(decodeEntities(String(value || '').replace(/<[^>]+>/g, ' ')), 700); }
function decodeEntities(value) { return String(value || '').replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'").replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&nbsp;/gi, ' ').replace(/&#(\d+);/g, (_m, code) => String.fromCodePoint(Number(code))).replace(/&#x([0-9a-f]+);/gi, (_m, code) => String.fromCodePoint(parseInt(code, 16))); }
function normalizeKey(value) { return String(value || '').toLocaleLowerCase('tr-TR').replace(/ç/g, 'c').replace(/ğ/g, 'g').replace(/ı/g, 'i').replace(/ö/g, 'o').replace(/ş/g, 's').replace(/ü/g, 'u').replace(/[^a-z0-9]/g, ''); }
function normalizeScale(value) { if (!value) return null; const text = clean(value, 80); const match = text.match(/(?:1\s*[:/]\s*)?(\d{3,7})/); return match ? `1/${Number(match[1]).toLocaleString('tr-TR')}` : text; }
function normalizeDate(value) { if (!value) return null; const text = clean(value, 80); const tr = text.match(/(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})/); if (tr) return `${tr[3]}-${String(tr[2]).padStart(2, '0')}-${String(tr[1]).padStart(2, '0')}`; const iso = text.match(/(\d{4})[.\/-](\d{1,2})[.\/-](\d{1,2})/); return iso ? `${iso[1]}-${String(iso[2]).padStart(2, '0')}-${String(iso[3]).padStart(2, '0')}` : null; }
function unavailable(message, center = null, diagnostics = []) { return { status: 'unavailable', center, matches: [], metadata: {}, sources: [], diagnostics: Array.isArray(diagnostics) ? diagnostics : [], message: clean(message, 500) }; }
function clampInt(value, min, max, fallback) { const number = Number(value); return Number.isFinite(number) ? Math.min(max, Math.max(min, Math.trunc(number))) : fallback; }
function clean(value, max = 500) { if (value == null) return null; const text = String(value).replace(/[\u0000-\u001f<>]/g, ' ').replace(/\s+/g, ' ').trim(); return text ? text.slice(0, max) : null; }
function trimCache() { while (CACHE.size > 500) CACHE.delete(CACHE.keys().next().value); }
