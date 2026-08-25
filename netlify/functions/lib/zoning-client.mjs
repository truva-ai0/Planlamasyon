import { compareZoningRecords, normalizeZoningFields } from './analysis-core.mjs';
import { discoverPublicPlanContext } from './plan-context-client.mjs';
import { discoverPublicPlanRecords } from './plan-record-client.mjs';
import { discoverMunicipalityProvider } from './municipality-provider.mjs';
import { discoverOpenOfficialZoning } from './open-official-source-client.mjs';
import { enhanceZoningWithPlanAI } from './plan-ai-client.mjs';

const CACHE = globalThis.__PLANLAMASYON_ZONING_CACHE__ || new Map();
globalThis.__PLANLAMASYON_ZONING_CACHE__ = CACHE;

const EVIDENCE_BOUND_FIELDS = [
  'landUse', 'netParcelArea', 'taks', 'emsal', 'floors', 'hmax', 'buildingOrder',
  'frontSetback', 'sideSetback', 'rearSetback', 'frontGardenArea', 'sideGardenArea', 'rearGardenArea'
];

/**
 * v3.8 belge okuyucusunun alan kanıtı, çıkarılan normalize değerini de taşır.
 * Kullanıcı formda değeri değiştirirse eski alıntı/yüksek güven etiketi yeni değere
 * uygulanmaz. Eski sürüm kayıtlarında `fieldEvidence.value` bulunmadığı için bu
 * kayıtlar geriye dönük olarak korunur ve kullanıcı belgesi sınıfında kalır.
 */
export function bindUserEvidenceToExtraction(input = {}) {
  if (!input || typeof input !== 'object') return { evidence: input, mismatchedFields: [], legacyUnboundFields: [] };
  const nested = input.fields && typeof input.fields === 'object' && !Array.isArray(input.fields);
  const values = nested ? { ...input.fields } : { ...input };
  const originalEvidence = input.fieldEvidence && typeof input.fieldEvidence === 'object' && !Array.isArray(input.fieldEvidence)
    ? input.fieldEvidence
    : {};
  const fieldEvidence = Object.fromEntries(Object.entries(originalEvidence).map(([key, item]) => [key, item && typeof item === 'object' ? { ...item } : item]));
  const mismatchedFields = [];
  const legacyUnboundFields = [];

  for (const field of EVIDENCE_BOUND_FIELDS) {
    if (values[field] == null || values[field] === '') continue;
    const proof = fieldEvidence[field];
    if (!proof || typeof proof !== 'object' || !Object.prototype.hasOwnProperty.call(proof, 'value')) {
      legacyUnboundFields.push(field);
      continue;
    }
    if (boundEvidenceValueEquals(field, values[field], proof.value)) {
      proof.bindingStatus = 'exact';
      continue;
    }
    mismatchedFields.push(field);
    values[field] = null;
    fieldEvidence[field] = {
      ...proof,
      confidence: 'low',
      bindingStatus: 'mismatch',
      method: 'evidence-value-mismatch'
    };
  }

  const evidence = nested
    ? { ...input, fields: values, fieldEvidence }
    : { ...values, fieldEvidence };
  evidence.evidenceBinding = {
    version: '3.8.0',
    status: mismatchedFields.length ? 'mismatch' : legacyUnboundFields.length ? 'legacy-unbound' : 'exact',
    mismatchedFields,
    legacyUnboundFields
  };
  return { evidence, mismatchedFields, legacyUnboundFields };
}

function boundEvidenceValueEquals(field, current, extracted) {
  if (['netParcelArea', 'taks', 'emsal', 'floors', 'hmax', 'frontSetback', 'sideSetback', 'rearSetback', 'frontGardenArea', 'sideGardenArea', 'rearGardenArea'].includes(field)) {
    const left = Number(String(current).trim().replace(',', '.'));
    const right = Number(String(extracted).trim().replace(',', '.'));
    return Number.isFinite(left) && Number.isFinite(right) && Math.abs(left - right) <= 1e-9;
  }
  return String(current).toLocaleLowerCase('tr-TR').replace(/\s+/g, ' ').trim()
    === String(extracted).toLocaleLowerCase('tr-TR').replace(/\s+/g, ' ').trim();
}

