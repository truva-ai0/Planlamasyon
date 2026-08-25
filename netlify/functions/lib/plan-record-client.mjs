import { matchEmbeddedCatalog } from './municipality-provider.mjs';

const CACHE = globalThis.__PLANLAMASYON_PLAN_RECORD_CACHE__ || new Map();
globalThis.__PLANLAMASYON_PLAN_RECORD_CACHE__ = CACHE;

export const PUBLIC_PLAN_RECORD_VERSION = '2026-08-23';

// Kamuya açık ve doğrulanmış örnek plan kayıtları. Bunlar yapılaşma hakkı değildir;
// yalnızca ilgili parsel için resmî bir plan/askı kaydı bulunduğunu gösterir.
export const EMBEDDED_PUBLIC_PLAN_RECORDS = Object.freeze([
  Object.freeze({
    id: 'istanbul-pendik-yesilbaglar-964-26-nip-2010',
    province: 'İstanbul',
    district: 'Pendik',
    neighbourhood: 'Yeşil Bağlar',
    block: '964',
    parcel: '26',
    authority: 'Pendik Belediyesi',
    title: 'PENDİK REVİZYON NİP / YEŞİLBAĞLAR MAH. 964 ADA 26 PARSELE İLİŞKİN N.İ.P. DEĞİŞİKLİĞİ',
    description: 'Yeşilbağlar Mahallesi 964 ada 26 parsele ilişkin nazım imar planı değişikliği askı kaydı.',
    planType: 'NİP',
    planScale: null,
    planScaleConfidence: null,
    announcementStart: '2010-01-12',
    announcementEnd: '2010-02-12',
    recordStatus: 'historical-announcement',
    sourceUrl: 'https://www.turkiye.gov.tr/pendik-belediyesi-askidaki-imar-plani-sorgulama?index=160&islem=detay',
    sourceTitle: 'Pendik Belediyesi Askıdaki İmar Planı Sorgulama',
    note: 'Bu bir resmî askı kaydıdır. Güncel yürürlük, plan paftası, plan notları ve yapılaşma koşulları ayrıca doğrulanmalıdır.'
  })
]);

export async function discoverPublicPlanRecords({ parcel, query = {}, env = process.env, fetchImpl = globalThis.fetch }) {
  const location = resolveLocation(parcel, query);
  if (!location.block || !location.parcel) return unavailable('Ada ve parsel bilgisi bulunmadı.', location);
  const enabled = String(env.PUBLIC_PLAN_RECORD_DISCOVERY_ENABLED ?? 'true').toLowerCase() === 'true';
  if (!enabled) return unavailable('Kamu plan kaydı araması bu kurulumda kapalı.', location);

  const embedded = matchRecords([
    ...EMBEDDED_PUBLIC_PLAN_RECORDS,
    ...parseConfiguredRecords(env.PUBLIC_PLAN_RECORDS_JSON)
  ], location).map((record) => normalizeRecord(record, { discovery: 'embedded' })).filter(Boolean);

  const cacheDisabled = String(env.PUBLIC_PLAN_RECORD_CACHE_DISABLED ?? 'false').toLowerCase() === 'true';
  const key = [location.provinceKey, location.districtKey, location.neighbourhoodKey, location.block, location.parcel].join(':');
  if (!cacheDisabled) {
    const cached = CACHE.get(key);
    if (cached?.expiresAt > Date.now()) return mergeResults(cached.value, embedded, location);
  }

  const diagnostics = [];
  let remoteRecords = [];
  let successfulSources = 0;
  const remoteEnabled = String(env.PUBLIC_PLAN_RECORD_REMOTE_ENABLED ?? 'true').toLowerCase() === 'true';
  const sourceUrls = remoteEnabled ? buildSourceUrls(location, env) : [];
  if (typeof fetchImpl === 'function' && sourceUrls.length) {
    const totalBudget = clampInt(env.PUBLIC_PLAN_RECORD_TOTAL_TIMEOUT_MS, 1800, 30000, 4800);
    const perSource = clampInt(env.PUBLIC_PLAN_RECORD_TIMEOUT_MS, 900, 15000, 2200);
    const startedAt = Date.now();
    for (const url of sourceUrls) {
      const remaining = totalBudget - (Date.now() - startedAt);
      if (remaining < 700) break;
      try {
        const html = await fetchOfficialPage(url, fetchImpl, Math.min(perSource, remaining));
        successfulSources += 1;
        remoteRecords.push(...parseOfficialPlanPage(html, url, location));
        if (remoteRecords.some((record) => record.matchStrength === 'exact')) break;
      } catch (error) {
        diagnostics.push({ source: safeHost(url), message: clean(error?.message || error, 360), status: error?.status || null });
      }
    }
  }

  remoteRecords = dedupeRecords(remoteRecords);
  const remoteResult = {
    status: remoteRecords.length ? 'available' : successfulSources ? 'not-found' : 'unavailable',
    location,
    records: remoteRecords,
    sources: remoteRecords.map(recordSource),
    diagnostics,
    successfulSources,
    message: remoteRecords.length
      ? `${remoteRecords.length} resmî plan/askı kaydı bulundu.`
      : successfulSources
        ? 'Kontrol edilen kamu plan sayfalarında ada/parsel ile eşleşen kayıt bulunamadı.'
        : 'Kamu plan kayıt sayfaları geçici olarak okunamadı.'
  };

  if (!cacheDisabled) {
    CACHE.set(key, { value: remoteResult, expiresAt: Date.now() + 6 * 60 * 60 * 1000 });
    trimCache();
  }
  return mergeResults(remoteResult, embedded, location);
}

