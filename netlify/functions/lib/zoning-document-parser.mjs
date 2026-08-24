import { createHash } from 'node:crypto';

export const ZONING_DOCUMENT_PARSER_VERSION = '3.4.0';

const FIELD_LABELS = {
  planName: 'Plan adı', planNumber: 'Plan işlem / karar no', planScale: 'Plan ölçeği', planDate: 'Plan / belge tarihi',
  authority: 'Yetkili idare', landUse: 'Plan fonksiyonu', taks: 'TAKS', emsal: 'Emsal / KAKS', floors: 'Kat adedi / Yençok (kat)',
  hmax: 'Yençok / Hmax (metre)', buildingOrder: 'Yapı nizamı', frontSetback: 'Ön bahçe', sideSetback: 'Yan bahçe', rearSetback: 'Arka bahçe'
};

const LAND_USE_PATTERNS = [
  ['Ticaret + Konut Alanı', /(?:ticaret\s*\+\s*konut|ticaret\s*[-/]\s*konut|konut\s*\+\s*ticaret|ticaret\s+ve\s+konut)\s*(?:alanı|bölgesi)?/iu],
  ['Konut Alanı', /\bkonut\s*(?:alanı|bölgesi)\b/iu],
  ['Ticaret Alanı', /\bticaret\s*(?:alanı|bölgesi)\b/iu],
  ['Turizm Alanı', /\bturizm\s*(?:alanı|bölgesi|tesisi)\b/iu],
  ['Sanayi Alanı', /\b(?:sanayi|küçük\s+sanayi|organize\s+sanayi)\s*(?:alanı|bölgesi)?\b/iu],
  ['Depolama Alanı', /\bdepolama\s+alanı\b/iu],
  ['Akaryakıt ve Servis İstasyonu Alanı', /\bakaryakıt(?:\s+ve\s+servis)?\s+istasyonu\s+alanı\b/iu],
  ['Eğitim Alanı', /\b(?:eğitim|okul|ilköğretim|ortaöğretim)\s*(?:alanı|tesisi)?\b/iu],
  ['Sağlık Alanı', /\b(?:sağlık|hastane)\s*(?:alanı|tesisi)?\b/iu],
  ['Sosyal ve Kültürel Tesis Alanı', /\b(?:sosyal|kültürel)(?:\s+ve\s+(?:sosyal|kültürel))?\s+tesis\s+alanı\b/iu],
  ['Dini Tesis Alanı', /\b(?:dini\s+tesis|ibadet|cami)\s+alanı\b/iu],
  ['Spor Alanı', /\bspor\s*(?:alanı|tesisi)\b/iu],
  ['Park ve Yeşil Alan', /\b(?:park|yeşil\s+alan|rekreasyon)\b/iu],
  ['Otopark Alanı', /\botopark\s+alanı\b/iu],
  ['Mezarlık Alanı', /\bmezarlık\s*(?:alanı)?\b/iu],
  ['Tarım Alanı', /\b(?:tarım|tarımsal)\s*(?:alanı|nitelikli\s+alan)?\b/iu],
  ['Orman Alanı', /\borman\s*(?:alanı)?\b/iu],
  ['Teknik Altyapı Alanı', /\bteknik\s+altyapı\s+alanı\b/iu],
  ['Belediye Hizmet Alanı', /\bbelediye\s+hizmet\s+alanı\b/iu],
  ['Kamu Hizmet Alanı', /\bkamu\s+hizmet\s+alanı\b/iu]
];

