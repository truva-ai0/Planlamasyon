import { normalizeZoningFields } from './analysis-core.mjs';

export const BESIKTAS_KEOS_IMAR_PARSER_VERSION = '3.5.0';

const MAX_HTML_LENGTH = 2_500_000;
const OFFICIAL_HOST = 'keos.besiktas.bel.tr';
const OFFICIAL_PATH = '/imardurumu/imar.aspx';

const FIELD_DEFINITIONS = Object.freeze({
  planName: { labels: ["mer'i imar plani", 'meri imar plani', 'plan adi'], parse: parseText },
  landUse: { labels: ['fonksiyon', 'plan fonksiyonu'], parse: parseText },
  planScale: { labels: ['olcek', 'plan olcegi'], parse: parseScale },
  planDate: { labels: ['tasdik tarihi', 'plan tasdik tarihi', 'onay tarihi'], parse: parseTurkishDate },
  hmax: { labels: ['bina yuksekligi', 'yencok', 'hmax'], parse: parsePositiveNumber },
  taks: { labels: ['taks', 'taban alani katsayisi'], parse: (value) => parseRatio(value, 1) },
  emsal: { labels: ['kaks emsal', 'kaks', 'emsal', 'katlar alani katsayisi'], parse: (value) => parseRatio(value, 15) },
  floors: { labels: ['kat adedi', 'kat sayisi'], parse: parseFloorCount },
  buildingOrder: { labels: ['insaat nizami', 'yapi nizami', 'nizam'], parse: parseBuildingOrder },
  frontSetback: { labels: ['on bahce', 'on bahce mesafesi'], parse: parseNonNegativeNumber },
  sideSetback: { labels: ['yan bahce', 'yan bahce mesafesi'], parse: parseNonNegativeNumber },
  rearSetback: { labels: ['arka bahce', 'arka bahce mesafesi'], parse: parseNonNegativeNumber }
});

/**
 * Kullanıcının yüklediği/yapıştırdığı Beşiktaş Belediyesi Netcad/KEOS imar sonuç
 * HTML'ini ağ çağrısı yapmadan ayrıştırır.
 *
 * Güvenlik kuralı: Yapılaşma alanları yalnız sonuç tablosundaki Ada/Parsel değeri
 * sorgudaki ada ve parselle birebir eşleştiğinde döndürülür. Script içeriği, sayfa
 * dışındaki serbest metin ve yalnız URL'deki `parselid` eşleşme kanıtı sayılmaz.
 */
