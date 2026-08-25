export const OFFICIAL_SOURCE_SECURITY_VERSION = '3.7.0';

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const RETRYABLE_STATUSES = new Set([429, 502, 503, 504]);
const IDEMPOTENT_METHODS = new Set(['GET', 'HEAD']);
const BLOCKED_HOSTNAMES = new Set([
  'localhost', 'metadata.google.internal', 'metadata.goog',
  'instance-data', 'instance-data.ec2.internal'
]);
const BLOCKED_HOST_SUFFIXES = [
  '.localhost', '.local', '.internal', '.home.arpa', '.lan', '.intranet', '.corp', '.onion', '.invalid'
];

/**
 * Resmî kaynak ağ çağrılarında kullanılacak URL'yi kanonikleştirir.
 * Sayısal IP adresleri, kullanıcı bilgisi, özel portlar ve yerel DNS adları
 * özellikle reddedilir. Resmî kurumlar ve izinli adaptörler alan adıyla
 * tanımlandığı için doğrudan IP adresine ihtiyaç yoktur.
 */
export function validatePublicHttpsUrl(value, {
  requireOfficialHost = false,
  allowedHosts = '',
  maxLength = 4096
} = {}) {
  const raw = String(value || '').trim();
  if (!raw || raw.length > maxLength || /%(?:00|0a|0d|09|1b)/i.test(raw)) {
    throw securityError('Resmî kaynak adresi geçersiz veya güvenli sınırları aşıyor.', 'UNSAFE_SOURCE_URL');
  }

  let url;
  try { url = new URL(raw); } catch {
    throw securityError('Resmî kaynak adresi geçerli bir HTTPS URL değil.', 'UNSAFE_SOURCE_URL');
  }
  if (url.protocol !== 'https:' || url.username || url.password || !['', '443'].includes(url.port)) {
    throw securityError('Resmî kaynak için yalnız kullanıcı bilgisi içermeyen standart HTTPS adresi kullanılabilir.', 'UNSAFE_SOURCE_URL');
  }

  const host = canonicalHostname(url.hostname);
  if (!isSafePublicHostname(host)) {
    throw securityError('Resmî kaynak adresi yerel, özel veya sayısal bir ağ hedefine gidiyor.', 'BLOCKED_NETWORK_TARGET');
  }
  if (requireOfficialHost && !isOfficialTurkishHost(host) && !hostMatchesAllowlist(host, allowedHosts)) {
    throw securityError('Otomatik kaynak alan adı resmî alan adı veya açık izin listesiyle eşleşmiyor.', 'SOURCE_HOST_NOT_ALLOWED');
  }

  url.hostname = host;
  url.hash = '';
  return url.toString();
}

export function safePublicHttpsUrl(value, options = {}) {
  try { return validatePublicHttpsUrl(value, options); } catch { return null; }
}

export function isOfficialTurkishHost(value) {
  const host = canonicalHostname(value);
  return host === 'gov.tr' || host === 'bel.tr' || host.endsWith('.gov.tr') || host.endsWith('.bel.tr');
}

export function hostMatchesAllowlist(value, rawAllowlist) {
  const host = canonicalHostname(value);
  if (!host) return false;
  return parseAllowedHosts(rawAllowlist).some((entry) => host === entry || host.endsWith(`.${entry}`));
}

export function parseAllowedHosts(rawAllowlist) {
  const source = Array.isArray(rawAllowlist) ? rawAllowlist : String(rawAllowlist || '').split(/[\s,;]+/);
  return [...new Set(source.map((entry) => {
    const raw = String(entry || '').trim().toLowerCase().replace(/^\*\./, '').replace(/\.$/, '');
    if (!raw || raw.includes('/') || raw.includes('@') || raw.includes(':')) return null;
    const host = canonicalHostname(raw);
    return isSafePublicHostname(host) ? host : null;
  }).filter(Boolean))];
}

/**
 * Yönlendirmeleri fetch'e bırakmaz. Her Location yeniden doğrulanır ve varsayılan
 * olarak yalnız aynı origin'e izin verilir. GET/HEAD en fazla bir güvenli retry,
 * POST ise hiç retry kullanmaz. Tek deadline tüm retry ve redirect zincirini kapsar.
 */
