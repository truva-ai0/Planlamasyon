export function jsonResponse(statusCode, body, headers = {}) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...headers
    },
    body: JSON.stringify(body)
  };
}

export function parseJsonBody(event, maxBytes = 1_500_000) {
  const raw = event?.body || '';
  const base64 = Boolean(event?.isBase64Encoded);
  const text = base64 ? decodeBase64Utf8(raw) : String(raw);
  const size = utf8ByteLength(text);
  if (size > maxBytes) throw httpError('İstek gövdesi çok büyük.', 413, 'PAYLOAD_TOO_LARGE');
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw httpError('JSON isteği okunamadı.', 400, 'INVALID_JSON');
  }
}

export function requestIp(event) {
  const headers = normalizeHeaders(event?.headers || {});
  const forwarded = headers['x-nf-client-connection-ip'] || headers['cf-connecting-ip'] || headers['x-forwarded-for'] || '';
  return String(forwarded).split(',')[0].trim() || 'unknown';
}

export function normalizeHeaders(headers) {
  return Object.fromEntries(Object.entries(headers || {}).map(([key, value]) => [String(key).toLowerCase(), value]));
}

export function enforceSimpleRateLimit(store, key, max, windowMs) {
  const now = Date.now();
  const safeKey = String(key || 'unknown').slice(0, 180);
  const entry = store.get(safeKey);
  if (!entry || entry.resetAt <= now) {
    store.set(safeKey, { count: 1, resetAt: now + windowMs });
    cleanupRateStore(store, now);
    return;
  }
  entry.count += 1;
  if (entry.count > max) throw httpError('Çok fazla istek yapıldı. Lütfen kısa süre sonra tekrar deneyin.', 429, 'RATE_LIMITED');
}

export function httpError(message, statusCode = 500, code = 'HTTP_ERROR') {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

export function safeErrorResponse(error) {
  const status = Number(error?.statusCode) || 500;
  const knownSafe = Boolean(error?.safeForClient) || status < 500 || String(error?.code || '').startsWith('PLAN_AI_');
  return jsonResponse(status, {
    ok: false,
    code: error?.code || 'INTERNAL_ERROR',
    message: knownSafe ? String(error?.message || 'İşlem tamamlanamadı.') : 'Beklenmeyen sunucu hatası.'
  });
}

export function utf8ByteLength(value) {
  return new TextEncoder().encode(String(value || '')).byteLength;
}

function decodeBase64Utf8(raw) {
  try {
    if (typeof Buffer !== 'undefined') return Buffer.from(String(raw || ''), 'base64').toString('utf8');
  } catch {}
  try {
    const binary = globalThis.atob(String(raw || ''));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  } catch {
    throw httpError('Base64 istek gövdesi okunamadı.', 400, 'INVALID_BASE64_BODY');
  }
}

function cleanupRateStore(store, now) {
  if (store.size < 2000) return;
  for (const [key, value] of store) if (value.resetAt <= now) store.delete(key);
  while (store.size > 1500) store.delete(store.keys().next().value);
}
