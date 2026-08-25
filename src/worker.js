import { handleCloudflareTkgm } from './tkgm-cloudflare.js';

const API_BODY_LIMIT_BYTES = 2_000_000;
const ANALYSIS_REQUEST_BODY_LIMIT_BYTES = 64_000;
const ANALYSIS_REQUEST_WINDOW_MS = 10 * 60 * 1000;
const ANALYSIS_REQUEST_MAX_PER_WINDOW = 8;
const analysisRequestRateStore = new Map();

const CORE = {
  analyze: () => import('../netlify/functions/analyze.mjs'),
  health: () => import('../netlify/functions/health.mjs'),
  'official-services': () => import('../netlify/functions/official-services.mjs'),
  'plan-records': () => import('../netlify/functions/plan-records.mjs'),
  'parse-zoning-document': () => import('../netlify/functions/parse-zoning-document.mjs'),
  'open-source-scan': () => import('../netlify/functions/open-source-scan.mjs'),
  'plan-ai': () => import('../netlify/functions/plan-ai.mjs')
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) {
      return env.ASSETS ? env.ASSETS.fetch(request) : new Response('Not found', { status: 404 });
    }

    const route = url.pathname.replace(/^\/api\/?/, '').replace(/\/+$/, '');
    if (route === 'tkgm') return handleCloudflareTkgm(request, env);
    if (route === 'user-data') {
      return json(503, {
        ok: false,
        code: 'ACCOUNT_SYNC_DISABLED',
        message: 'Bu yayında hesap eşitleme kapalıdır. Çalışmalar, favoriler ve talepler yalnız bu cihazda tutulur.',
        data: { syncEnabled: false, storage: 'client-local-only' }
      });
    }
    if (route === 'request-analysis') return handleAnalysisRequest(request, env);

    const load = CORE[route];
    if (!load) return json(404, { ok: false, code: 'API_NOT_FOUND', message: 'API yolu bulunamadı.' });

    try {
      const mod = await load();
      const event = await toNetlifyEvent(request);
      const result = await mod.handler(event, { clientContext: null, cloudflareEnv: env });
      return fromNetlifyResult(result);
    } catch (error) {
      console.error('Cloudflare Worker API adapter error', route, error);
      const status = Number(error?.statusCode) || 500;
      return json(status, {
        ok: false,
        code: error?.code || 'CLOUDFLARE_WORKER_ADAPTER_ERROR',
        message: status >= 400 && status < 500
          ? String(error?.message || 'İstek tamamlanamadı.')
          : 'Sunucu işlemi tamamlanamadı.'
      });
    }
  }
};

async function toNetlifyEvent(request) {
  const url = new URL(request.url);
  const headers = Object.fromEntries(request.headers.entries());
  const ip = request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || 'unknown';
  headers['x-nf-client-connection-ip'] ||= ip;
  let body = '';
  if (!['GET', 'HEAD'].includes(request.method)) {
    body = await readBoundedText(request, API_BODY_LIMIT_BYTES);
  }
  return {
    httpMethod: request.method,
    headers,
    body,
    isBase64Encoded: false,
    rawUrl: request.url,
    rawQuery: url.searchParams.toString(),
    path: url.pathname,
    queryStringParameters: Object.fromEntries(url.searchParams.entries())
  };
}

function fromNetlifyResult(result = {}) {
  const headers = new Headers(result.headers || {});
  if (!headers.has('Cache-Control')) headers.set('Cache-Control', 'no-store');
  applyApiSecurityHeaders(headers);
  return new Response(result.body ?? '', { status: Number(result.statusCode) || 200, headers });
}

