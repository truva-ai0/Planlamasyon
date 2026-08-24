import { randomUUID } from 'node:crypto';
import { getStore } from '@netlify/blobs';
import { enforceSimpleRateLimit, jsonResponse, parseJsonBody, requestIp, safeErrorResponse, httpError } from './lib/http.mjs';
import { runtimeEnv } from './lib/runtime-env.mjs';

const LIMITS = globalThis.__PLANLAMASYON_REQUEST_LIMITS__ || new Map();
globalThis.__PLANLAMASYON_REQUEST_LIMITS__ = LIMITS;

export async function handler(event, context = {}) {
  const env = runtimeEnv(context);
  if ((event.httpMethod || 'GET') !== 'POST') return jsonResponse(405, { ok: false, code: 'METHOD_NOT_ALLOWED', message: 'Yalnızca POST destekleniyor.' }, { Allow: 'POST' });
  try {
    enforceSimpleRateLimit(LIMITS, requestIp(event), 8, 60 * 60 * 1000);
    const body = parseJsonBody(event, 150_000);
    const user = context?.clientContext?.user || null;
    const request = sanitizeRequest(body, user);
    if (!request.email) throw httpError('Talep sonucu için geçerli bir e-posta adresi gerekli.', 400, 'EMAIL_REQUIRED');
    if (!request.parcel.block || !request.parcel.parcel) throw httpError('Ada ve parsel bilgisi gerekli.', 400, 'PARCEL_REQUIRED');

    const id = `req_${Date.now()}_${randomUUID().slice(0, 12)}`;
    const record = { id, status: 'Gönderildi', createdAt: new Date().toISOString(), ...request };
    const store = getStore('planlamasyon-analysis-requests');
    await store.setJSON(`request/${id}`, record, { metadata: { status: record.status, email: record.email, createdAt: record.createdAt } });
    const emailSent = await sendNotification(record, env);
    return jsonResponse(201, { ok: true, data: { id, status: record.status, emailSent, createdAt: record.createdAt } });
  } catch (error) {
    return safeErrorResponse(error);
  }
}

function sanitizeRequest(body, user) {
  const parcel = body?.parcel || {};
  return {
    userId: clean(user?.sub, 180),
    name: clean(body?.name, 120) || clean(user?.user_metadata?.full_name, 120),
    email: email(body?.email) || email(user?.email),
    phone: clean(body?.phone, 40),
    note: clean(body?.note, 2500),
    parcel: {
      province: clean(parcel.province, 120), district: clean(parcel.district, 120), neighbourhood: clean(parcel.neighbourhood, 160),
      neighbourhoodId: clean(parcel.neighbourhoodId, 80), block: clean(parcel.block, 40), parcel: clean(parcel.parcel, 40), area: finite(parcel.area), quality: clean(parcel.quality, 240)
    },
    missing: Array.isArray(body?.missing) ? body.missing.map((item) => clean(item, 120)).filter(Boolean).slice(0, 30) : [],
    sourcePage: clean(body?.sourcePage, 300)
  };
}

async function sendNotification(record, env) {
  if (!env.RESEND_API_KEY || !env.ANALYSIS_TEAM_EMAIL || !env.FROM_EMAIL) return false;
  const location = [record.parcel.province, record.parcel.district, record.parcel.neighbourhood].filter(Boolean).join(' / ');
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: env.FROM_EMAIL,
      to: [env.ANALYSIS_TEAM_EMAIL],
      reply_to: record.email,
      subject: `Planlamasyon analiz talebi: ${record.parcel.block}/${record.parcel.parcel}`,
      text: `Talep: ${record.id}\nKonum: ${location}\nAda/Parsel: ${record.parcel.block}/${record.parcel.parcel}\nAd: ${record.name || '-'}\nE-posta: ${record.email}\nTelefon: ${record.phone || '-'}\nEksik bilgiler: ${record.missing.join(', ') || '-'}\nNot: ${record.note || '-'}\nTarih: ${record.createdAt}`
    })
  });
  return response.ok;
}

function email(value) { const text = clean(value, 240); return text && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text) ? text.toLowerCase() : null; }
function finite(value) { const number = Number(value); return Number.isFinite(number) ? number : null; }
function clean(value, max = 500) { if (value == null) return null; const text = String(value).replace(/[\u0000-\u001f<>]/g, ' ').replace(/\s+/g, ' ').trim(); return text ? text.slice(0, max) : null; }