export function parseBesiktasKeosImarHtml({
  html,
  expected,
  query,
  parcel,
  sourceUrl,
  evidence
} = {}) {
  const wanted = resolveExpectedParcel(expected, query, parcel);
  if (!wanted.block || !wanted.parcel) {
    return failure('invalid-query', 'Sorgulanan ada ve parsel numarası birlikte verilmelidir.', wanted);
  }

  const evidencePermission = resolveEvidencePermission(evidence);
  if (!evidencePermission.allowed) {
    return failure(
      'permission-required',
      'Beşiktaş imar HTML ayrıştırıcısı yalnız kullanıcının yüklediği veya yapıştırdığı resmî içerikte ve açık kullanıcı onayıyla çalışır.',
      wanted
    );
  }

  const rawHtml = typeof html === 'string' ? html : '';
  if (!rawHtml.trim()) return failure('empty-html', 'Belediye imar sonucu HTML içeriği boş.', wanted);
  if (rawHtml.length > MAX_HTML_LENGTH) {
    return failure('html-too-large', 'Belediye imar sonucu güvenli ayrıştırma boyutunu aşıyor.', wanted);
  }

  const prepared = prepareHtml(rawHtml);
  if (!hasBesiktasResultSignature(prepared)) {
    return failure('unexpected-page', 'İçerik Beşiktaş Belediyesi imar sonuç sayfası olarak doğrulanamadı.', wanted);
  }

  const rows = extractLabeledRows(prepared);
  const parcelRow = uniqueRowValue(rows, ['ada parsel']);
  if (!parcelRow.value) {
    return failure(
      parcelRow.conflict ? 'ambiguous-parcel' : 'parcel-not-found',
      parcelRow.conflict
        ? 'Sonuç tablosunda birbiriyle çelişen ada/parsel değerleri bulundu.'
        : 'Sonuç tablosunda Ada/Parsel satırı bulunamadı.',
      wanted
    );
  }

  const detected = parseParcelPair(parcelRow.value);
  if (!detected) return failure('parcel-not-found', 'Sonuç tablosundaki Ada/Parsel değeri okunamadı.', wanted);

  const hidden = detectHiddenParcel(prepared);
  const tableExact = sameParcel(wanted, detected);
  const hiddenConsistent = !hidden || sameParcel(detected, hidden);
  if (!tableExact || !hiddenConsistent) {
    return {
      ...failure(
        hidden && !hiddenConsistent ? 'ambiguous-parcel' : 'parcel-mismatch',
        hidden && !hiddenConsistent
          ? 'Sonuç tablosu ile sayfanın gizli ada/parsel alanları çelişiyor; veri uygulanmadı.'
          : `Belediye sonucu ${detected.block}/${detected.parcel} parseline ait; sorgulanan ${wanted.block}/${wanted.parcel} ile eşleşmiyor.`,
        wanted
      ),
      detectedParcel: detected,
      hiddenParcel: hidden
    };
  }

  const rawFields = {};
  const fieldEvidence = {};
  const conflictingFields = [];
  for (const [field, definition] of Object.entries(FIELD_DEFINITIONS)) {
    const row = uniqueRowValue(rows, definition.labels);
    if (row.conflict) {
      conflictingFields.push(field);
      continue;
    }
    if (!row.value) continue;
    const value = definition.parse(row.value);
    if (value == null) continue;
    rawFields[field] = value;
    fieldEvidence[field] = {
      label: row.label,
      rawValue: row.value,
      value,
      confidence: 'high',
      method: 'besiktas-keos-result-row'
    };
  }

  rawFields.authority = 'Beşiktaş Belediyesi';
  const fields = normalizeZoningFields(rawFields);
  const safeSourceUrl = normalizeOfficialSourceUrl(sourceUrl);
  const populatedFields = Object.keys(fieldEvidence);
  const missingFields = Object.keys(FIELD_DEFINITIONS).filter((field) => fields[field] == null);
  const source = {
    id: 'besiktas-keos-imar-result',
    title: 'Beşiktaş Belediyesi İmar Durumu',
    provider: 'Beşiktaş Belediyesi',
    url: safeSourceUrl,
    kind: 'zoning',
    trust: 'user-evidence',
    note: 'Kullanıcının yüklediği veya yapıştırdığı Beşiktaş Belediyesi bilgi amaçlı imar sonuç HTML’inden ayrıştırılmıştır; içerik orijinalliği bağımsız doğrulanmış sayılmaz ve ruhsat veya kazanılmış hak belgesi değildir.',
    retrievalMode: 'user-provided-html',
    evidenceOrigin: evidencePermission.origin,
    parcelMatchStatus: 'exact',
    parserVersion: BESIKTAS_KEOS_IMAR_PARSER_VERSION
  };

  return {
    status: populatedFields.length ? 'matched' : 'matched-no-fields',
    canApply: populatedFields.length > 0,
    parcelMatch: { status: 'exact', exact: true, expected: wanted, detected },
    expectedParcel: wanted,
    detectedParcel: detected,
    hiddenParcel: hidden,
    fields,
    fieldEvidence,
    populatedFields,
    missingFields,
    conflictingFields,
    record: populatedFields.length ? {
      fields,
      source,
      fieldEvidence,
      parcelMatchStatus: 'exact',
      extractionConfidence: conflictingFields.length ? 'medium' : 'high',
      message: 'Beşiktaş Belediyesi bilgi amaçlı imar sonuç sayfasındaki eşleşen ada/parsel kaydı okundu.'
    } : null,
    source,
    warnings: [
      'Bu kayıt bilgi amaçlıdır; proje, ruhsat veya kesin yapılaşma hakkı için Beşiktaş Belediyesi güncel kaydı esas alınmalıdır.',
      ...(conflictingFields.length ? [`Çelişkili satırlar nedeniyle uygulanmayan alanlar: ${conflictingFields.join(', ')}.`] : [])
    ]
  };
}

