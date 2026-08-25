import { createHash } from 'node:crypto';

export const ZONING_DOCUMENT_PARSER_VERSION = '3.6.0';

const FIELD_LABELS = {
  planName: 'Plan adı', planNumber: 'Plan işlem / karar no', planScale: 'Plan ölçeği', planDate: 'Plan / belge tarihi',
  authority: 'Yetkili idare', landUse: 'Plan fonksiyonu', taks: 'TAKS', emsal: 'Emsal / KAKS', floors: 'Kat adedi / Yençok (kat)',
  hmax: 'Yençok / Hmax (metre)', buildingOrder: 'Yapı nizamı', frontSetback: 'Ön bahçe', sideSetback: 'Yan bahçe', rearSetback: 'Arka bahçe',
  netParcelArea: 'Net imar parseli alanı', setbackConditions: 'Cepheye göre çekme mesafeleri'
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
  setField('netParcelArea', detectNetParcelArea(lines));
  setField('taks', detectRatioField(lines, 'taks', 1));
  setField('emsal', detectRatioField(lines, 'emsal', 15));
  setField('floors', detectFloors(lines));
  setField('hmax', detectHmax(lines));
  setField('buildingOrder', detectBuildingOrder(lines, normalizedText));
  const setbacks = detectSetbacks(lines);
  setField('frontSetback', setbacks.scalars.front);
  setField('sideSetback', setbacks.scalars.side);
  setField('rearSetback', setbacks.scalars.rear);
  if (setbacks.conditions.length) {
    fields.setbackConditions = setbacks.conditions;
    fieldEvidence.setbackConditions = {
      label: FIELD_LABELS.setbackConditions,
      confidence: setbacks.ambiguousTypes.length ? 'medium' : 'high',
      excerpt: trim(setbacks.conditions.map((item) => item.excerpt).filter(Boolean).join(' | '), 520),
      method: 'setback-condition-list'
    };
  }

  const extractedAt = new Date().toISOString();
  const documentDate = normalizeMetadataDate(fields.planDate || metadata.documentDate || metadata.lastModified);
  const retrievedAt = normalizeTimestamp(metadata.retrievedAt) || extractedAt;
  const sourceTitle = cleanValue(metadata.sourceTitle || fields.planName || metadata.fileName || documentTypeLabel(documentType), 280);
  const sourceUrl = safeHttps(metadata.sourceUrl);
  const evidenceContext = {
    sourceTitle,
    sourceUrl,
    documentDate,
    retrievedAt,
    parserVersion: ZONING_DOCUMENT_PARSER_VERSION,
    parcelMatchStatus: parcelMatch.status
  };
  for (const item of Object.values(fieldEvidence)) Object.assign(item, evidenceContext);
  if (Array.isArray(fields.setbackConditions)) {
    fields.setbackConditions = fields.setbackConditions.map((item) => ({
      ...item,
      confidence: item.confidence || 'high',
      method: item.method || 'setback-condition',
      ...evidenceContext
    }));
  }

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
  if (setbacks.ambiguousTypes.length) warnings.push(`Belgede ${setbacks.ambiguousTypes.map(setbackTypeLabel).join(' ve ')} için birden fazla koşullu değer bulundu; tek bir çekme mesafesi seçilmedi. Cephe koşulları ayrı ayrı korunmuştur.`);
  if (requiredMissing.length) warnings.push(`Tam sonuç için eksik alanlar: ${requiredMissing.map((key) => FIELD_LABELS[key]).join(', ')}.`);
  if (overallConfidence === 'low') warnings.push('Otomatik okuma güveni düşük; alanları resmî belgeyle tek tek karşılaştırın.');

  const evidence = {
    confirmed: false,
    parcelConfirmed: parcelMatch.status === 'exact',
    sourceTitle,
    authority: fields.authority || cleanValue(metadata.authority, 240),
    sourceUrl,
    planName: fields.planName || null,
    planNumber: fields.planNumber || null,
    planScale: fields.planScale || null,
    planDate: fields.planDate || null,
    landUse: fields.landUse || null,
    netParcelArea: numberOrNull(fields.netParcelArea),
    taks: numberOrNull(fields.taks),
    emsal: numberOrNull(fields.emsal),
    floors: integerOrNull(fields.floors),
    hmax: numberOrNull(fields.hmax),
    buildingOrder: fields.buildingOrder || null,
    frontSetback: numberOrNull(fields.frontSetback),
    sideSetback: numberOrNull(fields.sideSetback),
    rearSetback: numberOrNull(fields.rearSetback),
    setbackConditions: fields.setbackConditions || [],
    allowances,
    parkingRequired,
    roadDedicationPossible,
    floodDataStatus,
    planNotes,
    constraints,
    documentName: cleanValue(metadata.fileName || metadata.documentName, 260),
    documentMimeType: cleanValue(metadata.mimeType, 120),
    documentDate,
    retrievedAt,
    documentHash,
    parserVersion: ZONING_DOCUMENT_PARSER_VERSION,
    documentType,
    extractionConfidence: overallConfidence,
    parcelMatchStatus: parcelMatch.status,
    detectedParcels,
    fieldEvidence,
    extractedAt
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

function detectNetParcelArea(lines) {
  // Yalnızca açıkça "net" denilen imar alanını kabul et. Sıradan "parsel
  // alanı" kadastro alanı olabilir ve yapılaşma hesabında net alan diye
  // kullanılamaz.
  const label = /(?:net\s+imar\s+parsel(?:i)?\s+(?:alani|yuz\s*olcumu|yuzolcumu)|imar\s+parsel(?:i)?\s+net\s+(?:alani|yuz\s*olcumu|yuzolcumu)|(?:imar\s+uygulamasi\s+sonrasi\s+)?net\s+parsel(?:i)?\s+(?:alani|yuz\s*olcumu|yuzolcumu))/i;
  const valuePattern = /([0-9]{1,3}(?:[.\s][0-9]{3})*(?:,[0-9]{1,3})?|[0-9]+(?:[,.][0-9]{1,3})?)\s*(?:m\s*[²2]|metrekare)(?![\p{L}\p{N}])/iu;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const labelMatch = normalizeForSearch(line).match(label);
    if (!labelMatch) continue;
    const offset = (labelMatch.index || 0) + labelMatch[0].length;
    let excerpt = line;
    let valueText = line.slice(offset);
    if (!valuePattern.test(valueText) && isStandaloneMeasurementLine(lines[index + 1])) {
      excerpt = `${line} ${lines[index + 1]}`;
      valueText = `${valueText} ${lines[index + 1]}`;
    }
    const match = valueText.match(new RegExp(`^\\s*(?:[:=.-]|\\([^)]*\\))*\\s*${valuePattern.source}`, 'iu'));
    if (!match) continue;
    const value = parseLocaleNumber(match[1], true);
    if (value != null && value > 0 && value <= 100_000_000) return result(value, 'high', excerpt, 'net-parcel-area-label');
  }
  return null;
}

function detectRatioField(lines, type, max) {
  const taksLabel = '(?:T\\s*\\.?\\s*A\\s*\\.?\\s*K\\s*\\.?\\s*S\\s*\\.?|TABAN\\s+ALANI\\s+KAT(?:SAYISI|SAYI(?:SI)?))';
  const emsalLabel = '(?:EMSAL(?:\\s*[/(]\\s*(?:K\\s*\\.?\\s*A\\s*\\.?\\s*K\\s*\\.?\\s*S\\s*\\.?|E)\\s*\\)?)?|K\\s*\\.?\\s*A\\s*\\.?\\s*K\\s*\\.?\\s*S\\s*\.?(?:\\s*[/(]\\s*(?:EMSAL|E)\\s*\\)?)?|KATLAR\\s+ALANI\\s+KAT(?:SAYISI|SAYI(?:SI)?))';
  const label = type === 'taks' ? taksLabel : emsalLabel;
  const number = '(?:[0-9]+(?:[,.][0-9]+)?|[,.][0-9]+)';
  const pattern = new RegExp(`(?:^|[^\\p{L}\\p{N}])(%)?\\s*${label}\\s*[:=xX-]?\\s*(%)?\\s*(${number})\\s*(%)?`, 'iu');
  const shortEPattern = type === 'emsal' ? new RegExp(`(?:^|[^\\p{L}\\p{N}])E\\s*\\.?\\s*[:=]\\s*(%)?\\s*(${number})\\s*(%)?`, 'iu') : null;
  const reversePercentPattern = new RegExp(`(?:^|[^\\p{L}\\p{N}])%\\s*(${number})\\s*${label}(?:[^\\p{L}\\p{N}]|$)`, 'iu');
  const pairedPattern = /(?:T\s*\.?\s*A\s*\.?\s*K\s*\.?\s*S\s*\.?)\s*[/|-]\s*(?:K\s*\.?\s*A\s*\.?\s*K\s*\.?\s*S\s*\.?|EMSAL)\s*[:=]?\s*(%?)\s*([0-9]+(?:[,.][0-9]+)?)\s*[/|-]\s*(%?)\s*([0-9]+(?:[,.][0-9]+)?)(%?)/iu;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const paired = line.match(pairedPattern);
    if (paired) {
      const rawValue = type === 'taks' ? paired[2] : paired[4];
      const hasPercent = type === 'taks' ? Boolean(paired[1]) : Boolean(paired[3] || paired[5]);
      let value = parseLocaleNumber(rawValue);
      if (value != null && hasPercent) value /= 100;
      if (value != null && value >= 0 && value <= max) return result(value, 'high', line, `${type}-paired-label`);
    }

    let candidate = line;
    if (containsOnlyRatioLabel(line, type) && isStandaloneRatioLine(lines[index + 1])) candidate = `${line} ${lines[index + 1]}`;
    const standardMatch = candidate.match(pattern);
    if (standardMatch) {
      let value = parseLocaleNumber(standardMatch[3]);
      if (value == null) continue;
      if (standardMatch[1] || standardMatch[2] || standardMatch[4]) value /= 100;
      if (value >= 0 && value <= max) return result(value, 'high', candidate, `${type}-label`);
      continue;
    }
    const shortEMatch = shortEPattern ? candidate.match(shortEPattern) : null;
    if (shortEMatch) {
      let value = parseLocaleNumber(shortEMatch[2]);
      if (value == null) continue;
      if (shortEMatch[1] || shortEMatch[3]) value /= 100;
      if (value >= 0 && value <= max) return result(value, 'high', candidate, `${type}-label`);
      continue;
    }
    const reverseMatch = line.match(reversePercentPattern);
    if (reverseMatch) {
      const value = parseLocaleNumber(reverseMatch[1]);
      if (value != null && value / 100 >= 0 && value / 100 <= max) return result(value / 100, 'high', line, `${type}-percent-prefix`);
    }
  }
  return null;
}

