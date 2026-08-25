import { buildParcelAnalysis } from './lib/analysis-core.mjs';
import { analyzeEnvironment } from './lib/environment-client.mjs';
import { resolveZoning } from './lib/zoning-client.mjs';
import { enforceSimpleRateLimit, jsonResponse, parseJsonBody, requestIp, safeErrorResponse, httpError } from './lib/http.mjs';
import { runtimeEnv } from './lib/runtime-env.mjs';

const LIMITS = globalThis.__PLANLAMASYON_ANALYSIS_LIMITS__ || new Map();
globalThis.__PLANLAMASYON_ANALYSIS_LIMITS__ = LIMITS;

export async function handler(event, context = {}) {
  const env = runtimeEnv(context);
  if ((event.httpMethod || 'GET') !== 'POST') return jsonResponse(405, { ok: false, code: 'METHOD_NOT_ALLOWED', message: 'Yalnızca POST destekleniyor.' }, { Allow: 'POST' });
  try {
    enforceSimpleRateLimit(LIMITS, requestIp(event), clampInt(env.ANALYSIS_RATE_LIMIT_PER_MINUTE, 5, 120, 30), 60_000);
    const body = parseJsonBody(event);
    const parcel = sanitizeParcel(body.parcel);
    const query = sanitizeQuery(body.query || {});
    const evidence = sanitizeEvidence(body.evidence);
    const forceRefresh = body.forceRefresh === true;
    if (!parcel?.geometry || !parcel?.properties) throw httpError('Geçerli parsel geometrisi ve bilgileri gerekli.', 400, 'INVALID_PARCEL');

    const boundedEnv = buildAnalysisEnv(env, forceRefresh, {
      OPEN_OFFICIAL_SOURCE_MAX_CANDIDATES: 12,
      OPEN_OFFICIAL_SOURCE_TIMEOUT_MS: 3200,
      OPEN_OFFICIAL_SOURCE_TOTAL_BUDGET_MS: 9000,
      PUBLIC_PLAN_COVERAGE_TIMEOUT_MS: 5000,
      PUBLIC_PLAN_RECORD_TOTAL_TIMEOUT_MS: 5500,
      PUBLIC_PLAN_RECORD_TIMEOUT_MS: 2500,
      MUNICIPALITY_EDEVLET_DISCOVERY_TIMEOUT_MS: 2000,
      PLAN_AI_MAX_SOURCES: 3,
      PLAN_AI_SOURCE_TIMEOUT_MS: 4500,
      PLAN_AI_EVIDENCE_TOTAL_BUDGET_MS: 9000,
      PLAN_AI_TIMEOUT_MS: 9000,
      PLAN_AI_AUTO_ENABLED: 'false',
      PLAN_AI_MAX_TOKENS: 900,
      OVERPASS_TOTAL_TIMEOUT_MS: 7000,
      OVERPASS_TIMEOUT_MS: 2800,
      NOMINATIM_FALLBACK_ENABLED: 'true'
    });

    const [zoningResult, environmentResult] = await Promise.allSettled([
      settleWithin(
        resolveZoning({ parcel, query, evidence, env: boundedEnv }),
        12_000,
        () => ({
          status: 'unavailable', conflict: false, fields: {}, sources: [],
          sourceScan: { status: 'incomplete', exhausted: false, budgetLimited: true, attemptedCount: 0, reachableCount: 0, foundRecordCount: 0, attempts: [], sources: [], message: 'İmar kaynakları süre sınırı içinde tamamlanamadı.' },
          planAi: { status: 'unavailable', enabled: true, configured: Boolean(boundedEnv.NVIDIA_API_KEY), canCalculate: false, evidenceBackedFields: [], evidence: [], attempts: [], message: 'Plan AI süre sınırı nedeniyle bu turda tamamlanamadı.' },
          planContext: { status: 'unavailable', matches: [], metadata: {}, records: [], sources: [] },
          providerDiscovery: { status: 'national-portals-ready', actions: [], sources: [], municipalServices: [], catalog: { embedded: true, matchCount: 0 }, message: 'Kaynak keşfi süre sınırına ulaştı; e-Plan bağlantısı manuel olarak kullanılabilir.' },
          configuration: { boundedAnalysis: true, boundedAnalysisVersion: '3.5.0', forceRefresh },
          diagnostics: [{ connector: 'analysis-deadline', message: 'İmar analizi güvenli süre sınırına ulaştı.' }],
          message: 'İmar servislerinden bazıları süre sınırı içinde yanıt vermedi; bulunan kadastro sonucu korunarak eksik alanlar işaretlendi.'
        })
      ),
      settleWithin(
        analyzeEnvironment({ geometry: parcel.geometry, env: boundedEnv }),
        8_000,
        () => ({ status: 'unavailable', categories: [], items: [], message: 'Yakın çevre servisi süre içinde yanıt vermedi; parsel ve imar sonucu bundan etkilenmez.' })
      )
    ]);

    const zoning = zoningResult.status === 'fulfilled' ? zoningResult.value : {
      status: 'unavailable', conflict: false, fields: {}, sources: [], message: String(zoningResult.reason?.message || 'İmar kaynağı alınamadı.')
    };
    const environment = environmentResult.status === 'fulfilled' ? environmentResult.value : {
      status: 'unavailable', categories: [], items: [], message: String(environmentResult.reason?.message || 'Yakın çevre verisi alınamadı.')
    };
    const analysis = buildParcelAnalysis({ parcel, zoning, environment });
    analysis.version = '3.5.0';
    analysis.forceRefreshed = forceRefresh;
    analysis.manualOnly = Boolean(zoning?.manualOnly || zoning?.status === 'manual-only');
    analysis.zoning.manualOnly = analysis.manualOnly;
    analysis.zoning.fieldSources = zoning?.fieldSources || {};
    analysis.zoning.selectedSource = zoning?.selectedSource || null;
    analysis.planAi = {
      ...(analysis.planAi || {}),
      degraded: ['disabled', 'unavailable', 'no-values', 'review-required'].includes(analysis.planAi?.status),
      fallbackAvailable: true
    };
    applyFieldProvenance(analysis, zoning?.fieldSources || {});
    return jsonResponse(200, { ok: true, data: analysis });
  } catch (error) {
    return safeErrorResponse(error);
  }
}


