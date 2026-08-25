const POSSIBILITY_LABELS = {
  housing: 'Konut',
  villa: 'Villa',
  pool: 'Havuz',
  landscaping: 'Bahçe / Peyzaj',
  roof: 'Çatı',
  terraceRoof: 'Teras çatı',
  balcony: 'Balkon',
  basement: 'Bodrum',
  parking: 'Otopark',
  solar: 'Güneş paneli'
};

const STATUS_LABELS = {
  allowed: 'Yapılabilir',
  conditional: 'Belirli şartlarla',
  prohibited: 'Uygun değil',
  required: 'Gerekli',
  unknown: 'Doğrulanamadı'
};

export function buildParcelAnalysis({ parcel, zoning, environment }) {
  const properties = parcel?.properties || {};
  const parcelArea = finitePositive(properties.area) ?? parseArea(properties.areaText);
  const zoningStatus = zoning?.status || 'unavailable';
  const calculationsAllowed = ['verified', 'user-evidence', 'ai-assisted-official'].includes(zoningStatus) && zoning?.conflict !== true;
  const fields = normalizeZoningFields(zoning?.fields || {});
  const fieldExclusionReasons = Object.fromEntries(['netParcelArea', 'taks', 'emsal', 'floors', 'hmax'].map((field) => [field, calculationFieldExclusionReason(zoning, field)]).filter(([, reason]) => reason));
  const excludedFields = Object.keys(fieldExclusionReasons);
  const netParcelAreaCandidate = calculationsAllowed && !fieldExclusionReasons.netParcelArea ? finitePositive(fields.netParcelArea) : null;
  const netParcelAreaPlausible = netParcelAreaCandidate == null || parcelArea == null || netParcelAreaCandidate <= parcelArea * 1.05;
  const verifiedNetParcelArea = netParcelAreaPlausible ? netParcelAreaCandidate : null;
  const calculationArea = verifiedNetParcelArea ?? parcelArea;
  const calculationAreaKind = verifiedNetParcelArea != null ? 'net-imar-parseli-alani' : 'kadastro-parsel-alani';
  const calculationAreaLabel = verifiedNetParcelArea != null ? 'Doğrulanmış net imar parseli alanı' : 'Kadastro parsel alanı';

  const taks = calculationsAllowed && !fieldExclusionReasons.taks ? ratio(fields.taks, 1) : null;
  const emsal = calculationsAllowed && !fieldExclusionReasons.emsal ? ratio(fields.emsal, 15) : null;
  const floors = calculationsAllowed && !fieldExclusionReasons.floors ? integer(fields.floors, 1, 150) : null;
  const hmax = calculationsAllowed && !fieldExclusionReasons.hmax ? finitePositive(fields.hmax) : null;
  const footprint = calculationArea != null && taks != null ? round2(calculationArea * taks) : null;
  const construction = calculationArea != null && emsal != null ? round2(calculationArea * emsal) : null;
  const outside = calculationArea != null && footprint != null ? round2(Math.max(0, calculationArea - footprint)) : null;
  const calculationBasis = {
    area: calculationArea ?? null,
    kind: calculationArea != null ? calculationAreaKind : 'unavailable',
    label: calculationArea != null ? calculationAreaLabel : 'Hesap alanı doğrulanamadı',
    cadastralParcelArea: parcelArea ?? null,
    netParcelArea: verifiedNetParcelArea,
    netParcelAreaCandidate,
    netParcelAreaRejected: netParcelAreaCandidate != null && !netParcelAreaPlausible,
    excludedFields,
    fieldExclusionReasons,
    sourceField: verifiedNetParcelArea != null ? 'netParcelArea' : 'parcel.area',
    fallbackUsed: verifiedNetParcelArea == null && parcelArea != null,
    fallbackReason: verifiedNetParcelArea != null
      ? null
      : netParcelAreaCandidate != null
        ? 'Net imar parseli alanı kadastro alanıyla tutarsız olduğu için hesapta kullanılmadı.'
        : 'Doğrulanmış net imar parseli alanı bulunmadığı için kadastro alanı geçici hesap temeli olarak kullanıldı.'
  };

  const metrics = {
    floors: metric(floors, floors != null ? `${floors} Kat` : null, 'En fazla', 'floors'),
    footprint: metric(footprint, formatArea(footprint), 'Binanın oturabileceği yaklaşık alan', `taks-${calculationAreaKind}`),
    construction: metric(construction, formatArea(construction), 'Yaklaşık toplam emsale esas alan', `emsal-${calculationAreaKind}`),
    outside: metric(outside, formatArea(outside), 'Teorik taban oturumu dışında kalan alan', `taks-${calculationAreaKind}`)
  };

  const possibilities = buildPossibilities(fields, { parcelArea, outside, floors });
  const missing = missingFields(fields, calculationsAllowed, new Set(excludedFields));
  const warnings = buildWarnings({ zoning, fields, missing, environment, calculationBasis });
  const explanation = buildExplanation({ properties, parcelArea, zoning, fields, metrics, missing, calculationBasis });
  const technical = buildTechnical(properties, fields, zoning);
  const claims = buildClaims({ parcel, zoning: { ...zoning, fields }, environment, metrics, calculationBasis });
  const sources = dedupeSources([
    sourceFromParcel(parcel),
    ...(Array.isArray(zoning?.sources) ? zoning.sources : []),
    ...(environment?.source ? [environment.source] : []),
    calculationSource(metrics, calculationBasis)
  ].filter(Boolean));

  const status = zoning?.conflict
    ? 'conflict'
    : calculationsAllowed && missing.length === 0
      ? 'complete'
      : calculationsAllowed
        ? 'partial'
        : 'cadastral-only';

  return {
    version: '3.7.0',
    status,
    zoningStatus,
    calculatedAt: new Date().toISOString(),
    parcel: {
      area: parcelArea,
      province: clean(properties.province),
      district: clean(properties.district),
      neighbourhood: clean(properties.neighbourhood),
      block: clean(properties.block),
      parcel: clean(properties.parcel),
      quality: clean(properties.quality),
      mapSheet: clean(properties.mapSheet)
    },
    zoning: {
      status: zoningStatus,
      conflict: Boolean(zoning?.conflict),
      providerMessage: clean(zoning?.message),
      configuration: zoning?.configuration || {},
      diagnostics: Array.isArray(zoning?.diagnostics) ? zoning.diagnostics.slice(0, 12) : [],
      fields,
      fieldSources: zoning?.fieldSources || {},
      missing
    },
    sourceScan: zoning?.sourceScan || { status: 'exhausted', exhausted: true, attemptedCount: 0, reachableCount: 0, foundRecordCount: 0, attempts: [], sources: [] },
    planAi: zoning?.planAi || { status: 'disabled', enabled: false, configured: false, canCalculate: false, evidenceBackedFields: [], evidence: [], attempts: [], message: 'Plan AI çalıştırılmadı.' },
    planContext: zoning?.planContext || { status: 'unavailable', matches: [], metadata: {}, records: [], sources: [] },
    planRecords: Array.isArray(zoning?.planContext?.records) ? zoning.planContext.records : [],
    providerDiscovery: zoning?.providerDiscovery || { status: 'unavailable', actions: [], sources: [], municipalServices: [], catalog: { embedded: true, matchCount: 0 } },
    explanation,
    calculationBasis,
    metrics,
    possibilities,
    warnings,
    technical,
    environment: environment || { status: 'unavailable', categories: [] },
    roadmap: permitRoadmap(),
    claims,
    sources,
    nextActions: buildNextActions(status, missing)
  };
}

