const DEFAULT_API_BASE = 'https://cbsapi.tkgm.gov.tr/megsiswebapi.v3.1/api';
const DEFAULT_PROVINCES_URL = `${DEFAULT_API_BASE}/idariYapi/ilListe`;
const DEFAULT_PROVINCES_FALLBACK_URL = 'https://parselsorgu.tkgm.gov.tr/app/modules/administrativeQuery/data/ilListe.json';
const ALLOWED_HOSTS = new Set(['cbsapi.tkgm.gov.tr', 'parselsorgu.tkgm.gov.tr']);
const CACHE = globalThis.__PLANLAMASYON_TKGM_CACHE__ || new Map();
globalThis.__PLANLAMASYON_TKGM_CACHE__ = CACHE;

export class TkgmPublicInfoClient {
  constructor(env = process.env, options = {}) {
    this.apiBase = stripSlash(env.TKGM_PUBLIC_API_BASE || DEFAULT_API_BASE);
    this.provincesUrl = env.TKGM_PUBLIC_PROVINCES_URL || `${this.apiBase}/idariYapi/ilListe`;
    this.provincesFallbackUrl = env.TKGM_PUBLIC_PROVINCES_FALLBACK_URL || DEFAULT_PROVINCES_FALLBACK_URL;
    this.timeoutMs = clampInt(env.TKGM_TIMEOUT_MS, 1500, 30000, 15000);
    this.fetchImpl = options.fetchImpl || globalThis.fetch;
    this.userAgent = env.TKGM_USER_AGENT || 'Mozilla/5.0 (compatible; Planlamasyon/3.0; +https://planlamasyon.com)';
    this.enabled = String(env.TKGM_PUBLIC_INFO_ENABLED ?? 'true').toLowerCase() === 'true';
    this.bearerToken = cleanSecret(env.TKGM_BEARER_TOKEN, 8192);
    this.cacheTtlAdminMs = clampInt(env.TKGM_ADMIN_CACHE_TTL_MS, 60000, 86400000, 21600000);
    this.cacheTtlParcelMs = clampInt(env.TKGM_PARCEL_CACHE_TTL_MS, 10000, 3600000, 300000);
  }