function resolveEvidencePermission(evidence) {
  const origin = String(evidence?.origin || '').trim().toLowerCase();
  const allowedOrigin = origin === 'user-upload' || origin === 'user-paste';
  return {
    allowed: allowedOrigin && evidence?.userConfirmedOfficialSource === true,
    origin: allowedOrigin ? origin : null
  };
}

export function isBesiktasKeosOfficialResultUrl(value) {
  return normalizeOfficialSourceUrl(value) != null;
}

function failure(status, message, expectedParcel) {
  return {
    status,
    canApply: false,
    parcelMatch: { status: status === 'parcel-mismatch' ? 'mismatch' : 'unverified', exact: false, expected: expectedParcel },
    expectedParcel,
    detectedParcel: null,
    hiddenParcel: null,
    fields: null,
    fieldEvidence: {},
    populatedFields: [],
    missingFields: Object.keys(FIELD_DEFINITIONS),
    conflictingFields: [],
    record: null,
    source: null,
    warnings: [message],
    message
  };
}

function resolveExpectedParcel(expected = {}, query = {}, parcel = {}) {
  const properties = parcel?.properties || {};
  return {
    block: parcelNumber(expected?.block ?? expected?.ada ?? properties.block ?? properties.ada ?? query?.block ?? query?.ada),
    parcel: parcelNumber(expected?.parcel ?? expected?.parsel ?? properties.parcel ?? properties.parsel ?? query?.parcel ?? query?.parsel)
  };
}

function parcelNumber(value) {
  const text = String(value ?? '').trim();
  if (!/^\d{1,12}$/.test(text)) return null;
  return text.replace(/^0+(?=\d)/, '');
}

function sameParcel(left, right) {
  return Boolean(left?.block && left?.parcel && right?.block && right?.parcel
    && parcelNumber(left.block) === parcelNumber(right.block)
    && parcelNumber(left.parcel) === parcelNumber(right.parcel));
}

function parseParcelPair(value) {
  const match = String(value || '').match(/^\s*(\d{1,12})\s*[/\-]\s*(\d{1,12})(?:\s|$)/u);
  if (!match) return null;
  return { block: parcelNumber(match[1]), parcel: parcelNumber(match[2]) };
}

function prepareHtml(html) {
  return String(html)
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ');
}

function hasBesiktasResultSignature(html) {
  const title = extractTagText(html, 'title');
  const normalized = normalizeKey(title);
  return normalized.includes('besiktas belediyesi') && normalized.includes('imar durumu');
}

function extractLabeledRows(html) {
  const output = new Map();
  const searchRoot = extractElementById(html, 'htmlOutput')?.inner || html;
  const rowOpen = /<div\b[^>]*>/gi;
  let match;
  while ((match = rowOpen.exec(searchRoot))) {
    const attrs = parseHtmlAttributes(match[0]);
    if (!classTokens(attrs.class).includes('divTableRow')) continue;
    const row = extractBalancedElement(searchRoot, match.index, 'div');
    if (!row) continue;
    rowOpen.lastIndex = row.end;
    const cells = extractRowCells(row.inner);
    const labelCell = cells.find((cell) => cell.classes.includes('divTableCellLabel'));
    const valueCell = cells.find((cell) => cell.classes.includes('divTableContent'));
    const label = cleanText(labelCell?.text, 160);
    const value = cleanText(valueCell?.text, 600);
    if (!label) continue;
    const key = normalizeKey(label);
    if (!key) continue;
    if (!output.has(key)) output.set(key, []);
    output.get(key).push({ label, value });
    if (output.size >= 120) break;
  }
  return output;
}