export async function fetchOfficialResource(value, options = {}, {
  fetchImpl = globalThis.fetch,
  timeoutMs = 1800,
  retryCount = 1,
  maxRedirects = 2,
  allowPost = false,
  allowPostRedirects = false,
  allowCrossOriginRedirects = false,
  allowedRedirectHosts = '',
  maxResponseBytes = 5_000_000
} = {}) {
  if (typeof fetchImpl !== 'function') throw securityError('Sunucuda güvenli ağ erişimi bulunmuyor.', 'FETCH_UNAVAILABLE');

  const method = String(options.method || 'GET').trim().toUpperCase();
  if (!IDEMPOTENT_METHODS.has(method) && !(method === 'POST' && allowPost)) {
    throw securityError('Resmî kaynak isteğinde bu HTTP yöntemine izin verilmiyor.', 'HTTP_METHOD_NOT_ALLOWED');
  }
  if (options.body != null && !['POST'].includes(method)) {
    throw securityError('Salt-okunur resmî kaynak isteği gövde içeremez.', 'HTTP_BODY_NOT_ALLOWED');
  }
  if (options.body != null && utf8Length(options.body) > 256_000) {
    throw securityError('Yetkili form isteği güvenli gövde boyutu sınırını aşıyor.', 'REQUEST_BODY_TOO_LARGE');
  }

  const startUrl = validatePublicHttpsUrl(value);
  const startOrigin = new URL(startUrl).origin;
  const deadline = Date.now() + clampInt(timeoutMs, 250, 15_000, 1800);
  const retries = IDEMPOTENT_METHODS.has(method) ? clampInt(retryCount, 0, 1, 1) : 0;
  const redirects = clampInt(maxRedirects, 0, 3, 2);
  let lastError;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    let requestUrl = startUrl;
    let requestMethod = method;
    let requestBody = options.body;

    try {
      for (let redirectIndex = 0; ; redirectIndex += 1) {
        const remaining = deadline - Date.now();
        if (remaining <= 0) throw timeoutError();
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), remaining);
        let response;
        try {
          response = await fetchImpl(requestUrl, {
            ...options,
            method: requestMethod,
            body: requestBody,
            redirect: 'manual',
            signal: controller.signal
          });
        } catch (error) {
          if (error?.name === 'AbortError') throw timeoutError();
          throw error;
        } finally {
          clearTimeout(timer);
        }

        const reportedUrl = response?.url ? validatePublicHttpsUrl(response.url) : requestUrl;
        if (reportedUrl !== requestUrl) {
          assertRedirectAllowed(requestUrl, reportedUrl, {
            startOrigin, allowCrossOriginRedirects, allowedRedirectHosts
          });
        }

        if (!REDIRECT_STATUSES.has(Number(response?.status))) {
          assertResponseSize(response, maxResponseBytes);
          defineFinalUrl(response, reportedUrl || requestUrl);
          if (attempt < retries && RETRYABLE_STATUSES.has(Number(response?.status)) && deadline - Date.now() > 25) break;
          return response;
        }

        if (redirectIndex >= redirects) throw securityError('Resmî kaynak çok fazla yönlendirme döndürdü.', 'REDIRECT_LIMIT_EXCEEDED');
        if (requestMethod === 'POST' && !allowPostRedirects) {
          throw securityError('Yetkili form isteğinin otomatik yönlendirmesine izin verilmiyor.', 'POST_REDIRECT_NOT_ALLOWED');
        }
        const location = response?.headers?.get?.('location');
        if (!location) throw securityError('Resmî kaynak yönlendirmesi hedef adres içermiyor.', 'INVALID_REDIRECT');
        const nextUrl = validatePublicHttpsUrl(new URL(location, requestUrl).toString());
        assertRedirectAllowed(requestUrl, nextUrl, {
          startOrigin, allowCrossOriginRedirects, allowedRedirectHosts
        });
        if (requestMethod === 'POST' && [301, 302, 303].includes(Number(response.status))) {
          requestMethod = 'GET';
          requestBody = undefined;
        }
        requestUrl = nextUrl;
      }
    } catch (error) {
      lastError = error;
      if (error?.name === 'AbortError' || attempt >= retries || deadline - Date.now() <= 25 || !isRetryableNetworkError(error)) throw error;
    }
  }
  throw lastError || securityError('Resmî kaynağa güvenli bağlantı kurulamadı.', 'OFFICIAL_FETCH_FAILED');
}

export async function readResponseTextLimited(response, maxBytes = 2_000_000) {
  const limit = clampInt(maxBytes, 1024, 10_000_000, 2_000_000);
  assertResponseSize(response, limit);
  if (!response?.body?.getReader) {
    const text = await response.text();
    if (utf8Length(text) > limit) throw securityError('Resmî kaynak yanıtı güvenli boyut sınırını aşıyor.', 'SOURCE_RESPONSE_TOO_LARGE');
    return text;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let output = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value?.byteLength || 0;
      if (total > limit) {
        try { await reader.cancel(); } catch {}
        throw securityError('Resmî kaynak yanıtı güvenli boyut sınırını aşıyor.', 'SOURCE_RESPONSE_TOO_LARGE');
      }
      output += decoder.decode(value, { stream: true });
    }
    output += decoder.decode();
    return output;
  } finally {
    try { reader.releaseLock(); } catch {}
  }
}