export async function resolveZoning({ parcel, query, evidence, env = process.env, fetchImpl = globalThis.fetch }) {
  const key = parcelKey(parcel, query);
  const records = [];
  const diagnostics = [];
  const fastEnv = withDefaultEnv(env, {
    ZONING_CONNECTOR_TIMEOUT_MS: 4200,
    PUBLIC_PLAN_COVERAGE_TIMEOUT_MS: 3200,
    PUBLIC_PLAN_RECORD_TOTAL_TIMEOUT_MS: 3800,
    PUBLIC_PLAN_RECORD_TIMEOUT_MS: 1700,
    MUNICIPALITY_EDEVLET_DISCOVERY_TIMEOUT_MS: 1500,
    OPEN_OFFICIAL_SOURCE_MAX_CANDIDATES: 12,
    OPEN_OFFICIAL_SOURCE_TIMEOUT_MS: 2600,
    OPEN_OFFICIAL_SOURCE_TOTAL_BUDGET_MS: 5600,
    OPEN_OFFICIAL_SOURCE_CONCURRENCY: 3,
    PLAN_AI_MAX_SOURCES: 3,
    PLAN_AI_SOURCE_TIMEOUT_MS: 1500,
    PLAN_AI_EVIDENCE_TOTAL_BUDGET_MS: 2600,
    PLAN_AI_TIMEOUT_MS: 6000,
    PLAN_AI_MAX_TOKENS: 1800
  });
  const planContextPromise = settleWithin(
    discoverPublicPlanContext({ geometry: parcel?.geometry, env: fastEnv, fetchImpl }),
    9000,
    () => unavailablePlanContext('Plan kapsamı servisi süre sınırı içinde yanıt vermedi.')
  );
  const publicPlanRecordsPromise = settleWithin(
    discoverPublicPlanRecords({ parcel, query, env: fastEnv, fetchImpl }),
    10000,
    () => unavailablePlanRecords('Resmî plan kayıtları süre sınırı içinde yanıt vermedi.')
  );
  const providerDiscoveryPromise = settleWithin(
    discoverMunicipalityProvider({ parcel, query, env: fastEnv, fetchImpl }),
    5000,
    () => unavailableProviderDiscovery('Belediye kaynak keşfi süre sınırı içinde tamamlanamadı.')
  );

  const registryRecord = findRegistryRecord(fastEnv.VERIFIED_ZONING_JSON, key, parcel, query);
  if (registryRecord) records.push(normalizeProviderRecord(registryRecord, {
    id: 'verified-registry', title: 'Planlamasyon Doğrulanmış İmar Kaydı', provider: registryRecord.authority || 'Yetkili veri kaydı', trust: 'verified',
    sourceClass: 'authorized-adapter', accessMode: 'verified-registry', automationPolicy: 'authorized-automatic'
  }));

  const connectors = buildConnectors(fastEnv, parcel, query);
  const configuration = {
    automaticZoningConfigured: Boolean(registryRecord || connectors.length),
    connectorIds: connectors.map((connector) => connector.id),
    publicPlanCoverageEnabled: String(fastEnv.PUBLIC_PLAN_COVERAGE_ENABLED ?? 'true').toLowerCase() === 'true'
  };
  if (connectors.length) {
    const connectorResults = await Promise.allSettled(connectors.map((connector) => settleWithin(fetchConnector(connector, { parcel, query }, fetchImpl, fastEnv), 8000, () => null)));
    connectorResults.forEach((result, index) => {
      if (result.status === 'fulfilled' && result.value) records.push(result.value);
      else if (result.status === 'rejected') diagnostics.push({ connector: connectors[index].id, message: safeMessage(result.reason) });
    });
  }

  if (evidence?.confirmed === true) {
    const evidenceBinding = bindUserEvidenceToExtraction(evidence);
    const boundedEvidence = evidenceBinding.evidence;
    const parcelMatchStatus = String(evidence.parcelMatchStatus || '').toLowerCase();
    const documentType = String(evidence.documentType || '').toLowerCase();
    const parcelAccepted = parcelMatchStatus === 'exact' || (parcelMatchStatus === 'unverified' && evidence.parcelConfirmed === true) || (!parcelMatchStatus && evidence.parcelConfirmed !== false);
    const documentEligible = !['plan-announcement', 'public-plan-record'].includes(documentType);
    if (parcelMatchStatus === 'mismatch') diagnostics.push({ connector: 'user-official-document', message: 'Yüklenen belge ada/parseli sorguyla eşleşmediği için uygulanmadı.' });
    else if (!parcelAccepted) diagnostics.push({ connector: 'user-official-document', message: 'Yüklenen belgenin bu parsele ait olduğu onaylanmadığı için uygulanmadı.' });
    else if (!documentEligible) diagnostics.push({ connector: 'user-official-document', message: 'Tarihsel plan/askı kaydı güncel yapılaşma hakkı olarak uygulanmadı.' });
    else {
      if (evidenceBinding.mismatchedFields.length) {
        diagnostics.push({
          connector: 'user-official-document',
          message: `Belge okumasından sonra değiştirilen ${evidenceBinding.mismatchedFields.join(', ')} alanları eski otomatik kanıtla eşleşmediği için hesapta kullanılmadı.`
        });
      }
      records.push(normalizeProviderRecord(boundedEvidence, {
        id: evidence.documentHash ? `user-official-document-${String(evidence.documentHash).slice(0, 16)}` : 'user-official-document',
        title: evidence.sourceTitle || evidence.planName || 'Kullanıcının eklediği resmî imar belgesi',
        provider: evidence.authority || 'Belgeyi düzenleyen idare',
        trust: 'user-evidence',
        sourceClass: 'user-official-document',
        accessMode: 'user-upload',
        automationPolicy: 'user-confirmed-document',
        url: evidence.sourceUrl || null,
        note: evidence.parserVersion
          ? `Belge Planlamasyon ${evidence.parserVersion} okuma motoruyla tarandı ve kullanıcı tarafından kontrol edilerek onaylandı. Ada/parsel durumu: ${parcelMatchStatus || 'kullanıcı onayı'}. Ruhsat öncesinde yetkili idare teyidi gerekir.`
          : 'Değerler kullanıcı tarafından resmî belgeden girildi; Planlamasyon belge güncelliğini bağımsız olarak doğrulamaz.'
      }));
    }
  }

  const providerDiscovery = await providerDiscoveryPromise;
  const primaryMunicipalService = providerDiscovery?.municipalService || providerDiscovery?.municipalServices?.[0] || null;
  const primaryRequiresManualUse = providerDiscovery?.status === 'manual-only'
    || primaryMunicipalService?.status === 'manual-only'
    || primaryMunicipalService?.accessMode === 'manual-only';
  const manualOnlyWithoutConnector = primaryRequiresManualUse
    && Number(providerDiscovery?.automaticConnectorCount || 0) === 0
    && !(providerDiscovery?.actions || []).some((item) => item?.automatedQueryAllowed === true || item?.accessMode === 'automatic-adapter');
  const openSourceScanPromise = manualOnlyWithoutConnector
    ? Promise.resolve(manualOnlySourceScan(providerDiscovery))
    : settleWithin(
      discoverOpenOfficialZoning({ parcel, query, providerDiscovery, env: fastEnv, fetchImpl }),
      7_000,
      () => incompleteSourceScan('Açık resmî kaynak taraması süre sınırına ulaştı; bulunan diğer bilgiler gösteriliyor.')
    );
  const [basePlanContext, publicPlanRecords, openSourceScan] = await Promise.all([
    planContextPromise,
    publicPlanRecordsPromise,
    openSourceScanPromise
  ]);
  const planContext = mergePlanContext(basePlanContext, publicPlanRecords);

  // Sağlayıcı keşfi tamamlanır tamamlanmaz izinli açık kaynak taraması, plan metaverisiyle
  // paralel yürür. Manuel portallara hiçbir otomatik istek yapılmaz.
  const planAiAutoEnabled = String(fastEnv.PLAN_AI_AUTO_ENABLED ?? 'false').toLowerCase() === 'true';
  const planAiResult = planAiAutoEnabled
    ? await settleWithin(
      enhanceZoningWithPlanAI({ parcel, query, providerDiscovery, planContext, openSourceScan, env: fastEnv, fetchImpl }),
      10_000,
      () => unavailablePlanAi(fastEnv, 'Plan AI süre sınırı içinde yanıt vermedi; diğer resmî kaynak sonuçları gösteriliyor.')
    )
    : unavailablePlanAi(fastEnv, 'Hızlı ilk sonuç için Plan AI otomatik beklenmedi. İsterseniz Plan AI panelinden mevcut sonucu ayrıca açıklatabilirsiniz.');
  if (Array.isArray(openSourceScan?.records)) records.push(...openSourceScan.records);
  if (Array.isArray(openSourceScan?.diagnostics)) diagnostics.push(...openSourceScan.diagnostics);
  if (Array.isArray(planContext?.diagnostics)) diagnostics.push(...planContext.diagnostics);
  if (Array.isArray(providerDiscovery?.diagnostics)) diagnostics.push(...providerDiscovery.diagnostics);
  configuration.nationalProviderDiscoveryEnabled = true;
  configuration.municipalityProviderStatus = providerDiscovery?.status || 'unavailable';
  configuration.municipalityConnectorCount = providerDiscovery?.automaticConnectorCount || 0;
  configuration.embeddedMunicipalityCatalog = Boolean(providerDiscovery?.catalog?.embedded);
  configuration.embeddedMunicipalityCatalogRecords = Number(providerDiscovery?.catalog?.recordCount || 0);
  configuration.embeddedMunicipalityCatalogMatches = Number(providerDiscovery?.catalog?.matchCount || 0);
  configuration.municipalityResultCapability = providerDiscovery?.resultCapability || 'official-routing-only';
  configuration.publicPlanMetadataAvailable = Boolean(planContext?.metadata && Object.keys(planContext.metadata).length);
  configuration.publicPlanRecordDiscoveryEnabled = String(fastEnv.PUBLIC_PLAN_RECORD_DISCOVERY_ENABLED ?? 'true').toLowerCase() === 'true';
  configuration.publicPlanRecordCount = Number(planContext?.records?.length || 0);
  configuration.embeddedPublicPlanRecordCount = Number(planContext?.publicRecords?.embeddedCount || 0);
  configuration.openOfficialSourceScanEnabled = true;
  configuration.openOfficialSourceScanExhausted = Boolean(openSourceScan?.exhausted);
  configuration.openOfficialSourceScanIncomplete = openSourceScan?.status === 'incomplete';
  configuration.openOfficialSourceScanBudgetLimited = Boolean(openSourceScan?.budgetLimited);
  configuration.openOfficialSourceAttemptCount = Number(openSourceScan?.attemptedCount || 0);
  configuration.openOfficialSourceReachableCount = Number(openSourceScan?.reachableCount || 0);
  configuration.openOfficialSourceFoundRecordCount = Number(openSourceScan?.foundRecordCount || 0);
  configuration.openOfficialSourceFoundFieldCount = Number(openSourceScan?.foundFieldCount || 0);

  const planAi = planAiResult || unavailablePlanAi(fastEnv, 'Plan AI sonucu alınamadı.');
  if (planAi?.record) records.push(planAi.record);
  configuration.planAiAutoEnabled = planAiAutoEnabled;
  configuration.planAiEnabled = Boolean(planAi?.enabled);
  configuration.planAiConfigured = Boolean(planAi?.configured);
  configuration.planAiStatus = planAi?.status || 'unavailable';
  configuration.planAiModel = planAi?.model || null;
  configuration.planAiEvidenceCount = Number(planAi?.evidenceCount || 0);
  configuration.planAiEvidenceBackedFieldCount = Number(planAi?.evidenceBackedFields?.length || 0);
  configuration.boundedAnalysis = true;
  configuration.boundedAnalysisVersion = '3.8.0';

  const publicPlanRecord = buildPublicPlanMetadataRecord(planContext);
  if (publicPlanRecord) records.push(publicPlanRecord);

  const usable = records.filter((record) => record && hasAnyZoningField(record.fields));
  if (!usable.length) {
    const manualOnly = shouldUseManualOnlyStatus(providerDiscovery);
    configuration.manualOnly = manualOnly;
    return {
      status: manualOnly ? 'manual-only' : 'unavailable',
      manualOnly,
      conflict: false,
      fields: normalizeZoningFields({}),
      sources: dedupeSources([...officialFallbackSources(parcel, query, providerDiscovery), ...(openSourceScan?.sources || []), ...(providerDiscovery?.sources || []), ...(planContext?.sources || [])]),
      sourceScan: publicSourceScan(openSourceScan),
      planAi,
      planContext,
      publicPlanRecords,
      providerDiscovery,
      configuration,
      diagnostics,
      message: openSourceScan?.exhausted
        ? `${openSourceScan.attemptedCount || 0} e-Devletsiz açık resmî kaynak sırayla denendi. ${planContext?.records?.length
          ? `Ada-parsel ile eşleşen ${planContext.records.length} resmî plan/askı kaydı bulundu; ancak bu kayıt güncel TAKS, emsal, kat ve ruhsat hakkı değildir.`
          : planContext?.coverageStatus === 'available'
            ? 'Kesinleşmiş plan kapsamı bulundu; fakat güncel yapılaşma değerleri açık kaynaklardan alınamadı.'
            : manualOnly
              ? 'Otomatik okunabilen güncel yapılaşma değeri bulunamadı; bu parsel için resmî imar portalında manuel sorgu gerekir.'
              : 'Güncel TAKS, emsal, kat veya çekme mesafesi veren açık bir sonuç bulunamadı.'}`
        : 'Açık resmî kaynak taraması tamamlanamadığı için yapılaşma hesabı üretilemedi.'
    };
  }

  const comparison = compareZoningRecords(usable);
  if (comparison.conflict) {
    return {
      status: 'conflict',
      conflict: true,
      conflictFields: comparison.fields,
      fields: normalizeZoningFields({}),
      sources: dedupeSources([...usable.map((record) => record.source), ...(openSourceScan?.sources || []), ...(providerDiscovery?.sources || []), ...(planContext?.sources || [])]),
      sourceScan: publicSourceScan(openSourceScan),
      planAi,
      planContext,
      publicPlanRecords,
      providerDiscovery,
      configuration,
      diagnostics,
      message: 'İmar kaynakları birbiriyle çeliştiği için otomatik hesaplama durduruldu.'
    };
  }

  const selected = selectBestRecord(usable);
  const merged = mergeComplementaryZoningRecords(usable, selected);
  const selectedStatus = selected.source.trust === 'user-evidence'
    ? 'user-evidence'
    : selected.source.trust === 'verified'
      ? 'verified'
      : selected.source.trust === 'ai-assisted-official'
        ? 'ai-assisted-official'
        : 'public-plan-metadata';
  const manualOnly = selectedStatus === 'public-plan-metadata' && shouldUseManualOnlyStatus(providerDiscovery);
  configuration.manualOnly = manualOnly;
  if (merged.conflictFields.length) diagnostics.push({
    connector: 'zoning-safe-merge',
    message: `Tamamlayıcı kaynaklarda birleştirilemeyen alanlar: ${merged.conflictFields.join(', ')}.`
  });
  return {
    status: selectedStatus,
    manualOnly,
    conflict: false,
    fields: merged.fields,
    fieldSources: merged.fieldSources,
    selectedSource: selected.source,
    sources: dedupeSources([selected.source, ...usable.map((record) => record.source), ...(openSourceScan?.sources || []), ...(providerDiscovery?.sources || []), ...(planContext?.sources || [])]),
    sourceScan: publicSourceScan(openSourceScan),
    planAi,
    planContext,
    publicPlanRecords,
    providerDiscovery,
    configuration,
    diagnostics,
    message: selected.message || (selectedStatus === 'public-plan-metadata'
      ? 'Kamuya açık plan metaverisi bulundu; yapılaşma hakları için yetkili imar verisi ayrıca gereklidir.'
      : null)
  };
}


