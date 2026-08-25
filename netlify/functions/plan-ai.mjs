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
    return jsonResponse(200, { ok: true, data: publicPlanAiResult(result) });
  } catch (error) {
    // Sağlayıcı ve altyapı hatalarının teknik kodları istemciye taşınmaz.
    // Doğrulama/rate-limit gibi kullanıcının düzeltebileceği 4xx yanıtları korunur.
    if (Number(error?.statusCode || 500) >= 500) {
      return jsonResponse(503, {
        ok: false,
        message: 'Canlı açıklama şu anda hazırlanamadı. Mevcut parsel sonucunu kullanabilir veya kısa süre sonra yeniden deneyebilirsiniz.'
      });
    }
    return safeErrorResponse(error);
  }
}

function publicPlanAiResult(result = {}) {
  const cleanPublicText = (value, max) => String(value || '')
    .replace(/\bPLAN_AI_[A-Z0-9_]+\b/gi, ' ')
    .replace(/\bNVIDIA_API_KEY\b/gi, ' ')
    .replace(/\bHTTP\s*\d{3}\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
  const output = {
    answer: cleanPublicText(result.answer, 900),
    model: PLAN_AI_MODEL,
    version: PLAN_AI_VERSION
  };
  if (result.degraded === true) {
    output.degraded = true;
    output.notice = cleanPublicText(result.notice || 'Canlı açıklama şu anda kullanılamıyor; mevcut doğrulanmış analiz özetlendi.', 180);
  }
  return output;
}

function sanitizeAnalysis(value) {
  if (!value || typeof value !== 'object') return {};
  const json = JSON.stringify(value);
  if (json.length > 220_000) throw httpError('Analiz bağlamı çok büyük.', 413, 'PLAN_AI_CONTEXT_TOO_LARGE');
  return JSON.parse(json);
}
function clampInt(value, min, max, fallback) { const n = Number(value); return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.trunc(n))) : fallback; }
