import {
  MUNICIPALITY_CATALOG,
  MUNICIPALITY_CATALOG_STATS,
  MUNICIPALITY_CATALOG_VERSION
} from './municipality-catalog.mjs';

const CACHE = globalThis.__PLANLAMASYON_MUNICIPALITY_PROVIDER_CACHE__ || new Map();
globalThis.__PLANLAMASYON_MUNICIPALITY_PROVIDER_CACHE__ = CACHE;



const PUBLIC_MUNICIPAL_PORTAL_HINTS = [
  {
    province: 'İstanbul', district: 'Şişli',
    id: 'istanbul-sisli-web-imar-durumu',
    status: 'manual-only',
    accessMode: 'manual-only',
    kind: 'municipality-portal',
    title: 'Şişli Belediyesi Web İmar Durum Uygulaması',
    provider: 'Şişli Belediyesi',
    url: 'https://kentrehberi.sisli.bel.tr/imardurum/',
    termsUrl: 'https://kentrehberi.sisli.bel.tr/imardurum/legal.aspx',
    note: 'Şişli Belediyesi tarafından yayımlanan bilgi amaçlı imar durumu uygulaması. Kullanım koşulları nedeniyle Planlamasyon bu portalda otomatik sorgu/form işlemi yapmaz; bağlantı kullanıcı tarafından açılır.',
    verifiedAt: '2026-08-24',
    machineReadableCandidate: false,
    automatedQueryAllowed: false
  },
  {
    province: 'İstanbul', district: 'Beşiktaş',
    id: 'istanbul-besiktas-imar-durumu',
    status: 'manual-only',
    accessMode: 'manual-only',
    kind: 'municipality-portal',
    title: 'Beşiktaş Belediyesi İmar Durumu',
    provider: 'Beşiktaş Belediyesi',
    url: 'https://besiktas.bel.tr/',
    termsUrl: 'https://keos.besiktas.bel.tr/imardurumu/legal.aspx',
    note: 'Beşiktaş Belediyesi sitesinden E-Belediye / İmar Durumu hizmetini açın. Yayınlanan koşullar üçüncü taraf otomatik işlemini yasakladığı için Planlamasyon bu portalı taramaz; indirdiğiniz güncel resmî belgeyi kullanıcı onayıyla okuyabilir.',
    verifiedAt: '2026-08-25',
    machineReadableCandidate: false,
    writtenPermissionRequired: true,
    automatedQueryAllowed: false
  }
];

const OFFICIAL_PORTALS = {
  eplan: "https://eplan.csb.gov.tr/e-plan/html/imarDurumu.html",
  eplanHome: 'https://eplan.csb.gov.tr/',
  eplanPlans: "https://eplan.csb.gov.tr/e-plan/html/acikPlanlar.html?filter=aski",
  tucbs: "https://tucbs.gov.tr/",
  tucbsOpenData: "https://ucbp.tucbs.gov.tr/cografi-acik-veri-platformu",
  eDevletSearch: "https://www.turkiye.gov.tr/arama",
  eDevletMunicipalities: "https://www.turkiye.gov.tr/belediyeler",
  googleSearch: "https://www.google.com/search"
};

