import { discoverMunicipalityProvider } from './lib/municipality-provider.mjs';
import { discoverOpenOfficialZoning } from './lib/open-official-source-client.mjs';
import { enforceSimpleRateLimit, jsonResponse, parseJsonBody, requestIp, safeErrorResponse, httpError } from './lib/http.mjs';
import { runtimeEnv } from './lib/runtime-env.mjs';

const LIMITS = globalThis.__PLANLAMASYON_OPEN_SCAN_LIMITS__ || new Map();
globalThis.__PLANLAMASYON_OPEN_SCAN_LIMITS__ = LIMITS;

export async function handler(event, context = {}) {
  const env = runtimeEnv(context);
  if ((event.httpMethod || 'GET') !== 'POST') {
    return jsonResponse(405, { ok: false, code: 'METHOD_NOT_ALLOWED', message: 'Yalnızca POST destekleniyor.' }, { Allow: 'POST' });
  }
  try {
    enforceSimpleRateLimit(LIMITS, requestIp(event), clampInt(env.OPEN_SOURCE_SCAN_RATE_LIMIT_PER_MINUTE, 2, 60, 12), 60_000);
    const body = parseJsonBody(event);
    const parcel = sanitizeParcel(body.parcel);
    const query = sanitizeQuery(body.query || {});
    if (!parcel?.geometry || !parcel?.properties) throw httpError('Geçerli parsel geometrisi ve bilgileri gerekli.', 400, 'INVALID_PARCEL');

    const providerDiscovery = await discoverMunicipalityProvider({ parcel, query, env });
    const scan = await discoverOpenOfficialZoning({ parcel, query, providerDiscovery, env });
    const { aiEvidence, ...publicScan } = scan || {};
    return jsonResponse(200, { ok: true, data: publicScan });
  } catch (error) {
    return safeErrorResponse(error);
  }
}

function sanitizeParcel(parcel) {
  if (!parcel || parcel.type !== 'Feature' || !parcel.geometry || !parcel.properties) return null;
  const json = JSON.stringify(parcel);
  if (json.length > 1_000_000) throw httpError('Parsel geometrisi çok büyük.', 413, 'PARCEL_TOO_LARGE');
  return JSON.parse(json);
}

function sanitizeQuery(query) {
  const result = {};
  for (const [key, value] of Object.entries(query).slice(0, 20)) {
    const safeKey = clean(key, 60);
    const safeValue = clean(value, 240);
    if (safeKey && safeValue != null) result[safeKey] = safeValue;
  }
  return result;
}

function clean(value, max) {
  if (value == null) return null;
  const text = String(value).replace(/[\u0000-\u001f<>]/g, ' ').replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, max) : null;
}
function clampInt(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, Math.trunc(number))) : fallback;
}
