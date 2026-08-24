import { executeTkgmApi } from './lib/tkgm-api.mjs';
import { runtimeEnv } from './lib/runtime-env.mjs';

export async function handler(event, context = {}) {
  const env = runtimeEnv(context);
  const headers = normalizeHeaders(event.headers || {});
  const forwarded = headers['x-nf-client-connection-ip'] || headers['x-forwarded-for'] || '';
  const ip = String(forwarded).split(',')[0].trim() || 'unknown';
  const requestUrl = event.rawUrl || buildUrl(event);
  const result = await executeTkgmApi({
    requestUrl,
    method: event.httpMethod || 'GET',
    ip,
    env
  });
  return {
    statusCode: result.status,
    headers: result.headers,
    body: JSON.stringify(result.body)
  };
}

function normalizeHeaders(headers) {
  return Object.fromEntries(Object.entries(headers).map(([key, value]) => [String(key).toLowerCase(), value]));
}

function buildUrl(event) {
  const qs = event.rawQuery || new URLSearchParams(event.queryStringParameters || {}).toString();
  return `https://planlamasyon.local/api/tkgm${qs ? `?${qs}` : ''}`;
}