export async function discoverMunicipalityProvider({ parcel, query, env = process.env, fetchImpl = globalThis.fetch } = {}) {
  const location = resolveLocation(parcel, query);
  const configuredConnectors = matchingConnectors(env.MUNICIPALITY_CONNECTORS_JSON, location, env);
  const environmentRegistry = parseRegistry(env.MUNICIPALITY_OFFICIAL_SERVICES_JSON)
    .filter((record) => matchesLocation(record, location))
    .map((record, index) => normalizeRegistryService(record, location, `environment-${index + 1}`))
    .filter(Boolean);
  const embeddedRecords = matchEmbeddedCatalog(location);
  const embeddedServices = embeddedRecords.map(normalizeCatalogService).filter(Boolean);
  const publicPortalHints = PUBLIC_MUNICIPAL_PORTAL_HINTS.filter((record) => matchesLocation(record, location)).map((record) => normalizeRegistryService(record, location, record.id)).filter(Boolean);
  const municipalServices = dedupeServices([...environmentRegistry, ...publicPortalHints, ...embeddedServices]).map(withAccessPolicy);
  const cacheKey = [
    location.provinceKey,
    location.districtKey,
    municipalServices.map((item) => [item.id, canonicalUrlKey(item.url), item.accessMode, item.status].join('~')).join('|'),
    configuredConnectors.map((item) => [item.id, canonicalUrlKey(item.publicUrl || item.sourceUrl || item.url), item.accessMode].join('~')).join('|')
  ].join(':');
  const cacheDisabled = String(env.MUNICIPALITY_PROVIDER_CACHE_DISABLED ?? 'false').toLowerCase() === 'true';

  if (!cacheDisabled) {
    const cached = CACHE.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.value;
  }

  const diagnostics = [];
  const discoveryEnabled = String(env.MUNICIPALITY_EDEVLET_DISCOVERY_ENABLED ?? 'true').toLowerCase() === 'true';
  if (!municipalServices.length && discoveryEnabled && location.district && typeof fetchImpl === 'function') {
    try {
      const discovered = await discoverEDevletService(location, env, fetchImpl);
      if (discovered) municipalServices.push(withAccessPolicy(discovered));
    } catch (error) {
      diagnostics.push({ connector: 'e-devlet-service-directory', message: clean(error?.message || error, 400) });
    }
  }
  if (!municipalServices.length && location.district) municipalServices.push(withAccessPolicy(fallbackSearchService(location)));

  const automaticConnectors = configuredConnectors.filter((item) => item.authorized === true && item.automatedQueryAllowed === true);
  const automaticConnectorCount = automaticConnectors.length;
  const authorityLabel = location.district
    ? `${location.district} Belediyesi / yetkili imar idaresi`
    : location.province
      ? `${location.province} için yetkili imar idaresi`
      : 'Yetkili imar idaresi';

  const actions = [
    ...nationalCatalogActions(),
    ...locationRoutingActions(location),
    ...municipalServices.map((service) => ({
      id: service.id,
      title: service.title,
      provider: service.provider || authorityLabel,
      url: service.url,
      kind: service.kind || 'municipality-portal',
      status: service.status,
      accessMode: service.accessMode,
      note: service.note,
      authentication: service.authentication || null,
      verifiedAt: service.verifiedAt || null,
      termsUrl: service.termsUrl || null,
      catalogRecordId: service.catalogRecordId || null,
      machineReadableCandidate: Boolean(service.machineReadableCandidate),
      automatedQueryAllowed: service.automatedQueryAllowed === true,
      writtenPermissionRequired: service.writtenPermissionRequired === true,
      configured: service.configured === true,
      authorized: service.authorized === true
    })),
    ...configuredConnectors.map((connector) => ({
      ...accessPolicyFor(connector),
      id: `configured-${connector.id}`,
      title: connector.title || `${location.district || location.province || 'Belediye'} imar veri bağlantısı`,
      provider: connector.provider || connector.authority || authorityLabel,
      url: safeHttpsUrl(connector.publicUrl || connector.sourceUrl || connector.url || null),
      kind: 'configured-adapter',
      status: connector.authorized === true && connector.automatedQueryAllowed === true ? 'configured' : 'authorization-required',
      accessMode: connector.authorized === true && connector.automatedQueryAllowed === true ? 'automatic-adapter' : 'configured-not-authorized',
      note: connector.authorized === true && connector.automatedQueryAllowed === true
        ? 'Planlamasyon backend’ine açıkça yetkilendirilerek yapılandırılmış otomatik imar veri adaptörü.'
        : 'Bağlantı yapılandırılmıştır ancak otomatik veri okuma yetkisi açıkça verilmediği için yalnız kaynak kaydı olarak gösterilir.',
      termsUrl: safeHttpsUrl(connector.termsUrl),
      machineReadableCandidate: connector.authorized === true && connector.automatedQueryAllowed === true,
      configured: true,
      authorized: connector.authorized === true || connector.automatedQueryAllowed === true,
      automatedQueryAllowed: connector.automatedQueryAllowed === true
    }))
  ];
  const finalActions = dedupeActions(actions).map(withAccessPolicy);
  const exactCatalogMatches = embeddedRecords.filter((record) => record.scope === 'district').length;
  const provinceCatalogMatches = embeddedRecords.filter((record) => record.scope === 'province').length;

  const result = {
    status: automaticConnectorCount > 0
      ? 'automatic-adapter-configured'
      : municipalServices[0]?.status === 'manual-only'
        ? 'manual-only'
      : municipalServices.some((item) => item.status === 'official-service-found')
        ? 'official-service-found'
        : location.district
          ? 'official-search-ready'
          : 'national-portals-ready',
    scope: 'turkiye-wide-embedded-catalog-routing',
    location,
    authority: {
      label: authorityLabel,
      province: location.province,
      district: location.district
    },
    municipalService: municipalServices[0] || null,
    municipalServices,
    automaticConnectorCount,
    connectorIds: automaticConnectors.map((item) => item.id),
    configuredConnectorCount: configuredConnectors.length,
    authorizationRequiredConnectorCount: configuredConnectors.length - automaticConnectorCount,
    actions: finalActions,
    sources: finalActions.map(actionToSource),
    diagnostics,
    catalog: {
      embedded: true,
      version: MUNICIPALITY_CATALOG_VERSION,
      ...MUNICIPALITY_CATALOG_STATS,
      matchCount: embeddedRecords.length,
      exactMatchCount: exactCatalogMatches,
      provinceMatchCount: provinceCatalogMatches,
      selectedServiceCount: municipalServices.length,
      routingProvinceCount: 81,
      nationwideRouting: true,
      automaticDataClaim: false,
      publicCatalogUrl: '/data/municipality-official-services.json',
      publicRoutingUrl: '/data/official-source-routing.json'
    },
    resultCapability: automaticConnectorCount > 0
      ? 'automatic-zoning-data'
      : municipalServices[0]?.status === 'manual-only'
        ? 'manual-official-query'
        : 'official-routing-only',
    message: buildProviderMessage({
      location,
      authorityLabel,
      automaticConnectorCount,
      embeddedRecords,
      municipalServices
    })
  };

  if (!cacheDisabled) {
    CACHE.set(cacheKey, { value: result, expiresAt: Date.now() + 12 * 60 * 60 * 1000 });
    trimCache();
  }
  return result;
}