function detectFloors(lines) {
  for (const line of lines) {
    const normalizedLine = normalizeForSearch(line);
    const zeminPlus = normalizedLine.match(/(?:kat\s+(?:adedi|sayisi)|yen\s*cok|maksimum\s+kat|yapilasma\s+(?:kosulu|nizami))\s*[:=.-]?\s*(?:b(?:odrum)?\s*\+\s*)?z(?:emin)?\s*\+\s*(\d{1,3})\s*(?:kat)?\b/i);
    if (zeminPlus) {
      const normalFloorCount = Number(zeminPlus[1]);
      const value = normalFloorCount + 1;
      if (Number.isInteger(value) && value >= 1 && value <= 150) return result(value, 'high', line, 'floor-zemin-plus-label');
    }
    const roman = normalizedLine.match(/(?:kat\s+(?:adedi|sayisi)|yen\s*cok|maksimum\s+kat)\s*[:=.-]?\s*([ivxlcdm]{1,8})\s*kat\b/i);
    if (roman) {
      const value = romanToInteger(roman[1]);
      if (value != null && value >= 1 && value <= 150) return result(value, 'high', line, 'floor-roman-label');
    }
    const compact = normalizedLine.match(/(?:yapi\s*nizami|yapilasma\s*nizami|insaat\s*nizami|nizam)\s*[:=.-]?\s*(?:a|b|bl)\s*[-/]\s*(\d{1,3})\b/i);
    if (compact) {
      const value = Number(compact[1]);
      if (Number.isInteger(value) && value >= 1 && value <= 150) return result(value, 'high', line, 'floor-compact-order');
    }
  }
  const patterns = [
    /(?:kat\s+adedi|kat\s+sayisi|azami\s+kat)\s*[:=-]?\s*(\d{1,3})\b/i,
    /(?:yen\s*cok|maksimum\s+kat)(?:\s*\(\s*kat\s*\))?\s*[:=.-]?\s*(\d{1,3})\s*kat\b/i,
    /\b(\d{1,3})\s*kat(?:li|tir|dir)?\b/i
  ];
  for (const line of lines) {
    const normalizedLine = normalizeForSearch(line);
    for (const pattern of patterns) {
      const match = normalizedLine.match(pattern);
      if (!match) continue;
      const value = Number(match[1]);
      if (Number.isInteger(value) && value >= 1 && value <= 150) return result(value, /kat\s+(?:adedi|sayisi)/i.test(normalizedLine) ? 'high' : 'medium', line, 'floor-pattern');
    }
  }
  return null;
}