const CONSTRAINT_PATTERNS = [
  ['Yol terki / düzenleme sınırı', /\b(?:yol\s+terki|terk\s+işlemi|düzenleme\s+ortaklık\s+payı|DOP)\b/iu],
  ['Kamulaştırma', /\bkamulaştır(?:ma|ılacak|ılabilir)\b/iu],
  ['Koruma / sit alanı', /\b(?:sit\s+alanı|koruma\s+alanı|koruma\s+kurulu|tescilli)\b/iu],
  ['Taşkın / dere kısıtı', /\b(?:taşkın|dere\s+koruma|dere\s+yaklaşma|su\s+baskını|DSİ)\b/iu],
  ['Orman mevzuatı', /\b(?:orman\s+sınırı|6831\s+sayılı|orman\s+izni)\b/iu],
  ['Tarım mevzuatı', /\b(?:5403\s+sayılı|tarım\s+dışı\s+kullanım|toprak\s+koruma)\b/iu],
  ['Enerji hattı / koridoru', /\b(?:enerji\s+nakil\s+hattı|yüksek\s+gerilim|elektrik\s+hattı)\b/iu],
  ['Jeolojik / zemin önlemi', /\b(?:jeolojik|jeoteknik|zemin\s+etüdü|önlemli\s+alan|yerleşime\s+uygunluk)\b/iu],
  ['Kurum görüşü gerekli', /\b(?:kurum\s+görüşü|ilgili\s+kurumdan\s+görüş|uygun\s+görüş)\b/iu],
  ['Otopark şartı', /\b(?:otopark\s+yönetmeliği|otopark\s+ihtiyacı|otopark\s+zorunluluğu)\b/iu],
  ['Kıyı mevzuatı', /\b(?:kıyı\s+kenar\s+çizgisi|3621\s+sayılı|sahil\s+şeridi)\b/iu],
  ['Afet / riskli alan', /\b(?:riskli\s+alan|rezerv\s+yapı\s+alanı|afet\s+riski|6306\s+sayılı)\b/iu]
];