export function matchEmbeddedCatalog({ province, district, provinceKey = normalize(province), districtKey = normalize(district) } = {}) {
  if (!provinceKey) return [];
  const isCentral = ['merkez', provinceKey].includes(districtKey);
  return MUNICIPALITY_CATALOG.filter((record) => {
    if (record.scope === 'national') return false;
    if (normalize(record.province) !== provinceKey) return false;
    if (record.scope === 'province') return true;
    const recordDistrictKey = normalize(record.district);
    if (recordDistrictKey === districtKey) return true;
    return isCentral && recordDistrictKey === provinceKey;
  }).sort((a, b) => catalogPriority(b) - catalogPriority(a) || String(a.title).localeCompare(String(b.title), 'tr'));
}

export function embeddedCatalogStats() {
  return { version: MUNICIPALITY_CATALOG_VERSION, ...MUNICIPALITY_CATALOG_STATS };
}

export function buildEDevletSearchUrl({ district, province } = {}) {
  const parts = [district ? `${district} Belediyesi` : null, 'İmar Durum Bilgisi Sorgulama', province].filter(Boolean);
  const url = new URL(OFFICIAL_PORTALS.eDevletSearch);
  url.searchParams.set('aranan', parts.join(' '));
  return url.toString();
}

export function buildGoogleOfficialSearchUrl({ district, province, neighbourhood, block, parcel } = {}) {
  const url = new URL(OFFICIAL_PORTALS.googleSearch);
  const parcelRef = block && parcel ? `ada ${block} parsel ${parcel}` : null;
  const parts = [district ? `"${district} Belediyesi"` : null, province, neighbourhood, '"imar durumu"', parcelRef, 'site:bel.tr OR site:gov.tr'].filter(Boolean);
  url.searchParams.set('q', parts.join(' '));
  return url.toString();
}

function locationRoutingActions(location) {
  const actions = [{
    id: 'official-domain-google-discovery',
    title: 'Resmî kurum sitelerinde imar kaynağı ara',
    provider: 'Google resmî alan adı araması',
    url: buildGoogleOfficialSearchUrl(location),
    kind: 'discovery-search',
    status: 'unverified-discovery',
    accessMode: 'discovery-only',
    note: 'Yalnız bel.tr ve gov.tr alan adlarında keşif araması açılır. Arama sonucu doğrulanmadan resmî veri veya otomatik sorgu kaynağı sayılmaz.',
    machineReadableCandidate: false,
    automatedQueryAllowed: false
  }];
  if (OFFICIAL_PORTALS.eplanPlans) actions.push({
    id: 'eplan-public-plans',
    title: 'Askıdaki ve yürürlükteki planları aç',
    provider: 'e-Plan Otomasyon Sistemleri',
    url: OFFICIAL_PORTALS.eplanPlans,
    kind: 'national-plan-directory',
    status: 'official-portal',
    accessMode: 'public-portal',
    note: 'Resmî e-Plan plan ve askı ilanları sayfası; her parsel için kayıt bulunması garanti değildir.',
    machineReadableCandidate: false,
    automatedQueryAllowed: false
  });
  return actions;
}