export function matchEmbeddedPublicPlanRecords(query = {}) {
  const location = resolveLocation(null, query);
  return matchRecords(EMBEDDED_PUBLIC_PLAN_RECORDS, location).map((record) => normalizeRecord(record, { discovery: 'embedded' })).filter(Boolean);
}

export function parseOfficialPlanPage(html, sourceUrl, location) {
  const source = String(html || '');
  if (!source || !/imar|plan|n\.?[iİ]\.?p|u\.?[iİ]\.?p/i.test(source)) return [];
  const rows = extractRows(source);
  const matches = [];
  for (const row of rows) {
    const text = row.text;
    const strength = parcelMatchStrength(text, location);
    if (!strength) continue;
    const record = recordFromRow(row, sourceUrl, location, strength);
    if (record) matches.push(record);
  }
  if (!matches.length) {
    const text = stripMarkup(source);
    const strength = parcelMatchStrength(text, location);
    if (strength) {
      const excerpt = contextExcerpt(text, location);
      const record = normalizeRecord({
        id: `public-page-${hash(`${sourceUrl}:${location.block}:${location.parcel}`)}`,
        province: location.province,
        district: location.district,
        neighbourhood: location.neighbourhood,
        block: location.block,
        parcel: location.parcel,
        authority: `${location.district || location.province || 'Yetkili'} Belediyesi`,
        title: inferTitle(excerpt) || `${location.block} ada ${location.parcel} parsel plan kaydı`,
        description: excerpt,
        ...inferPlanMetadata(excerpt),
        recordStatus: /yürürlükte/i.test(excerpt) ? 'published-current-reference' : 'public-announcement',
        sourceUrl,
        sourceTitle: 'e-Devlet Askıdaki İmar Planı Sorgulama',
        note: 'Kamuya açık resmî sayfada ada/parsel eşleşmesi bulundu. Güncel yürürlük ve yapılaşma koşulları ayrıca doğrulanmalıdır.',
        matchStrength: strength
      }, { discovery: 'remote' });
      if (record) matches.push(record);
    }
  }
  return dedupeRecords(matches);
}

function extractRows(source) {
  const rows = [];
  const rowPattern = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  let match;
  while ((match = rowPattern.exec(source))) {
    const rowHtml = match[1];
    const cells = [...rowHtml.matchAll(/<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/gi)]
      .map((item) => stripMarkup(item[1]))
      .filter(Boolean);
    if (!cells.length) continue;
    const hrefMatch = rowHtml.match(/<a\b[^>]*href=["']([^"']+)["']/i);
    rows.push({ cells, text: cells.join(' | '), href: hrefMatch?.[1] || null });
  }
  return rows;
}

