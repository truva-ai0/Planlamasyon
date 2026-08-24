import { TkgmPublicInfoClient, serviceError } from './tkgm-client.mjs';

const LIMITS = globalThis.__PLANLAMASYON_RATE_LIMITS__ || new Map();
globalThis.__PLANLAMASYON_RATE_LIMITS__ = LIMITS;

export async function executeTkgmApi({ requestUrl, method = 'GET', ip = 'unknown', env = process.env, fetchImpl }) {
  const url = new URL(requestUrl, 'http://localhost');
  if (method !== 'GET') return response(405, { ok: false, code: 'METHOD_NOT_ALLOWED', message: 'Yalnızca GET destekleniyor.' }, { Allow: 'GET' });

  const action = url.searchParams.get('action') || 'status';
  try {
    enforceRateLimit(ip, env);
    const client = new TkgmPublicInfoClient(env, { fetchImpl });
    let data;
    switch (action) {
      case 'status':
        data = { enabled: client.enabled, mode: 'public-information', officialTransactionSuitable: false };
        break;
      case 'provinces':
        data = await client.getProvinces();
        break;
      case 'districts':
        data = await client.getDistricts(url.searchParams.get('provinceId'));
        break;
      case 'neighbourhoods':
      case 'neighborhoods':
        data = await client.getNeighbourhoods(url.searchParams.get('districtId'));
        break;
      case 'parcel':
        data = await client.getParcel({
          neighbourhoodId: url.searchParams.get('neighbourhoodId') || url.searchParams.get('neighborhoodId'),
          block: url.searchParams.get('block'),
          parcel: url.searchParams.get('parcel')
        });
        if (!data) throw serviceError('Bu ada/parsel için TKGM yanıtı bulunamadı.', 404, 'PARCEL_NOT_FOUND');
        break;
      case 'coordinate':
        data = await client.getParcelByCoordinate({ lat: url.searchParams.get('lat'), lon: url.searchParams.get('lon') });
        if (!data) throw serviceError('Bu koordinatta TKGM parsel yanıtı bulunamadı.', 404, 'PARCEL_NOT_FOUND');
        break;
      default:
        throw serviceError('Bilinmeyen API işlemi.', 400, 'INVALID_ACTION');
    }
    const ttl = action === 'parcel' || action === 'coordinate' ? 300 : 21600;
    return response(200, { ok: true, data }, { 'Cache-Control': `public, max-age=0, s-maxage=${ttl}, stale-while-revalidate=60` });
  } catch (error) {
    const status = Number(error?.statusCode) || 500;
    return response(status, {
      ok: false,
      code: error?.code || 'INTERNAL_ERROR',
      message: status >= 500 && !error?.statusCode ? 'Beklenmeyen sunucu hatası.' : String(error?.message || 'İşlem tamamlanamadı.')
    }, { 'Cache-Control': 'no-store' });
  }
}

function enforceRateLimit(ip, env) {
  const max = Math.min(300, Math.max(10, Number(env.TKGM_RATE_LIMIT_PER_MINUTE || 90)));
  const now = Date.now();
  const windowMs = 60000;
  const key = String(ip || 'unknown').slice(0, 120);
  const entry = LIMITS.get(key);
  if (!entry || entry.resetAt <= now) {
    LIMITS.set(key, { count: 1, resetAt: now + windowMs });
    cleanupLimits(now);
    return;
  }
  entry.count += 1;
  if (entry.count > max) throw serviceError('Çok fazla sorgu yapıldı. Bir dakika sonra tekrar deneyin.', 429, 'RATE_LIMITED');
}

function cleanupLimits(now) {
  if (LIMITS.size < 2000) return;
  for (const [key, value] of LIMITS) if (value.resetAt <= now) LIMITS.delete(key);
}

function response(status, body, headers = {}) {
  return {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
      ...headers
    },
    body
  };
}
