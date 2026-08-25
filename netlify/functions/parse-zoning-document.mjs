import { extractText, getDocumentProxy } from 'unpdf';
import { parseZoningDocumentText, ZONING_DOCUMENT_PARSER_VERSION } from './lib/zoning-document-parser.mjs';
import { parseBesiktasKeosImarHtml, BESIKTAS_KEOS_IMAR_PARSER_VERSION } from './lib/besiktas-keos-imar-parser.mjs';
import { enforceSimpleRateLimit, jsonResponse, normalizeHeaders, parseJsonBody, requestIp, safeErrorResponse, httpError } from './lib/http.mjs';
import { fetchOfficialResource, readResponseBytesLimited, validatePublicHttpsUrl } from './lib/official-source-security.mjs';
import { runtimeEnv } from './lib/runtime-env.mjs';

const LIMITS = globalThis.__PLANLAMASYON_DOCUMENT_PARSE_LIMITS__ || new Map();
globalThis.__PLANLAMASYON_DOCUMENT_PARSE_LIMITS__ = LIMITS;

const MAX_REMOTE_BYTES = 10 * 1024 * 1024;
const MAX_PDF_PAGES = 80;
const MAX_JSON_BODY_BYTES = 1_900_000;
const ALLOWED_TEXT_MIME_TYPES = new Set([
  'text/plain', 'text/html', 'text/csv', 'application/json', 'application/xml', 'text/xml',
  'application/xhtml+xml', 'application/gml+xml', 'application/pdf', 'image/png', 'image/jpeg', 'image/jpg'
]);
const SENSITIVE_QUERY_KEY = /^(?:access[-_.]?token|id[-_.]?token|refresh[-_.]?token|login[-_.]?token|token|bearer|auth(?:orization)?|auth[-_.]?key|session(?:id)?|sid|phpsessid|jsessionid|code|ticket|sso|jwt|signature|sig|secret|client[-_.]?secret|api[-_.]?key|credential|key[-_.]?pair[-_.]?id|policy|expires|password|passwd|pwd|samlresponse|relaystate|oauth[-_.]?.*|state|nonce|tckn|tc[-_.]?(?:kimlik|kimlikno)|identity|email|phone|username)$/i;

export async function handler(event, context = {}) {
  if ((event.httpMethod || 'GET') !== 'POST') return jsonResponse(405, { ok: false, code: 'METHOD_NOT_ALLOWED', message: 'Yalnızca POST destekleniyor.' }, { Allow: 'POST' });
  try {
    const headers = normalizeHeaders(event.headers || {});
    const contentType = String(headers['content-type'] || '').toLowerCase();
    if (contentType && !contentType.includes('application/json')) {
      throw httpError('İstek JSON biçiminde gönderilmelidir.', 415, 'UNSUPPORTED_MEDIA_TYPE');
    }
    enforceSimpleRateLimit(LIMITS, requestIp(event), 12, 60_000);
    const body = parseJsonBody(event, MAX_JSON_BODY_BYTES);
    const env = runtimeEnv(context);
    const mode = String(body.mode || (body.sourceUrl ? 'url' : 'text')).toLowerCase();
    const query = sanitizeObject(body.query, 20, 220);
    const parcel = sanitizeParcel(body.parcel);
    let text = '';
    const receivedAt = new Date().toISOString();
    let metadata = {
      sourceTitle: clean(body.sourceTitle, 280),
      authority: clean(body.authority, 240),
      sourceUrl: sanitizeDocumentUrl(body.sourceUrl, env, { forFetch: mode === 'url' }),
      fileName: clean(body.fileName, 260),
      mimeType: sanitizeDeclaredMimeType(body.mimeType),
      documentDate: clean(body.documentDate, 80),
      retrievedAt: receivedAt,
      sourceLastModified: null,
      evidenceOrigin: sanitizeEvidenceOrigin(body.evidenceOrigin),
      userConfirmedOfficialSource: body.userConfirmedOfficialSource === true,
      sourceVerification: body.userConfirmedOfficialSource === true ? 'user-confirmed-source' : 'unconfirmed-user-source'
    };

    if (mode === 'url') {
      if (!metadata.sourceUrl) throw httpError('Geçerli bir HTTPS resmî belge bağlantısı gerekli.', 400, 'DOCUMENT_URL_REQUIRED');
      const remote = await fetchOfficialDocument(metadata.sourceUrl, {
        env,
        fetchImpl: context?.fetchImpl || globalThis.fetch
      });
      text = remote.text;
      metadata = {
        ...metadata,
        ...remote.metadata,
        sourceUrl: remote.metadata.finalUrl || metadata.sourceUrl,
        sourceVerification: 'official-host-retrieved'
      };
    } else if (mode === 'text') {
      text = String(body.text || '');
      if (!text.trim()) throw httpError('Okunacak belge metni gerekli.', 400, 'DOCUMENT_TEXT_REQUIRED');
    } else {
      throw httpError('Desteklenmeyen belge okuma yöntemi.', 400, 'DOCUMENT_MODE_UNSUPPORTED');
    }

    const parsed = looksLikeBesiktasKeosHtml(text)
      ? parseUserProvidedBesiktasHtml({ text, query, parcel, metadata, body, mode })
      : parseZoningDocumentText({ text, query, parcel, metadata });
    return jsonResponse(200, {
      ok: true,
      data: {
        ...parsed,
        extraction: {
          mode,
          sourceUrl: metadata.sourceUrl || null,
          fileName: metadata.fileName || null,
          mimeType: metadata.mimeType || null,
          pageCount: metadata.pageCount || null,
          parserVersion: ZONING_DOCUMENT_PARSER_VERSION,
          documentDate: parsed.evidence?.documentDate || metadata.documentDate || null,
          sourceLastModified: parsed.evidence?.sourceLastModified || metadata.sourceLastModified || null,
          retrievedAt: parsed.evidence?.retrievedAt || metadata.retrievedAt || null,
          characterCount: text.length,
          sourceVerification: parsed.evidence?.sourceVerification || metadata.sourceVerification,
          inputIntegrity: mode === 'text' ? 'extracted-text-only' : 'server-retrieved-bytes'
        }
      }
    });
  } catch (error) {
    return safeErrorResponse(error);
  }
}

