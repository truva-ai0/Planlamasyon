import { discoverPublicPlanRecords } from './lib/plan-record-client.mjs';
import { jsonResponse, safeErrorResponse, httpError } from './lib/http.mjs';
import { runtimeEnv } from './lib/runtime-env.mjs';

export async function handler(event, context = {}) {
  const env = runtimeEnv(context);
  if ((event.httpMethod || 'GET') !== 'GET') return jsonResponse(405, { ok: false, code: 'METHOD_NOT_ALLOWED', message: 'Yalnızca GET destekleniyor.' }, { Allow: 'GET' });
  try {
    const params = event.queryStringParameters || {};
    const query = {
      province: clean(params.province || params.il, 120),
      district: clean(params.district || params.ilce, 120),
      neighbourhood: clean(params.neighbourhood || params.mahalle, 160),
      block: clean(params.block || params.ada, 40),
      parcel: clean(params.parcel || params.parsel, 40)
    };
    if (!query.district || !query.block || !query.parcel) throw httpError('İlçe, ada ve parsel gerekli.', 400, 'MISSING_QUERY');
    const data = await discoverPublicPlanRecords({ parcel: null, query, env });
    return jsonResponse(200, { ok: true, data }, { 'Cache-Control': 'public, max-age=300' });
  } catch (error) {
    return safeErrorResponse(error);
  }
}

function clean(value, max = 500) {
  if (value == null) return null;
  const text = String(value).replace(/[\u0000-\u001f<>]/g, ' ').replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, max) : null;
}