export function normalizeZoningFields(input = {}) {
  const setbacks = input.setbacks || {};
  const allowances = input.allowances || {};
  const setbackConditions = normalizeSetbackConditions(input.setbackConditions);
  const conditionalFields = normalizeConditionalFields(input.conditionalFields);
  return {
    landUse: clean(input.landUse, 180),
    netParcelArea: finitePositive(input.netParcelArea),
    taks: ratio(input.taks, 1),
    emsal: ratio(input.emsal, 15),
    floors: integer(input.floors, 1, 150),
    hmax: finitePositive(input.hmax),
    buildingOrder: clean(input.buildingOrder, 120),
    frontSetback: normalizeSetbackScalar(input.frontSetback ?? setbacks.front, setbackConditions, 'front'),
    sideSetback: normalizeSetbackScalar(input.sideSetback ?? setbacks.side, setbackConditions, 'side'),
    rearSetback: normalizeSetbackScalar(input.rearSetback ?? setbacks.rear, setbackConditions, 'rear'),
    setbackConditions,
    conditionalFields,
    frontGardenArea: finiteNonNegative(input.frontGardenArea),
    sideGardenArea: finiteNonNegative(input.sideGardenArea),
    rearGardenArea: finiteNonNegative(input.rearGardenArea),
    planName: clean(input.planName, 300),
    planNumber: clean(input.planNumber, 120),
    planScale: clean(input.planScale, 80),
    planDate: isoDate(input.planDate),
    authority: clean(input.authority, 240),
    planNotes: clean(input.planNotes, 4000),
    constraints: normalizeStringList(input.constraints, 30, 500),
    parkingRequired: booleanOrNull(input.parkingRequired),
    roadDedicationPossible: booleanOrNull(input.roadDedicationPossible),
    floodDataStatus: enumValue(input.floodDataStatus, ['clear', 'risk', 'unknown']),
    allowances: Object.fromEntries(Object.keys(POSSIBILITY_LABELS).map((key) => [key, normalizePossibility(allowances[key] ?? input[key])]))
  };
}

export function compareZoningRecords(records) {
  const valid = records.filter((record) => record && record.fields);
  if (valid.length < 2) return { conflict: false, fields: [] };
  const fields = ['landUse', 'netParcelArea', 'taks', 'emsal', 'floors', 'hmax', 'buildingOrder', 'frontSetback', 'sideSetback', 'rearSetback', 'frontGardenArea', 'sideGardenArea', 'rearGardenArea'];
  const conflicts = [];
  for (const field of fields) {
    const values = valid.map((record) => comparable(record.fields[field])).filter((value) => value != null);
    if (new Set(values).size > 1) conflicts.push(field);
  }
  return { conflict: conflicts.length > 0, fields: conflicts };
}

function buildExplanation({ properties, parcelArea, zoning, fields, metrics, missing, calculationBasis }) {
  const location = [properties.province, properties.district, properties.neighbourhood].filter(Boolean).join(' / ');
  const intro = `${location ? `${location} sınırlarındaki ` : ''}${properties.block || '—'} ada ${properties.parcel || '—'} parsel${parcelArea != null ? ` ${formatArea(parcelArea)} büyüklüğündedir` : ' için alan bilgisi doğrulanamadı'}.`;
  if (zoning?.conflict) {
    return `${intro} Ulaşılan plan kaynaklarında birbiriyle çelişen yapılaşma değerleri bulunduğu için otomatik inşaat hesabı durduruldu. Kaynakların yetkili uzman tarafından karşılaştırılması gerekir.`;
  }
  if (!['verified', 'user-evidence', 'ai-assisted-official'].includes(zoning?.status)) {
    const quality = properties.quality ? ` TKGM kaydında taşınmaz niteliği “${properties.quality}” olarak görünüyor; bu nitelik tek başına güncel imar hakkını göstermez.` : '';
    const planMetadata = zoning?.planContext?.metadata || {};
    const planRecords = Array.isArray(zoning?.planContext?.records) ? zoning.planContext.records : [];
    const recordScale = planMetadata.planScale || null;
    const planLabel = [planMetadata.planName, recordScale].filter(Boolean).join(' · ');
    const coverage = zoning?.planContext?.coverageStatus === 'available'
      ? ` Kamuya açık plan katmanında kapsam${planLabel ? ` ve “${planLabel}” plan kaydı` : ''} tespit edildi; ancak bu kayıt yapılaşma koşullarını tek başına vermez.`
      : '';
    const recordText = planRecords.length
      ? ` Ada/parsel ile eşleşen ${planRecords.length} resmî plan/askı kaydı bulundu${planRecords[0]?.title ? `; ilk kayıt “${planRecords[0].title}”` : ''}. Bu kayıtların güncel yürürlük ve plan notları ayrıca doğrulanmalıdır.`
      : '';
    const municipalServices = Array.isArray(zoning?.providerDiscovery?.municipalServices)
      ? zoning.providerDiscovery.municipalServices
      : zoning?.providerDiscovery?.municipalService ? [zoning.providerDiscovery.municipalService] : [];
    const catalogMatchCount = Number(zoning?.providerDiscovery?.catalog?.matchCount || 0);
    const officialService = municipalServices.length
      ? ` ${zoning.providerDiscovery.authority?.label || 'Yetkili belediye'} için ${municipalServices.length} resmî imar hizmeti${catalogMatchCount ? ' gömülü katalogdan' : ''} bulundu; oturum gerektiren hizmetlerin sonucu kullanıcı tarafından resmî portalda açılır.`
      : '';
    const scan = zoning?.sourceScan || {};
    const scanText = scan.exhausted
      ? ` Planlamasyon ${Number(scan.attemptedCount || 0)} e-Devletsiz açık resmî kaynağı sırayla denedi${scan.reachableCount != null ? `; ${Number(scan.reachableCount || 0)} kaynağa erişebildi` : ''}. Güncel TAKS, emsal, kat veya çekme mesafesi bulunamadığı için yalnızca bulunabilen bilgiler gösterildi ve eksik hesaplar yapılmadı.`
      : ` Planlamasyon ${Number(scan.attemptedCount || 0)} açık resmî kaynağı denedi; tarama süre veya bağlantı sınırı nedeniyle tamamlanamadı. Eksik hesaplar üretilmedi ve analiz yeniden denenebilir.`;
    return `${intro}${quality}${coverage}${recordText}${officialService}${scanText}`;
  }

  const sentences = [intro];
  if (fields.landUse) sentences.push(`Doğrulanan kaynakta kullanım kararı “${fields.landUse}” olarak belirtilmiştir.`);
  if (calculationBasis.netParcelArea != null) sentences.push(`Yapılaşma hesaplarında kadastro alanı yerine belgede doğrulanan ${formatArea(calculationBasis.netParcelArea)} net imar parseli alanı esas alınmıştır.`);
  else if (calculationBasis.fallbackUsed && [fields.taks, fields.emsal].some((value) => value != null)) sentences.push(calculationBasis.fallbackReason);
  if (metrics.floors.value != null) sentences.push(`En fazla ${metrics.floors.value} kat bilgisi bulunmaktadır.`);
  if (metrics.footprint.value != null) sentences.push(`TAKS değerine göre ${calculationBasis.label.toLocaleLowerCase('tr-TR')} üzerinden binanın zeminde oturabileceği yaklaşık alan ${formatArea(metrics.footprint.value)} olarak hesaplanmıştır.`);
  if (metrics.construction.value != null) sentences.push(`Emsal değerine göre ${calculationBasis.label.toLocaleLowerCase('tr-TR')} üzerinden yaklaşık toplam emsale esas inşaat alanı ${formatArea(metrics.construction.value)} olabilir.`);
  if (metrics.outside.value != null) sentences.push(`Yaklaşık ${formatArea(metrics.outside.value)} teorik taban oturumu dışında kalır; bu değer bahçe alanı veya yapı yapılabilir alan değildir ve proje, çekme mesafeleri ile diğer kısıtlarla değişebilir.`);
  const setbacks = setbackExplanationItems(fields);
  if (setbacks.length) sentences.push(`Yapı yaklaşma mesafeleri ${setbacks.join(', ')} olarak kaydedilmiştir.`);
  if (missing.length) sentences.push(`Şu bilgiler henüz doğrulanamadı: ${missing.map(humanField).join(', ')}.`);
  if (zoning.status === 'user-evidence') sentences.push('Bu bölüm kullanıcı tarafından girilen resmî belge bilgilerine dayanır; bağlayıcı işlem öncesinde yetkili idareden teyit edilmelidir.');
  if (zoning.status === 'ai-assisted-official') sentences.push('Bu bölüm Plan AI tarafından e-Devlet girişi istemeyen açık resmî kaynaklardan kanıtıyla çıkarılan değerlere dayanır; bağlayıcı işlem öncesinde yetkili idare kaydı esas alınır.');
  return sentences.join(' ');
}

