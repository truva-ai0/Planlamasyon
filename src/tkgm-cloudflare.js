import { normalizeAdministrativeCollection, normalizeParcel } from '../netlify/functions/lib/tkgm-client.mjs';

// Cloudflare-native TKGM bridge. The browser-facing response shape is kept
// identical to the working v3.2 / Netlify API so the existing UI is unchanged.
// Administrative queries use the public v3 path first; parcel queries use v3.1.
// This is the same split used by working Cloudflare TKGM proxy implementations.
const ADMIN_BASES = [
  'https://cbsapi.tkgm.gov.tr/megsiswebapi.v3/api',
  'https://cbsapi.tkgm.gov.tr/megsiswebapi.v3.1/api',
  'https://cbsservis.tkgm.gov.tr/megsiswebapi.v3/api'
];
const PARCEL_BASES = [
  'https://cbsapi.tkgm.gov.tr/megsiswebapi.v3.1/api',
  'https://cbsapi.tkgm.gov.tr/megsiswebapi.v3/api',
  'https://cbsservis.tkgm.gov.tr/megsiswebapi.v3/api'
];
const PROVINCES_STATIC = 'https://parselsorgu.tkgm.gov.tr/app/modules/administrativeQuery/data/ilListe.json';
const ALLOWED_HOSTS = new Set(['cbsapi.tkgm.gov.tr', 'cbsservis.tkgm.gov.tr', 'parselsorgu.tkgm.gov.tr']);
const TKGM_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36',
  'Accept': 'application/json',
  'Referer': 'https://parselsorgu.tkgm.gov.tr/',
  'Origin': 'https://parselsorgu.tkgm.gov.tr'
};

export async function handleCloudflareTkgm(request, env = {}) {
  if (request.method !== 'GET') return json(405, { ok: false, code: 'METHOD_NOT_ALLOWED', message: 'Yalnızca GET destekleniyor.' }, { Allow: 'GET' });
  const url = new URL(request.url);
  const action = url.searchParams.get('action') || 'status';
  try {
    let data;
    switch (action) {
      case 'status':
        data = { enabled: true, mode: 'public-information', officialTransactionSuitable: false, bridge: 'cloudflare-native-v3.7.0' };
        break;
      case 'provinces': {
        const upstream = await firstJson([
          `${ADMIN_BASES[0]}/idariYapi/ilListe`,
          PROVINCES_STATIC,
          ...ADMIN_BASES.slice(1).map((base) => `${base}/idariYapi/ilListe`)
        ], env);
        data = normalizeAdministrativeCollection(upstream.payload, 'province');
        data.source.bridge = 'cloudflare-native';
        break;
      }
      case 'districts': {
        const provinceId = positiveId(url.searchParams.get('provinceId'), 'provinceId');
        const upstream = await firstJson(ADMIN_BASES.map((base) => `${base}/idariYapi/ilceListe/${encodeURIComponent(provinceId)}`), env);
        data = normalizeAdministrativeCollection(upstream.payload, 'district');
        data.source.bridge = 'cloudflare-native';
        break;
      }
      case 'neighbourhoods':
      case 'neighborhoods': {
        const districtId = positiveId(url.searchParams.get('districtId'), 'districtId');
        const upstream = await firstJson(ADMIN_BASES.map((base) => `${base}/idariYapi/mahalleListe/${encodeURIComponent(districtId)}`), env);
        data = normalizeAdministrativeCollection(upstream.payload, 'neighbourhood');
        data.source.bridge = 'cloudflare-native';
        break;
      }
      case 'parcel': {
        const neighbourhoodId = positiveId(url.searchParams.get('neighbourhoodId') || url.searchParams.get('neighborhoodId'), 'neighbourhoodId');
        const block = parcelPart(url.searchParams.get('block'), 'block');
        const parcel = parcelPart(url.searchParams.get('parcel'), 'parcel');
        const encoded = `${encodeURIComponent(neighbourhoodId)}/${encodeURIComponent(block)}/${encodeURIComponent(parcel)}`;
        const upstream = await firstJson(PARCEL_BASES.map((base) => `${base}/parsel/${encoded}`), env, { allowNotFound: true });
        if (!upstream?.payload) return json(404, { ok: false, code: 'PARCEL_NOT_FOUND', message: 'Bu ada/parsel için TKGM yanıtı bulunamadı.' });
        data = normalizeParcel(upstream.payload, { neighbourhoodId, block, parcel });
        break;
      }
      case 'coordinate': {
        const lat = coordinate(url.searchParams.get('lat'), -90, 90, 'lat');
        const lon = coordinate(url.searchParams.get('lon'), -180, 180, 'lon');
        const encoded = `${encodeURIComponent(lat)}/${encodeURIComponent(lon)}`;
        const candidates = PARCEL_BASES.flatMap((base) => [`${base}/parsel/${encoded}/`, `${base}/parsel/${encoded}`]);
        const upstream = await firstJson(candidates, env, { allowNotFound: true });
        if (!upstream?.payload) return json(404, { ok: false, code: 'PARCEL_NOT_FOUND', message: 'Bu koordinatta TKGM parsel yanıtı bulunamadı.' });
        data = normalizeParcel(upstream.payload, {});
        break;
      }
      default:
        return json(400, { ok: false, code: 'INVALID_ACTION', message: 'Bilinmeyen API işlemi.' });
    }
    const ttl = action === 'parcel' || action === 'coordinate' ? 300 : 21600;
    return json(200, { ok: true, data }, { 'Cache-Control': `public, max-age=0, s-maxage=${ttl}, stale-while-revalidate=60` });
  } catch (error) {
    const status = Number(error?.statusCode) || 502;
    return json(status, {
      ok: false,
      code: error?.code || 'TKGM_CLOUDFLARE_BRIDGE_ERROR',
      message: String(error?.message || 'TKGM servisine ulaşılamadı.'),
      diagnostics: Array.isArray(error?.attempts) ? error.attempts.slice(0, 10) : undefined
    });
  }
}