export function parseZoningDocumentText({ text, query = {}, parcel = null, metadata = {} } = {}) {
  const rawText = cleanDocumentText(text);
  if (rawText.length < 20) throw parserError('Belgeden yeterli metin okunamadı.', 'DOCUMENT_TEXT_EMPTY');
  if (rawText.length > 350_000) throw parserError('Belge metni çok uzun. En fazla 350.000 karakter işlenebilir.', 'DOCUMENT_TEXT_TOO_LONG');

  const lines = buildLines(rawText);
  const normalizedText = normalizeForSearch(rawText);
  const expected = expectedParcel(query, parcel);
  const detectedParcels = detectParcelPairs(rawText);
  const parcelMatch = evaluateParcelMatch(expected, detectedParcels);
  const documentType = detectDocumentType(normalizedText, lines);

  const fieldEvidence = {};
  const fields = {};
  const setField = (key, result) => {
    if (!result || result.value == null || result.value === '') return;
    fields[key] = result.value;
    fieldEvidence[key] = {
      label: FIELD_LABELS[key] || key,
      confidence: result.confidence || 'medium',
      excerpt: trim(result.excerpt || '', 520),
      method: result.method || 'pattern'
    };
  };

  setField('authority', detectAuthority(lines));
  setField('planName', detectPlanName(lines));
  setField('planNumber', detectPlanNumber(lines));
  setField('planScale', detectPlanScale(lines));
  setField('planDate', detectPlanDate(lines));
  setField('landUse', detectLandUse(lines, normalizedText));
  setField('taks', detectRatioField(lines, ['TAKS', 'TABAN ALANI KATSAYISI'], 1));
  setField('emsal', detectRatioField(lines, ['KAKS', 'EMSAL', 'E'], 15));
  setField('floors', detectFloors(lines));
  setField('hmax', detectHmax(lines));
  setField('buildingOrder', detectBuildingOrder(lines, normalizedText));
  setField('frontSetback', detectSetback(lines, 'front'));
  setField('sideSetback', detectSetback(lines, 'side'));
  setField('rearSetback', detectSetback(lines, 'rear'));

  const allowances = detectAllowances(lines, normalizedText);
  const constraints = detectConstraints(lines);
  const planNotes = buildPlanNotes(lines, fieldEvidence, constraints);
  const parkingRequired = /(?:otopark\s+ihtiyac[ıi].{0,90}(?:parsel|kendi).{0,60}(?:karşılan|çözül)|otopark\s+yönetmeliğine\s+uyul)/iu.test(rawText) ? true : null;
  const roadDedicationPossible = /(?:yol\s+terki|terk\s+işlemi|düzenleme\s+ortaklık\s+payı)/iu.test(rawText) ? true : null;
  const floodDataStatus = /(?:taşkın|dere\s+koruma|su\s+baskını)/iu.test(rawText) ? 'risk' : null;

  const documentHash = createHash('sha256').update(rawText, 'utf8').digest('hex');
  const populatedCore = ['landUse', 'taks', 'emsal', 'floors', 'hmax', 'buildingOrder', 'frontSetback', 'sideSetback', 'rearSetback'].filter((key) => fields[key] != null);
  const requiredMissing = ['landUse', 'taks', 'emsal', 'floors', 'frontSetback', 'sideSetback', 'rearSetback'].filter((key) => fields[key] == null);
  const highConfidenceCount = Object.values(fieldEvidence).filter((item) => item.confidence === 'high').length;
  const mediumConfidenceCount = Object.values(fieldEvidence).filter((item) => item.confidence === 'medium').length;
  const historicalOnly = ['public-plan-record', 'plan-announcement'].includes(documentType) && !/(?:imar\s+durum(?:u|\s+belgesi)|çap|aplikasyon|yapılaşma\s+koşulları)/iu.test(rawText);
  const hasCalculationValues = ['taks', 'emsal', 'floors', 'hmax', 'frontSetback', 'sideSetback', 'rearSetback'].some((key) => fields[key] != null);
  const canApply = parcelMatch.status !== 'mismatch' && !historicalOnly && hasCalculationValues;
  const overallConfidence = highConfidenceCount >= 5 ? 'high' : (highConfidenceCount + mediumConfidenceCount >= 4 ? 'medium' : 'low');

  const warnings = [];
  if (parcelMatch.status === 'mismatch') warnings.push(`Belgede tespit edilen ada/parsel (${detectedParcels.map((item) => `${item.block}/${item.parcel}`).join(', ')}) sorgulanan ${expected.block || '—'}/${expected.parcel || '—'} parseliyle eşleşmiyor.`);
  if (parcelMatch.status === 'unverified') warnings.push('Belge metninde ada/parsel eşleşmesi otomatik doğrulanamadı; kullanıcı belge-parsel ilişkisini elle onaylamalıdır.');
  if (historicalOnly) warnings.push('Bu metin tarihsel plan/askı kaydı niteliğinde görünüyor; güncel yapılaşma hakkı olarak uygulanamaz.');
  if (!hasCalculationValues) warnings.push('Belgede TAKS, emsal, kat, Yençok veya çekme mesafesi gibi hesaplanabilir yapılaşma değeri bulunamadı.');
  if (requiredMissing.length) warnings.push(`Tam sonuç için eksik alanlar: ${requiredMissing.map((key) => FIELD_LABELS[key]).join(', ')}.`);
  if (overallConfidence === 'low') warnings.push('Otomatik okuma güveni düşük; alanları resmî belgeyle tek tek karşılaştırın.');

  const evidence = {
    confirmed: false,
    parcelConfirmed: parcelMatch.status === 'exact',
    sourceTitle: cleanValue(metadata.sourceTitle || fields.planName || metadata.fileName || documentTypeLabel(documentType), 280),
    authority: fields.authority || cleanValue(metadata.authority, 240),
    sourceUrl: safeHttps(metadata.sourceUrl),
    planName: fields.planName || null,
    planNumber: fields.planNumber || null,
    planScale: fields.planScale || null,
    planDate: fields.planDate || null,
    landUse: fields.landUse || null,
    taks: numberOrNull(fields.taks),
    emsal: numberOrNull(fields.emsal),
    floors: integerOrNull(fields.floors),
    hmax: numberOrNull(fields.hmax),
    buildingOrder: fields.buildingOrder || null,
    frontSetback: numberOrNull(fields.frontSetback),
    sideSetback: numberOrNull(fields.sideSetback),
    rearSetback: numberOrNull(fields.rearSetback),
    allowances,
    parkingRequired,
    roadDedicationPossible,
    floodDataStatus,
    planNotes,
    constraints,
    documentName: cleanValue(metadata.fileName || metadata.documentName, 260),
    documentMimeType: cleanValue(metadata.mimeType, 120),
    documentHash,
    parserVersion: ZONING_DOCUMENT_PARSER_VERSION,
    documentType,
    extractionConfidence: overallConfidence,
    parcelMatchStatus: parcelMatch.status,
    detectedParcels,
    fieldEvidence,
    extractedAt: new Date().toISOString()
  };

  return {
    version: ZONING_DOCUMENT_PARSER_VERSION,
    status: canApply ? (requiredMissing.length ? 'partial' : 'ready') : 'review-required',
    canApply,
    documentType,
    documentTypeLabel: documentTypeLabel(documentType),
    documentHash,
    parcelMatch,
    detectedParcels,
    expectedParcel: expected,
    fields,
    fieldEvidence,
    evidence,
    completeness: {
      populatedCore: populatedCore.length,
      requiredTotal: 7,
      requiredFound: 7 - requiredMissing.length,
      missing: requiredMissing,
      percentage: Math.round(((7 - requiredMissing.length) / 7) * 100)
    },
    confidence: overallConfidence,
    warnings,
    preview: trim(rawText, 1800)
  };
}