function buildPossibilities(fields, context) {
  const values = { ...(fields.allowances || {}) };
  if (values.housing === 'unknown' && /konut|meskun|yerleşik/i.test(fields.landUse || '')) values.housing = 'conditional';
  if (values.parking === 'unknown' && fields.parkingRequired === true) values.parking = 'required';
  return Object.entries(POSSIBILITY_LABELS).map(([key, label]) => {
    const status = normalizePossibility(values[key]);
    return {
      key,
      label,
      status,
      statusLabel: STATUS_LABELS[status],
      note: possibilityNote(key, status, fields)
    };
  });
}

function possibilityNote(key, status, fields) {
  if (status === 'unknown') return 'İlgili plan notu veya idare görüşü bulunamadı.';
  if (status === 'required') return 'Plan, yönetmelik veya idare şartı olarak belirtilmiş.';
  if (status === 'prohibited') return 'Doğrulanan kaynakta uygun görülmüyor.';
  if (status === 'conditional') return key === 'housing' && fields.landUse ? `“${fields.landUse}” kullanım kararına göre; özel plan notları ayrıca kontrol edilmeli.` : 'Proje ve ilgili idare şartlarının sağlanmasına bağlı.';
  return 'Doğrulanan imar belgesinde yapılabilir olarak işaretlenmiş.';
}