function detectHmax(lines) {
  for (const line of lines) {
    const normalizedLine = normalizeForSearch(line);
    const explicitHeight = normalizedLine.match(/(?:h\s*\.?\s*(?:max|maks)|hmax|hmaks|maksimum\s+(?:yapi\s+|bina\s+)?yuksekligi|(?:yapi|bina)\s+yuksekligi|yukseklik\s*\(\s*h\s*\))(?:\s*\(\s*(?:m|metre)\s*\))?\s*[:=.-]?\s*(\d{1,3}(?:[,.]\d{1,3})?)\s*(?:m|metre)?\b/i);
    const yencokHeight = normalizedLine.match(/(?:yen\s*cok)(?:\s*\(\s*(?:(?:h\s*\.?\s*)?(?:max|maks)|m|metre)\s*\))?\s*[:=.-]?\s*(\d{1,3}(?:[,.]\d{1,3})?)\s*(?:m|metre)\b/i);
    const match = explicitHeight || yencokHeight;
    if (match) {
      const value = parseLocaleNumber(match[1]);
      if (value != null && value > 0 && value <= 1000) return result(value, 'high', line, 'hmax-label');
    }
  }
  return null;
}

function detectBuildingOrder(lines, normalizedText) {
  const labelPattern = /(?:yapi\s*nizami|yapinizami|yapilasma\s*nizami|insaat\s*nizami|yapi\s*duzeni|nizam)\s*[:=-]?\s*(ayrik|bitisik|blok|serbest)(?:\s+nizam)?\b/i;
  for (const line of lines) {
    const match = normalizeForSearch(line).match(labelPattern);
    if (match) return result(normalizeBuildingOrderValue(match[1]), 'high', line, 'building-order-label');
    const compact = normalizeForSearch(line).match(/(?:yapi\s*nizami|yapilasma\s*nizami|insaat\s*nizami|nizam)\s*[:=.-]?\s*(a|b|bl)\s*[-/]\s*\d{1,3}\b/i);
    if (compact) {
      const value = compact[1] === 'a' ? 'Ayrık' : compact[1] === 'b' ? 'Bitişik' : 'Blok';
      return result(value, 'high', line, 'building-order-compact');
    }
  }
  const match = normalizedText.match(/\b(ayrik|bitisik|blok|serbest)\s+nizam\b/iu);
  return match ? result(normalizeBuildingOrderValue(match[1]), 'medium', context(normalizedText, match.index, match[0].length), 'order-pattern') : null;
}