export function cleanDocumentText(value) {
  const text = String(value ?? '')
    .replace(/\u0000/g, ' ')
    .replace(/\r\n?/g, '\n')
    .replace(/[\t\f\v]+/g, ' ')
    .replace(/[ ]{2,}/g, ' ')
    .replace(/\n[ ]+/g, '\n')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim();
  return text;
}

function buildLines(text) {
  return text.split(/\n+/).map((line) => line.replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 9000);
}

function detectParcelPairs(text) {
  const pairs = [];
  const patterns = [
    /\b(?:ada|ada\s*no|adası)\s*[:#-]?\s*(\d{1,12})\s*[,;/\-]?\s*(?:parsel|parsel\s*no|parseli|parsele|parseline)\s*[:#-]?\s*(\d{1,12})\b/giu,
    /\b(\d{1,12})\s*(?:ada|adası)\s*[,;/\-]?\s*(\d{1,12})\s*(?:parsel|parseli|parsele|parseline)\b/giu,
    /\b(?:ada\s*\/\s*parsel|ada-parsel)\s*[:#-]?\s*(\d{1,12})\s*[\/-]\s*(\d{1,12})\b/giu
  ];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(text)) && pairs.length < 30) {
      const block = String(match[1]).replace(/^0+/, '') || '0';
      const parcel = String(match[2]).replace(/^0+/, '') || '0';
      if (!pairs.some((item) => item.block === block && item.parcel === parcel)) pairs.push({ block, parcel, excerpt: trim(context(text, match.index, match[0].length), 360) });
    }
  }
  return pairs;
}

function expectedParcel(query, parcel) {
  const p = parcel?.properties || {};
  return {
    province: cleanValue(p.province || query.province, 120), district: cleanValue(p.district || query.district, 120), neighbourhood: cleanValue(p.neighbourhood || query.neighbourhood, 160),
    block: numericText(p.block || query.block), parcel: numericText(p.parcel || query.parcel)
  };
}

function evaluateParcelMatch(expected, detected) {
  if (!expected.block || !expected.parcel) return { status: detected.length ? 'unverified' : 'unverified', exact: false, message: 'Sorgulanan ada/parsel bilgisi bulunamadı.' };
  if (!detected.length) return { status: 'unverified', exact: false, message: 'Belgede ada/parsel numarası otomatik okunamadı.' };
  const exact = detected.find((item) => numericText(item.block) === expected.block && numericText(item.parcel) === expected.parcel);
  if (exact) return { status: 'exact', exact: true, message: `Belge ${expected.block}/${expected.parcel} parseliyle eşleşiyor.`, excerpt: exact.excerpt };
  return { status: 'mismatch', exact: false, message: `Belgede tespit edilen ada/parsel sorgulanan ${expected.block}/${expected.parcel} ile eşleşmiyor.` };
}