function publicSourceScan(scan = {}) {
  if (!scan || typeof scan !== 'object') return scan;
  const { aiEvidence, ...publicScan } = scan;
  return publicScan;
}

function mergePlanContext(base = {}, publicRecords = {}) {
  const records = Array.isArray(publicRecords?.records) ? publicRecords.records : [];
  // Askı/ilan kayıtları tarihsel kanıttır; güncel plan adı, ölçek veya yapılaşma
  // koşulu gibi davranmamalıdır. Güncel plan metaverisi yalnızca plan katmanı
  // sağlayıcısından gelirse ana imar özetine taşınır.
  const metadata = base?.metadata && typeof base.metadata === 'object' ? base.metadata : {};
  const sources = dedupeSources([...(base?.sources || []), ...(publicRecords?.sources || [])]);
  const diagnostics = [...(base?.diagnostics || []), ...(publicRecords?.diagnostics || [])].slice(0, 24);
  const coverageStatus = base?.status || 'unavailable';
  const available = coverageStatus === 'available' || records.length > 0;
  return {
    ...base,
    status: available ? 'available' : coverageStatus || publicRecords?.status || 'unavailable',
    coverageStatus,
    matches: Array.isArray(base?.matches) ? base.matches : [],
    metadata,
    sources,
    diagnostics,
    records,
    publicRecords,
    message: records.length
      ? `${coverageStatus === 'available' ? `${base.message || 'Kamu plan kapsamı bulundu.'} ` : ''}${publicRecords.message || `${records.length} resmî plan kaydı bulundu.`}`.trim()
      : base?.message || publicRecords?.message || 'Kamu plan kaydı alınamadı.'
  };
}