  async getProvinces() {
    this.#assertEnabled();
    let lastError;
    const urls = [...new Set([this.provincesUrl, this.provincesFallbackUrl].filter(Boolean))];
    for (const [index, url] of urls.entries()) {
      try {
        const payload = await this.#cachedJson(`provinces:${index}`, url, this.cacheTtlAdminMs);
        return normalizeAdministrativeCollection(payload, 'province');
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError || serviceError('TKGM il listesi alınamadı.', 502, 'TKGM_DIRECTORY_UNAVAILABLE');
  }

  async getDistricts(provinceId) {
    this.#assertEnabled();
    const id = positiveId(provinceId, 'provinceId');
    const url = `${this.apiBase}/idariYapi/ilceListe/${encodeURIComponent(id)}`;
    const payload = await this.#cachedJson(`districts:${id}`, url, this.cacheTtlAdminMs);
    return normalizeAdministrativeCollection(payload, 'district');
  }

  async getNeighbourhoods(districtId) {
    this.#assertEnabled();
    const id = positiveId(districtId, 'districtId');
    const url = `${this.apiBase}/idariYapi/mahalleListe/${encodeURIComponent(id)}`;
    const payload = await this.#cachedJson(`neighbourhoods:${id}`, url, this.cacheTtlAdminMs);
    return normalizeAdministrativeCollection(payload, 'neighbourhood');
  }

  async getParcel({ neighbourhoodId, block, parcel }) {
    this.#assertEnabled();
    const nId = positiveId(neighbourhoodId, 'neighbourhoodId');
    const blockNo = safeParcelPart(block, 'block');
    const parcelNo = safeParcelPart(parcel, 'parcel');
    const url = `${this.apiBase}/parsel/${encodeURIComponent(nId)}/${encodeURIComponent(blockNo)}/${encodeURIComponent(parcelNo)}`;
    const payload = await this.#cachedJson(`parcel:${nId}:${blockNo}:${parcelNo}`, url, this.cacheTtlParcelMs, { allowNotFound: true });
    if (!payload) return null;
    return normalizeParcel(payload, { neighbourhoodId: nId, block: blockNo, parcel: parcelNo });
  }

  async getParcelByCoordinate({ lat, lon }) {
    this.#assertEnabled();
    const latitude = finiteCoordinate(lat, -90, 90, 'lat');
    const longitude = finiteCoordinate(lon, -180, 180, 'lon');
    const key = `parcel-coordinate:${latitude.toFixed(7)}:${longitude.toFixed(7)}`;
    const url = `${this.apiBase}/parsel/${encodeURIComponent(latitude)}/${encodeURIComponent(longitude)}/`;
    const payload = await this.#cachedJson(key, url, this.cacheTtlParcelMs, { allowNotFound: true });
    if (!payload) return null;
    return normalizeParcel(payload, {});
  }

  async #cachedJson(key, url, ttlMs, options = {}) {
    const cached = CACHE.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.value;
    const value = await this.#fetchJson(url, options);
    CACHE.set(key, { value, expiresAt: Date.now() + ttlMs });
    trimCache();
    return value;
  }

  async #fetchJson(url, { allowNotFound = false } = {}) {
    if (typeof this.fetchImpl !== 'function') throw serviceError('Sunucuda fetch desteği yok.', 500, 'FETCH_UNAVAILABLE');
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || !ALLOWED_HOSTS.has(parsed.hostname)) {
      throw serviceError('İzin verilmeyen TKGM servis adresi.', 500, 'UPSTREAM_NOT_ALLOWED');
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      // No Origin/Referer forgery and no authentication bypass. Only ordinary
      // public information requests are made to fixed TKGM hosts.
      const response = await this.fetchImpl(parsed, {
        method: 'GET',
        headers: {
          Accept: 'application/json, application/geo+json;q=0.9, */*;q=0.1',
          'User-Agent': this.userAgent,
          ...(this.bearerToken ? { Authorization: `Bearer ${this.bearerToken}` } : {})
        },
        redirect: 'follow',
        signal: controller.signal
      });

      if (allowNotFound && (response.status === 404 || response.status === 204)) return null;
      if (response.status === 429) throw serviceError('TKGM sorgu sınırına ulaşıldı. Lütfen kısa süre sonra tekrar deneyin.', 429, 'TKGM_RATE_LIMIT');
      if (!response.ok) {
        const body = await safeText(response);
        const message = extractProviderMessage(body) || `TKGM servisi ${response.status} yanıtı verdi.`;
        const restricted = response.status === 401 || response.status === 403;
        throw serviceError(
          message,
          restricted ? 503 : 502,
          restricted ? (this.bearerToken ? 'TKGM_ACCESS_RESTRICTED' : 'TKGM_AUTH_OR_ACCESS_REQUIRED') : 'TKGM_UPSTREAM_ERROR'
        );
      }

      const contentType = String(response.headers?.get?.('content-type') || '').toLowerCase();
      const text = await response.text();
      if (!text.trim()) return null;
      try {
        return JSON.parse(text);
      } catch {
        throw serviceError(contentType.includes('html') ? 'TKGM servisi beklenmeyen bir HTML yanıtı verdi.' : 'TKGM servis yanıtı JSON olarak okunamadı.', 502, 'TKGM_INVALID_RESPONSE');
      }
    } catch (error) {
      if (error?.name === 'AbortError') throw serviceError('TKGM servisi zaman aşımına uğradı.', 504, 'TKGM_TIMEOUT');
      if (error?.statusCode) throw error;
      throw serviceError('TKGM servisine ulaşılamadı.', 502, 'TKGM_NETWORK_ERROR', error);
    } finally {
      clearTimeout(timer);
    }
  }

  #assertEnabled() {
    if (!this.enabled) throw serviceError('TKGM bilgi amaçlı bağlantısı bu kurulumda kapalı.', 503, 'TKGM_PUBLIC_INFO_DISABLED');
  }
}