function extractRowCells(rowHtml) {
  const cells = [];
  const open = /<div\b[^>]*>/gi;
  let match;
  while ((match = open.exec(rowHtml))) {
    const attrs = parseHtmlAttributes(match[0]);
    const classes = classTokens(attrs.class);
    if (!classes.includes('divTableCell')) continue;
    const element = extractBalancedElement(rowHtml, match.index, 'div');
    if (!element) continue;
    open.lastIndex = element.end;
    cells.push({ classes, text: htmlToText(element.inner) });
    if (cells.length >= 12) break;
  }
  return cells;
}

function uniqueRowValue(rows, aliases) {
  const wanted = new Set(aliases.map(normalizeKey));
  const entries = [];
  for (const [key, values] of rows.entries()) if (wanted.has(key)) entries.push(...values);
  const nonBlank = entries.filter((entry) => entry.value && !isBlank(entry.value));
  const unique = [...new Set(nonBlank.map((entry) => normalizeComparable(entry.value)))];
  return {
    value: unique.length === 1 ? nonBlank[0].value : null,
    label: unique.length === 1 ? nonBlank[0].label : null,
    conflict: unique.length > 1
  };
}

function detectHiddenParcel(html) {
  const block = parcelNumber(extractElementById(html, 'lblAda')?.text);
  const parcel = parcelNumber(extractElementById(html, 'lblParsel')?.text);
  return block && parcel ? { block, parcel } : null;
}

function extractElementById(html, id) {
  const pattern = /<([a-z][\w:-]*)\b[^>]*>/gi;
  let match;
  while ((match = pattern.exec(html))) {
    const attrs = parseHtmlAttributes(match[0]);
    if (String(attrs.id || '') !== id) continue;
    const element = extractBalancedElement(html, match.index, match[1]);
    if (!element) return null;
    return { ...element, text: htmlToText(element.inner) };
  }
  return null;
}

function extractBalancedElement(source, start, tagName) {
  const tag = escapeRegExp(tagName);
  const tokens = new RegExp(`<${tag}\\b[^>]*>|<\/${tag}\\s*>`, 'gi');
  tokens.lastIndex = start;
  let depth = 0;
  let openingEnd = null;
  let token;
  while ((token = tokens.exec(source))) {
    if (token.index < start) continue;
    if (token[0].startsWith('</')) depth -= 1;
    else {
      depth += 1;
      if (openingEnd == null) openingEnd = tokens.lastIndex;
    }
    if (openingEnd != null && depth === 0) {
      return {
        start,
        end: tokens.lastIndex,
        inner: source.slice(openingEnd, token.index),
        outer: source.slice(start, tokens.lastIndex)
      };
    }
    if (depth < 0 || tokens.lastIndex - start > MAX_HTML_LENGTH) return null;
  }
  return null;
}

