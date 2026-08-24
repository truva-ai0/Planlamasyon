import { discoverMunicipalityProvider } from './lib/municipality-provider.mjs';
import { jsonResponse, safeErrorResponse } from './lib/http.mjs';
import { runtimeEnv } from './lib/runtime-env.mjs';

export async function handler(event, context = {}) {
  const env = runtimeEnv(context);
  if ((event.httpMethod || 'GET') !== 'GET') return jsonResponse(405, { ok: false, code: 'METHOD_NOT_ALLOWED', message: 'Yalnızca GET destekleniyor.' }, { Allow: 'GET' });
  try {
    const params = event.queryStringParameters || {};
    const query = {
      province: clean(params.province || params.il, 120),
      district: clean(params.district || params.ilce, 120),
      neighbourhood: clean(params.neighbourhood || params.mahalle, 160)
    };
    const data = await discoverMunicipalityProvider({ query, env });
    return jsonResponse(200, { ok: true, data });
  } catch (error) {
    return safeErrorResponse(error);
  }
}

function clean(value, max = 500) {
  if (value == null) return null;
  const text = String(value).replace(/[\u0000-\u001f<>]/g, ' ').replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, max) : null;
}