function buildPublicPlanMetadataRecord(planContext) {
  const metadata = planContext?.metadata || {};
  if (!Object.keys(metadata).some((key) => metadata[key] != null && metadata[key] !== '')) return null;
  const fields = normalizeZoningFields({
    ...(planContext?.zoningFields || {}),
    planName: metadata.planName,
    planNumber: metadata.planNumber,
    planScale: metadata.planScale,
    planDate: metadata.planDate,
    authority: metadata.authority
  });
  if (!hasAnyZoningField(fields)) return null;
  const metadataSource = (planContext?.sources || []).find((source) => source.kind === 'official-plan-metadata') || planContext?.sources?.[0];
  return {
    fields,
    source: {
      id: 'eplan-public-metadata',
      title: metadata.planName || metadataSource?.title || 'Kamuya Açık e-Plan / TUCBS Plan Metaverisi',
      provider: metadata.authority || metadataSource?.provider || 'Çevre, Şehircilik ve İklim Değişikliği Bakanlığı / TUCBS',
      url: metadataSource?.url || 'https://tucbs.gov.tr/',
      kind: 'official-plan-metadata',
      trust: hasActionableFields(fields) ? 'verified' : 'public-information',
      sourceClass: 'open-machine-readable',
      accessMode: 'open-plan-metadata',
      automationPolicy: 'read-only',
      dataClaim: hasActionableFields(fields) ? 'read-and-location-matched' : 'metadata-only',
      note: hasActionableFields(fields)
        ? 'Kamuya açık resmî e-Plan/TUCBS katmanından yapılaşma öznitelikleri otomatik okundu.'
        : 'Plan adı, ölçek, işlem numarası, tarih veya yetkili idare gibi açık plan metaverileri kullanıldı. Bu kayıt TAKS, emsal, kat veya ruhsat hakkı değildir.',
      documentDate: metadata.planDate || null,
      retrievedAt: new Date().toISOString()
    },
    message: hasActionableFields(fields) ? 'Kamuya açık resmî plan katmanında yapılaşma koşulu bulundu.' : 'Kamuya açık plan metaverisi bulundu.'
  };
}

function buildConnectors(env, parcel, query) {
  const connectors = [];
  const zoningProviderUrl = safeConnectorUrl(env.PLANLAMASYON_ZONING_API_URL, env);
  if (zoningProviderUrl) connectors.push({
    id: 'planlamasyon-zoning-provider',
    url: zoningProviderUrl,
    token: env.PLANLAMASYON_ZONING_API_TOKEN,
    title: 'Planlamasyon İmar Veri Sağlayıcısı',
    provider: 'Yapılandırılmış imar servisi',
    trust: 'verified',
    sourceClass: 'authorized-adapter', accessMode: 'automatic-adapter', automationPolicy: 'authorized-automatic'
  });
  const eplanAdapterUrl = safeConnectorUrl(env.EPLAN_ADAPTER_URL, env);
  if (eplanAdapterUrl) connectors.push({
    id: 'eplan-adapter',
    url: eplanAdapterUrl,
    token: env.EPLAN_ADAPTER_TOKEN,
    title: 'e-Plan Entegrasyon Adaptörü',
    provider: 'e-Plan / yetkili adaptör',
    trust: 'verified',
    sourceClass: 'authorized-adapter', accessMode: 'automatic-adapter', automationPolicy: 'authorized-automatic'
  });

  const configured = parseJson(env.MUNICIPALITY_CONNECTORS_JSON, []);
  const municipalityConnectors = Array.isArray(configured) ? configured : Array.isArray(configured?.connectors) ? configured.connectors : [];
  for (const connector of municipalityConnectors) {
    if (!connector?.url) continue;
    if (connector.authorized !== true || connector.automatedQueryAllowed !== true) continue;
    if (!matchesLocation(connector, parcel, query)) continue;
    const connectorUrl = safeConnectorUrl(connector.url, env);
    if (!connectorUrl) continue;
    connectors.push({
      id: clean(connector.id, 120) || `municipality-${connectors.length + 1}`,
      url: connectorUrl,
      token: connector.tokenEnv ? env[connector.tokenEnv] : connector.token,
      title: clean(connector.title, 240) || 'Belediye İmar Veri Servisi',
      provider: clean(connector.provider, 240) || clean(connector.authority, 240) || 'İlgili belediye',
      trust: 'verified',
      sourceClass: 'authorized-adapter',
      accessMode: 'automatic-adapter',
      automationPolicy: 'authorized-automatic',
      method: String(connector.method || 'POST').toUpperCase(),
      priority: Number.isFinite(Number(connector.priority)) ? Number(connector.priority) : 0
    });
  }
  return connectors.sort((a, b) => b.priority - a.priority).slice(0, 8);
}

async function fetchConnector(connector, payload, fetchImpl, env) {
  if (typeof fetchImpl !== 'function') throw new Error('Fetch desteği bulunmuyor.');
  const url = allowedConnectorUrl(connector.url, env);
  const timeoutMs = clampInt(env.ZONING_CONNECTOR_TIMEOUT_MS, 2000, 45000, 12000);
  const cacheKey = `${connector.id}:${parcelKey(payload.parcel, payload.query)}`;
  const cacheDisabled = String(env.ZONING_CONNECTOR_CACHE_DISABLED ?? 'false').toLowerCase() === 'true';
  const cached = cacheDisabled ? null : CACHE.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  try {
    const method = connector.method === 'GET' ? 'GET' : 'POST';
    const requestUrl = new URL(url);
    if (method === 'GET') {
      const p = payload.parcel?.properties || {};
      requestUrl.searchParams.set('province', p.province || payload.query?.province || '');
      requestUrl.searchParams.set('district', p.district || payload.query?.district || '');
      requestUrl.searchParams.set('neighbourhood', p.neighbourhood || payload.query?.neighbourhood || '');
      requestUrl.searchParams.set('neighbourhoodId', p.neighbourhoodId || payload.query?.neighbourhoodId || '');
      requestUrl.searchParams.set('block', p.block || payload.query?.block || '');
      requestUrl.searchParams.set('parcel', p.parcel || payload.query?.parcel || '');
    }
    const response = await fetchConnectorRequest(requestUrl, {
      method,
      headers: {
        Accept: 'application/json',
        ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}),
        ...(connector.token ? { Authorization: `Bearer ${String(connector.token).trim()}` } : {})
      },
      body: method === 'POST' ? JSON.stringify({
        parcel: sanitizeParcelPayload(payload.parcel),
        query: sanitizeQuery(payload.query),
        requestedFields: ['landUse', 'taks', 'emsal', 'floors', 'hmax', 'buildingOrder', 'netParcelArea', 'setbacks', 'setbackConditions', 'conditionalFields', 'frontGardenArea', 'sideGardenArea', 'rearGardenArea', 'planNotes', 'allowances', 'constraints']
      }) : undefined
    }, timeoutMs, fetchImpl);
    if (response.status === 404 || response.status === 204) return null;
    if (!response.ok) throw new Error(`${connector.title} ${response.status} yanıtı verdi.`);
    const responseText = await response.text();
    if (responseText.length > 2_000_000) throw new Error(`${connector.title} güvenli yanıt sınırını aştı.`);
    let json;
    try { json = JSON.parse(responseText); } catch { throw new Error(`${connector.title} geçerli JSON döndürmedi.`); }
    const data = json?.data ?? json?.result ?? json;
    if (!data || data.found === false) return null;
    const record = normalizeProviderRecord(data, connector);
    if (!cacheDisabled) {
      CACHE.set(cacheKey, { value: record, expiresAt: Date.now() + 15 * 60 * 1000 });
      trimCache();
    }
    return record;
  } catch (error) {
    if (error?.name === 'AbortError' || /zaman aşım/i.test(error?.message || '')) throw new Error(`${connector.title} zaman aşımına uğradı.`);
    throw error;
  }
}

