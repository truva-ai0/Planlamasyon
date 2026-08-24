import { getStore } from '@netlify/blobs';
import { jsonResponse, parseJsonBody, safeErrorResponse, httpError } from './lib/http.mjs';

const STORE_NAME = 'planlamasyon-user-data';

export async function handler(event, context) {
  try {
    const user = context?.clientContext?.user;
    if (!user?.sub) throw httpError('Bu işlem için giriş yapmanız gerekiyor.', 401, 'AUTH_REQUIRED');
    const method = event.httpMethod || 'GET';
    const store = getStore(STORE_NAME);
    const key = `user/${String(user.sub).slice(0, 180)}`;

    if (method === 'GET') {
      const value = await store.get(key, { type: 'json', consistency: 'strong' });
      return jsonResponse(200, { ok: true, data: value || emptyUserData(user) });
    }
    if (method === 'PUT') {
      const value = sanitizeUserData(parseJsonBody(event, 900_000), user);
      await store.setJSON(key, value, { metadata: { updatedAt: value.updatedAt, email: clean(user.email, 240) } });
      return jsonResponse(200, { ok: true, data: value });
    }
    return jsonResponse(405, { ok: false, code: 'METHOD_NOT_ALLOWED', message: 'Yalnızca GET ve PUT destekleniyor.' }, { Allow: 'GET, PUT' });
  } catch (error) {
    return safeErrorResponse(error);
  }
}

function sanitizeUserData(input, user) {
  return {
    version: 1,
    profile: {
      nick: clean(input?.profile?.nick, 80) || clean(user?.user_metadata?.nick, 80) || clean(user?.user_metadata?.full_name, 80) || null,
      fullName: clean(input?.profile?.fullName, 120) || clean(user?.user_metadata?.full_name, 120) || null,
      email: clean(user?.email, 240)
    },
    works: sanitizeCollection(input?.works, 60),
    favorites: sanitizeCollection(input?.favorites, 80),
    requests: sanitizeCollection(input?.requests, 80),
    evidence: sanitizeEvidenceMap(input?.evidence),
    updatedAt: new Date().toISOString()
  };
}

function emptyUserData(user) {
  return sanitizeUserData({}, user);
}

function sanitizeCollection(value, maxItems) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, maxItems).map((item) => ({
    id: clean(item?.id, 220),
    title: clean(item?.title, 260),
    subtitle: clean(item?.subtitle, 500),
    createdAt: clean(item?.createdAt, 60),
    updatedAt: clean(item?.updatedAt, 60),
    status: clean(item?.status, 80),
    query: sanitizeQuery(item?.query),
    snapshot: sanitizeSnapshot(item?.snapshot),
    sources: Array.isArray(item?.sources) ? item.sources.slice(0, 20).map((source) => ({ id: clean(source?.id, 140), title: clean(source?.title, 280), url: safeUrl(source?.url) })) : []
  })).filter((item) => item.id && item.title);
}

function sanitizeQuery(value = {}) {
  return {
    province: clean(value.province, 120), district: clean(value.district, 120), neighbourhood: clean(value.neighbourhood, 160),
    neighbourhoodId: clean(value.neighbourhoodId, 80), block: clean(value.block, 40), parcel: clean(value.parcel, 40)
  };
}

function sanitizeSnapshot(value = {}) {
  return {
    area: finite(value.area), quality: clean(value.quality, 240), mapSheet: clean(value.mapSheet, 120),
    analysisStatus: clean(value.analysisStatus, 80), explanation: clean(value.explanation, 1600),
    metrics: value.metrics && typeof value.metrics === 'object' ? Object.fromEntries(Object.entries(value.metrics).slice(0, 10).map(([key, metric]) => [clean(key, 60), { display: clean(metric?.display, 120), label: clean(metric?.label, 240) }]).filter(([key]) => key)) : {}
  };
}

function sanitizeEvidenceMap(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const entries = Object.entries(value).slice(0, 50);
  const output = {};
  for (const [key, item] of entries) {
    const safeKey = clean(key, 220);
    if (!safeKey || !item || typeof item !== 'object') continue;
    const json = JSON.stringify(item);
    if (json.length <= 30_000) output[safeKey] = JSON.parse(json);
  }
  return output;
}

function finite(value) { const number = Number(value); return Number.isFinite(number) ? number : null; }
function clean(value, max = 500) { if (value == null) return null; const text = String(value).replace(/[\u0000-\u001f<>]/g, ' ').replace(/\s+/g, ' ').trim(); return text ? text.slice(0, max) : null; }
function safeUrl(value) { if (!value) return null; try { const url = new URL(String(value)); return url.protocol === 'https:' ? url.toString() : null; } catch { return null; } }