function recordFromRow(row, sourceUrl, location, strength) {
  const text = row.text;
  const dates = [...text.matchAll(/\b(\d{2})[.\/-](\d{2})[.\/-](\d{4})\b/g)].map((match) => `${match[3]}-${match[2]}-${match[1]}`);
  const description = row.cells.slice().sort((a, b) => b.length - a.length)[0] || text;
  const title = inferTitle(description) || `${location.block} ada ${location.parcel} parsel plan kaydı`;
  const detailUrl = safeOfficialUrl(row.href, sourceUrl) || sourceUrl;
  return normalizeRecord({
    id: `public-row-${hash(`${detailUrl}:${title}`)}`,
    province: location.province,
    district: location.district,
    neighbourhood: location.neighbourhood,
    block: location.block,
    parcel: location.parcel,
    authority: `${location.district || location.province || 'Yetkili'} Belediyesi`,
    title,
    description,
    ...inferPlanMetadata(`${title} ${description}`),
    announcementStart: dates[0] || null,
    announcementEnd: dates[1] || null,
    recordStatus: /yürürlükte/i.test(text) ? 'published-current-reference' : 'public-announcement',
    sourceUrl: detailUrl,
    sourceTitle: 'e-Devlet Askıdaki İmar Planı Sorgulama',
    note: 'Kamuya açık resmî askı/plan kaydıdır. Güncel imar durumu, plan notları ve yapılaşma koşulları ayrı kaynaktan doğrulanmalıdır.',
    matchStrength: strength
  }, { discovery: 'remote' });
}

function inferPlanMetadata(text) {
  const source = String(text || '');
  let planType = null;
  let planScale = null;
  let planScaleConfidence = null;
  if (/\bU\.?İ\.?P\.?\b|uygulama imar plan/i.test(source)) {
    planType = 'UİP';
  } else if (/\bN\.?İ\.?P\.?\b|nazım imar plan/i.test(source)) {
    planType = 'NİP';
  } else if (/çevre düzeni plan/i.test(source)) planType = 'ÇDP';
  const explicitScale = source.match(/\b1\s*\/\s*(500|1000|5000|25000|50000|100000)\b/i);
  if (explicitScale) {
    planScale = `1/${explicitScale[1]}`;
    planScaleConfidence = 'explicit';
  }
  const functionCandidate = inferFunctionCandidate(source);
  const indicators = extractRecordIndicators(source);
  return { planType, planScale, planScaleConfidence, functionCandidate, indicators };
}