async function discoverEDevletService(location, env, fetchImpl) {
  const searchUrl = buildEDevletSearchUrl(location);
  const timeoutMs = clampInt(env.MUNICIPALITY_EDEVLET_DISCOVERY_TIMEOUT_MS, 900, 10000, 2200);
  try {
    const response = await fetchOfficialDirectory(searchUrl, {
      method: 'GET',
      headers: {
        Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.2',
        'Accept-Language': 'tr-TR,tr;q=0.9,en;q=0.5',
        'User-Agent': 'Planlamasyon/3.6.0 (https://planlamasyon.truva-ai.com)',
        Referer: 'https://www.turkiye.gov.tr/'
      }
    }, timeoutMs, fetchImpl, clampInt(env.MUNICIPALITY_SOURCE_RETRY_COUNT, 0, 1, 1));
    if (!response.ok) throw new Error(`e-Devlet hizmet dizini ${response.status} yanıtı verdi.`);
    const html = await response.text();
    const match = parseEDevletServiceHtml(html, location);
    if (!match) return null;
    return {
      id: 'municipality-dynamic-edelivery',
      status: 'official-service-found',
      accessMode: 'official-login-service',
      kind: 'municipality-portal',
      title: match.title || `${location.district} Belediyesi İmar Durum Bilgisi Sorgulama`,
      provider: `${location.district} Belediyesi / e-Devlet Kapısı`,
      url: match.url,
      note: 'Resmî e-Devlet belediye hizmeti dinamik olarak bulundu. Sonuç ekranı kimlik doğrulaması isteyebilir; Planlamasyon oturum verisini okumaz.',
      authentication: 'Hizmete göre'
    };
  } catch (error) {
    if (error?.name === 'AbortError' || /zaman aşım/i.test(error?.message || '')) throw new Error('e-Devlet belediye hizmeti araması zaman aşımına uğradı.');
    throw error;
  }
}

export function parseEDevletServiceHtml(html, location = {}) {
  const source = String(html || '');
  const districtKey = normalize(location.district);
  if (!source || !districtKey) return null;
  const anchorPattern = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = anchorPattern.exec(source))) {
    const href = decodeEntities(match[1]);
    const text = clean(stripTags(decodeEntities(match[2])), 500) || '';
    const combined = normalize(`${text} ${href}`);
    if (!combined.includes(districtKey)) continue;
    if (!combined.includes('imar') || !(combined.includes('durum') || combined.includes('sorgu') || combined.includes('eimar'))) continue;
    let url;
    try { url = new URL(href, 'https://www.turkiye.gov.tr/'); } catch { continue; }
    if (!['www.turkiye.gov.tr', 'turkiye.gov.tr'].includes(url.hostname)) continue;
    if (url.pathname === '/arama') continue;
    return { url: url.toString(), title: text || `${location.district} Belediyesi İmar Durum Bilgisi Sorgulama` };
  }
  return null;
}

function nationalCatalogActions() {
  const records = MUNICIPALITY_CATALOG.filter((record) => record.scope === 'national');
  const actions = records.map((record) => ({
    id: `catalog-${record.id}`,
    title: record.title,
    provider: record.authority,
    url: record.url,
    kind: record.kind,
    status: 'official-portal',
    accessMode: record.accessMode,
    note: record.note,
    authentication: record.authentication,
    verifiedAt: record.verifiedAt,
    catalogRecordId: record.id,
    machineReadableCandidate: Boolean(record.machineReadableCandidate)
  }));
  if (!actions.some((item) => item.url === OFFICIAL_PORTALS.eplan)) actions.push({
    id: 'eplan-national', title: 'e-Plan İmar Durumu', provider: 'Çevre, Şehircilik ve İklim Değişikliği Bakanlığı', url: OFFICIAL_PORTALS.eplan,
    kind: 'national-portal', status: 'official-portal', accessMode: 'public-portal', note: 'Türkiye genelinde yürürlükteki plan, plan notu ve imar durumu sorgulaması için resmî portal.'
  });
  if (!actions.some((item) => item.kind === 'national-geodata')) actions.push({
    id: 'tucbs-national', title: 'TUCBS Coğrafi Açık Veri', provider: 'Ulusal Coğrafi Bilgi Platformu', url: OFFICIAL_PORTALS.tucbsOpenData,
    kind: 'national-geodata', status: 'official-portal', accessMode: 'public-portal', note: 'Kamu kurumlarının açık olarak yayımladığı plan ve coğrafi katmanların servis kataloğu.'
  });
  return actions;
}