function normalizeProviderRecord(input, sourceDefaults) {
  const data = input?.fields || input?.zoning || input;
  const fields = normalizeZoningFields(data || {});
  const sourceInput = input?.source || {};
  const source = {
    id: clean(sourceInput.id || sourceDefaults.id, 140),
    title: clean(sourceInput.title || input?.sourceTitle || sourceDefaults.title, 280),
    provider: clean(sourceInput.provider || input?.authority || sourceDefaults.provider, 240),
    url: safeUrl(sourceInput.url || input?.sourceUrl || sourceDefaults.url),
    kind: 'zoning',
    trust: sourceDefaults.trust,
    note: clean(sourceInput.note || input?.note || sourceDefaults.note, 1000),
    documentDate: clean(input?.documentDate || sourceInput.documentDate || input?.planDate, 40),
    documentName: clean(input?.documentName || sourceInput.documentName, 260),
    documentHash: clean(input?.documentHash || sourceInput.documentHash, 80),
    documentHashKind: clean(input?.documentHashKind || sourceInput.documentHashKind, 80),
    parserVersion: clean(input?.parserVersion || sourceInput.parserVersion, 40),
    extractionConfidence: clean(input?.extractionConfidence || sourceInput.extractionConfidence || sourceInput.confidence, 40),
    parcelMatchStatus: clean(input?.parcelMatchStatus || sourceInput.parcelMatchStatus, 40),
    fieldEvidence: input?.fieldEvidence && typeof input.fieldEvidence === 'object'
      ? input.fieldEvidence
      : sourceInput.fieldEvidence && typeof sourceInput.fieldEvidence === 'object' ? sourceInput.fieldEvidence : {},
    retrievedAt: clean(input?.retrievedAt || sourceInput.retrievedAt, 40) || new Date().toISOString(),
    sourceLastModified: clean(input?.sourceLastModified || sourceInput.sourceLastModified, 40),
    sourceVerification: clean(input?.sourceVerification || sourceInput.sourceVerification, 80),
    evidenceOrigin: clean(input?.evidenceOrigin || sourceInput.evidenceOrigin, 80),
    verifiedAt: clean(input?.verifiedAt || sourceInput.verifiedAt, 40),
    sourceClass: clean(sourceDefaults.sourceClass || sourceInput.sourceClass, 80),
    accessMode: clean(sourceDefaults.accessMode || sourceInput.accessMode, 80),
    automationPolicy: clean(sourceDefaults.automationPolicy || sourceInput.automationPolicy, 80),
    dataClaim: clean(sourceInput.dataClaim || sourceDefaults.dataClaim, 80),
    retrievalMode: clean(sourceInput.retrievalMode || input?.retrievalMode, 80),
    scanVersion: clean(sourceInput.scanVersion || input?.scanVersion, 40)
  };
  return { fields, source, message: clean(input?.message, 600) };
}

function withDefaultEnv(env, defaults) {
  return { ...defaults, ...(env && typeof env === 'object' ? env : {}) };
}

async function settleWithin(promise, timeoutMs, fallbackFactory) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve(promise).catch((error) => fallbackFactory(error)),
      new Promise((resolve) => { timer = setTimeout(() => resolve(fallbackFactory(codedTimeout())), timeoutMs); })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function codedTimeout() {
  const error = new Error('Süre sınırı aşıldı.');
  error.code = 'SOURCE_TIMEOUT';
  return error;
}

function unavailablePlanContext(message) {
  return { status: 'unavailable', coverageStatus: 'unavailable', matches: [], metadata: {}, zoningFields: {}, records: [], sources: [], diagnostics: [{ connector: 'plan-context', message }], message };
}

function unavailablePlanRecords(message) {
  return { status: 'unavailable', records: [], sources: [], diagnostics: [{ connector: 'plan-records', message }], successfulSources: 0, embeddedCount: 0, message };
}

function unavailableProviderDiscovery(message) {
  return {
    status: 'national-portals-ready', resultCapability: 'official-routing-only', automaticConnectorCount: 0,
    authority: null, municipalServices: [], actions: [
      { id: 'eplan-national', title: 'e-Plan İmar Durumu', provider: 'Çevre, Şehircilik ve İklim Değişikliği Bakanlığı', url: 'https://eplan.csb.gov.tr/e-plan/html/imarDurumu.html', kind: 'national-portal', accessMode: 'public-portal', status: 'official-portal', note: 'Türkiye geneli resmî imar durumu portalı.' },
      { id: 'tucbs-national', title: 'TUCBS Coğrafi Açık Veri', provider: 'Ulusal Coğrafi Bilgi Platformu', url: 'https://ucbp.tucbs.gov.tr/cografi-acik-veri-platformu', kind: 'national-geodata', accessMode: 'public-portal', status: 'official-portal', note: 'Kamuya açık coğrafi katmanlar.' }
    ],
    sources: [], catalog: { embedded: true, recordCount: 0, matchCount: 0 }, diagnostics: [{ connector: 'municipality-provider', message }], message
  };
}

function incompleteSourceScan(message) {
  return {
    status: 'incomplete', exhausted: false, budgetLimited: true, attemptedCount: 0, reachableCount: 0,
    foundRecordCount: 0, foundFieldCount: 0, records: [], sources: [], attempts: [], diagnostics: [{ connector: 'open-official-source-scan', message }], message
  };
}