export function normalizeAdministrativeCollection(payload, kind) {
  const features = extractFeatures(payload);
  const seen = new Set();
  const items = [];
  for (const feature of features) {
    const props = feature?.properties || feature || {};
    const id = normalizeId(props.id ?? props.kod ?? props.ilKodu ?? props.ilceKodu ?? props.mahalleKodu ?? props.mahalleId);
    const name = cleanText(props.text ?? props.ad ?? props.name ?? props.ilAdi ?? props.ilceAdi ?? props.mahalleAdi, 160);
    if (id == null || !name || seen.has(String(id))) continue;
    seen.add(String(id));
    items.push({
      id,
      name,
      parentId: normalizeId(props.ilId ?? props.ilKodu ?? props.ilceId ?? props.ilceKodu),
      geometry: sanitizeGeometry(feature?.geometry || props.geometry)
    });
  }
  items.sort((a, b) => a.name.localeCompare(b.name, 'tr'));
  if (!items.length) throw serviceError(`TKGM ${kind} listesi boş döndü.`, 502, 'TKGM_EMPTY_DIRECTORY');
  return { items, source: sourceMeta() };
}

export function normalizeParcel(payload, fallback = {}) {
  const feature = selectFeature(payload);
  if (!feature) return null;
  const props = feature.properties || payload.properties || {};
  const geometry = sanitizeGeometry(feature.geometry || payload.geometry);
  if (!geometry) throw serviceError('Parsel yanıtında geçerli geometri bulunamadı.', 502, 'TKGM_GEOMETRY_MISSING');

  const areaText = cleanText(props.alan ?? props.yuzolcumu ?? props.yuzOlcumu ?? props.ALAN, 80);
  const area = parseTurkishNumber(areaText);
  const publicProperties = {
    province: cleanText(props.ilAd ?? props.ilAdi, 120),
    district: cleanText(props.ilceAd ?? props.ilceAdi, 120),
    neighbourhood: cleanText(props.mahalleAd ?? props.mahalleAdi, 160),
    neighbourhoodId: normalizeId(props.mahalleId ?? fallback.neighbourhoodId),
    block: cleanText(props.adaNo ?? fallback.block, 40),
    parcel: cleanText(props.parselNo ?? fallback.parcel, 40),
    area,
    areaText: areaText || null,
    quality: cleanText(props.nitelik, 240),
    mapSheet: cleanText(props.pafta, 120),
    locality: cleanText(props.mevkii ?? props.mevki, 180),
    summary: cleanText(props.ozet, 240),
    status: cleanText(props.durum, 80)
  };

  return {
    type: 'Feature',
    id: cleanText(feature.id ?? props.id, 120),
    geometry,
    properties: publicProperties,
    source: sourceMeta(),
    retrievedAt: new Date().toISOString(),
    usage: {
      mode: 'public-information',
      officialTransactionSuitable: false,
      commercialRelianceSuitable: false,
      notice: 'TKGM Parsel Sorgu kaynaklı konum ve temel kadastro bilgileri bilgi amaçlıdır; resmî işlem ve kesin aplikasyon yerine geçmez.'
    }
  };
}

function extractFeatures(payload) {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  if (payload.type === 'FeatureCollection' && Array.isArray(payload.features)) return payload.features;
  if (Array.isArray(payload.features)) return payload.features;
  if (Array.isArray(payload.data)) return payload.data;
  if (Array.isArray(payload?.data?.features)) return payload.data.features;
  return [];
}

function selectFeature(payload) {
  if (!payload || typeof payload !== 'object') return null;
  if (payload.Message || payload.message) {
    const message = cleanText(payload.Message || payload.message, 300) || 'Parsel bulunamadı.';
    if (/bulunamad|yoktur|mevcut değil/i.test(message)) return null;
    throw serviceError(message, 502, 'TKGM_PROVIDER_MESSAGE');
  }
  if (payload.type === 'Feature') return payload;
  if (payload.type === 'FeatureCollection') return payload.features?.[0] || null;
  if (payload.feature?.type === 'Feature') return payload.feature;
  if (payload.data) return selectFeature(payload.data);
  if (payload.geometry) return payload;
  return null;
}