function looksLikeBesiktasKeosHtml(text) {
  return /Beşiktaş Belediyesi[^<]{0,120}İmar Durumu|T\.?\s*C\.?\s*Beşiktaş Belediyesi/iu.test(String(text || ''))
    && /divTableRow|htmlOutput/iu.test(String(text || ''));
}

function parseUserProvidedBesiktasHtml({ text, query, parcel, metadata, body, mode }) {
  if (mode !== 'text') throw httpError('Beşiktaş Belediyesi portalı otomatik URL okumasına kapalıdır. Güncel resmî sonucu indirip Dosya sekmesinden yükleyin.', 403, 'BESIKTAS_AUTOMATIC_READ_FORBIDDEN');
  const parsed = parseBesiktasKeosImarHtml({
    html: text,
    query,
    parcel,
    sourceUrl: metadata.sourceUrl,
    evidence: {
      origin: body.evidenceOrigin,
      userConfirmedOfficialSource: body.userConfirmedOfficialSource === true
    }
  });
  if (parsed.status === 'permission-required') {
    throw httpError('Bu belediye sonucu yalnız kullanıcı tarafından sağlanan resmî belge ve açık kullanıcı onayıyla okunabilir.', 403, 'DOCUMENT_USER_CONFIRMATION_REQUIRED');
  }
  const expected = parsed.expectedParcel || {};
  if (!parsed.canApply || !parsed.record) {
    return {
      version: BESIKTAS_KEOS_IMAR_PARSER_VERSION,
      status: 'review-required',
      canApply: false,
      documentType: 'zoning-status-document',
      documentTypeLabel: 'Beşiktaş Belediyesi imar durumu sonucu',
      documentHash: null,
      parcelMatch: parsed.parcelMatch,
      detectedParcels: parsed.detectedParcel ? [parsed.detectedParcel] : [],
      expectedParcel: expected,
      fields: {},
      fieldEvidence: {},
      evidence: {
        confirmed: false,
        parcelConfirmed: false,
        sourceTitle: 'Beşiktaş Belediyesi İmar Durumu',
        authority: 'Beşiktaş Belediyesi',
        sourceUrl: null,
        parserVersion: BESIKTAS_KEOS_IMAR_PARSER_VERSION,
        documentType: 'zoning-status-document',
        documentHashKind: 'extracted-text-sha256',
        parcelMatchStatus: parsed.parcelMatch?.status || 'unverified',
        sourceVerification: metadata.sourceVerification || 'user-confirmed-source',
        evidenceOrigin: metadata.evidenceOrigin || 'user-upload',
        fieldEvidence: {},
        allowances: {}
      },
      completeness: { populatedCore: 0, requiredTotal: 7, requiredFound: 0, missing: parsed.missingFields || [], percentage: 0 },
      confidence: 'low',
      warnings: parsed.warnings || [parsed.message],
      preview: ''
    };
  }
  const generic = parseZoningDocumentText({ text: htmlToText(text), query, parcel, metadata });
  const fields = parsed.fields || {};
  const fieldEvidence = Object.fromEntries(Object.entries(parsed.fieldEvidence || {}).map(([key, item]) => [key, {
    label: item.label || key,
    value: item.value ?? fields[key] ?? null,
    unit: documentFieldUnit(key),
    confidence: item.confidence || 'high',
    excerpt: `${item.label || key}: ${item.rawValue ?? item.value ?? ''}`,
    method: item.method || 'besiktas-keos-result-row',
    sourceTitle: parsed.source?.title || metadata.sourceTitle || 'Beşiktaş Belediyesi İmar Durumu',
    sourceAuthority: 'Beşiktaş Belediyesi',
    sourceUrl: parsed.source?.url || metadata.sourceUrl || null,
    documentDate: fields.planDate || metadata.documentDate || null,
    sourceLastModified: metadata.sourceLastModified || null,
    retrievedAt: metadata.retrievedAt || new Date().toISOString(),
    parserVersion: BESIKTAS_KEOS_IMAR_PARSER_VERSION,
    documentHash: generic.documentHash || null,
    documentHashKind: generic.evidence?.documentHashKind || 'extracted-text-sha256',
    parcelMatchStatus: 'exact',
    sourceVerification: metadata.sourceVerification || 'user-confirmed-source',
    evidenceOrigin: metadata.evidenceOrigin || 'user-upload'
  }]));
  const core = ['landUse', 'taks', 'emsal', 'floors', 'hmax', 'buildingOrder', 'frontSetback', 'sideSetback', 'rearSetback'];
  const populated = core.filter((key) => fields[key] != null);
  const required = ['landUse', 'taks', 'emsal', 'floors', 'frontSetback', 'sideSetback', 'rearSetback'];
  const missing = required.filter((key) => fields[key] == null);
  return {
    ...generic,
    version: BESIKTAS_KEOS_IMAR_PARSER_VERSION,
    status: missing.length ? 'partial' : 'ready',
    canApply: true,
    documentType: 'zoning-status-document',
    documentTypeLabel: 'Beşiktaş Belediyesi imar durumu sonucu',
    parcelMatch: parsed.parcelMatch,
    detectedParcels: [parsed.detectedParcel],
    expectedParcel: expected,
    fields,
    fieldEvidence,
    evidence: {
      ...generic.evidence,
      confirmed: false,
      parcelConfirmed: true,
      sourceTitle: parsed.source?.title || 'Beşiktaş Belediyesi İmar Durumu',
      authority: 'Beşiktaş Belediyesi',
      sourceUrl: parsed.source?.url || null,
      planName: fields.planName || null,
      planScale: fields.planScale || null,
      planDate: fields.planDate || null,
      landUse: fields.landUse || null,
      taks: fields.taks,
      emsal: fields.emsal,
      floors: fields.floors,
      hmax: fields.hmax,
      buildingOrder: fields.buildingOrder || null,
      frontSetback: fields.frontSetback,
      sideSetback: fields.sideSetback,
      rearSetback: fields.rearSetback,
      parserVersion: BESIKTAS_KEOS_IMAR_PARSER_VERSION,
      documentType: 'zoning-status-document',
      documentHashKind: generic.evidence?.documentHashKind || 'extracted-text-sha256',
      documentDate: fields.planDate || generic.evidence?.documentDate || metadata.documentDate || null,
      sourceLastModified: generic.evidence?.sourceLastModified || metadata.sourceLastModified || null,
      retrievedAt: metadata.retrievedAt || generic.evidence?.retrievedAt || null,
      extractionConfidence: parsed.record.extractionConfidence || 'high',
      parcelMatchStatus: 'exact',
      detectedParcels: [parsed.detectedParcel],
      sourceVerification: metadata.sourceVerification || 'user-confirmed-source',
      evidenceOrigin: metadata.evidenceOrigin || 'user-upload',
      fieldEvidence
    },
    completeness: {
      populatedCore: populated.length,
      requiredTotal: required.length,
      requiredFound: required.length - missing.length,
      missing,
      percentage: Math.round(((required.length - missing.length) / required.length) * 100)
    },
    confidence: parsed.record.extractionConfidence || 'high',
    warnings: parsed.warnings || []
  };
}