function manualOnlySourceScan(providerDiscovery = {}) {
  const services = Array.isArray(providerDiscovery?.municipalServices)
    ? providerDiscovery.municipalServices.filter((item) => item?.accessMode === 'manual-only' || item?.status === 'manual-only')
    : [];
  const attempts = services.map((item) => ({
    id: item.id,
    title: item.title,
    provider: item.provider,
    url: item.url,
    status: 'manual-only',
    message: item.note || 'Bu resmî portal yalnız kullanıcı tarafından açılır; otomatik sorgu yapılmadı.',
    sourceClass: item.sourceClass || 'public-manual',
    accessMode: item.accessMode || 'manual-only',
    automatedQueryAllowed: false,
    dataClaim: 'not-read'
  }));
  const message = providerDiscovery?.message || 'Resmî imar portalı manuel kullanım gerektiriyor; otomatik kaynak taraması yapılmadı.';
  return {
    status: 'manual-only', exhausted: true, budgetLimited: false,
    totalCandidateCount: attempts.length, attemptedCount: attempts.length, reachableCount: 0,
    foundRecordCount: 0, foundFieldCount: 0, records: [], sources: [], attempts, diagnostics: [], message
  };
}

function unavailablePlanAi(env, message) {
  return {
    status: 'unavailable', enabled: true, configured: Boolean(env?.NVIDIA_API_KEY), canCalculate: false,
    fields: {}, actionableFields: [], evidenceBackedFields: [], evidence: [], attempts: [], evidenceCount: 0,
    message
  };
}

function findRegistryRecord(raw, key, parcel, query) {
  const parsed = parseJson(raw, null);
  if (!parsed) return null;
  if (Array.isArray(parsed)) return parsed.find((record) => recordMatches(record, key, parcel, query)) || null;
  if (typeof parsed === 'object') {
    if (parsed[key]) return parsed[key];
    const list = Array.isArray(parsed.records) ? parsed.records : [];
    return list.find((record) => recordMatches(record, key, parcel, query)) || null;
  }
  return null;
}

function recordMatches(record, key, parcel, query) {
  if (!record) return false;
  if (record.key && String(record.key) === key) return true;
  const p = parcel?.properties || {};
  const block = String(record.block ?? record.ada ?? '').trim();
  const parcelNo = String(record.parcel ?? record.parsel ?? '').trim();
  const neighbourhoodId = String(record.neighbourhoodId ?? record.mahalleId ?? '').trim();
  return block === String(p.block ?? query?.block ?? '') && parcelNo === String(p.parcel ?? query?.parcel ?? '') && (!neighbourhoodId || neighbourhoodId === String(p.neighbourhoodId ?? query?.neighbourhoodId ?? ''));
}

function matchesLocation(connector, parcel, query) {
  const p = parcel?.properties || {};
  const province = p.province || query?.province || '';
  const district = p.district || query?.district || '';
  const provinceKey = normalize(province);
  const districtKey = normalize(district);
  if (connector.province && !['*', provinceKey].includes(normalize(connector.province))) return false;
  if (connector.district && !['*', districtKey].includes(normalize(connector.district))) return false;
  const provinces = Array.isArray(connector.provinces) ? connector.provinces.map(normalize) : [];
  const districts = Array.isArray(connector.districts) ? connector.districts.map(normalize) : [];
  if (provinces.length && !provinces.includes('*') && !provinces.includes(provinceKey)) return false;
  if (districts.length && !districts.includes('*') && !districts.includes(districtKey)) return false;
  return true;
}

function selectBestRecord(records) {
  const score = (record) => {
    let value = record.source.trust === 'verified' ? 100 : record.source.trust === 'user-evidence' ? 95 : record.source.trust === 'ai-assisted-official' ? 92 : 30;
    for (const field of ['landUse', 'taks', 'emsal', 'floors', 'hmax', 'buildingOrder', 'netParcelArea', 'frontSetback', 'sideSetback', 'rearSetback', 'frontGardenArea', 'sideGardenArea', 'rearGardenArea']) if (record.fields[field] != null) value += 2;
    if (Array.isArray(record.fields.setbackConditions) && record.fields.setbackConditions.length) value += 2;
    if (record.source.url) value += 5;
    if (record.fields.planName) value += 3;
    return value;
  };
  return [...records].sort((a, b) => score(b) - score(a))[0];
}

const MERGE_SCALAR_FIELDS = [
  'landUse', 'taks', 'emsal', 'floors', 'hmax', 'buildingOrder',
  'netParcelArea', 'frontSetback', 'sideSetback', 'rearSetback', 'frontGardenArea', 'sideGardenArea', 'rearGardenArea', 'planName', 'planNumber',
  'planScale', 'planDate', 'authority', 'planNotes', 'parkingRequired',
  'roadDedicationPossible', 'floodDataStatus'
];
const MERGE_CONFLICT_SENSITIVE_FIELDS = new Set([
  'landUse', 'taks', 'emsal', 'floors', 'hmax', 'buildingOrder',
  'netParcelArea', 'frontSetback', 'sideSetback', 'rearSetback', 'frontGardenArea', 'sideGardenArea', 'rearGardenArea', 'parkingRequired',
  'roadDedicationPossible', 'floodDataStatus'
]);
const MERGE_PLAN_IDENTITY_FIELDS = ['planName', 'planNumber', 'planScale', 'planDate'];

/**
 * Aynı parsele ait, birbiriyle çelişmeyen kayıtların boş alanlarını tamamlar.
 * Her alanın kaynak kaydı korunur; farklı iki dolu değer sessizce ezilmez.
 */
export function mergeComplementaryZoningRecords(records = [], preferredRecord = null) {
  const valid = records.filter((record) => record?.fields && record?.source);
  if (!valid.length) return { fields: normalizeZoningFields({}), fieldSources: {}, conflictFields: [] };
  const preferred = preferredRecord && valid.includes(preferredRecord) ? preferredRecord : selectBestRecord(valid);
  const conflictFields = [];
  const ordered = [preferred];
  for (const candidate of valid.filter((record) => record !== preferred).sort((a, b) => recordScore(b) - recordScore(a))) {
    const identityConflicts = ordered.flatMap((accepted) => mergePlanIdentityConflicts(accepted, candidate));
    if (identityConflicts.length) {
      conflictFields.push(...identityConflicts);
      continue;
    }
    ordered.push(candidate);
  }
  const input = {};
  const fieldSources = {};

  for (const field of MERGE_SCALAR_FIELDS) {
    const candidates = ordered.filter((record) => hasValue(record.fields?.[field]));
    if (!candidates.length) continue;
    const unique = new Set(candidates.map((record) => comparableMergeValue(record.fields[field])));
    if (unique.size > 1 && MERGE_CONFLICT_SENSITIVE_FIELDS.has(field)) {
      conflictFields.push(field);
      continue;
    }
    const chosen = hasValue(preferred.fields?.[field]) ? preferred : candidates[0];
    input[field] = chosen.fields[field];
    fieldSources[field] = publicFieldSource(chosen.source, field);
  }

  const setbackCandidates = ordered.filter((record) => Array.isArray(record.fields?.setbackConditions) && record.fields.setbackConditions.length);
  if (setbackCandidates.length) {
    const chosen = Array.isArray(preferred.fields?.setbackConditions) && preferred.fields.setbackConditions.length ? preferred : setbackCandidates[0];
    input.setbackConditions = chosen.fields.setbackConditions;
    fieldSources.setbackConditions = publicFieldSource(chosen.source, 'setbackConditions');
  }

  const conditionalCandidates = ordered.filter((record) => record.fields?.conditionalFields && Object.values(record.fields.conditionalFields).some((items) => Array.isArray(items) && items.length));
  if (conditionalCandidates.length) {
    const chosen = preferred.fields?.conditionalFields && Object.values(preferred.fields.conditionalFields).some((items) => Array.isArray(items) && items.length) ? preferred : conditionalCandidates[0];
    input.conditionalFields = chosen.fields.conditionalFields;
    fieldSources.conditionalFields = publicFieldSource(chosen.source, 'conditionalFields');
  }

  const allowanceKeys = Object.keys(normalizeZoningFields({}).allowances || {});
  input.allowances = {};
  for (const key of allowanceKeys) {
    const candidates = ordered.filter((record) => {
      const value = String(record.fields?.allowances?.[key] || 'unknown');
      return value !== 'unknown';
    });
    if (!candidates.length) continue;
    const unique = new Set(candidates.map((record) => String(record.fields.allowances[key])));
    if (unique.size > 1) {
      conflictFields.push(`allowances.${key}`);
      input.allowances[key] = 'unknown';
      continue;
    }
    input.allowances[key] = candidates[0].fields.allowances[key];
    fieldSources[`allowances.${key}`] = publicFieldSource(candidates[0].source, `allowances.${key}`);
  }

  input.constraints = [...new Set(ordered.flatMap((record) => Array.isArray(record.fields?.constraints) ? record.fields.constraints : []).filter(Boolean))].slice(0, 30);
  return {
    fields: normalizeZoningFields(input),
    fieldSources,
    conflictFields: [...new Set(conflictFields)]
  };
}