export async function handleAnalysisRequest(request, env = {}, fetchImpl = fetch) {
  if (request.method !== 'POST') {
    return json(405, { ok: false, code: 'METHOD_NOT_ALLOWED', message: 'Yalnızca POST destekleniyor.' }, { Allow: 'POST' });
  }
  const contentType = String(request.headers.get('content-type') || '').toLowerCase();
  if (!contentType.includes('application/json')) {
    return json(415, { ok: false, code: 'UNSUPPORTED_MEDIA_TYPE', message: 'İstek JSON biçiminde gönderilmelidir.' });
  }
  if (!isAllowedOrigin(request, env)) {
    return json(403, { ok: false, code: 'ORIGIN_NOT_ALLOWED', message: 'Bu kaynaktan analiz talebi gönderilemez.' });
  }
  const clientKey = request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || 'unknown';
  if (!consumeRateLimit(analysisRequestRateStore, clientKey, ANALYSIS_REQUEST_MAX_PER_WINDOW, ANALYSIS_REQUEST_WINDOW_MS)) {
    return json(429, { ok: false, code: 'RATE_LIMITED', message: 'Çok fazla talep gönderildi. Lütfen kısa süre sonra yeniden deneyin.' }, { 'Retry-After': '600' });
  }
  let body;
  try {
    const raw = await readBoundedText(request, ANALYSIS_REQUEST_BODY_LIMIT_BYTES);
    body = raw ? JSON.parse(raw) : {};
  } catch (error) {
    if (error?.code === 'PAYLOAD_TOO_LARGE') return json(413, { ok: false, code: error.code, message: error.message });
    return json(400, { ok: false, code: 'INVALID_JSON', message: 'İstek okunamadı.' });
  }

  if (clean(body?.website, 200)) {
    return json(202, { ok: true, data: { accepted: false, emailSent: false, serverStored: false, storage: 'discarded' } });
  }

  const parcel = body?.parcel || {};
  const email = clean(body?.email, 240);
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json(400, { ok: false, code: 'EMAIL_REQUIRED', message: 'Geçerli e-posta gerekli.' });
  }
  if (!clean(parcel.block, 40) || !clean(parcel.parcel, 40)) {
    return json(400, { ok: false, code: 'PARCEL_REQUIRED', message: 'Ada ve parsel bilgisi gerekli.' });
  }

  const id = `req_${Date.now()}_${crypto.randomUUID().slice(0, 12)}`;
  const createdAt = new Date().toISOString();
  const delivery = await sendNotification(env, { id, createdAt, email, body, parcel }, fetchImpl)
    .catch(() => ({ configured: true, sent: false }));
  return json(delivery.sent ? 201 : 202, {
    ok: true,
    data: {
      id,
      status: delivery.sent ? 'Ekibe iletildi' : 'Yalnız bu cihazda saklanabilir',
      accepted: delivery.sent,
      emailSent: delivery.sent,
      notificationConfigured: delivery.configured,
      serverStored: false,
      createdAt,
      storage: delivery.sent ? 'email-notification-only' : 'client-local-only',
      notice: delivery.sent
        ? 'Talep ekibe e-posta ile iletildi; sunucuda hesap kaydı oluşturulmadı.'
        : 'Sunucu bildirimi yapılandırılmadığı veya iletilemediği için talep ekibe gönderilmedi. Kayıt yalnız bu cihazda saklanır.'
    }
  });
}

async function sendNotification(env, record, fetchImpl = fetch) {
  if (!env.RESEND_API_KEY || !env.ANALYSIS_TEAM_EMAIL || !env.FROM_EMAIL) return { configured: false, sent: false };
  const p = record.parcel;
  const location = [p.province, p.district, p.neighbourhood].map(v => clean(v, 160)).filter(Boolean).join(' / ');
  const response = await fetchImpl('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: env.FROM_EMAIL,
      to: [env.ANALYSIS_TEAM_EMAIL],
      reply_to: record.email,
      subject: `Planlamasyon analiz talebi: ${clean(p.block, 40)}/${clean(p.parcel, 40)}`,
      text: `Talep: ${record.id}\nKonum: ${location}\nAda/Parsel: ${clean(p.block, 40)}/${clean(p.parcel, 40)}\nE-posta: ${record.email}\nTarih: ${record.createdAt}`
    })
  });
  return { configured: true, sent: response.ok };
}

async function readBoundedText(request, maxBytes) {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) throw requestError('İstek gövdesi çok büyük.', 'PAYLOAD_TOO_LARGE');
  if (!request.body) return '';
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let text = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) throw requestError('İstek gövdesi çok büyük.', 'PAYLOAD_TOO_LARGE');
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } catch (error) {
    try { await reader.cancel(error); } catch {}
    throw error;
  }
}

function isAllowedOrigin(request, env = {}) {
  const origin = request.headers.get('origin');
  if (!origin) return true;
  let expected;
  try { expected = new URL(request.url).origin; } catch { return false; }
  if (origin === expected) return true;
  const allowed = String(env.PUBLIC_APP_ORIGINS || '').split(',').map((item) => item.trim()).filter(Boolean);
  return allowed.includes(origin);
}

function consumeRateLimit(store, rawKey, max, windowMs) {
  const now = Date.now();
  const key = String(rawKey || 'unknown').split(',')[0].trim().slice(0, 180) || 'unknown';
  const current = store.get(key);
  if (!current || current.resetAt <= now) {
    store.set(key, { count: 1, resetAt: now + windowMs });
    cleanupRateStore(store, now);
    return true;
  }
  current.count += 1;
  return current.count <= max;
}

function cleanupRateStore(store, now) {
  if (store.size < 1500) return;
  for (const [key, value] of store) if (value.resetAt <= now) store.delete(key);
  while (store.size > 1000) store.delete(store.keys().next().value);
}

function requestError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function applyApiSecurityHeaders(headers) {
  if (!headers.has('X-Content-Type-Options')) headers.set('X-Content-Type-Options', 'nosniff');
  if (!headers.has('Referrer-Policy')) headers.set('Referrer-Policy', 'no-referrer');
  if (!headers.has('Content-Security-Policy')) headers.set('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'; base-uri 'none'");
  if (!headers.has('Permissions-Policy')) headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
}

function clean(value, max = 500) {
  if (value == null) return null;
  const text = String(value).replace(/[\u0000-\u001f<>]/g, ' ').replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, max) : null;
}

function json(status, body, extraHeaders = {}) {
  const headers = new Headers({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...extraHeaders
  });
  applyApiSecurityHeaders(headers);
  return new Response(JSON.stringify(body), { status, headers });
}