function sanitizeGeometry(value) {
  if (!value || typeof value !== 'object') return null;
  if (value.type === 'Feature') return sanitizeGeometry(value.geometry);
  if (value.geometry) return sanitizeGeometry(value.geometry);
  const allowed = new Set(['Polygon', 'MultiPolygon', 'Point', 'MultiPoint', 'LineString', 'MultiLineString']);
  if (!allowed.has(value.type) || !Array.isArray(value.coordinates)) return null;
  if (!validateCoordinates(value.coordinates, 0)) return null;
  return { type: value.type, coordinates: value.coordinates };
}

function validateCoordinates(value, depth) {
  if (depth > 8 || !Array.isArray(value) || value.length > 200000) return false;
  if (value.length >= 2 && value.every((n) => typeof n === 'number')) {
    return value.length <= 4 && value.every(Number.isFinite);
  }
  return value.every((item) => validateCoordinates(item, depth + 1));
}

function sourceMeta() {
  return {
    provider: 'TKGM / MEGSİS Parsel Sorgu',
    title: 'TKGM açık CBS yanıtı (bilgi amaçlı)',
    portalUrl: 'https://parselsorgu.tkgm.gov.tr/',
    verifiedOfficialRecord: false
  };
}

function stripSlash(value) {
  const url = new URL(String(value));
  if (url.protocol !== 'https:' || !ALLOWED_HOSTS.has(url.hostname)) throw new Error('TKGM_PUBLIC_API_BASE geçersiz.');
  return url.toString().replace(/\/$/, '');
}

function positiveId(value, field) {
  const text = String(value ?? '').trim();
  if (!/^\d{1,12}$/.test(text) || Number(text) <= 0) throw serviceError(`${field} geçersiz.`, 400, 'INVALID_QUERY');
  return text;
}

function safeParcelPart(value, field) {
  const text = String(value ?? '').trim();
  if (!text || text.length > 40 || !/^[0-9A-Za-zÇĞİÖŞÜçğıöşü._/-]+$/.test(text)) {
    throw serviceError(`${field} geçersiz.`, 400, 'INVALID_QUERY');
  }
  return text;
}

function finiteCoordinate(value, min, max, field) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) throw serviceError(`${field} geçersiz.`, 400, 'INVALID_QUERY');
  return number;
}

function normalizeId(value) {
  if (value == null) return null;
  const text = String(value).trim();
  if (!text || text.length > 80 || !/^[A-Za-z0-9._:-]+$/.test(text)) return null;
  return /^\d+$/.test(text) && Number.isSafeInteger(Number(text)) ? Number(text) : text;
}


function cleanSecret(value, maxLength) {
  if (value == null) return null;
  const text = String(value).trim();
  if (!text || text.length > maxLength || /[\r\n]/.test(text)) return null;
  return text;
}

function cleanText(value, maxLength) {
  if (value == null) return null;
  const text = String(value).replace(/[\u0000-\u001f<>]/g, ' ').replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, maxLength) : null;
}

function parseTurkishNumber(value) {
  if (!value) return null;
  const text = String(value).replace(/\s/g, '');
  let normalized = text;
  if (text.includes(',') && text.includes('.')) normalized = text.replace(/\./g, '').replace(',', '.');
  else if (text.includes(',')) normalized = text.replace(',', '.');
  const number = Number(normalized.replace(/[^0-9.+-]/g, ''));
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function extractProviderMessage(text) {
  if (!text) return null;
  try {
    const parsed = JSON.parse(text);
    return cleanText(parsed?.Message ?? parsed?.message ?? parsed?.error ?? parsed?.detail, 300);
  } catch {
    const match = String(text).match(/<string[^>]*>(.*?)<\/string>/is);
    return cleanText(match?.[1], 300);
  }
}

async function safeText(response) {
  try { return (await response.text()).slice(0, 2000); } catch { return ''; }
}

function trimCache() {
  if (CACHE.size <= 1500) return;
  const now = Date.now();
  for (const [key, entry] of CACHE) if (entry.expiresAt <= now) CACHE.delete(key);
  while (CACHE.size > 1200) CACHE.delete(CACHE.keys().next().value);
}

function clampInt(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, Math.trunc(number))) : fallback;
}

export function serviceError(message, statusCode = 500, code = 'SERVICE_ERROR', cause) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}