function fallbackSearchService(location) {
  return {
    id: 'municipality-official-search',
    status: 'official-search-ready',
    accessMode: 'official-search',
    kind: 'municipality-portal',
    title: `${location.district} Belediyesi imar hizmetini e-Devlet’te ara`,
    provider: 'e-Devlet Kapısı belediye hizmetleri',
    url: buildEDevletSearchUrl(location),
    note: 'Gömülü katalogda doğrudan kayıt bulunamadı. İlgili belediyenin imar sorgu hizmeti e-Devlet resmî aramasında kontrol edilir; sonuç hizmete ve kullanıcı oturumuna bağlıdır.'
  };
}

function normalizeCatalogService(record) {
  const url = safeHttpsUrl(record.url);
  if (!url) return null;
  return {
    id: `catalog-${record.id}`,
    catalogRecordId: record.id,
    status: 'official-service-found',
    accessMode: record.accessMode || 'official-service',
    kind: record.kind || 'municipality-portal',
    title: record.title || 'Resmî imar hizmeti',
    provider: record.authority,
    url,
    note: [record.note, record.verifiedAt ? `Bağlantı doğrulama tarihi: ${record.verifiedAt}.` : null].filter(Boolean).join(' '),
    authentication: record.authentication,
    verifiedAt: record.verifiedAt,
    termsUrl: safeHttpsUrl(record.termsUrl),
    machineReadableCandidate: Boolean(record.machineReadableCandidate),
    automatedQueryAllowed: record.automatedQueryAllowed === true,
    configured: false,
    authorized: false
  };
}

function normalizeRegistryService(record, location, fallbackId = 'registry-service') {
  const url = safeHttpsUrl(record.url || record.serviceUrl);
  if (!url) return null;
  return {
    id: clean(record.id, 120) || fallbackId,
    status: clean(record.status, 80) || 'official-service-found',
    accessMode: clean(record.accessMode, 80) || 'official-service',
    kind: clean(record.kind, 80) || 'municipality-portal',
    title: clean(record.title, 260) || `${location.district || location.province} Belediyesi İmar Durum Bilgisi Sorgulama`,
    provider: clean(record.provider || record.authority, 240) || `${location.district || location.province} Belediyesi / yetkili idare`,
    url,
    note: clean(record.note, 600) || 'Planlamasyon yapılandırmasında resmî hizmet bağlantısı olarak kayıtlıdır.',
    authentication: clean(record.authentication, 120),
    verifiedAt: clean(record.verifiedAt, 40),
    termsUrl: safeHttpsUrl(record.termsUrl),
    machineReadableCandidate: Boolean(record.machineReadableCandidate),
    automatedQueryAllowed: record.automatedQueryAllowed === true,
    writtenPermissionRequired: record.writtenPermissionRequired === true,
    configured: record.configured === true,
    authorized: record.authorized === true || record.automatedQueryAllowed === true
  };
}

function buildProviderMessage({ location, authorityLabel, automaticConnectorCount, embeddedRecords, municipalServices }) {
  if (automaticConnectorCount > 0) return `${authorityLabel} için otomatik imar veri adaptörü yapılandırılmıştır. Gömülü resmî katalog yedek kaynak olarak da kullanılır.`;
  if (municipalServices[0]?.status === 'manual-only') return `${authorityLabel} için resmî imar portalı bulundu; kullanım koşulları nedeniyle sorgu yalnızca kullanıcı tarafından portalda yapılır ve Planlamasyon otomatik form işlemi yapmaz.`;
  if (embeddedRecords.length) {
    const loginCount = municipalServices.filter((item) => item.accessMode === 'official-login-service').length;
    return `Gömülü resmî katalogdan ${embeddedRecords.length} hizmet eşleşti${loginCount ? `; ${loginCount} hizmet resmî oturum isteyebilir` : ''}. Bu bağlantılar doğru resmî sorgu yolunu sağlar; otomatik TAKS, emsal ve kat sonucu yalnızca makine-okunabilir veya yapılandırılmış veri kaynağı bulunduğunda oluşturulur.`;
  }
  if (municipalServices.some((item) => item.status === 'official-service-found')) return `${location.district} Belediyesi için resmî imar sorgu hizmeti bulundu. Oturum gerektiren sonuç kullanıcı tarafından resmî portalda açılır.`;
  if (location.district) return `${location.district} için e-Plan, TUCBS ve e-Devlet belediye hizmet araması hazırdır; yapılaşma değerleri ancak açık veya yapılandırılmış veri kaynağından alınır.`;
  return 'Türkiye geneli e-Plan, TUCBS ve gömülü resmî belediye hizmetleri kataloğu hazırdır.';
}