function detectDocumentType(normalizedText) {
  // normalizedText Türkçe karakterleri ASCII karşılıklarına dönüştürür.
  if (/imar durum(?:u| belgesi)|imar capi|yapilasma kosullari/.test(normalizedText)) return 'zoning-status-document';
  if (/plan not(?:u|lari)|uygulama hukumleri/.test(normalizedText)) return 'plan-notes';
  if (/\baski\b|ilan suresi|(?:plan|nip|uip|nazim|uygulama|revizyon)[^\n]{0,80}degisikligi/.test(normalizedText)) return 'plan-announcement';
  if (/uygulama imar plani|nazim imar plani|revizyon imar plani|koruma amacli imar plani/.test(normalizedText)) return 'planning-document';
  return 'official-document';
}

function detectAuthority(lines) {
  const candidates = lines.filter((line) => /(?:BELEDİYESİ|BÜYÜKŞEHİR BELEDİYESİ|İMAR VE ŞEHİRCİLİK MÜDÜRLÜĞÜ|ÇEVRE, ŞEHİRCİLİK|BAKANLIĞI|VALİLİĞİ)/iu.test(line)).slice(0, 15);
  if (!candidates.length) return null;
  const line = candidates.sort((a, b) => scoreAuthorityLine(b) - scoreAuthorityLine(a))[0];
  const match = line.match(/([A-ZÇĞİÖŞÜa-zçğıöşü .'-]{2,100}(?:BÜYÜKŞEHİR\s+)?BELEDİYESİ|[A-ZÇĞİÖŞÜa-zçğıöşü .'-]{2,100}(?:İMAR VE ŞEHİRCİLİK|PLAN VE PROJE)\s+MÜDÜRLÜĞÜ|ÇEVRE,?\s+ŞEHİRCİLİK[^\n]{0,80}BAKANLIĞI)/iu);
  return result(match ? titleCaseTurkish(match[1]) : trim(line, 180), 'high', line, 'authority-label');
}
function scoreAuthorityLine(line) { return (/BELEDİYESİ/iu.test(line) ? 5 : 0) + (/MÜDÜRLÜĞÜ/iu.test(line) ? 4 : 0) + (line.length < 140 ? 2 : 0); }

function detectPlanName(lines) {
  const label = findLabeled(lines, [/(?:plan\s+adı|planın\s+adı)\s*[:=-]\s*(.{4,260})/iu], (value) => cleanValue(value, 300));
  if (label) return { ...label, confidence: 'high', method: 'plan-name-label' };
  const candidates = lines.filter((line) => /(?:UYGULAMA|NAZIM|REVİZYON|İLAVE|KORUMA AMAÇLI|MEVZİİ|ÇEVRE DÜZENİ)\s+İMAR\s+PLANI|PLAN DEĞİŞİKLİĞİ/iu.test(line) && line.length <= 360);
  if (!candidates.length) return null;
  const line = candidates.sort((a, b) => planNameScore(b) - planNameScore(a))[0];
  return result(trim(line, 300), 'medium', line, 'plan-title-line');
}
function planNameScore(line) { return (/1\s*\/\s*\d+/.test(line) ? 2 : 0) + (/UYGULAMA/iu.test(line) ? 3 : 0) + (/REVİZYON/iu.test(line) ? 2 : 0) + Math.min(3, line.length / 100); }