export function shouldUseManualOnlyStatus(providerDiscovery = {}) {
  const actions = Array.isArray(providerDiscovery?.actions) ? providerDiscovery.actions : [];
  const services = Array.isArray(providerDiscovery?.municipalServices)
    ? providerDiscovery.municipalServices
    : providerDiscovery?.municipalService ? [providerDiscovery.municipalService] : [];
  return [...actions, ...services].some((item) => {
    if (!item?.url) return false;
    const mode = String(item.accessMode || '');
    const kind = String(item.kind || '');
    return ['official-login-service', 'public-portal', 'official-search'].includes(mode)
      || ['municipality-portal', 'official-portal', 'national-portal'].includes(kind);
  });
}

function recordScore(record) {
  let value = record?.source?.trust === 'verified' ? 100 : record?.source?.trust === 'user-evidence' ? 95 : record?.source?.trust === 'ai-assisted-official' ? 92 : 30;
  for (const field of ['landUse', 'taks', 'emsal', 'floors', 'hmax', 'buildingOrder', 'netParcelArea', 'frontSetback', 'sideSetback', 'rearSetback', 'frontGardenArea', 'sideGardenArea', 'rearGardenArea']) if (hasValue(record?.fields?.[field])) value += 2;
  if (Array.isArray(record?.fields?.setbackConditions) && record.fields.setbackConditions.length) value += 2;
  if (record?.source?.url) value += 5;
  if (record?.fields?.planName) value += 3;
  return value;
}

function hasValue(value) { return value != null && value !== ''; }
function comparableMergeValue(value) {
  if (typeof value === 'number') return String(Math.round(value * 10000) / 10000);
  if (typeof value === 'boolean') return String(value);
  return String(value).toLocaleLowerCase('tr-TR').replace(/\s+/g, ' ').trim();
}
function mergePlanIdentityConflicts(first, second) {
  return MERGE_PLAN_IDENTITY_FIELDS.filter((field) => {
    const firstValue = first?.fields?.[field];
    const secondValue = second?.fields?.[field];
    return hasValue(firstValue) && hasValue(secondValue)
      && comparableMergeValue(firstValue) !== comparableMergeValue(secondValue);
  });
}
function publicFieldSource(source = {}, field = '') {
  const evidence = source?.fieldEvidence && typeof source.fieldEvidence === 'object'
    ? source.fieldEvidence[field]
    : null;
  const confidence = clean(evidence?.confidence || source.extractionConfidence, 40);
  return {
    id: clean(source.id, 140),
    title: clean(source.title || source.provider, 280),
    provider: clean(source.provider, 240),
    trust: clean(source.trust, 60),
    url: safeUrl(source.url),
    documentDate: clean(source.documentDate, 40),
    retrievedAt: clean(source.retrievedAt, 40),
    sourceLastModified: clean(source.sourceLastModified, 40),
    sourceVerification: clean(source.sourceVerification, 80),
    evidenceOrigin: clean(source.evidenceOrigin, 80),
    confidence,
    extractionConfidence: confidence,
    excerpt: clean(evidence?.excerpt || evidence?.quote, 520),
    method: clean(evidence?.method, 80),
    parserVersion: clean(source.parserVersion, 40),
    parcelMatchStatus: clean(source.parcelMatchStatus, 40),
    documentName: clean(source.documentName, 260),
    documentHash: clean(source.documentHash, 80),
    documentHashKind: clean(source.documentHashKind, 80),
    verifiedAt: clean(source.verifiedAt, 40),
    sourceClass: clean(source.sourceClass, 80),
    accessMode: clean(source.accessMode, 80),
    automationPolicy: clean(source.automationPolicy, 80),
    dataClaim: clean(source.dataClaim, 80),
    retrievalMode: clean(source.retrievalMode, 80),
    scanVersion: clean(source.scanVersion, 40)
  };
}