function detectSetbacks(lines) {
  const definitions = {
    front: /(?:on\s+bahce(?:\s+cekme)?(?:\s+mesafesi)?|on\s+(?:yapi\s+)?(?:cekme|yaklasma)(?:\s+mesafesi)?|yol\s+cephesi\s+(?:yapi\s+)?(?:cekme|yaklasma)(?:\s+mesafesi)?|yoldan\s+(?:yapi\s+)?(?:cekme|yaklasma)(?:\s+mesafesi)?|(?:^|[|;])\s*on(?=\s*[:=-]))/i,
    side: /(?:yan\s+bahce(?:\s+cekme)?(?:\s+mesafesi)?|yan\s+(?:yapi\s+)?(?:cekme|yaklasma)(?:\s+mesafesi)?|(?:^|[|;])\s*yan(?=\s*[:=-]))/i,
    rear: /(?:arka\s+bahce(?:\s+cekme)?(?:\s+mesafesi)?|arka\s+(?:yapi\s+)?(?:cekme|yaklasma)(?:\s+mesafesi)?|(?:^|[|;])\s*arka(?=\s*[:=-]))/i
  };
  const output = { conditions: [], scalars: {}, ambiguousTypes: [] };
  for (const [type, labelPattern] of Object.entries(definitions)) {
    for (let index = 0; index < lines.length; index += 1) {
      let excerpt = lines[index];
      let normalizedLine = normalizeForSearch(excerpt);
      const labelMatch = normalizedLine.match(labelPattern);
      if (!labelMatch) continue;
      let start = (labelMatch.index || 0) + labelMatch[0].length;
      let segment = setbackSegment(normalizedLine, start, definitions, type);
      if (!hasSetbackMeasurement(segment) && isStandaloneSetbackLine(lines[index + 1])) {
        excerpt = `${excerpt} ${lines[index + 1]}`;
        normalizedLine = normalizeForSearch(excerpt);
        const combinedLabel = normalizedLine.match(labelPattern);
        start = (combinedLabel?.index || 0) + (combinedLabel?.[0]?.length || 0);
        segment = setbackSegment(normalizedLine, start, definitions, type);
      }
      const measurements = extractSetbackMeasurements(segment, type);
      for (const measurement of measurements) {
        output.conditions.push({
          type,
          qualifier: measurement.qualifier,
          value: measurement.value,
          unit: 'm',
          confidence: measurement.confidence || 'high',
          method: measurement.method || 'setback-label',
          excerpt: trim(excerpt, 520)
        });
      }
    }
    const conditions = dedupeSetbackConditions(output.conditions.filter((item) => item.type === type));
    output.conditions = [...output.conditions.filter((item) => item.type !== type), ...conditions];
    const uniqueValues = [...new Set(conditions.map((item) => item.value))];
    if (uniqueValues.length === 1) {
      output.scalars[type] = result(uniqueValues[0], 'high', conditions.map((item) => item.excerpt).join(' | '), `${type}-setback-label`);
    } else if (uniqueValues.length > 1) {
      output.ambiguousTypes.push(type);
    }
  }
  return output;
}