async function firstJson(candidates, env, options = {}) {
  const attempts = [];
  let sawNotFound = false;
  let lastError = null;
  for (const raw of [...new Set(candidates)]) {
    let target;
    try {
      target = new URL(raw);
      if (target.protocol !== 'https:' || !ALLOWED_HOSTS.has(target.hostname)) continue;
    } catch { continue; }
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000);
        let response;
        try {
          response = await fetch(target.toString(), {
            method: 'GET',
            headers: {
              ...TKGM_HEADERS,
              ...(env.TKGM_BEARER_TOKEN ? { Authorization: `Bearer ${String(env.TKGM_BEARER_TOKEN).trim()}` } : {})
            },
            redirect: 'follow',
            signal: controller.signal
          });
        } finally { clearTimeout(timeout); }
        if (options.allowNotFound && (response.status === 404 || response.status === 204)) {
          sawNotFound = true;
          attempts.push({ host: target.hostname, path: target.pathname, status: response.status });
          break;
        }
        const text = await response.text();
        attempts.push({ host: target.hostname, path: target.pathname, status: response.status });
        if (!response.ok) {
          if ((response.status === 429 || response.status >= 500) && attempt === 0) { await delay(250); continue; }
          const error = new Error(providerMessage(text) || `TKGM servisi ${response.status} yanıtı verdi.`);
          error.statusCode = response.status === 401 || response.status === 403 ? 503 : 502;
          error.code = response.status === 401 || response.status === 403 ? 'TKGM_AUTH_OR_ACCESS_REQUIRED' : response.status === 429 ? 'TKGM_RATE_LIMIT' : 'TKGM_UPSTREAM_ERROR';
          lastError = error;
          break;
        }
        if (!text.trim()) {
          if (options.allowNotFound) { sawNotFound = true; break; }
          throw coded('TKGM servisi boş yanıt verdi.', 502, 'TKGM_EMPTY_RESPONSE');
        }
        try { return { payload: JSON.parse(text), url: target.toString() }; }
        catch { throw coded('TKGM servis yanıtı JSON olarak okunamadı.', 502, 'TKGM_INVALID_RESPONSE'); }
      } catch (error) {
        if (error?.name === 'AbortError') lastError = coded('TKGM servisi zaman aşımına uğradı.', 504, 'TKGM_TIMEOUT');
        else lastError = error?.statusCode ? error : coded('TKGM servisine ulaşılamadı.', 502, 'TKGM_NETWORK_ERROR');
        if (attempt === 0 && ['TKGM_NETWORK_ERROR','TKGM_TIMEOUT'].includes(lastError.code)) { await delay(250); continue; }
        break;
      }
    }
  }
  if (options.allowNotFound && sawNotFound && !lastError) return { payload: null, url: null };
  const error = lastError || coded('TKGM açık servislerinden yanıt alınamadı.', 502, 'TKGM_DIRECTORY_UNAVAILABLE');
  error.attempts = attempts;
  throw error;
}

function positiveId(value, field) {
  const text = String(value ?? '').trim();
  if (!/^\d{1,12}$/.test(text) || Number(text) <= 0) throw coded(`${field} geçersiz.`, 400, 'INVALID_QUERY');
  return text;
}
function parcelPart(value, field) {
  const text = String(value ?? '').trim();
  if (!text || text.length > 40 || !/^[0-9A-Za-zÇĞİÖŞÜçğıöşü._/-]+$/.test(text)) throw coded(`${field} geçersiz.`, 400, 'INVALID_QUERY');
  return text;
}
function coordinate(value, min, max, field) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max) throw coded(`${field} geçersiz.`, 400, 'INVALID_QUERY');
  return n;
}
function providerMessage(text) {
  if (!text) return null;
  try { const p = JSON.parse(text); return p?.Message || p?.message || p?.error || p?.detail || null; }
  catch { return null; }
}
function coded(message, statusCode, code) { const e = new Error(message); e.statusCode = statusCode; e.code = code; return e; }
function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function json(status, body, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store', ...extra }
  });
}