function parseRegistry(raw) {
  const parsed = parseJson(raw, []);
  if (Array.isArray(parsed)) return parsed.filter(Boolean);
  if (Array.isArray(parsed?.services)) return parsed.services.filter(Boolean);
  if (parsed && typeof parsed === 'object') return Object.entries(parsed).map(([key, value]) => ({ key, ...(value && typeof value === 'object' ? value : {}) }));
  return [];
}

function matchingConnectors(raw, location, env = {}) {
  const parsed = parseJson(raw, []);
  const list = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.connectors) ? parsed.connectors : [];
  return list.filter((item) => {
    const url = safeHttpsUrl(item?.publicUrl || item?.sourceUrl || item?.url);
    return Boolean(url && connectorHostAllowed(url, env.MUNICIPALITY_CONNECTOR_ALLOWED_HOSTS) && matchesLocation(item, location));
  }).slice(0, 20).map((item, index) => ({
    ...item,
    id: clean(item.id, 120) || `municipality-${index + 1}`,
    authorized: item.authorized === true,
    automatedQueryAllowed: item.automatedQueryAllowed === true
  }));
}

function matchesLocation(record, location) {
  if (!record) return false;
  const province = normalize(record.province || record.il || '');
  const district = normalize(record.district || record.ilce || '');
  const provinces = arrayKeys(record.provinces || record.iller);
  const districts = arrayKeys(record.districts || record.ilceler);
  if (province && province !== location.provinceKey) return false;
  if (district && district !== '*' && district !== location.districtKey) return false;
  if (provinces.length && !provinces.includes(location.provinceKey) && !provinces.includes('*')) return false;
  if (districts.length && !districts.includes(location.districtKey) && !districts.includes('*')) return false;
  if (record.key) {
    const key = normalize(record.key);
    const locationKeys = [location.districtKey, `${location.provinceKey}${location.districtKey}`];
    if (!locationKeys.includes(key)) return false;
  }
  return true;
}

function resolveLocation(parcel, query) {
  const p = parcel?.properties || {};
  const province = clean(p.province || query?.province, 120);
  const district = clean(p.district || query?.district, 120);
  const neighbourhood = clean(p.neighbourhood || query?.neighbourhood, 160);
  const block = clean(p.block || query?.block || query?.ada, 80);
  const parcelNumber = clean(p.parcel || query?.parcel || query?.parsel, 80);
  return {
    province,
    district,
    neighbourhood,
    block,
    parcel: parcelNumber,
    provinceKey: normalize(province),
    districtKey: normalize(district),
    neighbourhoodKey: normalize(neighbourhood)
  };
}

function actionToSource(action) {
  return {
    id: action.id,
    title: action.title,
    provider: action.provider,
    url: action.url,
    kind: action.kind,
    trust: action.status === 'configured' ? 'verified-connector-configured' : 'lookup-required',
    note: action.note,
    verifiedAt: action.verifiedAt || null,
    authentication: action.authentication || null,
    termsUrl: action.termsUrl || null,
    accessMode: action.accessMode || null,
    automatedQueryAllowed: action.automatedQueryAllowed === true,
    sourceClass: action.sourceClass || null,
    accessRequirement: action.accessRequirement || null,
    automationPolicy: action.automationPolicy || null,
    dataClaim: action.dataClaim || null,
    userActionRequired: action.userActionRequired === true
  };
}

function catalogPriority(record) {
  let score = 0;
  if (record.scope === 'district') score += 50;
  if (record.kind === 'municipality-geodata') score += 30;
  if (record.accessMode === 'public-portal') score += 20;
  if (/imar durum/i.test(record.title)) score += 12;
  if (/e-?imar/i.test(record.title)) score += 8;
  if (record.machineReadableCandidate) score += 50;
  return score;
}