function buildWarnings({ zoning, fields, missing, environment, calculationBasis }) {
  const warnings = [];
  if (zoning?.conflict) warnings.push({ level: 'danger', text: `Plan kaynaklarında çelişki var: ${(zoning.conflictFields || []).map(humanField).join(', ') || 'yapılaşma koşulları'}. Otomatik hesap yapılmadı.` });
  if (zoning?.status === 'user-evidence') {
    const source = zoning?.sources?.find((item) => item?.trust === 'user-evidence') || zoning?.sources?.[0] || {};
    const parserText = source.parserVersion ? ` Belge Planlamasyon ${source.parserVersion} okuma motoruyla taranmış, kullanıcı tarafından kontrol edilmiştir.` : '';
    warnings.push({ level: 'info', text: `İmar değerleri kullanıcının eklediği resmî belgeye dayanıyor.${parserText} Belge güncelliğini, ada/parsel eşleşmesini ve yürürlük durumunu yetkili idareden doğrulayın.` });
    if (source.extractionConfidence === 'low') warnings.push({ level: 'warning', text: 'Belge otomatik okuma güveni düşük olarak işaretlendi; bütün değerleri belge üzerinde tek tek kontrol edin.' });
  }
  if (zoning?.status === 'ai-assisted-official') {
    const ai = zoning?.planAi || {};
    warnings.push({ level: 'info', text: `Plan AI ${Number(ai.evidenceCount || 0)} açık resmî içerik okudu ve yalnızca kaynak alıntısıyla desteklenen ${Number(ai.evidenceBackedFields?.length || 0)} alanı kullandı. Sonuç resmî ruhsat belgesi yerine geçmez.` });
  }
  if (fields.parkingRequired === true) warnings.push({ level: 'warning', text: 'Otopark çözümü proje ve ruhsat aşamasında sağlanmalıdır.' });
  if (fields.roadDedicationPossible === true) warnings.push({ level: 'warning', text: 'Parselde yol veya kamu alanı terki ihtimali işaretlenmiştir; net alan hesabı için imar uygulaması kontrol edilmelidir.' });
  if (fields.floodDataStatus === 'risk') warnings.push({ level: 'danger', text: 'Taşkın riski veya ilgili kurum kısıtı kaydedilmiştir; kurum görüşü alınmadan proje geliştirilmemelidir.' });
  if (fields.floodDataStatus === 'unknown') warnings.push({ level: 'info', text: 'Taşkın durumuyla ilgili yeterli doğrulanmış veri bulunamadı.' });
  if (calculationBasis?.netParcelAreaRejected) warnings.push({ level: 'danger', text: 'Belgedeki net imar parseli alanı kadastro alanından belirgin biçimde büyük göründüğü için otomatik hesapta kullanılmadı; alanları yetkili idare belgesinden karşılaştırın.' });
  else if (calculationBasis?.fallbackUsed && [fields.taks, fields.emsal].some((value) => value != null)) warnings.push({ level: 'info', text: 'Net imar parseli alanı doğrulanamadığından teorik hesaplarda kadastro parsel alanı kullanıldı; yol terki veya düzenleme sonrası sonuç değişebilir.' });
  const excluded = calculationBasis?.fieldExclusionReasons || {};
  for (const [field, reason] of Object.entries(excluded)) {
    warnings.push({
      level: 'warning',
      text: reason === 'low-confidence'
        ? `${humanField(field)} düşük okuma güveni nedeniyle otomatik hesapta kullanılmadı.`
        : `${humanField(field)} kaynak-parsel eşleşmesi doğrulanmadığı için otomatik hesapta kullanılmadı.`
    });
  }
  const conditionalLabels = Object.entries(fields.conditionalFields || {}).filter(([, items]) => Array.isArray(items) && items.length).map(([field]) => humanField(field));
  if (conditionalLabels.length) warnings.push({ level: 'warning', text: `${conditionalLabels.join(', ')} için koşullu değerler bulundu; hangi koşulun parsele uygulandığı doğrulanmadan tek bir değer seçilmedi ve hesap yapılmadı.` });
  for (const constraint of fields.constraints || []) warnings.push({ level: 'warning', text: constraint });
  if (missing.length) warnings.push({ level: 'info', text: `Eksik imar verileri nedeniyle bazı sonuçlar hesaplanmadı: ${missing.map(humanField).join(', ')}.` });
  if (zoning?.sourceScan?.exhausted) {
    const scan = zoning.sourceScan;
    warnings.push({
      level: scan.foundRecordCount > 0 ? 'info' : 'warning',
      text: scan.foundRecordCount > 0
        ? `${scan.attemptedCount || 0} e-Devletsiz açık resmî kaynak denendi ve ${scan.foundRecordCount} kaynakta yapılaşma verisi bulundu.`
        : `${scan.attemptedCount || 0} e-Devletsiz açık resmî kaynak sırayla denendi; güncel yapılaşma değeri bulunamadığı için eksik sonuçlar hesaplanmadı.`
    });
  }
  if (!zoning?.configuration?.automaticZoningConfigured && !['verified', 'user-evidence', 'ai-assisted-official'].includes(zoning?.status)) {
    const discovery = zoning?.providerDiscovery;
    const serviceCount = Array.isArray(discovery?.municipalServices) ? discovery.municipalServices.length : discovery?.municipalService ? 1 : 0;
    const catalogCount = Number(discovery?.catalog?.matchCount || 0);
    const serviceText = serviceCount
      ? `${discovery.authority?.label || 'Yetkili belediye'} için ${serviceCount} resmî imar hizmeti${catalogCount ? ' gömülü katalogdan' : ''} bulundu; bu bağlantılar resmî sorguya götürür, otomatik veri aktarımı yoksa sonuç kullanıcı tarafından kontrol edilmelidir.`
      : 'Türkiye geneli e-Plan, TUCBS ve belediye resmî hizmet yönlendirmeleri hazırdır; fakat bu parsel için otomatik yapılaşma değerleri sağlayan açık/yapılandırılmış bağlantı bulunamadı.';
    warnings.push({ level: 'info', text: serviceText });
  }
  if (zoning?.planContext?.status === 'available' && !['verified', 'user-evidence', 'ai-assisted-official'].includes(zoning?.status)) {
    const labels = (zoning.planContext.matches || []).map((item) => item.shortLabel || item.title).filter(Boolean).join(' ve ');
    warnings.push({ level: 'info', text: `${labels || 'Kamuya açık plan kapsamı'} tespit edildi; ancak bu katman tek başına TAKS, emsal, kat ve plan notlarını doğrulamaz.` });
  }
  if (Array.isArray(zoning?.planContext?.records) && zoning.planContext.records.length) {
    const record = zoning.planContext.records[0];
    warnings.push({ level: 'info', text: `Ada/parsel ile eşleşen ${zoning.planContext.records.length} resmî plan/askı kaydı bulundu${record?.title ? `: ${record.title}` : ''}. Askı kaydı güncel imar hakkı değildir; yürürlükteki plan ve plan notları yetkili idareden teyit edilmelidir.` });
    const indicatorText = formatRecordIndicators(record?.indicators);
    if (indicatorText) warnings.push({ level: 'warning', text: `Plan kayıt metninde ${indicatorText} ifadeleri geçiyor. Bunlar tarihsel/ilan metni göstergesidir; güncel yapılaşma hesabında kullanılmadı.` });
  }
  if (environment?.status === 'unavailable') warnings.push({ level: 'info', text: 'Yakın çevre verisi geçici olarak alınamadı; parsel ve imar sonucu bundan etkilenmez.' });
  return warnings.slice(0, 20);
}