export function extractRecordIndicators(text) {
  const source = String(text || '').toLocaleUpperCase('tr-TR').replace(/,/g, '.');
  const result = {
    taksMentioned: null,
    emsalMentioned: null,
    floorsMentioned: null,
    hmaxMentioned: null,
    landUsesMentioned: []
  };
  const taks = source.match(/\bTAKS\s*[:=]?\s*(0(?:\.\d+)?|1(?:\.0+)?)\b/);
  const emsal = source.match(/\b(?:EMSAL|KAKS|E)\s*[:=]?\s*(\d+(?:\.\d+)?)\b/);
  if (taks) result.taksMentioned = safeRatio(taks[1], 1);
  if (emsal) result.emsalMentioned = safeRatio(emsal[1], 15);
  if (result.taksMentioned == null || result.emsalMentioned == null) {
    const pair = source.match(/\b(?:0|O)[.]?(\d{2})\s*[/\\-]\s*(\d+(?:\.\d+)?)\b(?=[^\n]{0,100}(?:YAPILANMA|ŞART|KONUT|TİCARET))/);
    if (pair) {
      if (result.taksMentioned == null) result.taksMentioned = safeRatio(`0.${pair[1]}`, 1);
      if (result.emsalMentioned == null) result.emsalMentioned = safeRatio(pair[2], 15);
    }
  }
  const floors = source.match(/\b(\d{1,2})\s*KAT(?:LI|A|IN)?\b/);
  if (floors) result.floorsMentioned = safeInteger(floors[1], 1, 150);
  const hmax = source.match(/\b(?:HMAX|HMAKS|YENÇOK|YEN\s*ÇOK)\s*[:=]?\s*(\d+(?:\.\d+)?)\s*M?\b/);
  if (hmax) result.hmaxMentioned = safeNumber(hmax[1], 0, 1000);
  const landUsePatterns = [
    ['Ticaret + Konut', /TİCARET\s*[+]\s*KONUT|TİCARET\s+VE\s+KONUT/],
    ['Konut Alanı', /\bKONUT\s+ALANI\b/],
    ['Ticaret Alanı', /\bTİCARET\s+ALANI\b/],
    ['Park / Yeşil Alan', /\bPARK\s+ALANI\b|YEŞİL\s+ALAN/],
    ['Sağlık Tesisi Alanı', /SAĞLIK\s+TESİS/],
    ['Eğitim Tesisi Alanı', /EĞİTİM\s+ALANI|OKUL\s+ALANI|İLKÖĞRETİM|ORTAÖĞRETİM|MESLEK\s+LİSESİ/],
    ['Sanayi Alanı', /SANAYİ\s+(?:ALANI|BÖLGESİ)/],
    ['Turizm Tesis Alanı', /TURİZM\s+TESİS/],
    ['Akaryakıt Alanı', /AKARYAKIT/],
    ['Kentsel Hizmet / İdari Tesis', /KENTSEL\s+HİZMET|İDARİ\s+TESİS/]
  ];
  result.landUsesMentioned = landUsePatterns.filter(([, pattern]) => pattern.test(source)).map(([label]) => label);
  return result;
}

function inferFunctionCandidate(text) {
  const patterns = [
    ['Konut Alanı', /konut alan(?:ı|ina)/i],
    ['Ticaret Alanı', /ticaret alan(?:ı|ina)/i],
    ['Turizm Tesis Alanı', /turizm tesis(?:i|leri)? alan(?:ı|ina)/i],
    ['Sağlık Tesisi Alanı', /sağlık tesis(?:i)? alan(?:ı|ina)/i],
    ['Eğitim Tesisi Alanı', /eğitim|okul|ilköğretim|ortaöğretim|meslek lisesi/i],
    ['Sosyal / Kültürel Tesis Alanı', /sosyal tesis|kültürel tesis/i],
    ['Park / Yeşil Alan', /park alan(?:ı|ina)|yeşil alan/i],
    ['Sanayi Alanı', /sanayi alan(?:ı|ina)/i],
    ['Akaryakıt Alanı', /akaryakıt alan(?:ı|ina)/i]
  ];
  return patterns.find(([, pattern]) => pattern.test(text))?.[0] || null;
}

function inferTitle(text) {
  const source = clean(text, 900);
  if (!source) return null;
  const parts = source.split(/\s+\|\s+/).map((item) => clean(item, 500)).filter(Boolean);
  const likely = parts.find((item) => /imar|\bU\.?İ\.?P\.?\b|\bN\.?İ\.?P\.?\b|plan/i.test(item) && item.length > 12);
  return clean(likely || parts.sort((a, b) => b.length - a.length)[0] || source, 500);
}