function servicePriority(service = {}) {
  let score = 0;
  if (service.kind === 'configured-adapter') score += 600;
  if (service.accessMode === 'automatic-adapter') score += 550;
  if (service.kind === 'municipality-geodata') score += 500;
  if (service.accessMode === 'public-portal') score += 400;
  if (service.kind === 'municipality-portal') score += 250;
  if (service.status === 'official-service-found' || service.accessMode === 'official-service') score += 220;
  if (service.status === 'manual-only' || service.accessMode === 'manual-only') score += 400;
  if (service.accessMode === 'official-login-service') score += 120;
  if (service.accessMode === 'official-search') score += 300;
  if (service.kind === 'national-portal' || service.kind === 'national-geodata' || service.kind === 'national-directory' || service.kind === 'national-plan-directory') score += 40;
  if (service.kind === 'discovery-search' || service.accessMode === 'discovery-only') score -= 50;
  if (service.machineReadableCandidate) score += 70;
  if (/imar durum/i.test(service.title || '')) score += 12;
  return score;
}

function sortActions(actions) {
  return [...actions].sort((a, b) => servicePriority(b) - servicePriority(a) || itemRichness(b) - itemRichness(a) || String(a.title || '').localeCompare(String(b.title || ''), 'tr'));
}

function itemRichness(item = {}) {
  return ['provider', 'note', 'authentication', 'verifiedAt', 'termsUrl', 'catalogRecordId'].reduce((score, key) => score + (item[key] ? 1 : 0), 0);
}

function canonicalUrlKey(value) {
  if (!value) return null;
  try {
    const url = new URL(String(value));
    if (url.protocol !== 'https:') return null;
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) {
      if (/^(?:utm_.+|gclid|fbclid|mc_[ce]id)$/i.test(key)) url.searchParams.delete(key);
    }
    const sorted = [...url.searchParams.entries()].sort(([a, av], [b, bv]) => a.localeCompare(b) || av.localeCompare(bv));
    url.search = '';
    for (const [key, entryValue] of sorted) url.searchParams.append(key, entryValue);
    const pathname = url.pathname.replace(/\/+$/, '') || '/';
    return `${url.origin.toLowerCase()}${pathname}${url.search}`;
  } catch { return null; }
}

function serviceKey(item = {}) {
  const urlKey = canonicalUrlKey(item.url);
  if (urlKey) return `url:${urlKey}`;
  return `id:${item.id || item.title || item.provider || 'unknown'}`;
}