function buildTechnical(properties, fields, zoning) {
  const rows = [
    ['İl', properties.province, 'TKGM'],
    ['İlçe', properties.district, 'TKGM'],
    ['Mahalle / Köy', properties.neighbourhood, 'TKGM'],
    ['Ada', properties.block, 'TKGM'],
    ['Parsel', properties.parcel, 'TKGM'],
    ['Parsel alanı', formatArea(finitePositive(properties.area) ?? parseArea(properties.areaText)), 'TKGM'],
    ['Nitelik', properties.quality, 'TKGM'],
    ['Pafta', properties.mapSheet, 'TKGM'],
    ['Açık resmî kaynak taraması', zoning?.sourceScan?.attemptedCount != null ? `${zoning.sourceScan.attemptedCount} kaynak denendi` : null, 'Planlamasyon açık kaynak motoru'],
    ['Erişilebilen açık kaynak', zoning?.sourceScan?.reachableCount != null ? `${zoning.sourceScan.reachableCount} kaynak` : null, 'Planlamasyon açık kaynak motoru'],
    ['Otomatik bulunan yapılaşma kaydı', zoning?.sourceScan?.foundRecordCount != null ? `${zoning.sourceScan.foundRecordCount} kayıt` : null, 'Planlamasyon açık kaynak motoru'],
    ['Yüklenen resmî belge', zoning?.sources?.find((item) => item?.trust === 'user-evidence')?.documentName, zoning?.sources?.find((item) => item?.trust === 'user-evidence') ? 'Kullanıcının eklediği belge' : 'Doğrulanamadı'],
    ['Belge okuma güveni', zoning?.sources?.find((item) => item?.trust === 'user-evidence')?.extractionConfidence, zoning?.sources?.find((item) => item?.trust === 'user-evidence') ? 'Planlamasyon belge okuma motoru' : 'Doğrulanamadı'],
    ['Belge-parsel eşleşmesi', zoning?.sources?.find((item) => item?.trust === 'user-evidence')?.parcelMatchStatus, zoning?.sources?.find((item) => item?.trust === 'user-evidence') ? 'Belge okuma ve kullanıcı onayı' : 'Doğrulanamadı'],
    ['Resmî plan / askı kaydı', zoning?.planContext?.records?.[0]?.title, zoning?.planContext?.records?.[0] ? 'e-Devlet / ilgili belediye' : 'Doğrulanamadı'],
    ['Plan kayıt türü', zoning?.planContext?.records?.[0]?.planType, zoning?.planContext?.records?.[0] ? 'Resmî kamu plan kaydı' : 'Doğrulanamadı'],
    ['Plan kayıt ölçeği', formatRecordScale(zoning?.planContext?.records?.[0]), zoning?.planContext?.records?.[0]?.planScale ? 'Resmî kamu plan kaydında açıkça yazılan ölçek' : 'Doğrulanamadı'],
    ['Kayıt metninde geçen göstergeler', formatRecordIndicators(zoning?.planContext?.records?.[0]?.indicators), zoning?.planContext?.records?.[0] ? 'Resmî kamu plan kayıt metni (güncel hak değildir)' : 'Doğrulanamadı'],
    ['Askı başlangıcı', zoning?.planContext?.records?.[0]?.announcementStart, zoning?.planContext?.records?.[0] ? 'Resmî kamu plan kaydı' : 'Doğrulanamadı'],
    ['Askı bitişi', zoning?.planContext?.records?.[0]?.announcementEnd, zoning?.planContext?.records?.[0] ? 'Resmî kamu plan kaydı' : 'Doğrulanamadı'],
    ['Plan fonksiyonu', fields.landUse, zoningFieldSourceLabel(zoning, 'landUse')],
    ['Net imar parseli alanı', formatArea(fields.netParcelArea), zoningFieldSourceLabel(zoning, 'netParcelArea')],
    ['TAKS', formatRatio(fields.taks), zoningFieldSourceLabel(zoning, 'taks')],
    ['Emsal / KAKS', formatRatio(fields.emsal), zoningFieldSourceLabel(zoning, 'emsal')],
    ['Kat adedi', fields.floors != null ? String(fields.floors) : null, zoningFieldSourceLabel(zoning, 'floors')],
    ['Yençok / Hmax', fields.hmax != null ? formatMeters(fields.hmax) : null, zoningFieldSourceLabel(zoning, 'hmax')],
    ['Yapı nizamı', fields.buildingOrder, zoningFieldSourceLabel(zoning, 'buildingOrder')],
    ['Ön bahçe / yapı yaklaşma', fields.frontSetback != null ? formatMeters(fields.frontSetback) : null, zoningFieldSourceLabel(zoning, 'frontSetback')],
    ['Yan bahçe / yapı yaklaşma', fields.sideSetback != null ? formatMeters(fields.sideSetback) : null, zoningFieldSourceLabel(zoning, 'sideSetback')],
    ['Arka bahçe / yapı yaklaşma', fields.rearSetback != null ? formatMeters(fields.rearSetback) : null, zoningFieldSourceLabel(zoning, 'rearSetback')],
    ['Cepheye / koşula göre çekme mesafeleri', formatSetbackConditions(fields.setbackConditions), zoningFieldSourceLabel(zoning, 'setbackConditions')],
    ['Belgede yazan ön bahçe alanı', formatArea(fields.frontGardenArea), zoningFieldSourceLabel(zoning, 'frontGardenArea')],
    ['Belgede yazan yan bahçe alanı', formatArea(fields.sideGardenArea), zoningFieldSourceLabel(zoning, 'sideGardenArea')],
    ['Belgede yazan arka bahçe alanı', formatArea(fields.rearGardenArea), zoningFieldSourceLabel(zoning, 'rearGardenArea')],
    ['Koşullu yapılaşma değerleri', formatConditionalFields(fields.conditionalFields), zoningFieldSourceLabel(zoning, 'conditionalFields')],
    ['Plan adı', fields.planName, zoningFieldSourceLabel(zoning, 'planName')],
    ['Plan işlem / karar no', fields.planNumber, zoningFieldSourceLabel(zoning, 'planNumber')],
    ['Plan ölçeği', fields.planScale, zoningFieldSourceLabel(zoning, 'planScale')],
    ['Yetkili idare', fields.authority, zoningFieldSourceLabel(zoning, 'authority')]
  ];
  return rows.map(([label, value, source]) => ({ label, value: value ?? null, source }));
}

