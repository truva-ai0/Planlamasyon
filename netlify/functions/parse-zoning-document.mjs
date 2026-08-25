import { extractText, getDocumentProxy } from 'unpdf';
import { parseZoningDocumentText, ZONING_DOCUMENT_PARSER_VERSION } from './lib/zoning-document-parser.mjs';
import { parseBesiktasKeosImarHtml, BESIKTAS_KEOS_IMAR_PARSER_VERSION } from './lib/besiktas-keos-imar-parser.mjs';
import { enforceSimpleRateLimit, jsonResponse, parseJsonBody, requestIp, safeErrorResponse, httpError } from './lib/http.mjs';

const LIMITS = globalThis.__PLANLAMASYON_DOCUMENT_PARSE_LIMITS__ || new Map();
globalThis.__PLANLAMASYON_DOCUMENT_PARSE_LIMITS__ = LIMITS;

const MAX_REMOTE_BYTES = 10 * 1024 * 1024;
const MAX_PDF_PAGES = 80;

export async function handler(event) {
  if ((event.httpMethod || 'GET') !== 'POST') return jsonResponse(405, { ok: false, code: 'METHOD_NOT_ALLOWED', message: 'Yalnızca POST destekleniyor.' }, { Allow: 'POST' });
  try {
    enforceSimpleRateLimit(LIMITS, requestIp(event), 12, 60_000);
    const body = parseJsonBody(event, 600_000);
    const mode = String(body.mode || (body.sourceUrl ? 'url' : 'text')).toLowerCase();
    const query = sanitizeObject(body.query, 20, 220);
    const parcel = sanitizeParcel(body.parcel);
    let text = '';
    let metadata = {
      sourceTitle: clean(body.sourceTitle, 280),
      authority: clean(body.authority, 240),
      sourceUrl: safeHttps(body.sourceUrl),
      fileName: clean(body.fileName, 260),
      mimeType: clean(body.mimeType, 120)
    };

    if (mode === 'url') {
      if (!metadata.sourceUrl) throw httpError('Geçerli bir HTTPS resmî belge bağlantısı gerekli.', 400, 'DOCUMENT_URL_REQUIRED');
      const remote = await fetchOfficialDocument(metadata.sourceUrl);
      text = remote.text;
      metadata = { ...metadata, ...remote.metadata, sourceUrl: remote.metadata.finalUrl || metadata.sourceUrl };
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
          characterCount: text.length
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
        parcelMatchStatus: parsed.parcelMatch?.status || 'unverified',
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
    confidence: item.confidence || 'high',
    excerpt: `${item.label || key}: ${item.rawValue ?? item.value ?? ''}`,
    method: item.method || 'besiktas-keos-result-row'
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
      extractionConfidence: parsed.record.extractionConfidence || 'high',
      parcelMatchStatus: 'exact',
      detectedParcels: [parsed.detectedParcel],
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

async function fetchOfficialDocument(inputUrl) {
  const initialUrl = allowedPublicUrl(inputUrl);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(initialUrl, {
      redirect: 'follow',
      headers: {
        Accept: 'application/pdf,text/html,application/xhtml+xml,text/plain,application/json,application/xml,text/xml;q=0.9,*/*;q=0.3',
        'User-Agent': 'Planlamasyon/3.5.0 (+https://planlamasyon.truva-ai.com; public-document-reader)'
      },
      signal: controller.signal
    });
    const finalUrl = allowedPublicUrl(response.url || initialUrl);
    if (!response.ok) throw httpError(`Resmî belge sunucusu ${response.status} yanıtı verdi.`, response.status === 404 ? 404 : 502, 'DOCUMENT_FETCH_FAILED');
    const declaredLength = Number(response.headers.get('content-length'));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_REMOTE_BYTES) throw httpError('Belge 10 MB sınırını aşıyor.', 413, 'DOCUMENT_TOO_LARGE');
    const buffer = new Uint8Array(await response.arrayBuffer());
    if (buffer.byteLength > MAX_REMOTE_BYTES) throw httpError('Belge 10 MB sınırını aşıyor.', 413, 'DOCUMENT_TOO_LARGE');
    const mimeType = String(response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    const fileName = fileNameFromResponse(response, finalUrl);
    let text;
    let pageCount = null;
    if (mimeType === 'application/pdf' || looksLikePdf(buffer, fileName)) {
      const result = await extractPdfText(buffer);
      text = result.text;
      pageCount = result.pageCount;
    } else if (isTextLike(mimeType, fileName)) {
      text = decodeText(buffer);
      if (/html|xhtml/i.test(mimeType) || /\.html?$/i.test(fileName || '')) text = htmlToText(text);
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
        sourceTitle: fileName ? fileName.replace(/\.[^.]+$/, '') : null
      }
    };
  } catch (error) {
    if (error?.name === 'AbortError') throw httpError('Belge bağlantısı zaman aşımına uğradı.', 504, 'DOCUMENT_FETCH_TIMEOUT');
    throw error;
  } finally {
    clearTimeout(timer);
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

function allowedPublicUrl(value) {
  let url;
  try { url = new URL(String(value)); } catch { throw httpError('Belge bağlantısı geçersiz.', 400, 'DOCUMENT_URL_INVALID'); }
  if (url.protocol !== 'https:') throw httpError('Belge bağlantısı HTTPS olmalıdır.', 400, 'DOCUMENT_URL_HTTPS_REQUIRED');
  if (url.hostname.toLowerCase() === 'keos.besiktas.bel.tr' && url.pathname.toLowerCase().startsWith('/imardurumu')) {
    throw httpError('Beşiktaş Belediyesi kullanım koşulları otomatik üçüncü taraf işlemini yasaklıyor. Sonucu belediye sitesinden açıp güncel belgeyi Dosya sekmesinden yükleyin.', 403, 'BESIKTAS_AUTOMATIC_READ_FORBIDDEN');
  }
  if (isPrivateHost(url.hostname)) throw httpError('Özel ağ adresinden belge alınamaz.', 400, 'DOCUMENT_URL_PRIVATE_HOST');
  if (url.username || url.password) throw httpError('Kullanıcı bilgisi içeren URL kabul edilmez.', 400, 'DOCUMENT_URL_CREDENTIALS');
  return url.toString();
}

function isPrivateHost(hostname) {
  const host = String(hostname).toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) return true;
  if (/^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(host)) return true;
  const match = host.match(/^172\.(\d+)\./);
  if (match && Number(match[1]) >= 16 && Number(match[1]) <= 31) return true;
  if (host === '::1' || host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80:')) return true;
  return false;
}

function fileNameFromResponse(response, url) {
  const disposition = response.headers.get('content-disposition') || '';
  const utf8 = disposition.match(/filename\*=UTF-8''([^;]+)/i);
  const plain = disposition.match(/filename="?([^";]+)"?/i);
  const candidate = utf8?.[1] ? decodeURIComponent(utf8[1]) : plain?.[1];
  if (candidate) return clean(candidate, 260);
  try { return clean(decodeURIComponent(new URL(url).pathname.split('/').pop() || ''), 260) || null; } catch { return null; }
}
function looksLikePdf(buffer, fileName) { return (buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46) || /\.pdf$/i.test(fileName || ''); }
function isTextLike(mime, fileName) { return /^(text\/|application\/(json|xml|xhtml\+xml))/.test(mime) || /\.(txt|html?|json|xml|gml|csv)$/i.test(fileName || ''); }
function inferMime(fileName) { if (/\.pdf$/i.test(fileName || '')) return 'application/pdf'; if (/\.html?$/i.test(fileName || '')) return 'text/html'; if (/\.json$/i.test(fileName || '')) return 'application/json'; if (/\.xml$/i.test(fileName || '')) return 'application/xml'; return 'text/plain'; }
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
function safeHttps(value) { if (!value) return null; try { const url = new URL(String(value)); return url.protocol === 'https:' ? url.toString() : null; } catch { return null; } }
function clean(value, max = 500) { if (value == null) return null; const text = String(value).replace(/[\u0000-\u001f<>]/g, ' ').replace(/\s+/g, ' ').trim(); return text ? text.slice(0, max) : null; }