async function fetchOfficialDocument(inputUrl, { env = {}, fetchImpl = globalThis.fetch } = {}) {
  const initialUrl = sanitizeDocumentUrl(inputUrl, env, { forFetch: true });
  try {
    const startHost = new URL(initialUrl).hostname;
    const allowedRedirectHosts = [
      String(env.OFFICIAL_DOCUMENT_ALLOWED_HOSTS || ''),
      startHost,
      /^www\.[^.]+\.(?:bel|gov)\.tr$/i.test(startHost) ? startHost.slice(4) : ''
    ].filter(Boolean).join(',');
    const response = await fetchOfficialResource(initialUrl, {
      method: 'GET',
      headers: {
        Accept: 'application/pdf,text/html,application/xhtml+xml,text/plain,application/json,application/xml,text/xml;q=0.9,*/*;q=0.3',
        'User-Agent': 'Planlamasyon/3.8.0 (+https://planlamasyon.truva-ai.com; public-document-reader)'
      }
    }, {
      fetchImpl,
      timeoutMs: 15_000,
      retryCount: 1,
      maxRedirects: 3,
      allowCrossOriginRedirects: true,
      allowedRedirectHosts,
      maxResponseBytes: MAX_REMOTE_BYTES,
      validateUrl: (value) => sanitizeDocumentUrl(value, env, { forFetch: true })
    });
    const finalUrl = sanitizeDocumentUrl(response.officialFinalUrl || response.url || initialUrl, env, { forFetch: true });
    if (!response.ok) throw httpError(`Resmî belge sunucusu ${response.status} yanıtı verdi.`, response.status === 404 ? 404 : 502, 'DOCUMENT_FETCH_FAILED');
    const buffer = await readResponseBytesLimited(response, MAX_REMOTE_BYTES);
    const mimeType = String(response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    const fileName = fileNameFromResponse(response, finalUrl);
    let text;
    let pageCount = null;
    const pdfDeclared = mimeType === 'application/pdf' || /\.pdf$/i.test(fileName || '');
    if (looksLikePdf(buffer)) {
      const result = await extractPdfText(buffer);
      text = result.text;
      pageCount = result.pageCount;
    } else if (pdfDeclared) {
      throw httpError('Bağlantı PDF olarak bildirildi ancak dosya imzası geçerli değil.', 415, 'DOCUMENT_MIME_MISMATCH');
    } else if (isTextLike(mimeType, fileName) && looksLikeText(buffer)) {
      text = decodeText(buffer);
      if (/html|xhtml/i.test(mimeType) || /\.html?$/i.test(fileName || '')) text = htmlToText(text);
    } else if (isTextLike(mimeType, fileName)) {
      throw httpError('Belge metin olarak bildirildi ancak içerik güvenli metin denetiminden geçmedi.', 415, 'DOCUMENT_MIME_MISMATCH');
    } else {
      throw httpError(`Bu bağlantıdaki ${mimeType || 'dosya türü'} otomatik okunamıyor. PDF, HTML, JSON, XML veya metin kullanın.`, 415, 'DOCUMENT_TYPE_UNSUPPORTED');
    }
    if (!text || text.trim().length < 20) throw httpError('Belgeden yeterli metin çıkarılamadı. Taranmış dosyayı uygulamadaki OCR seçeneğiyle yükleyin.', 422, 'DOCUMENT_TEXT_EMPTY');
    return {
      text,
      metadata: {
        finalUrl,
        fileName,
        mimeType: mimeType || inferMime(fileName),
        pageCount,
        documentDate: null,
        sourceLastModified: normalizeHttpTimestamp(response.headers.get('last-modified')),
        retrievedAt: new Date().toISOString(),
        sourceTitle: fileName ? fileName.replace(/\.[^.]+$/, '') : null
      }
    };
  } catch (error) {
    throw mapOfficialDocumentFetchError(error);
  }
}

async function extractPdfText(buffer) {
  let pdf;
  try {
    pdf = await getDocumentProxy(buffer, { maxImageSize: 16_777_216, isEvalSupported: false, useSystemFonts: true });
  } catch {
    throw httpError('PDF açılamadı veya parola korumalı.', 422, 'PDF_OPEN_FAILED');
  }
  if (pdf.numPages > MAX_PDF_PAGES) throw httpError(`PDF ${MAX_PDF_PAGES} sayfadan uzun olduğu için otomatik işlenemedi.`, 413, 'PDF_PAGE_LIMIT');
  try {
    const output = await Promise.race([
      extractText(pdf, { mergePages: true }),
      new Promise((_, reject) => setTimeout(() => reject(httpError('PDF metin çıkarma işlemi zaman aşımına uğradı.', 504, 'PDF_PARSE_TIMEOUT')), 12_000))
    ]);
    const text = Array.isArray(output?.text) ? output.text.join('\n') : String(output?.text || '');
    return { text, pageCount: Number(output?.totalPages || pdf.numPages || 0) || null };
  } finally {
    try { await pdf.destroy?.(); } catch {}
  }
}

function sanitizeDocumentUrl(value, env = {}, { forFetch = false } = {}) {
  if (!value) return null;
  let validated;
  try {
    validated = validatePublicHttpsUrl(value, {
      requireOfficialHost: true,
      allowedHosts: env.OFFICIAL_DOCUMENT_ALLOWED_HOSTS || ''
    });
  } catch (error) {
    throw mapDocumentUrlError(error);
  }
  const url = new URL(validated);
  for (const key of url.searchParams.keys()) {
    if (isSensitiveQueryKey(key)) {
      throw httpError('Oturum, kimlik doğrulama veya imza bilgisi içeren belge bağlantısı kabul edilmez.', 400, 'DOCUMENT_URL_SENSITIVE_QUERY');
    }
  }
  const host = url.hostname.toLowerCase();
  if (forFetch && (host === 'turkiye.gov.tr' || host.endsWith('.turkiye.gov.tr'))) {
    throw httpError('e-Devlet oturum ve hizmet sayfaları otomatik okunmaz. Belgeyi e-Devlet üzerinden kendiniz indirip Dosya sekmesinden ekleyin.', 403, 'EDEVLET_AUTOMATIC_READ_FORBIDDEN');
  }
  if (forFetch && ['os.besiktas.bel.tr', 'keos.besiktas.bel.tr'].includes(host)) {
    throw httpError('Beşiktaş Belediyesi kullanım koşulları otomatik üçüncü taraf işlemini yasaklıyor. Sonucu belediye sitesinden açıp güncel belgeyi Dosya sekmesinden yükleyin.', 403, 'BESIKTAS_AUTOMATIC_READ_FORBIDDEN');
  }
  if (forFetch && host === 'kentrehberi.sisli.bel.tr' && url.pathname.toLowerCase().startsWith('/imardurum')) {
    throw httpError('Şişli Belediyesi imar portalı kullanım koşulları nedeniyle otomatik okunmaz. Sonucu resmî portalda açıp güncel belgeyi Dosya sekmesinden yükleyin.', 403, 'SISLI_AUTOMATIC_READ_FORBIDDEN');
  }
  return url.toString();
}

function mapDocumentUrlError(error) {
  const code = String(error?.code || 'DOCUMENT_URL_INVALID');
  const status = code === 'SOURCE_HOST_NOT_ALLOWED' ? 403 : 400;
  const message = code === 'SOURCE_HOST_NOT_ALLOWED'
    ? 'Otomatik belge bağlantısı yalnız resmî .gov.tr/.bel.tr alan adından veya yapılandırılmış izin listesinden alınabilir.'
    : 'Belge bağlantısı kullanıcı bilgisi, özel port veya yerel/özel ağ hedefi içermeyen standart bir HTTPS adresi olmalıdır.';
  return httpError(message, status, code);
}

function mapOfficialDocumentFetchError(error) {
  if (error?.statusCode) return error;
  const code = String(error?.code || 'DOCUMENT_FETCH_FAILED');
  if (error?.name === 'AbortError' || code === 'OFFICIAL_FETCH_TIMEOUT') {
    return httpError('Belge bağlantısı zaman aşımına uğradı.', 504, 'DOCUMENT_FETCH_TIMEOUT');
  }
  if (code === 'SOURCE_RESPONSE_TOO_LARGE') return httpError('Belge 10 MB sınırını aşıyor.', 413, 'DOCUMENT_TOO_LARGE');
  if (['UNSAFE_SOURCE_URL', 'BLOCKED_NETWORK_TARGET', 'SOURCE_HOST_NOT_ALLOWED', 'CROSS_ORIGIN_REDIRECT_BLOCKED', 'REDIRECT_LIMIT_EXCEEDED', 'INVALID_REDIRECT'].includes(code)) {
    return mapDocumentUrlError(error);
  }
  return httpError('Resmî belge sunucusuna güvenli bağlantı kurulamadı.', 502, 'DOCUMENT_FETCH_FAILED');
}

function fileNameFromResponse(response, url) {
  const disposition = response.headers.get('content-disposition') || '';
  const utf8 = disposition.match(/filename\*=UTF-8''([^;]+)/i);
  const plain = disposition.match(/filename="?([^";]+)"?/i);
  const candidate = utf8?.[1] ? decodeURIComponent(utf8[1]) : plain?.[1];
  if (candidate) return clean(candidate, 260);
  try { return clean(decodeURIComponent(new URL(url).pathname.split('/').pop() || ''), 260) || null; } catch { return null; }
}
function looksLikePdf(buffer) { return buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46 && buffer[4] === 0x2d; }
function isTextLike(mime, fileName) { return /^(text\/|application\/(json|xml|xhtml\+xml))/.test(mime) || /\.(txt|html?|json|xml|gml|csv)$/i.test(fileName || ''); }
function inferMime(fileName) { if (/\.pdf$/i.test(fileName || '')) return 'application/pdf'; if (/\.html?$/i.test(fileName || '')) return 'text/html'; if (/\.json$/i.test(fileName || '')) return 'application/json'; if (/\.xml$/i.test(fileName || '')) return 'application/xml'; return 'text/plain'; }
function looksLikeText(buffer) {
  if (!buffer?.byteLength) return false;
  const sample = buffer.subarray(0, Math.min(buffer.byteLength, 8192));
  let controls = 0;
  for (const byte of sample) {
    if (byte === 0) return false;
    if (byte < 0x09 || (byte > 0x0d && byte < 0x20)) controls += 1;
  }
  return controls / sample.byteLength < 0.02;
}
function decodeText(buffer) { return new TextDecoder('utf-8', { fatal: false }).decode(buffer); }
function htmlToText(html) {
  return decodeEntities(String(html)
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<\/(?:p|div|li|tr|h[1-6]|section|article)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n'));
}
function decodeEntities(value) {
  const entities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (_, token) => {
    if (token[0] === '#') {
      const hex = token[1]?.toLowerCase() === 'x';
      const code = Number.parseInt(token.slice(hex ? 2 : 1), hex ? 16 : 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : ' ';
    }
    return entities[token.toLowerCase()] ?? ' ';
  });
}
function sanitizeParcel(parcel) { if (!parcel || parcel.type !== 'Feature') return null; const json = JSON.stringify(parcel); return json.length <= 1_000_000 ? JSON.parse(json) : null; }
function sanitizeObject(input, maxItems, maxLength) { const out = {}; for (const [key, value] of Object.entries(input || {}).slice(0, maxItems)) { const k = clean(key, 60); const v = clean(value, maxLength); if (k && v != null) out[k] = v; } return out; }
function sanitizeDeclaredMimeType(value) {
  const mime = clean(value, 120)?.toLowerCase().split(';')[0].trim() || null;
  if (!mime) return null;
  if (!ALLOWED_TEXT_MIME_TYPES.has(mime)) throw httpError('Bu belge türü desteklenmiyor. PDF, PNG, JPG, HTML, JSON, XML veya metin kullanın.', 415, 'DOCUMENT_TYPE_UNSUPPORTED');
  return mime;
}
function sanitizeEvidenceOrigin(value) {
  const origin = String(value || '').toLowerCase().trim();
  return ['user-upload', 'user-paste', 'automatic-url'].includes(origin) ? origin : 'unspecified-user-input';
}
function isSensitiveQueryKey(value) {
  const key = String(value || '').trim().toLowerCase();
  return SENSITIVE_QUERY_KEY.test(key) || key.startsWith('x-amz-') || key.startsWith('x-goog-');
}
function documentFieldUnit(key) {
  if (['netParcelArea', 'frontGardenArea', 'sideGardenArea', 'rearGardenArea'].includes(key)) return 'm2';
  if (['frontSetback', 'sideSetback', 'rearSetback', 'hmax'].includes(key)) return 'm';
  if (['taks', 'emsal'].includes(key)) return 'ratio';
  if (key === 'floors') return 'kat';
  return null;
}
function normalizeHttpTimestamp(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
function clean(value, max = 500) { if (value == null) return null; const text = String(value).replace(/[\u0000-\u001f<>]/g, ' ').replace(/\s+/g, ' ').trim(); return text ? text.slice(0, max) : null; }