function buildClaims({ parcel, zoning, environment, metrics, calculationBasis }) {
  const claims = [];
  if (parcel) {
    claims.push({ claim: 'Parsel konumu ve sınırı', value: 'TKGM geometrisi', sourceId: sourceFromParcel(parcel)?.id, confidence: 'source' });
    if (parcel.properties?.area != null || parcel.properties?.areaText) claims.push({ claim: 'Parsel alanı', value: formatArea(parcel.properties?.area ?? parseArea(parcel.properties?.areaText)), sourceId: sourceFromParcel(parcel)?.id, confidence: 'source' });
  }
  const evidenceSource = zoning?.sources?.find((item) => item?.trust === 'user-evidence');
  if (evidenceSource?.documentName) claims.push({ claim: 'Yüklenen resmî imar belgesi', value: evidenceSource.documentName, sourceId: evidenceSource.id, confidence: 'user-evidence' });
  if (evidenceSource?.documentHash) claims.push({ claim: 'Belge bütünlük özeti', value: evidenceSource.documentHash.slice(0, 16), sourceId: evidenceSource.id, confidence: 'document-integrity' });
  if (evidenceSource?.parcelMatchStatus) claims.push({ claim: 'Belge-parsel eşleşmesi', value: evidenceSource.parcelMatchStatus === 'exact' ? 'Ada/parsel metni eşleşti' : evidenceSource.parcelMatchStatus, sourceId: evidenceSource.id, confidence: 'user-evidence' });
  const fieldClaimMap = [
    ['Plan fonksiyonu', zoning?.fields?.landUse, 'landUse'],
    ['Net imar parseli alanı', formatArea(zoning?.fields?.netParcelArea), 'netParcelArea'],
    ['TAKS', formatRatio(zoning?.fields?.taks), 'taks'],
    ['Emsal', formatRatio(zoning?.fields?.emsal), 'emsal'],
    ['Kat adedi', zoning?.fields?.floors, 'floors'],
    ['Yençok / Hmax', zoning?.fields?.hmax != null ? formatMeters(zoning.fields.hmax) : null, 'hmax'],
    ['Yapı nizamı', zoning?.fields?.buildingOrder, 'buildingOrder'],
    ['Ön bahçe / yapı yaklaşma', zoning?.fields?.frontSetback != null ? formatMeters(zoning.fields.frontSetback) : null, 'frontSetback'],
    ['Yan bahçe / yapı yaklaşma', zoning?.fields?.sideSetback != null ? formatMeters(zoning.fields.sideSetback) : null, 'sideSetback'],
    ['Arka bahçe / yapı yaklaşma', zoning?.fields?.rearSetback != null ? formatMeters(zoning.fields.rearSetback) : null, 'rearSetback'],
    ['Cepheye / koşula göre çekme mesafeleri', formatSetbackConditions(zoning?.fields?.setbackConditions), 'setbackConditions'],
    ['Belgede yazan ön bahçe alanı', formatArea(zoning?.fields?.frontGardenArea), 'frontGardenArea'],
    ['Belgede yazan yan bahçe alanı', formatArea(zoning?.fields?.sideGardenArea), 'sideGardenArea'],
    ['Belgede yazan arka bahçe alanı', formatArea(zoning?.fields?.rearGardenArea), 'rearGardenArea'],
    ['Koşullu yapılaşma değerleri', formatConditionalFields(zoning?.fields?.conditionalFields), 'conditionalFields']
  ];
  for (const [claim, value, field] of fieldClaimMap) {
    if (value != null) claims.push({ claim, value: String(value), sourceId: zoningFieldSourceId(zoning, field), confidence: zoning.status });
  }
  if (calculationBasis?.area != null && [metrics.footprint.value, metrics.construction.value].some((value) => value != null)) {
    claims.push({ claim: 'Yapılaşma hesabının alan temeli', value: `${calculationBasis.label}: ${formatArea(calculationBasis.area)}`, sourceId: calculationBasis.netParcelArea != null ? zoningFieldSourceId(zoning, 'netParcelArea') : sourceFromParcel(parcel)?.id, confidence: calculationBasis.netParcelArea != null ? zoning.status : 'source' });
  }
  if (metrics.footprint.value != null) claims.push({ claim: 'Yaklaşık bina oturumu', value: formatArea(metrics.footprint.value), sourceId: 'planlamasyon-calculation', confidence: 'calculated' });
  if (metrics.construction.value != null) claims.push({ claim: 'Yaklaşık toplam inşaat hakkı', value: formatArea(metrics.construction.value), sourceId: 'planlamasyon-calculation', confidence: 'calculated' });
  if (metrics.outside.value != null) claims.push({ claim: 'Teorik taban oturumu dışında kalan alan', value: formatArea(metrics.outside.value), sourceId: 'planlamasyon-calculation', confidence: 'calculated' });
  if (zoning?.planContext?.status === 'available') {
    for (const match of zoning.planContext.matches || []) claims.push({ claim: 'Plan kapsamı', value: match.title || match.shortLabel || 'Kesinleşmiş plan kapsamı', sourceId: match.sourceId, confidence: 'public-information' });
    const metadata = zoning.planContext.metadata || {};
    const metadataSourceId = zoning.planContext.sources?.find((source) => source.kind === 'official-plan-metadata')?.id || zoning.planContext.sources?.[0]?.id;
    for (const [claim, value] of [['Plan adı', metadata.planName], ['Plan ölçeği', metadata.planScale], ['Plan işlem numarası', metadata.planNumber], ['Plan onay tarihi', metadata.planDate], ['Planı yayımlayan idare', metadata.authority]]) {
      if (value) claims.push({ claim, value: String(value), sourceId: metadataSourceId, confidence: 'public-information' });
    }
  }
  if (Array.isArray(zoning?.planContext?.records)) {
    for (const record of zoning.planContext.records.slice(0, 5)) {
      claims.push({ claim: 'Resmî plan / askı kaydı', value: record.title || `${record.block || ''}/${record.parcel || ''} plan kaydı`, sourceId: `plan-record-${record.id}`, confidence: 'public-information' });
      if (record.planScale) claims.push({ claim: 'Plan kayıt ölçeği', value: formatRecordScale(record), sourceId: `plan-record-${record.id}`, confidence: 'public-information' });
      const recordIndicators = formatRecordIndicators(record.indicators);
      if (recordIndicators) claims.push({ claim: 'Plan kayıt metninde geçen göstergeler', value: recordIndicators, sourceId: `plan-record-${record.id}`, confidence: 'record-mention-not-current-right' });
      if (record.announcementStart) claims.push({ claim: 'Askı başlangıcı', value: record.announcementStart, sourceId: `plan-record-${record.id}`, confidence: 'public-information' });
    }
  }
  const municipalServices = Array.isArray(zoning?.providerDiscovery?.municipalServices)
    ? zoning.providerDiscovery.municipalServices
    : zoning?.providerDiscovery?.municipalService ? [zoning.providerDiscovery.municipalService] : [];
  for (const service of municipalServices.slice(0, 4)) {
    claims.push({ claim: 'Yetkili resmî imar sorgu yolu', value: service.title, sourceId: service.id || service.catalogRecordId || service.url, confidence: 'lookup-required' });
  }
  if (zoning?.providerDiscovery?.catalog?.matchCount) {
    claims.push({
      claim: 'Gömülü belediye kataloğu eşleşmesi',
      value: `${zoning.providerDiscovery.catalog.matchCount} resmî hizmet`,
      sourceId: municipalServices[0]?.id || zoning?.providerDiscovery?.sources?.[0]?.id,
      confidence: 'lookup-required'
    });
  }
  if (environment?.status === 'available') claims.push({ claim: 'Yakın çevre noktaları', value: `${environment.items?.length || 0} kayıt`, sourceId: environment.source?.id, confidence: 'source' });
  return claims;
}

function missingFields(fields, allowed, excluded = new Set()) {
  const required = ['landUse', 'taks', 'emsal', 'floors', 'frontSetback', 'sideSetback', 'rearSetback'];
  if (!allowed) return required;
  const conditionTypeByField = { frontSetback: 'front', sideSetback: 'side', rearSetback: 'rear' };
  return required.filter((field) => {
    if (excluded.has(field)) return true;
    if (fields[field] != null && fields[field] !== '') return false;
    const type = conditionTypeByField[field];
    return !type || !fields.setbackConditions?.some((item) => item.type === type && finiteNonNegative(item.value) != null);
  });
}

function buildNextActions(status, missing) {
  const actions = [];
  if (status === 'cadastral-only') actions.push('Açık resmî kaynak taramasında bulunamayan değerleri ilgili belediyenin resmî imar ekranında kontrol edin.', 'Gerekirse güncel imar durumu belgesini alın.', 'Belge yükleme yalnızca otomatik açık kaynaklar sonuç vermediğinde son tamamlama yoludur.');
  if (status === 'partial') actions.push(`Eksik alanları resmî belgeden tamamlayın: ${missing.map(humanField).join(', ')}.`, 'Mimari projeden önce yetkili belediyeden yazılı teyit alın.');
  if (status === 'conflict') actions.push('Çelişen kaynakları planlama uzmanına inceletin.', 'Güncel ve yürürlükte olan plan kararını yetkili idareden yazılı olarak doğrulayın.');
  if (status === 'complete') actions.push('Mimari avan çalışma öncesinde imar durumunu yetkili idareden teyit edin.', 'Ruhsat süreci için mimar ve ilgili mühendislerle çalışın.');
  return actions;
}

function permitRoadmap() {
  return [
    { step: 1, title: 'İmar durumunu doğrula', description: 'Yürürlükteki planı, plan notlarını ve belediye imar durumunu güncel tarihli olarak kontrol edin.' },
    { step: 2, title: 'Gerekli belgeleri hazırla', description: 'Tapu/kadastro, aplikasyon, kot-kesit, zemin ve kurum görüşleri gibi parselinize özel belgeleri tamamlayın.' },
    { step: 3, title: 'Mimari projeyi hazırlat', description: 'Yapılaşma koşulları ve çekme mesafelerine uygun projeyi yetkili mimara hazırlatın.' },
    { step: 4, title: 'Kurum onaylarını al', description: 'Gerekiyorsa altyapı, itfaiye, ulaşım, koruma, tarım, DSİ ve diğer kurum görüşlerini alın.' },
    { step: 5, title: 'Yapı ruhsatına başvur', description: 'Onaylı projeler ve belgelerle yetkili belediye veya idareye ruhsat başvurusu yapın.' }
  ];
}

