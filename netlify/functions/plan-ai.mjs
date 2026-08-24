import { askPlanAI, PLAN_AI_MODEL, PLAN_AI_VERSION } from './lib/plan-ai-client.mjs';
import { enforceSimpleRateLimit, jsonResponse, parseJsonBody, requestIp, safeErrorResponse, httpError } from './lib/http.mjs';
import { runtimeEnv } from './lib/runtime-env.mjs';

const LIMITS = globalThis.__PLANLAMASYON_PLAN_AI_LIMITS__ || new Map();
globalThis.__PLANLAMASYON_PLAN_AI_LIMITS__ = LIMITS;

export async function handler(event, context = {}) {
  const env = runtimeEnv(context);
  if ((event.httpMethod || 'GET') !== 'POST') return jsonResponse(405, { ok: false, code: 'METHOD_NOT_ALLOWED', message: 'Yalnızca POST destekleniyor.' }, { Allow: 'POST' });
  try {
    enforceSimpleRateLimit(LIMITS, requestIp(event), clampInt(env.PLAN_AI_CHAT_RATE_LIMIT_PER_MINUTE, 1, 30, 8), 60_000);
    const body = parseJsonBody(event, 250_000);
    const question = String(body.question || '').trim();
    if (!question) throw httpError('Plan AI için bir soru yazın.', 400, 'PLAN_AI_QUESTION_REQUIRED');
    const analysis = sanitizeAnalysis(body.analysis);
    const result = await askPlanAI({ question, analysis, env });
    return jsonResponse(200, { ok: true, data: { ...result, model: PLAN_AI_MODEL, version: PLAN_AI_VERSION } });
  } catch (error) {
    return safeErrorResponse(error);
  }
}

function sanitizeAnalysis(value) {
  if (!value || typeof value !== 'object') return {};
  const json = JSON.stringify(value);
  if (json.length > 220_000) throw httpError('Analiz bağlamı çok büyük.', 413, 'PLAN_AI_CONTEXT_TOO_LARGE');
  return JSON.parse(json);
}
function clampInt(value, min, max, fallback) { const n = Number(value); return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.trunc(n))) : fallback; }