function dedupeServices(services) {
  const seen = new Set();
  const sorted = sortActions(services);
  return sorted.filter((item) => {
    const key = serviceKey(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function dedupeActions(actions) {
  const seen = new Set();
  return sortActions(actions).filter((item) => {
    const key = serviceKey(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function blockedHostname(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return true;
  if (host === '::' || host === '::1' || host.startsWith('fc') || host.startsWith('fd') || /^fe[89ab]/.test(host)) return true;
  if (host.startsWith('::ffff:')) return true;
  const parts = host.split('.');
  if (parts.length === 4 && parts.every((part) => /^\d+$/.test(part) && Number(part) >= 0 && Number(part) <= 255)) {
    const [a, b] = parts.map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || (a === 198 && [18, 19].includes(b));
  }
  return false;
}

function safeHttpsUrl(value) {
  if (!value) return null;
  try {
    const url = new URL(String(value));
    if (url.protocol !== 'https:' || url.username || url.password || !['', '443'].includes(url.port) || blockedHostname(url.hostname)) return null;
    return url.toString();
  } catch { return null; }
}

function accessPolicyFor(item = {}) {
  const mode = String(item.accessMode || '');
  const kind = String(item.kind || '');
  const url = String(item.url || '');
  const authenticated = ['official-login-service', 'official-search'].includes(mode) || /(?:^|\.)turkiye\.gov\.tr(?=\/|$)/i.test(url.replace(/^https?:\/\//, ''));
  if (authenticated) return {
    sourceClass: 'authenticated-official', accessRequirement: 'Kullanıcı resmî portalı açmalı; hizmet oturum isteyebilir.',
    automationPolicy: 'routing-only', dataClaim: 'not-read', userActionRequired: true
  };
  if (mode === 'manual-only' || mode === 'configured-not-authorized') return {
    sourceClass: 'public-manual', accessRequirement: 'Kullanıcı resmî portalı elle açmalıdır.',
    automationPolicy: 'manual-only', dataClaim: 'not-read', userActionRequired: true
  };
  if (mode === 'discovery-only' || kind === 'discovery-search') return {
    sourceClass: 'discovery-only', accessRequirement: 'Arama sonucu kullanıcı tarafından doğrulanmalıdır.',
    automationPolicy: 'discovery-only', dataClaim: 'unverified-link', userActionRequired: true
  };
  if (mode === 'automatic-adapter' && item.authorized === true && item.automatedQueryAllowed === true) return {
    sourceClass: 'authorized-adapter', accessRequirement: 'Yapılandırılmış kurum adaptörü.',
    automationPolicy: 'authorized-automatic', dataClaim: 'eligible-after-parcel-match', userActionRequired: false
  };
  if ((kind === 'municipality-geodata' || kind === 'national-geodata' || mode === 'read-only-result') && item.machineReadableCandidate === true) return {
    sourceClass: 'open-machine-readable', accessRequirement: 'Açık salt-okunur resmî kaynak.',
    automationPolicy: 'read-only', dataClaim: 'eligible-after-parcel-match', userActionRequired: false
  };
  return {
    sourceClass: 'public-manual', accessRequirement: 'Resmî bağlantı kullanıcı tarafından açılır.',
    automationPolicy: 'routing-only', dataClaim: 'not-read', userActionRequired: true
  };
}

function withAccessPolicy(item = {}) {
  const policy = accessPolicyFor(item);
  const automatic = ['authorized-automatic', 'read-only'].includes(policy.automationPolicy);
  return {
    ...item,
    ...policy,
    machineReadableCandidate: automatic && item.machineReadableCandidate === true,
    automatedQueryAllowed: policy.automationPolicy === 'authorized-automatic'
  };
}

function connectorHostAllowed(value, rawAllowlist) {
  let url;
  try { url = new URL(String(value)); } catch { return false; }
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (host.endsWith('.gov.tr') || host.endsWith('.bel.tr') || host === 'gov.tr' || host === 'bel.tr') return true;
  const allowed = String(rawAllowlist || '').split(/[\s,;]+/).map((item) => item.trim().toLowerCase().replace(/^\*\./, '')).filter(Boolean);
  return allowed.some((entry) => host === entry || host.endsWith(`.${entry}`));
}

async function fetchOfficialDirectory(url, options, timeoutMs, fetchImpl, retryCount = 1) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  for (let attempt = 0; attempt <= retryCount; attempt += 1) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), remaining);
    try {
      const response = await fetchImpl(url, { ...options, signal: controller.signal });
      if (attempt < retryCount && (response.status === 429 || response.status >= 500)) continue;
      return response;
    } catch (error) {
      lastError = error;
      if (error?.name === 'AbortError' || attempt >= retryCount) throw error;
    } finally { clearTimeout(timer); }
  }
  if (lastError) throw lastError;
  const timeoutError = new Error('Resmî kaynak zaman aşımına uğradı.');
  timeoutError.name = 'AbortError';
  throw timeoutError;
}

function arrayKeys(value) { return Array.isArray(value) ? value.map(normalize).filter(Boolean) : []; }
function parseJson(value, fallback) { if (!value) return fallback; try { return typeof value === 'string' ? JSON.parse(value) : value; } catch { return fallback; } }
function normalize(value) {
  return String(value || '').toLocaleLowerCase('tr-TR')
    .replace(/ç/g, 'c').replace(/ğ/g, 'g').replace(/ı/g, 'i').replace(/ö/g, 'o').replace(/ş/g, 's').replace(/ü/g, 'u')
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9*]/g, '');
}
function stripTags(value) { return String(value || '').replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' '); }
function decodeEntities(value) {
  return String(value || '')
    .replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&nbsp;/gi, ' ')
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCodePoint(parseInt(code, 16)));
}
function clean(value, max = 500) { if (value == null) return null; const text = String(value).replace(/[\u0000-\u001f<>]/g, ' ').replace(/\s+/g, ' ').trim(); return text ? text.slice(0, max) : null; }
function clampInt(value, min, max, fallback) { const number = Number(value); return Number.isFinite(number) ? Math.min(max, Math.max(min, Math.trunc(number))) : fallback; }
function trimCache() { while (CACHE.size > 1000) CACHE.delete(CACHE.keys().next().value); }