function sourceFromParcel(parcel) {
  const source = parcel?.source || {};
  return {
    id: 'tkgm-parcel',
    title: source.title || 'TKGM Parsel Sorgu / MEGSİS',
    provider: source.provider || 'Tapu ve Kadastro Genel Müdürlüğü',
    url: source.portalUrl || 'https://parselsorgu.tkgm.gov.tr/',
    kind: 'cadastre',
    trust: 'public-information',
    note: parcel?.usage?.notice || 'Parsel konumu ve temel kadastro bilgileri bilgi amaçlıdır.'
  };
}

function calculationSource(metrics, calculationBasis) {
  if (![metrics.footprint.value, metrics.construction.value, metrics.outside.value].some((value) => value != null)) return null;
  return {
    id: 'planlamasyon-calculation',
    title: 'Planlamasyon Hesap Motoru',
    provider: 'Planlamasyon',
    url: null,
    kind: 'calculation',
    trust: 'calculated',
    note: `Hesaplar ${calculationBasis?.label?.toLocaleLowerCase('tr-TR') || 'doğrulanan parsel alanı'} ile doğrulanmış TAKS/emsal değerlerinden üretilir; teorik sonuçlar ruhsat projesi yerine geçmez.`
  };
}

function dedupeSources(sources) {
  const seen = new Set();
  return sources.filter((source) => {
    const id = source?.id || source?.url || source?.title;
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

function zoningSourceLabel(zoning) {
  if (zoning?.status === 'verified') return zoning.sources?.[0]?.title || 'Doğrulanmış imar sağlayıcısı';
  if (zoning?.status === 'user-evidence') return zoning.sources?.[0]?.title || 'Kullanıcı tarafından eklenen resmî belge';
  if (zoning?.status === 'ai-assisted-official') return zoning.sources?.find((source) => source?.trust === 'ai-assisted-official')?.title || 'Plan AI · açık resmî kaynak okuması';
  if (zoning?.status === 'public-plan-metadata') return zoning.sources?.find((source) => ['official-plan-metadata', 'official-plan-record'].includes(source.kind))?.title || 'Kamuya açık plan / askı kaydı';
  if (zoning?.conflict) return 'Kaynak çelişkisi';
  return 'Doğrulanamadı';
}

function zoningFieldSourceLabel(zoning, field) {
  const source = zoning?.fieldSources?.[field];
  return source?.title || source?.provider || zoningSourceLabel(zoning);
}

function zoningFieldSourceId(zoning, field) {
  return zoning?.fieldSources?.[field]?.id || zoning?.sources?.[0]?.id || null;
}

function calculationFieldExclusionReason(zoning, field) {
  const source = zoning?.fieldSources?.[field];
  if (!source || typeof source !== 'object') return null;
  const parcelMatchStatus = String(source.parcelMatchStatus || '').toLowerCase();
  const confidence = String(source.confidence || source.extractionConfidence || '').toLowerCase();
  if (parcelMatchStatus === 'mismatch') return 'parcel-mismatch';
  if (confidence === 'low') return 'low-confidence';
  return null;
}

function normalizeConditionalFields(value) {
  let input = value;
  if (typeof input === 'string') {
    try { input = JSON.parse(input); } catch { input = {}; }
  }
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  const output = {};
  for (const [field, max] of [['taks', 1], ['emsal', 15], ['floors', 150], ['hmax', 1000]]) {
    if (!Array.isArray(input[field])) continue;
    const items = [];
    const seen = new Set();
    for (const item of input[field].slice(0, 30)) {
      if (!item || typeof item !== 'object') continue;
      const number = Number(item.value);
      if (!Number.isFinite(number) || number < 0 || number > max || (field === 'floors' && !Number.isInteger(number))) continue;
      const qualifier = clean(item.qualifier, 180);
      const key = `${qualifier?.toLocaleLowerCase('tr-TR') || ''}|${number}`;
      if (seen.has(key)) continue;
      seen.add(key);
      items.push({
        field,
        qualifier,
        value: number,
        unit: field === 'floors' ? 'kat' : field === 'hmax' ? 'm' : 'ratio',
        excerpt: clean(item.excerpt, 520),
        confidence: enumValue(item.confidence, ['high', 'medium', 'low']),
        method: clean(item.method, 120),
        sourceTitle: clean(item.sourceTitle, 280),
        sourceUrl: safeHttps(item.sourceUrl),
        documentDate: isoDate(item.documentDate),
        retrievedAt: isoTimestamp(item.retrievedAt),
        parserVersion: clean(item.parserVersion, 80),
        parcelMatchStatus: enumValue(item.parcelMatchStatus, ['exact', 'unverified', 'mismatch'])
      });
    }
    if (items.length) output[field] = items;
  }
  return output;
}

function normalizeSetbackConditions(value) {
  let items = value;
  if (typeof items === 'string') {
    try { items = JSON.parse(items); } catch { items = []; }
  }
  if (!Array.isArray(items)) return [];
  const normalized = [];
  const seen = new Set();
  for (const item of items.slice(0, 80)) {
    if (!item || typeof item !== 'object') continue;
    const type = normalizeSetbackType(item.type);
    const distance = finiteNonNegative(item.value ?? item.distance ?? item.metres ?? item.meters);
    if (!type || distance == null) continue;
    const qualifier = clean(item.qualifier ?? item.frontage ?? item.side ?? item.condition, 160);
    const normalizedItem = {
      type,
      qualifier,
      value: distance,
      unit: 'm',
      excerpt: clean(item.excerpt, 520),
      confidence: enumValue(item.confidence, ['high', 'medium', 'low']),
      method: clean(item.method, 120),
      sourceTitle: clean(item.sourceTitle, 280),
      sourceUrl: safeHttps(item.sourceUrl),
      documentDate: isoDate(item.documentDate),
      retrievedAt: isoTimestamp(item.retrievedAt),
      parserVersion: clean(item.parserVersion, 80),
      parcelMatchStatus: enumValue(item.parcelMatchStatus, ['exact', 'unverified', 'mismatch'])
    };
    const key = `${type}|${qualifier?.toLocaleLowerCase('tr-TR') || ''}|${distance}`;
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(normalizedItem);
  }
  return normalized;
}

function normalizeSetbackType(value) {
  const text = String(value || '').toLocaleLowerCase('tr-TR').trim();
  if (['front', 'ön', 'on'].includes(text)) return 'front';
  if (['side', 'yan', 'sağ', 'sag', 'sol'].includes(text)) return 'side';
  if (['rear', 'arka'].includes(text)) return 'rear';
  return null;
}

function normalizeSetbackScalar(value, conditions, type) {
  const explicit = finiteNonNegative(value);
  const conditionalValues = (conditions || [])
    .filter((item) => item.type === type)
    .map((item) => finiteNonNegative(item.value))
    .filter((item) => item != null);
  const uniqueValues = [...new Set(conditionalValues.map((item) => comparable(item)))];
  if (uniqueValues.length > 1) return null;
  if (explicit != null && conditionalValues.length && comparable(explicit) !== uniqueValues[0]) return null;
  return explicit ?? conditionalValues[0] ?? null;
}

function setbackExplanationItems(fields) {
  const typeDefinitions = [
    ['front', 'ön', fields.frontSetback],
    ['side', 'yan', fields.sideSetback],
    ['rear', 'arka', fields.rearSetback]
  ];
  const items = [];
  for (const [type, label, scalar] of typeDefinitions) {
    const conditions = (fields.setbackConditions || []).filter((item) => item.type === type);
    const mustShowConditions = scalar == null || conditions.length > 1 || conditions.some((item) => item.qualifier);
    if (conditions.length && mustShowConditions) {
      for (const condition of conditions) {
        items.push(`${condition.qualifier ? `${condition.qualifier} için ` : ''}${label} tarafta ${formatMeters(condition.value)}`);
      }
    } else if (scalar != null) {
      items.push(`${label} tarafta ${formatMeters(scalar)}`);
    }
  }
  return items;
}

function formatSetbackConditions(conditions) {
  if (!Array.isArray(conditions) || !conditions.length) return null;
  return conditions.map((item) => {
    const type = ({ front: 'Ön', side: 'Yan', rear: 'Arka' })[item.type] || item.type;
    return `${type}${item.qualifier ? ` · ${item.qualifier}` : ''}: ${formatMeters(item.value)}`;
  }).join(' | ');
}

function formatConditionalFields(fields) {
  if (!fields || typeof fields !== 'object') return null;
  const labels = { taks: 'TAKS', emsal: 'Emsal', floors: 'Kat', hmax: 'Yençok/Hmax' };
  const items = [];
  for (const [field, values] of Object.entries(fields)) {
    for (const item of Array.isArray(values) ? values : []) {
      const value = field === 'floors' ? `${item.value} kat` : field === 'hmax' ? formatMeters(item.value) : formatRatio(item.value);
      items.push(`${labels[field] || field}${item.qualifier ? ` · ${item.qualifier}` : ''}: ${value}`);
    }
  }
  return items.length ? items.join(' | ') : null;
}

function normalizePossibility(value) {
  const text = String(value ?? 'unknown').toLowerCase().trim();
  if (['allowed', 'yes', 'true', 'yapılabilir', 'uygun'].includes(text)) return 'allowed';
  if (['conditional', 'şartlı', 'belirli şartlarla'].includes(text)) return 'conditional';
  if (['prohibited', 'no', 'false', 'yasak', 'uygun değil'].includes(text)) return 'prohibited';
  if (['required', 'gerekli', 'zorunlu'].includes(text)) return 'required';
  return 'unknown';
}

function humanField(field) {
  return ({ landUse: 'plan fonksiyonu', netParcelArea: 'net imar parseli alanı', taks: 'TAKS', emsal: 'emsal', floors: 'kat adedi', hmax: 'Yençok/Hmax', buildingOrder: 'yapı nizamı', frontSetback: 'ön bahçe mesafesi', sideSetback: 'yan bahçe mesafesi', rearSetback: 'arka bahçe mesafesi', setbackConditions: 'cepheye göre çekme mesafeleri', conditionalFields: 'koşullu yapılaşma değerleri', frontGardenArea: 'ön bahçe alanı', sideGardenArea: 'yan bahçe alanı', rearGardenArea: 'arka bahçe alanı' })[field] || field;
}

function formatRecordScale(record) {
  return record?.planScale || null;
}
function formatRecordIndicators(indicators) {
  if (!indicators || typeof indicators !== 'object') return null;
  const values = [];
  if (indicators.taksMentioned != null) values.push(`TAKS ${formatRatio(indicators.taksMentioned)}`);
  if (indicators.emsalMentioned != null) values.push(`Emsal ${formatRatio(indicators.emsalMentioned)}`);
  if (indicators.floorsMentioned != null) values.push(`${indicators.floorsMentioned} kat`);
  if (indicators.hmaxMentioned != null) values.push(`Yençok/Hmax ${formatMeters(indicators.hmaxMentioned)}`);
  if (Array.isArray(indicators.landUsesMentioned) && indicators.landUsesMentioned.length) values.push(indicators.landUsesMentioned.join(', '));
  return values.length ? values.join(' · ') : null;
}
function metric(value, display, label, basis) { return { value: value ?? null, display: display || 'Doğrulanamadı', label, basis }; }
function formatArea(value) { return value == null ? null : `${new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 2 }).format(Number(value))} m²`; }
function formatMeters(value) { return `${new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 2 }).format(Number(value))} m`; }
function formatRatio(value) { return value == null ? null : new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 3 }).format(Number(value)); }
function round2(value) { return Math.round((Number(value) + Number.EPSILON) * 100) / 100; }
function parseArea(value) { return finitePositive(String(value ?? '').replace(/\./g, '').replace(',', '.').replace(/[^0-9.+-]/g, '')); }
function isBlankNumeric(value) { return value == null || (typeof value === 'string' && value.trim() === ''); }
function finitePositive(value) { if (isBlankNumeric(value)) return null; const number = Number(value); return Number.isFinite(number) && number > 0 ? number : null; }
function finiteNonNegative(value) { if (isBlankNumeric(value)) return null; const number = Number(value); return Number.isFinite(number) && number >= 0 ? number : null; }
function integer(value, min, max) { if (isBlankNumeric(value)) return null; const number = Number(value); return Number.isInteger(number) && number >= min && number <= max ? number : null; }
function ratio(value, max) { if (isBlankNumeric(value)) return null; const number = Number(String(value).replace(',', '.')); return Number.isFinite(number) && number >= 0 && number <= max ? number : null; }
function booleanOrNull(value) { if (value === true || value === 'true' || value === 1 || value === '1') return true; if (value === false || value === 'false' || value === 0 || value === '0') return false; return null; }
function enumValue(value, allowed) { const text = String(value ?? '').trim(); return allowed.includes(text) ? text : null; }
function isoDate(value) { if (!value) return null; const date = new Date(value); return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10); }
function isoTimestamp(value) { if (!value) return null; const date = new Date(value); return Number.isNaN(date.getTime()) ? null : date.toISOString(); }
function safeHttps(value) { if (!value) return null; try { const url = new URL(String(value)); return url.protocol === 'https:' ? url.toString() : null; } catch { return null; } }
function clean(value, max = 500) { if (value == null) return null; const text = String(value).replace(/[\u0000-\u001f<>]/g, ' ').replace(/\s+/g, ' ').trim(); return text ? text.slice(0, max) : null; }
function normalizeStringList(value, maxItems, maxLength) { const items = Array.isArray(value) ? value : String(value || '').split(/\r?\n|;/); return items.map((item) => clean(item, maxLength)).filter(Boolean).slice(0, maxItems); }
function comparable(value) { if (value == null || value === '') return null; if (typeof value === 'number') return String(Math.round(value * 10000) / 10000); return String(value).toLocaleLowerCase('tr-TR').replace(/\s+/g, ' ').trim(); }