function extractTagText(html, tagName) {
  const tag = escapeRegExp(tagName);
  const match = String(html).match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\/${tag}\\s*>`, 'i'));
  return match ? htmlToText(match[1]) : '';
}

function parseHtmlAttributes(openingTag) {
  const attrs = {};
  const pattern = /([:\w-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let match;
  while ((match = pattern.exec(String(openingTag || '')))) {
    attrs[String(match[1]).toLowerCase()] = decodeEntities(match[2] ?? match[3] ?? match[4] ?? '');
  }
  return attrs;
}

function classTokens(value) {
  return String(value || '').split(/\s+/).filter(Boolean);
}

function htmlToText(value) {
  return cleanText(String(value || '')
    .replace(/<br\s*\/?\s*>/gi, ' ')
    .replace(/<[^>]+>/g, ' '), 1200);
}

function decodeEntities(value) {
  return String(value || '')
    .replace(/&#x([0-9a-f]+);?/gi, (_, hex) => safeCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);?/g, (_, number) => safeCodePoint(Number(number)))
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;|&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&sup1;/gi, '¹')
    .replace(/&sup2;/gi, '²')
    .replace(/&sup3;/gi, '³');
}

function safeCodePoint(value) {
  if (!Number.isInteger(value) || value < 0 || value > 0x10ffff || (value >= 0xd800 && value <= 0xdfff)) return '';
  return String.fromCodePoint(value);
}

function cleanText(value, maxLength) {
  const text = decodeEntities(value)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, ' ')
    .replace(/[\u0096\u0097]/g, '–')
    .replace(/\s+/g, ' ')
    .trim();
  return text.slice(0, maxLength);
}

function normalizeKey(value) {
  return cleanText(value, 240)
    .toLocaleLowerCase('tr-TR')
    .replace(/ı/g, 'i')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(?:[a-z]\s+){2,}[a-z]\b/g, (acronym) => acronym.replace(/\s+/g, ''))
    .trim();
}

function normalizeComparable(value) {
  return cleanText(value, 700).toLocaleLowerCase('tr-TR');
}

function parseText(value) {
  return isBlank(value) ? null : cleanText(value, 300);
}

function parseScale(value) {
  if (isBlank(value)) return null;
  const match = cleanText(value, 80).match(/\b1\s*[/\-]\s*(\d{2,8})\b/u);
  return match ? `1/${match[1]}` : null;
}

function parseTurkishDate(value) {
  if (isBlank(value)) return null;
  const match = cleanText(value, 80).match(/\b(\d{1,2})[./-](\d{1,2})[./-](\d{4})\b/u);
  if (!match) return null;
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function parseLocaleNumber(value) {
  if (isBlank(value)) return null;
  const text = cleanText(value, 120);
  const match = text.match(/-?\d+(?:[.,]\d+)?/u);
  if (!match) return null;
  let numeric = match[0].replace(/\s/g, '');
  if (numeric.includes(',') && numeric.includes('.')) numeric = numeric.replace(/\./g, '').replace(',', '.');
  else if (numeric.includes(',')) numeric = numeric.replace(',', '.');
  const number = Number(numeric);
  return Number.isFinite(number) ? number : null;
}

function parsePositiveNumber(value) {
  const number = parseLocaleNumber(value);
  return number != null && number > 0 && number <= 1000 ? number : null;
}

function parseNonNegativeNumber(value) {
  const number = parseLocaleNumber(value);
  return number != null && number >= 0 && number <= 1000 ? number : null;
}

function parseRatio(value, max) {
  if (isBlank(value)) return null;
  let number = parseLocaleNumber(value);
  if (number == null) return null;
  if (/%/.test(String(value))) number /= 100;
  return number >= 0 && number <= max ? number : null;
}

function parseFloorCount(value) {
  if (isBlank(value)) return null;
  const text = cleanText(value, 80);
  const match = text.match(/^\s*(\d{1,3})(?:\s*kat)?\s*$/iu);
  if (!match) return null;
  const floors = Number(match[1]);
  return Number.isInteger(floors) && floors >= 1 && floors <= 150 ? floors : null;
}

function parseBuildingOrder(value) {
  if (isBlank(value)) return null;
  const normalized = normalizeKey(value);
  if (/\bayrik\b/.test(normalized)) return 'Ayrık';
  if (/\bbitisik\b/.test(normalized)) return 'Bitişik';
  if (/\bblok\b/.test(normalized)) return 'Blok';
  return cleanText(value, 120);
}

function isBlank(value) {
  const text = normalizeKey(value);
  return !text || /^(?:yok|belirtilmemis|uygulanmaz|bos)$/.test(text) || /^[-–—()\s.]+$/u.test(String(value || ''));
}

function normalizeOfficialSourceUrl(value) {
  if (!value) return null;
  try {
    const url = new URL(String(value));
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    if (url.hostname.toLowerCase() !== OFFICIAL_HOST || url.pathname.toLowerCase() !== OFFICIAL_PATH.toLowerCase()) return null;
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