export function buildAnalysisEnv(env = {}, forceRefresh = false, defaults = {}) {
  const value = { ...defaults, ...(env && typeof env === 'object' ? env : {}) };
  if (forceRefresh) Object.assign(value, {
    OPEN_OFFICIAL_SOURCE_CACHE_DISABLED: 'true',
    PLAN_AI_CACHE_DISABLED: 'true',
    MUNICIPALITY_PROVIDER_CACHE_DISABLED: 'true',
    PUBLIC_PLAN_COVERAGE_CACHE_DISABLED: 'true',
    PUBLIC_PLAN_RECORD_CACHE_DISABLED: 'true',
    ZONING_CONNECTOR_CACHE_DISABLED: 'true'
  });
  return value;
}

function applyFieldProvenance(analysis, fieldSources) {
  const technicalFields = {
    'Plan fonksiyonu': 'landUse', TAKS: 'taks', 'Emsal / KAKS': 'emsal', 'Kat adedi': 'floors',
    'Yençok / Hmax': 'hmax', 'Yapı nizamı': 'buildingOrder', 'Ön bahçe': 'frontSetback',
    'Yan bahçe': 'sideSetback', 'Arka bahçe': 'rearSetback', 'Plan adı': 'planName',
    'Plan işlem / karar no': 'planNumber', 'Plan ölçeği': 'planScale', 'Yetkili idare': 'authority'
  };
  for (const row of analysis.technical || []) {
    const field = technicalFields[row.label];
    if (field && fieldSources[field]?.title) row.source = fieldSources[field].title;
  }
  const claimFields = {
    'Plan fonksiyonu': 'landUse', TAKS: 'taks', Emsal: 'emsal', 'Kat adedi': 'floors',
    'Yençok / Hmax': 'hmax', 'Yapı nizamı': 'buildingOrder'
  };
  for (const claim of analysis.claims || []) {
    const field = claimFields[claim.claim];
    if (field && fieldSources[field]?.id) claim.sourceId = fieldSources[field].id;
  }
}
async function settleWithin(promise, timeoutMs, fallbackFactory) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve(promise),
      new Promise((resolve) => { timer = setTimeout(() => resolve(fallbackFactory()), timeoutMs); })
    ]);
  } finally { if (timer) clearTimeout(timer); }
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

function sanitizeEvidence(value) {
  if (!value || typeof value !== 'object') return null;
  const json = JSON.stringify(value);
  if (json.length > 30_000) throw httpError('İmar belgesi bilgisi çok büyük.', 413, 'EVIDENCE_TOO_LARGE');
  return JSON.parse(json);
}
function clean(value, max) { if (value == null) return null; const text = String(value).replace(/[\u0000-\u001f<>]/g, ' ').replace(/\s+/g, ' ').trim(); return text ? text.slice(0, max) : null; }
function clampInt(value, min, max, fallback) { const number = Number(value); return Number.isFinite(number) ? Math.min(max, Math.max(min, Math.trunc(number))) : fallback; }