function parcelMatchStrength(text, location) {
  const normalized = normalizeText(text);
  const blockValue = String(location?.block ?? '').replace(/^0+(?=\d)/, '');
  const parcelValue = String(location?.parcel ?? '').replace(/^0+(?=\d)/, '');
  if (!/^\d+$/.test(blockValue) || !/^\d+$/.test(parcelValue)) return null;
  const block = escapeRegex(blockValue);
  const parcel = escapeRegex(parcelValue);
  const exactPatterns = [
    new RegExp(String.raw`\b0*${block}\s*ada\s*(?:no\.?\s*)?0*${parcel}\s*parsel[a-z]*\b`, 'i'),
    new RegExp(String.raw`\b0*${block}\s*[/\-]\s*0*${parcel}\b`, 'i'),
    new RegExp(String.raw`\b0*${block}\s*ada[^\n]{0,100}\b0*${parcel}\s*(?:sayili\s*)?parsel[a-z]*\b`, 'i')
  ];
  if (exactPatterns.some((pattern) => pattern.test(normalized))) return 'exact';
  if (normalized.includes(`${blockValue} ada`) && normalized.includes(`${parcelValue} parsel`)) return 'strong';
  return null;
}

function contextExcerpt(text, location) {
  const normalized = String(text || '').replace(/\s+/g, ' ');
  const token = `${location.block} ada`;
  let index = normalizeText(normalized).indexOf(token);
  if (index < 0) index = normalizeText(normalized).indexOf(`${location.block}/${location.parcel}`);
  if (index < 0) return clean(normalized, 900);
  return clean(normalized.slice(Math.max(0, index - 180), index + 720), 900);
}

function buildSourceUrls(location, env) {
  const urls = [];
  const configured = parseConfiguredSources(env.PUBLIC_PLAN_RECORD_SOURCES_JSON, location);
  urls.push(...configured);

  const catalogRecords = matchEmbeddedCatalog({
    province: location.province,
    district: location.district,
    provinceKey: location.provinceKey,
    districtKey: location.districtKey
  });
  for (const record of catalogRecords) {
    const descriptor = `${record.title || ''} ${record.note || ''} ${record.url || ''}`;
    if (/ask[ıi]daki\s+imar\s+plan|ask[ıi]daki\s+plan|plan\s+ask[ıi]|yürürlükteki\s+plan/i.test(descriptor)) urls.push(record.url);
  }

  if (location.districtKey) {
    const slug = slugify(location.district);
    if (slug) {
      urls.push(`https://www.turkiye.gov.tr/${slug}-belediyesi-askidaki-imar-plani-sorgulama`);
      urls.push(`https://www.turkiye.gov.tr/${slug}-belediyesi-askidaki-imar-plani-sorgulama-v2`);
    }
  }
  return [...new Set(urls.map((url) => safeOfficialUrl(url)).filter(Boolean))].slice(0, 8);
}