/** Yanıt gövdesini akış halinde okuyup gerçek bayt sayısını sınırlar. */
export async function readResponseBytesLimited(response, maxBytes = 5_000_000) {
  const limit = clampInt(maxBytes, 1024, 20_000_000, 5_000_000);
  assertResponseSize(response, limit);
  if (!response?.body?.getReader) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > limit) throw securityError('Resmî kaynak yanıtı güvenli boyut sınırını aşıyor.', 'SOURCE_RESPONSE_TOO_LARGE');
    return bytes;
  }

  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = value instanceof Uint8Array ? value : new Uint8Array(value || 0);
      total += chunk.byteLength;
      if (total > limit) {
        try { await reader.cancel(); } catch {}
        throw securityError('Resmî kaynak yanıtı güvenli boyut sınırını aşıyor.', 'SOURCE_RESPONSE_TOO_LARGE');
      }
      chunks.push(chunk);
    }
  } finally {
    try { reader.releaseLock(); } catch {}
  }

  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

/** Veri güncelliğini erişim tarihinden türetmez; belge tarihi yoksa bilinmiyor der. */
export function describeSourceFreshness({ documentDate, verifiedAt, retrievedAt } = {}, {
  now = new Date(),
  currentDays = 180,
  staleDays = 730
} = {}) {
  const document = parseDate(documentDate);
  const verified = parseDate(verifiedAt);
  const retrieved = parseDate(retrievedAt);
  const nowDate = now instanceof Date ? now : new Date(now);
  const ageDays = document && Number.isFinite(nowDate.getTime())
    ? Math.max(0, Math.floor((nowDate.getTime() - document.getTime()) / 86_400_000))
    : null;
  const dataStatus = ageDays == null ? 'unknown' : ageDays <= currentDays ? 'current' : ageDays <= staleDays ? 'aging' : 'stale';
  return {
    dataStatus,
    basis: document ? 'document-date' : 'unknown',
    documentDate: isoDate(document),
    linkVerifiedAt: isoDate(verified),
    retrievedAt: retrieved ? retrieved.toISOString() : null,
    ageDays,
    note: document
      ? `Veri güncelliği belge tarihine göre ${dataStatus} olarak sınıflandırıldı.`
      : 'Belge tarihi bulunmadığı için veri güncelliği bilinmiyor; erişim tarihi güncellik kanıtı sayılmadı.'
  };
}

function assertRedirectAllowed(fromValue, toValue, { startOrigin, allowCrossOriginRedirects, allowedRedirectHosts }) {
  const from = new URL(validatePublicHttpsUrl(fromValue));
  const to = new URL(validatePublicHttpsUrl(toValue));
  if (to.origin === from.origin && to.origin === startOrigin) return;
  if (allowCrossOriginRedirects && hostMatchesAllowlist(to.hostname, allowedRedirectHosts)) return;
  throw securityError('Resmî kaynak farklı bir sunucuya yönlendiği için istek durduruldu.', 'CROSS_ORIGIN_REDIRECT_BLOCKED');
}

function isRetryableNetworkError(error) {
  if (!error || error?.name === 'AbortError') return false;
  if (String(error?.code || '').startsWith('UNSAFE_') || /_NOT_ALLOWED|_BLOCKED|_LIMIT|_TOO_LARGE/.test(String(error?.code || ''))) return false;
  return error instanceof TypeError || ['ECONNRESET', 'EAI_AGAIN', 'ENETUNREACH', 'ETIMEDOUT'].includes(error?.code);
}

function canonicalHostname(value) {
  return String(value || '').trim().toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
}

function isSafePublicHostname(host) {
  if (!host || host.length > 253 || BLOCKED_HOSTNAMES.has(host) || BLOCKED_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))) return false;
  if (host.includes(':')) return false; // Sayısal IPv6 hedefleri kullanılmaz.
  if (/^\d+(?:\.\d+){3}$/.test(host)) return false; // Sayısal IPv4 hedefleri kullanılmaz.
  const labels = host.split('.');
  if (labels.length < 2) return false;
  return labels.every((label) => label && label.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label));
}

function assertResponseSize(response, maxBytes) {
  const limit = clampInt(maxBytes, 1024, 20_000_000, 5_000_000);
  const raw = response?.headers?.get?.('content-length');
  const size = Number(raw);
  if (Number.isFinite(size) && size > limit) {
    throw securityError('Resmî kaynak yanıtı güvenli boyut sınırını aşıyor.', 'SOURCE_RESPONSE_TOO_LARGE');
  }
}

function defineFinalUrl(response, value) {
  if (!response || !value) return;
  try { Object.defineProperty(response, 'officialFinalUrl', { value, configurable: true }); } catch {}
}

function parseDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}
function isoDate(value) { return value ? value.toISOString().slice(0, 10) : null; }
function utf8Length(value) { return new TextEncoder().encode(String(value || '')).byteLength; }
function timeoutError() { const error = securityError('Resmî kaynak zaman aşımına uğradı.', 'OFFICIAL_FETCH_TIMEOUT'); error.name = 'AbortError'; return error; }
function securityError(message, code) { const error = new Error(message); error.code = code; return error; }
function clampInt(value, min, max, fallback) { const number = Number(value); return Number.isFinite(number) ? Math.min(max, Math.max(min, Math.trunc(number))) : fallback; }