function officialFallbackSources(parcel, query, providerDiscovery) {
  if (Array.isArray(providerDiscovery?.sources) && providerDiscovery.sources.length) return providerDiscovery.sources;
  const p = parcel?.properties || {};
  const location = [p.province || query?.province, p.district || query?.district].filter(Boolean).join(' / ');
  const search = new URL('https://www.turkiye.gov.tr/arama');
  search.searchParams.set('aranan', `${p.district || query?.district || ''} Belediyesi İmar Durum Bilgisi Sorgulama`.trim());
  return [
    {
      id: 'eplan-national', title: 'e-Plan Yürürlükteki Planlar ve İmar Durumu', provider: 'Çevre, Şehircilik ve İklim Değişikliği Bakanlığı',
      url: 'https://eplan.csb.gov.tr/e-plan/html/imarDurumu.html', kind: 'national-portal', trust: 'lookup-required', sourceClass: 'public-manual', accessMode: 'public-portal', automationPolicy: 'routing-only', dataClaim: 'not-read', note: `${location || 'Parsel'} için yürürlükteki plan, plan notu ve imar durumu bu portalda kontrol edilmelidir.`
    },
    {
      id: 'municipality-official-search', title: 'Belediye İmar Durumu Hizmetini Ara', provider: p.district ? `${p.district} Belediyesi / yetkili idare` : 'Yetkili yerel idare',
      url: search.toString(), kind: 'municipality-portal', trust: 'lookup-required', sourceClass: 'authenticated-official', accessMode: 'official-search', automationPolicy: 'routing-only', dataClaim: 'not-read', note: 'İlgili belediyenin resmî e-Devlet imar hizmeti bu bağlantıdan aranır; hizmet sonucu otomatik okunmuş sayılmaz.'
    }
  ];
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

function hasActionableFields(fields) {
  return ['landUse', 'taks', 'emsal', 'floors', 'hmax', 'buildingOrder', 'netParcelArea', 'frontSetback', 'sideSetback', 'rearSetback', 'frontGardenArea', 'sideGardenArea', 'rearGardenArea'].some((key) => fields?.[key] != null && fields[key] !== '')
    || Boolean(fields?.setbackConditions?.length)
    || Boolean(fields?.conditionalFields && Object.values(fields.conditionalFields).some((items) => Array.isArray(items) && items.length));
}

function hasAnyZoningField(fields) {
  return ['landUse', 'taks', 'emsal', 'floors', 'hmax', 'buildingOrder', 'netParcelArea', 'frontSetback', 'sideSetback', 'rearSetback', 'frontGardenArea', 'sideGardenArea', 'rearGardenArea', 'planName', 'planNotes'].some((key) => fields?.[key] != null && fields[key] !== '')
    || Boolean(fields?.setbackConditions?.length)
    || Boolean(fields?.conditionalFields && Object.values(fields.conditionalFields).some((items) => Array.isArray(items) && items.length));
}

function parcelKey(parcel, query) {
  const p = parcel?.properties || {};
  return [p.neighbourhoodId || query?.neighbourhoodId || p.neighbourhood || query?.neighbourhood, p.block || query?.block, p.parcel || query?.parcel].filter(Boolean).map(String).join(':');
}

function sanitizeParcelPayload(parcel) {
  if (!parcel) return null;
  return {
    type: 'Feature',
    geometry: parcel.geometry,
    properties: {
      province: clean(parcel.properties?.province, 120), district: clean(parcel.properties?.district, 120), neighbourhood: clean(parcel.properties?.neighbourhood, 160),
      neighbourhoodId: clean(parcel.properties?.neighbourhoodId, 80), block: clean(parcel.properties?.block, 40), parcel: clean(parcel.properties?.parcel, 40),
      area: Number.isFinite(Number(parcel.properties?.area)) ? Number(parcel.properties.area) : null, quality: clean(parcel.properties?.quality, 240), mapSheet: clean(parcel.properties?.mapSheet, 120)
    }
  };
}

function sanitizeQuery(query = {}) {
  return Object.fromEntries(Object.entries(query).slice(0, 20).map(([key, value]) => [clean(key, 60), clean(value, 200)]).filter(([key]) => key));
}

async function fetchConnectorRequest(url, options, timeoutMs, fetchImpl) {
  const method = String(options?.method || 'GET').toUpperCase();
  const retryCount = method === 'GET' || method === 'HEAD' ? 1 : 0;
  const deadline = Date.now() + timeoutMs;
  let lastError;
  for (let attempt = 0; attempt <= retryCount; attempt += 1) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), remaining);
    try {
      const response = await fetchImpl(url, { ...options, signal: controller.signal });
      if (attempt < retryCount && (response.status === 429 || response.status >= 500) && deadline - Date.now() > 50) continue;
      return response;
    } catch (error) {
      lastError = error;
      if (error?.name === 'AbortError' || attempt >= retryCount || deadline - Date.now() <= 50) break;
    } finally { clearTimeout(timer); }
  }
  if (lastError?.name === 'AbortError' || Date.now() >= deadline) throw new Error('İmar veri servisi zaman aşımına uğradı.');
  throw lastError || new Error('İmar veri servisine güvenli bağlantı kurulamadı.');
}

function safeConnectorUrl(value, env = {}) {
  if (!value) return null;
  try { return allowedConnectorUrl(value, env); } catch { return null; }
}

function connectorHostAllowed(hostname, rawAllowlist) {
  const host = String(hostname || '').toLowerCase().replace(/\.$/, '');
  if (host === 'gov.tr' || host === 'bel.tr' || host.endsWith('.gov.tr') || host.endsWith('.bel.tr')) return true;
  const allowed = String(rawAllowlist || '').split(/[\s,;]+/).map((item) => item.trim().toLowerCase().replace(/^\*\./, '')).filter(Boolean);
  return allowed.some((entry) => host === entry || host.endsWith(`.${entry}`));
}

function allowedConnectorUrl(value, env = {}) {
  const url = new URL(String(value));
  if (url.protocol !== 'https:' || url.username || url.password || !['', '443'].includes(url.port)) throw new Error('İmar bağlantısı güvenli HTTPS adresi olmalıdır.');
  if (isPrivateHost(url.hostname)) throw new Error('Özel ağ adresine imar bağlantısı yapılamaz.');
  if (!connectorHostAllowed(url.hostname, env.ZONING_CONNECTOR_ALLOWED_HOSTS || env.MUNICIPALITY_CONNECTOR_ALLOWED_HOSTS)) throw new Error('İmar bağlantısının alan adı izin listesinde değildir.');
  return url.toString();
}

function isPrivateHost(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return true;
  if (['::', '::1', '0.0.0.0', 'metadata.google.internal', 'instance-data'].includes(host)) return true;
  if (/^(?:fc|fd)[0-9a-f]{2}:|^fe[89ab][0-9a-f]:|^ff[0-9a-f]{2}:/i.test(host)) return true;
  if (host.startsWith('::ffff:')) return true;
  const parts = host.split('.');
  if (parts.length === 4 && parts.every((part) => /^\d+$/.test(part) && Number(part) >= 0 && Number(part) <= 255)) {
    const [a, b] = parts.map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
      || (a === 100 && b >= 64 && b <= 127) || (a === 198 && [18, 19].includes(b));
  }
  return false;
}

function safeUrl(value) {
  if (!value) return null;
  try {
    const url = new URL(String(value));
    return url.protocol === 'https:' && !url.username && !url.password && ['', '443'].includes(url.port) && !isPrivateHost(url.hostname) ? url.toString() : null;
  } catch { return null; }
}
function parseJson(value, fallback) { if (!value) return fallback; try { return typeof value === 'string' ? JSON.parse(value) : value; } catch { return fallback; } }
function normalize(value) { return String(value || '').toLocaleLowerCase('tr-TR').replace(/ç/g,'c').replace(/ğ/g,'g').replace(/ı/g,'i').replace(/ö/g,'o').replace(/ş/g,'s').replace(/ü/g,'u').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9*]/g, ''); }
function clean(value, max = 500) { if (value == null) return null; const text = String(value).replace(/[\u0000-\u001f<>]/g, ' ').replace(/\s+/g, ' ').trim(); return text ? text.slice(0, max) : null; }
function clampInt(value, min, max, fallback) { const number = Number(value); return Number.isFinite(number) ? Math.min(max, Math.max(min, Math.trunc(number))) : fallback; }
function safeMessage(error) {
  const raw = String(error?.message || error || '').replace(/https?:\/\/[^\s)]+/gi, '[resmî kaynak]').replace(/Bearer\s+\S+/gi, 'Bearer [gizlendi]');
  return clean(raw, 400) || 'Resmî kaynağa güvenli bağlantı kurulamadı.';
}
function trimCache() { while (CACHE.size > 500) CACHE.delete(CACHE.keys().next().value); }
