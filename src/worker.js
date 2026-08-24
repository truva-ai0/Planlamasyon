import { handleCloudflareTkgm } from './tkgm-cloudflare.js';
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
      return json(401, {
        ok: false,
        code: 'ACCOUNT_SYNC_DISABLED',
        message: 'Bu yayında hesap eşitleme kapalı; çalışmalar bu cihazda tutulur.'
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
  if (!['GET', 'HEAD'].includes(request.method)) body = await request.text();
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
  return new Response(result.body ?? '', { status: Number(result.statusCode) || 200, headers });
}

async function handleAnalysisRequest(request, env) {
  if (request.method !== 'POST') {
    return json(405, { ok: false, code: 'METHOD_NOT_ALLOWED', message: 'Yalnızca POST destekleniyor.' }, { Allow: 'POST' });
  }
  let body;
  try { body = await request.json(); }
  catch { return json(400, { ok: false, code: 'INVALID_JSON', message: 'İstek okunamadı.' }); }

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
  const emailSent = await sendNotification(env, { id, createdAt, email, body, parcel }).catch(() => false);
  return json(201, { ok: true, data: { id, status: 'Gönderildi', emailSent, createdAt, storage: 'cloudflare-stateless' } });
}

async function sendNotification(env, record) {
  if (!env.RESEND_API_KEY || !env.ANALYSIS_TEAM_EMAIL || !env.FROM_EMAIL) return false;
  const p = record.parcel;
  const location = [p.province, p.district, p.neighbourhood].map(v => clean(v, 160)).filter(Boolean).join(' / ');
  const response = await fetch('https://api.resend.com/emails', {
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
  return response.ok;
}

function clean(value, max = 500) {
  if (value == null) return null;
  const text = String(value).replace(/[\u0000-\u001f<>]/g, ' ').replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, max) : null;
}

function json(status, body, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...extraHeaders
    }
  });
}