async function fetchOfficialPage(url, fetchImpl, timeoutMs) {
  const safeUrl = safeOfficialUrl(url);
  if (!safeUrl) throw new Error('Plan kayıt kaynağı resmî e-Devlet adresi değil.');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(safeUrl, {
      headers: {
        Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5',
        'Accept-Language': 'tr-TR,tr;q=0.9,en;q=0.5',
        'User-Agent': 'Planlamasyon/3.5.0 (+https://planlamasyon.truva-ai.com)'
      },
      redirect: 'follow',
      signal: controller.signal
    });
    if (response.status === 404) { const error = new Error('Resmî askı hizmeti bulunamadı.'); error.status = 404; throw error; }
    if (!response.ok) { const error = new Error(`Resmî plan sayfası ${response.status} yanıtı verdi.`); error.status = response.status; throw error; }
    const text = await response.text();
    if (!/e-Devlet|Askıdaki İmar Planı|imar plan/i.test(text)) throw new Error('Beklenen resmî plan sayfası içeriği alınamadı.');
    return text;
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('Resmî plan sayfası zaman aşımına uğradı.');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function mergeResults(remoteResult, embedded, location) {
  const records = dedupeRecords([...(embedded || []), ...(remoteResult?.records || [])]);
  const sources = dedupeSources(records.map(recordSource));
  const diagnostics = remoteResult?.diagnostics || [];
  return {
    status: records.length ? 'available' : remoteResult?.status || 'unavailable',
    location,
    records,
    sources,
    diagnostics,
    successfulSources: remoteResult?.successfulSources || 0,
    embeddedCount: embedded?.length || 0,
    message: records.length
      ? `${records.length} resmî plan/askı kaydı ada-parsel ile eşleştirildi. Bu kayıtlar güncel yapılaşma hakkı yerine geçmez.`
      : remoteResult?.message || 'Resmî plan kaydı bulunamadı.'
  };
}

function matchRecords(records, location) {
  return records.filter((record) => {
    if (normalize(record.province) && normalize(record.province) !== location.provinceKey) return false;
    if (normalize(record.district) && normalize(record.district) !== location.districtKey) return false;
    if (String(record.block || '').trim() !== String(location.block || '').trim()) return false;
    if (String(record.parcel || '').trim() !== String(location.parcel || '').trim()) return false;
    if (record.neighbourhood && location.neighbourhoodKey) {
      const a = normalize(record.neighbourhood);
      if (a && !location.neighbourhoodKey.includes(a) && !a.includes(location.neighbourhoodKey)) return false;
    }
    return true;
  });
}

function normalizeRecord(record, defaults = {}) {
  if (!record) return null;
  const sourceUrl = safeOfficialUrl(record.sourceUrl || record.url);
  if (!sourceUrl) return null;
  return {
    id: clean(record.id, 160) || `public-record-${hash(sourceUrl)}`,
    province: clean(record.province, 120),
    district: clean(record.district, 120),
    neighbourhood: clean(record.neighbourhood, 160),
    block: clean(record.block, 40),
    parcel: clean(record.parcel, 40),
    authority: clean(record.authority, 240),
    title: clean(record.title, 600),
    description: clean(record.description, 1200),
    planType: clean(record.planType, 80),
    planScale: clean(record.planScale, 80),
    planScaleConfidence: clean(record.planScaleConfidence, 80),
    functionCandidate: clean(record.functionCandidate, 180),
    indicators: normalizeIndicators(record.indicators),
    announcementStart: isoDate(record.announcementStart),
    announcementEnd: isoDate(record.announcementEnd),
    recordStatus: clean(record.recordStatus, 80) || 'public-announcement',
    sourceUrl,
    sourceTitle: clean(record.sourceTitle, 260) || 'Resmî kamu plan kaydı',
    note: clean(record.note, 800),
    matchStrength: clean(record.matchStrength, 40) || 'exact',
    discovery: clean(record.discovery || defaults.discovery, 40) || 'embedded'
  };
}

function recordSource(record) {
  return {
    id: `plan-record-${record.id}`,
    title: record.title || record.sourceTitle || 'Resmî plan/askı kaydı',
    provider: record.authority || 'İlgili belediye / e-Devlet Kapısı',
    url: record.sourceUrl,
    kind: 'official-plan-record',
    trust: 'public-information',
    note: record.note || 'Ada/parsel ile eşleşen kamuya açık plan kaydıdır; güncel yapılaşma hakkı değildir.',
    documentDate: record.announcementStart || null,
    retrievedAt: new Date().toISOString()
  };
}

function parseConfiguredRecords(value) {
  if (!value) return [];
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    return Array.isArray(parsed) ? parsed : Array.isArray(parsed?.records) ? parsed.records : [];
  } catch { return []; }
}
function parseConfiguredSources(value, location) {
  if (!value) return [];
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    const list = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.sources) ? parsed.sources : [];
    return list.filter((item) => matchesLocation(item, location)).map((item) => item.url).filter(Boolean);
  } catch { return []; }
}
function matchesLocation(item, location) {
  if (!item) return false;
  const province = normalize(item.province || item.il || '*');
  const district = normalize(item.district || item.ilce || '*');
  return (province === '*' || province === location.provinceKey) && (district === '*' || district === location.districtKey);
}
function resolveLocation(parcel, query = {}) {
  const p = parcel?.properties || {};
  const province = clean(p.province || query.province, 120);
  const district = clean(p.district || query.district, 120);
  const neighbourhood = clean(p.neighbourhood || query.neighbourhood, 160);
  const block = clean(p.block || query.block, 40);
  const parcelNo = clean(p.parcel || query.parcel, 40);
  return { province, district, neighbourhood, block, parcel: parcelNo, provinceKey: normalize(province), districtKey: normalize(district), neighbourhoodKey: normalize(neighbourhood) };
}
function unavailable(message, location = {}) { return { status: 'unavailable', location, records: [], sources: [], diagnostics: [], message }; }
function safeOfficialUrl(value, base = null) {
  if (!value) return null;
  try {
    const url = new URL(String(value), base || undefined);
    const host = url.hostname.toLowerCase();
    if (url.protocol !== 'https:' || !['turkiye.gov.tr', 'www.turkiye.gov.tr'].includes(host)) return null;
    url.hash = '';
    return url.toString();
  } catch { return null; }
}
function stripMarkup(value) {
  return decodeEntities(String(value || '')
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?\s*>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')).trim();
}
function decodeEntities(value) {
  return String(value || '').replace(/&nbsp;|&#160;/gi, ' ').replace(/&amp;/gi, '&').replace(/&quot;|&#34;/gi, '"').replace(/&#39;|&apos;/gi, "'").replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}
function normalizeText(value) { return String(value || '').toLocaleLowerCase('tr-TR').replace(/ç/g,'c').replace(/ğ/g,'g').replace(/ı/g,'i').replace(/ö/g,'o').replace(/ş/g,'s').replace(/ü/g,'u').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' '); }
function normalize(value) { return normalizeText(value).replace(/[^a-z0-9*]/g, ''); }
function slugify(value) { return normalizeText(value).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }
function clean(value, max = 500) { if (value == null) return null; const text = String(value).replace(/[\u0000-\u001f<>]/g, ' ').replace(/\s+/g, ' ').trim(); return text ? text.slice(0, max) : null; }
function isoDate(value) { if (!value) return null; const text = String(value).trim(); if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text; const match = text.match(/^(\d{2})[.\/-](\d{2})[.\/-](\d{4})$/); return match ? `${match[3]}-${match[2]}-${match[1]}` : null; }
function normalizeIndicators(value) {
  const input = value && typeof value === 'object' ? value : {};
  return {
    taksMentioned: safeRatio(input.taksMentioned, 1),
    emsalMentioned: safeRatio(input.emsalMentioned, 15),
    floorsMentioned: safeInteger(input.floorsMentioned, 1, 150),
    hmaxMentioned: safeNumber(input.hmaxMentioned, 0, 1000),
    landUsesMentioned: Array.isArray(input.landUsesMentioned) ? input.landUsesMentioned.map((item) => clean(item, 160)).filter(Boolean).slice(0, 12) : []
  };
}
function safeRatio(value, max) { if (value == null || value === '') return null; const number = Number(String(value).replace(',', '.')); return Number.isFinite(number) && number >= 0 && number <= max ? number : null; }
function safeInteger(value, min, max) { if (value == null || value === '') return null; const number = Number(value); return Number.isInteger(number) && number >= min && number <= max ? number : null; }
function safeNumber(value, min, max) { if (value == null || value === '') return null; const number = Number(String(value).replace(',', '.')); return Number.isFinite(number) && number >= min && number <= max ? number : null; }
function safeHost(value) { try { return new URL(String(value)).hostname; } catch { return 'resmî kaynak'; } }
function hash(value) { let h = 2166136261; for (const char of String(value)) { h ^= char.charCodeAt(0); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); }
function escapeRegex(value) { return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function clampInt(value, min, max, fallback) { const number = Number(value); return Number.isFinite(number) ? Math.min(max, Math.max(min, Math.trunc(number))) : fallback; }
function dedupeRecords(records) { const seen = new Set(); return records.filter((record) => { const key = record?.id || `${record?.sourceUrl}:${record?.title}`; if (!key || seen.has(key)) return false; seen.add(key); return true; }); }
function dedupeSources(sources) { const seen = new Set(); return sources.filter((source) => { const key = source?.id || source?.url; if (!key || seen.has(key)) return false; seen.add(key); return true; }); }
function trimCache() { while (CACHE.size > 500) CACHE.delete(CACHE.keys().next().value); }