function detectPlanNumber(lines) {
  return findLabeled(lines, [
    /(?:plan\s+işlem\s+(?:numarası|no)|plan\s+işlem\s+no|pin)\s*[:#=-]\s*([A-Z0-9./_-]{2,80})/iu,
    /(?:meclis\s+karar(?:ı)?\s+(?:numarası|no)|karar\s+(?:numarası|no))\s*[:#=-]\s*([A-Z0-9./_-]{1,80})/iu
  ], (value) => cleanValue(value, 120), 'high');
}

function detectPlanScale(lines) {
  for (const line of lines) {
    const label = line.match(/(?:plan\s+ölçeği|ölçek)\s*[:=-]?\s*(1\s*[/:]\s*(?:500|1000|2000|5000|10000|25000|50000|100000))\b/iu);
    if (label) return result(normalizeScale(label[1]), 'high', line, 'scale-label');
  }
  for (const line of lines) {
    const match = line.match(/\b(1\s*[/:]\s*(?:500|1000|2000|5000|10000|25000|50000|100000))\b/iu);
    if (match && /plan|ölçek|pafta/iu.test(line)) return result(normalizeScale(match[1]), 'medium', line, 'scale-context');
  }
  return null;
}

function detectPlanDate(lines) {
  for (const line of lines) {
    const match = line.match(/(?:plan\s+(?:onay|tasdik|belge)\s+tarihi|onay\s+tarihi|belge\s+tarihi|tarih)\s*[:=-]?\s*(\d{1,2}[./-]\d{1,2}[./-]\d{4})/iu);
    if (match) return result(toIsoDate(match[1]), 'high', line, 'date-label');
  }
  return null;
}

function detectLandUse(lines, normalizedText) {
  const labeled = findLabeled(lines, [/(?:plan\s+fonksiyon(?:u)?|kullanım\s+kararı|arazi\s+kullanımı|imar\s+fonksiyonu)\s*[:=-]?\s*(.{3,160}?)(?=\s+(?:TAKS|KAKS|EMSAL|YENÇOK|YENCOK|HMAX|KAT\s+(?:ADEDİ|SAYISI)|YAPI\s*NİZAMI|YAPI\s*NIZAMI|İNŞAAT\s*NİZAMI|INSAAT\s*NIZAMI)\b|[|;,]|$)/iu], (value) => normalizeLandUseValue(value), 'high');
  if (labeled) return labeled;
  for (const [label, pattern] of LAND_USE_PATTERNS) {
    const line = lines.find((item) => pattern.test(item));
    if (line) return result(label, /fonksiyon|kullanım|alanı/iu.test(line) ? 'medium' : 'low', line, 'land-use-pattern');
  }
  if (/konut/.test(normalizedText) && /ticaret/.test(normalizedText)) return result('Ticaret + Konut Alanı', 'low', context(normalizedText, normalizedText.indexOf('konut'), 180), 'land-use-cooccurrence');
  return null;
}

function detectRatioField(lines, labels, max) {
  const escaped = labels.map((item) => item === 'E' ? '(?:E(?:MSAL)?)' : escapeRegex(item)).join('|');
  const pattern = new RegExp(`(?:${escaped})\\s*(?:\\([^)]{0,20}\\))?\\s*[:=xX-]?\\s*(0?[,.]\\d{1,3}|[1-9]\\d?(?:[,.]\\d{1,3})?)`, 'iu');
  for (const line of lines) {
    if (!labels.some((label) => label === 'E' ? /\bE\s*[:=]/iu.test(line) : new RegExp(escapeRegex(label), 'iu').test(line))) continue;
    const match = line.match(pattern);
    if (!match) continue;
    const value = parseLocaleNumber(match[1]);
    if (value != null && value >= 0 && value <= max) return result(value, 'high', line, `${labels[0].toLowerCase()}-label`);
  }
  return null;
}

function detectFloors(lines) {
  const patterns = [
    /(?:kat\s+adedi|kat\s+sayısı|azami\s+kat)\s*[:=-]?\s*(\d{1,3})\b/iu,
    /\b(\d{1,3})\s*kat(?:lı|tır|dır)?\b/iu,
    /\b(?:zemin\s*\+\s*)?(\d{1,2})\s*kat\b/iu
  ];
  for (const line of lines) {
    for (const pattern of patterns) {
      const match = line.match(pattern);
      if (!match) continue;
      const value = Number(match[1]);
      if (Number.isInteger(value) && value >= 1 && value <= 150) return result(value, /kat\s+(?:adedi|sayısı)/iu.test(line) ? 'high' : 'medium', line, 'floor-pattern');
    }
  }
  return null;
}

function detectHmax(lines) {
  for (const line of lines) {
    const match = line.match(/(?:YENÇOK|YENCOK|H\s*MAX|HMAX|MAKSİMUM\s+YÜKSEKLİK|MAKSIMUM\s+YUKSEKLIK)\s*[:=.-]?\s*(\d{1,3}(?:[,.]\d{1,2})?)\s*(?:m|metre)\b/iu);
    if (match) {
      const value = parseLocaleNumber(match[1]);
      if (value != null && value > 0 && value <= 1000) return result(value, 'high', line, 'hmax-label');
    }
  }
  return null;
}

function detectBuildingOrder(lines, normalizedText) {
  const labelPattern = /(?:yapi\s*nizami|yapinizami|yapilasma\s*nizami|insaat\s*nizami|yapi\s*duzeni|nizam)\s*[:=-]?\s*(ayrik|bitisik|blok|serbest)(?:\s+nizam)?\b(?=\s*(?:[|;,.]|$))/i;
  for (const line of lines) {
    const match = normalizeForSearch(line).match(labelPattern);
    if (match) return result(normalizeBuildingOrderValue(match[1]), 'high', line, 'building-order-label');
  }
  const match = normalizedText.match(/\b(ayrik|bitisik|blok|serbest)\s+nizam\b/iu);
  return match ? result(normalizeBuildingOrderValue(match[1]), 'medium', context(normalizedText, match.index, match[0].length), 'order-pattern') : null;
}

function detectSetback(lines, side) {
  const labels = side === 'front' ? ['ön bahçe', 'ön çekme', 'yol cephesi çekme'] : side === 'side' ? ['yan bahçe', 'yan çekme'] : ['arka bahçe', 'arka çekme'];
  const pattern = new RegExp(`(?:${labels.map(escapeRegex).join('|')})(?:\\s+mesafesi)?\\s*[:=.-]?\\s*(\\d{1,3}(?:[,.]\\d{1,2})?)\\s*(?:m|metre)?`, 'iu');
  for (const line of lines) {
    const match = line.match(pattern);
    if (match) {
      const value = parseLocaleNumber(match[1]);
      if (value != null && value >= 0 && value <= 500) return result(value, 'high', line, `${side}-setback-label`);
    }
  }
  return null;
}

function detectAllowances(lines, text) {
  const definitions = {
    housing: ['konut'], villa: ['villa'], pool: ['havuz'], landscaping: ['peyzaj', 'bahçe düzenlemesi'], roof: ['çatı'], terraceRoof: ['teras çatı'],
    balcony: ['balkon'], basement: ['bodrum'], parking: ['otopark'], solar: ['güneş paneli', 'güneş enerjisi']
  };
  const output = {};
  for (const [key, terms] of Object.entries(definitions)) {
    let status = 'unknown';
    for (const term of terms) {
      const escaped = escapeRegex(term);
      if (new RegExp(`${escaped}.{0,70}(?:yasaktır|yapılamaz|izin verilmez|uygun değildir)`, 'iu').test(text)) { status = 'prohibited'; break; }
      if (new RegExp(`${escaped}.{0,70}(?:zorunludur|yapılması gerekir|gerekli)`, 'iu').test(text)) { status = 'required'; break; }
      if (new RegExp(`${escaped}.{0,90}(?:şartıyla|koşuluyla|belirli şartlarla|izin alınarak)`, 'iu').test(text)) { status = 'conditional'; break; }
      if (new RegExp(`${escaped}.{0,70}(?:yapılabilir|izin verilir|mümkündür)`, 'iu').test(text)) { status = 'allowed'; break; }
    }
    output[key] = status;
  }
  return output;
}

function detectConstraints(lines) {
  const output = [];
  for (const [label, pattern] of CONSTRAINT_PATTERNS) {
    const line = lines.find((item) => pattern.test(item));
    if (line) output.push(`${label}: ${trim(line, 420)}`);
  }
  return output.slice(0, 24);
}

function buildPlanNotes(lines, fieldEvidence, constraints) {
  const evidenceExcerpts = new Set(Object.values(fieldEvidence).map((item) => item.excerpt).filter(Boolean));
  const relevant = lines.filter((line) => /(?:plan\s+not|hüküm|yapılaşma|çekme|bahçe|emsal|TAKS|KAKS|YENÇOK|HMAX|kat|otopark|terk|kurum\s+görüşü)/iu.test(line));
  const selected = [];
  for (const line of [...relevant, ...evidenceExcerpts, ...constraints]) {
    const cleanLine = trim(line, 650);
    if (cleanLine && !selected.includes(cleanLine)) selected.push(cleanLine);
    if (selected.join('\n').length > 3800) break;
  }
  return selected.join('\n').slice(0, 4000) || null;
}

function findLabeled(lines, patterns, transform = (value) => value, confidence = 'high') {
  for (const line of lines) {
    for (const pattern of patterns) {
      const match = line.match(pattern);
      if (!match) continue;
      const value = transform(match[1]);
      if (value != null && value !== '') return result(value, confidence, line, 'labeled-field');
    }
  }
  return null;
}

function result(value, confidence, excerpt, method) { return { value, confidence, excerpt: trim(excerpt, 520), method }; }
function normalizeLandUseValue(value) { const text = cleanValue(value, 180); if (!text) return null; for (const [label, pattern] of LAND_USE_PATTERNS) if (pattern.test(text)) return label; return titleCaseTurkish(text.replace(/[;,.].*$/, '')); }
function normalizeBuildingOrderValue(value) { const normalized = normalizeForSearch(value); if (/ayrik/.test(normalized)) return 'Ayrık'; if (/bitisik/.test(normalized)) return 'Bitişik'; if (/blok/.test(normalized)) return 'Blok'; if (/serbest/.test(normalized)) return 'Serbest'; return cleanValue(value, 120); }
function normalizeScale(value) { return String(value).replace(/\s+/g, '').replace(':', '/'); }
function parseLocaleNumber(value) { const text = String(value ?? '').trim().replace(/\s/g, '').replace(',', '.'); const number = Number(text); return Number.isFinite(number) ? number : null; }
function numericText(value) { const text = String(value ?? '').replace(/[^0-9]/g, '').replace(/^0+/, ''); return text || null; }
function numberOrNull(value) { const number = Number(value); return Number.isFinite(number) ? number : null; }
function integerOrNull(value) { const number = Number(value); return Number.isInteger(number) ? number : null; }
function cleanValue(value, max = 500) { if (value == null) return null; const text = String(value).replace(/[\u0000-\u001f<>]/g, ' ').replace(/\s+/g, ' ').trim(); return text ? text.slice(0, max) : null; }
function safeHttps(value) { if (!value) return null; try { const url = new URL(String(value)); return url.protocol === 'https:' ? url.toString() : null; } catch { return null; } }
function escapeRegex(value) { return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function normalizeForSearch(value) { return String(value || '').toLocaleLowerCase('tr-TR').replace(/ç/g, 'c').replace(/ğ/g, 'g').replace(/ı/g, 'i').replace(/ö/g, 'o').replace(/ş/g, 's').replace(/ü/g, 'u').normalize('NFKD').replace(/[\u0300-\u036f]/g, ''); }
function context(text, index, length) { const start = Math.max(0, index - 150); const end = Math.min(text.length, index + length + 210); return text.slice(start, end).replace(/\s+/g, ' ').trim(); }
function trim(value, max) { const text = String(value || '').replace(/\s+/g, ' ').trim(); return text.length > max ? `${text.slice(0, max - 1)}…` : text; }
function titleCaseTurkish(value) { return String(value || '').toLocaleLowerCase('tr-TR').replace(/(^|[\s/()-])([a-zçğıöşü])/gu, (_, prefix, char) => prefix + char.toLocaleUpperCase('tr-TR')).trim(); }
function toIsoDate(value) { const match = String(value).match(/(\d{1,2})[./-](\d{1,2})[./-](\d{4})/); if (!match) return null; const day = Number(match[1]); const month = Number(match[2]); const year = Number(match[3]); if (year < 1900 || year > 2200 || month < 1 || month > 12 || day < 1 || day > 31) return null; return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`; }
function documentTypeLabel(type) { return ({ 'zoning-status-document': 'İmar Durumu Belgesi', 'plan-notes': 'Plan Notları', 'plan-announcement': 'Plan / Askı Kaydı', 'planning-document': 'İmar Planı Belgesi', 'official-document': 'Resmî İmar Belgesi' })[type] || 'Resmî İmar Belgesi'; }
function parserError(message, code) { const error = new Error(message); error.code = code; error.statusCode = 400; return error; }