function setbackSegment(line, start, definitions, type) {
  const otherLabelOffsets = Object.entries(definitions)
    .filter(([otherType]) => otherType !== type)
    .map(([, pattern]) => line.slice(start).search(pattern))
    .filter((index) => index >= 0);
  const end = otherLabelOffsets.length ? start + Math.min(...otherLabelOffsets) : line.length;
  return line.slice(start, end);
}

function hasSetbackMeasurement(value) {
  return /\d{1,3}(?:[,.]\d{1,3})?\s*(?:m|metre)\b/i.test(value);
}

function extractSetbackMeasurements(segment, type) {
  const qualifierPattern = type === 'front'
    ? '(?:kuzey|guney|dogu|bati|diger\\s+yol(?:lar)?|imar\\s+yolu|servis\\s+yolu|[1-9]\\d*\\.?\\s*(?:nolu|numarali)?\\s*(?:yol|cephe)|yol\\s*\\d+|\\d+(?:[,.]\\d+)?\\s*m(?:etre)?(?:lik|\\s+ve\\s+uzeri|[\u2019\u2018\x27]?den\\s+(?:dar|genis))?\\s*yol(?:lar(?:da)?)?)'
    : type === 'side' ? '(?:sag|sol|kuzey|guney|dogu|bati)' : '(?:kuzey|guney|dogu|bati)';
  const qualified = new RegExp(`(${qualifierPattern})(?:\\s+(?:icin|ise|yolundan|yola\\s+bakan|cephesi|cephe|tarafi|tarafta|yollarda))?\\s*[:=.-]?\\s*(?:en\\s+az|asgari|minimum)?\\s*(\\d{1,3}(?:[,.]\\d{1,3})?)\\s*(?:m|metre)\\b`, 'gi');
  const output = [];
  let match;
  while ((match = qualified.exec(segment))) {
    const value = parseLocaleNumber(match[2]);
    if (value != null && value >= 0 && value <= 500) output.push({ qualifier: cleanSetbackQualifier(match[1]), value, confidence: 'high', method: 'qualified-setback-label' });
  }
  if (output.length) return output;
  const unqualified = /(?:^|[,:;=/\-]\s*)\s*(?:en\s+az|asgari|minimum)?\s*(\d{1,3}(?:[,.]\d{1,3})?)\s*(?:m|metre)?\b/gi;
  while ((match = unqualified.exec(segment))) {
    const value = parseLocaleNumber(match[1]);
    if (value != null && value >= 0 && value <= 500) output.push({ qualifier: null, value, confidence: 'high', method: 'unqualified-setback-label' });
  }
  return output;
}

function dedupeSetbackConditions(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = `${item.type}|${normalizeForSearch(item.qualifier || '')}|${item.value}|${item.excerpt}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function cleanSetbackQualifier(value) {
  const cleaned = cleanValue(value, 120);
  if (!cleaned) return null;
  const canonical = { kuzey: 'Kuzey', guney: 'Güney', dogu: 'Doğu', bati: 'Batı', sag: 'Sağ', sol: 'Sol' }[normalizeForSearch(cleaned)];
  return canonical || titleCaseTurkish(cleaned)
    .replace(/\bUzeri\b/g, 'Üzeri')
    .replace(/\bDiger\b/g, 'Diğer')
    .replace(/\bGenis\b/g, 'Geniş');
}

function setbackTypeLabel(type) {
  return ({ front: 'ön bahçe', side: 'yan bahçe', rear: 'arka bahçe' })[type] || type;
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
function containsOnlyRatioLabel(value, type) {
  const normalized = normalizeForSearch(value).replace(/[\s:;=._()-]+/g, '');
  return type === 'taks'
    ? ['taks', 'tabanalanikatsayisi'].includes(normalized)
    : ['kaks', 'emsal', 'kaksemsal', 'emsalkaks', 'e'].includes(normalized);
}
function isStandaloneRatioLine(value) { return /^\s*(?:[%]\s*)?(?:[0-9]+(?:[,.][0-9]+)?|[,.][0-9]+)\s*%?\s*$/u.test(String(value || '')); }
function isStandaloneMeasurementLine(value) { return /^\s*[:=.-]?\s*[0-9]{1,3}(?:[.\s][0-9]{3})*(?:,[0-9]{1,3})?\s*(?:m\s*[²2]|metrekare)\s*$/iu.test(String(value || '')); }
function isStandaloneSetbackLine(value) { return /^\s*[:=.-]?\s*(?:(?:en\s+az|asgari|minimum)\s+)?(?:\d{1,3}(?:[,.]\d{1,3})?\s*(?:m|metre)\b|(?:kuzey|güney|doğu|batı|sağ|sol|diğer|imar|servis|\d)[^\n]{0,180}\d{1,3}(?:[,.]\d{1,3})?\s*(?:m|metre)\b)/iu.test(String(value || '')); }
function romanToInteger(value) {
  const input = String(value || '').toUpperCase();
  if (!/^[IVXLCDM]+$/.test(input)) return null;
  const values = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };
  let total = 0;
  for (let index = 0; index < input.length; index += 1) {
    const current = values[input[index]];
    const next = values[input[index + 1]] || 0;
    total += current < next ? -current : current;
  }
  return total;
}
function normalizeLandUseValue(value) { const text = cleanValue(value, 180); if (!text) return null; for (const [label, pattern] of LAND_USE_PATTERNS) if (pattern.test(text)) return label; return titleCaseTurkish(text.replace(/[;,.].*$/, '')); }
function normalizeBuildingOrderValue(value) { const normalized = normalizeForSearch(value); if (/ayrik/.test(normalized)) return 'Ayrık'; if (/bitisik/.test(normalized)) return 'Bitişik'; if (/blok/.test(normalized)) return 'Blok'; if (/serbest/.test(normalized)) return 'Serbest'; return cleanValue(value, 120); }
function normalizeScale(value) { return String(value).replace(/\s+/g, '').replace(':', '/'); }
function parseLocaleNumber(value, preferThousands = false) {
  let text = String(value ?? '').trim().replace(/\s/g, '');
  if (!text) return null;
  if (text.includes(',') && text.includes('.')) {
    text = text.lastIndexOf(',') > text.lastIndexOf('.') ? text.replace(/\./g, '').replace(',', '.') : text.replace(/,/g, '');
  } else if (text.includes(',')) {
    text = text.replace(',', '.');
  } else if (preferThousands && /^\d{1,3}(?:\.\d{3})+$/.test(text)) {
    text = text.replace(/\./g, '');
  }
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}
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
function toIsoDate(value) { const match = String(value).match(/(\d{1,2})[./-](\d{1,2})[./-](\d{4})/); if (!match) return null; const day = Number(match[1]); const month = Number(match[2]); const year = Number(match[3]); if (year < 1900 || year > 2200) return null; return validIsoDate(String(year), String(month).padStart(2, '0'), String(day).padStart(2, '0')); }
function normalizeMetadataDate(value) {
  if (!value) return null;
  const text = String(value).trim();
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:T|$)/);
  if (iso) return validIsoDate(iso[1], iso[2], iso[3]);
  const turkish = toIsoDate(text);
  if (turkish) return turkish;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}
function normalizeTimestamp(value) { if (!value) return null; const date = new Date(value); return Number.isNaN(date.getTime()) ? null : date.toISOString(); }
function validIsoDate(year, month, day) { const date = new Date(`${year}-${month}-${day}T00:00:00.000Z`); return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== `${year}-${month}-${day}` ? null : `${year}-${month}-${day}`; }
function documentTypeLabel(type) { return ({ 'zoning-status-document': 'İmar Durumu Belgesi', 'plan-notes': 'Plan Notları', 'plan-announcement': 'Plan / Askı Kaydı', 'planning-document': 'İmar Planı Belgesi', 'official-document': 'Resmî İmar Belgesi' })[type] || 'Resmî İmar Belgesi'; }
function parserError(message, code) { const error = new Error(message); error.code = code; error.statusCode = 400; return error; }
