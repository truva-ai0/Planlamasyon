import { geometryCenter } from './geo.mjs';
import { normalizeZoningFields } from './analysis-core.mjs';

export const OPEN_OFFICIAL_SOURCE_VERSION = '3.4.0';

const CACHE = globalThis.__PLANLAMASYON_OPEN_OFFICIAL_SOURCE_CACHE__ || new Map();
globalThis.__PLANLAMASYON_OPEN_OFFICIAL_SOURCE_CACHE__ = CACHE;

const ACTIONABLE_FIELDS = [
  'landUse', 'taks', 'emsal', 'floors', 'hmax', 'buildingOrder',
  'frontSetback', 'sideSetback', 'rearSetback'
];

const NATIONAL_CANDIDATES = [
  {
    id: 'tucbs-eplan-uip-wms-open',
    title: 'Kesinleşmiş Uygulama İmar Planı açık WMS',
    provider: 'Çevre, Şehircilik ve İklim Değişikliği Bakanlığı / TUCBS',
    kind: 'wms',
    endpoint: 'https://tucbs-public-api.csb.gov.tr/trk_eplan_kesinlesmis_uip_wms',
    layers: ['tucbs_UIP', 'tucbsPlanSinir_UIP'],
    official: true,
    priority: 100
  },
  {
    id: 'tucbs-eplan-uip-wfs-open',
    title: 'Kesinleşmiş Uygulama İmar Planı açık WFS',
    provider: 'Çevre, Şehircilik ve İklim Değişikliği Bakanlığı / TUCBS',
    kind: 'wfs',
    endpoint: 'https://tucbs-public-api.csb.gov.tr/trk_eplan_kesinlesmis_uip_wfs',
    layers: ['tucbs_UIP', 'tucbsPlanSinir_UIP'],
    official: true,
    priority: 95
  },
  {
    id: 'tucbs-eplan-nip-wms-open',
    title: 'Kesinleşmiş Nazım İmar Planı açık WMS',
    provider: 'Çevre, Şehircilik ve İklim Değişikliği Bakanlığı / TUCBS',
    kind: 'wms',
    endpoint: 'https://tucbs-public-api.csb.gov.tr/trk_eplan_kesinlesmis_nip_wms',
    layers: ['tucbs_NIP', 'tucbsPlanSinir_NIP'],
    official: true,
    priority: 80
  },
  {
    id: 'tucbs-eplan-nip-wfs-open',
    title: 'Kesinleşmiş Nazım İmar Planı açık WFS',
    provider: 'Çevre, Şehircilik ve İklim Değişikliği Bakanlığı / TUCBS',
    kind: 'wfs',
    endpoint: 'https://tucbs-public-api.csb.gov.tr/trk_eplan_kesinlesmis_nip_wfs',
    layers: ['tucbs_NIP', 'tucbsPlanSinir_NIP'],
    official: true,
    priority: 75
  }
];

/**
 * e-Devlet oturumu istemeyen resmî kaynakları sırayla tarar.
 * Bir kaynak veri vermediğinde hemen vazgeçmez; diğer açık kaynaklara geçer.
 */
export async function discoverOpenOfficialZoning({
  parcel,
  query = {},
  providerDiscovery = {},
  env = process.env,
  fetchImpl = globalThis.fetch
} = {}) {
  const center = geometryCenter(parcel?.geometry);
  if (!center) return unavailableResult('Parsel merkezi hesaplanamadı.');
  if (String(env.OPEN_OFFICIAL_SOURCE_SCAN_ENABLED ?? 'true').toLowerCase() !== 'true') {
    return unavailableResult('Açık resmî kaynak taraması kapalı.', center, [], false);
  }
  if (typeof fetchImpl !== 'function') return unavailableResult('Açık resmî kaynak taraması için ağ erişimi bulunmuyor.', center);

  const location = resolveLocation(parcel, query);
  const candidates = buildCandidateQueue({ providerDiscovery, env, location });
  const cacheDisabled = String(env.OPEN_OFFICIAL_SOURCE_CACHE_DISABLED ?? 'false').toLowerCase() === 'true';
  const cacheKey = `${location.provinceKey}:${location.districtKey}:${center.lat.toFixed(5)}:${center.lon.toFixed(5)}:${candidates.map((item) => `${item.id}:${item.accessMode || ''}:${item.automatedQueryAllowed === true ? 1 : 0}:${item.authorized === true ? 1 : 0}`).join('|')}`;
  if (!cacheDisabled) {
    const cached = CACHE.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.value;
  }

  const maxCandidates = clampInt(env.OPEN_OFFICIAL_SOURCE_MAX_CANDIDATES, 4, 40, 12);
  const queue = candidates.slice(0, maxCandidates);
  const seen = new Set(queue.map(candidateKey));
  const attempts = [];
  const records = [];
  const sources = [];
  const aiEvidence = [];
  const diagnostics = [];
  const discoveredServices = [];
  const timeoutMs = clampInt(env.OPEN_OFFICIAL_SOURCE_TIMEOUT_MS, 800, 8000, 1800);
  const totalBudgetMs = clampInt(env.OPEN_OFFICIAL_SOURCE_TOTAL_BUDGET_MS, 3000, 45000, 6500);
  const concurrency = clampInt(env.OPEN_OFFICIAL_SOURCE_CONCURRENCY, 1, 6, 3);
  const scanStartedAt = Date.now();
  let cursor = 0;
  let budgetLimited = false;

  const runCandidate = async (candidate) => {
    const startedAt = Date.now();
    const remainingBudget = totalBudgetMs - (startedAt - scanStartedAt);
    if (remainingBudget < 600) {
      return { candidate, skipped: true, status: 'budget-skipped', message: 'Toplam tarama süresi dolduğu için sonraki denemeye bırakıldı.', durationMs: 0 };
    }
    try {
      const result = await queryCandidate(candidate, {
        center, parcel, query,
        timeoutMs: Math.max(500, Math.min(timeoutMs, remainingBudget - 150)),
        fetchImpl
      });
      return { candidate, result, durationMs: Date.now() - startedAt };
    } catch (error) {
      return { candidate, error, durationMs: Date.now() - startedAt };
    }
  };

  while (cursor < queue.length && cursor < maxCandidates) {
    if (Date.now() - scanStartedAt >= totalBudgetMs) { budgetLimited = true; break; }
    const batch = queue.slice(cursor, Math.min(cursor + concurrency, maxCandidates));
    cursor += batch.length;
    const outcomes = await Promise.all(batch.map(runCandidate));

    for (const outcome of outcomes) {
      const { candidate, durationMs } = outcome;
      if (outcome.skipped) {
        budgetLimited = true;
        attempts.push({
          id: candidate.id,
          title: candidate.title,
          provider: candidate.provider,
          kind: candidate.kind,
          url: candidate.endpoint || candidate.url || null,
          status: 'budget-skipped',
          message: outcome.message,
          durationMs,
          foundFields: [],
          accessMode: candidate.accessMode || null,
          automatedQueryAllowed: candidate.automatedQueryAllowed === true,
          termsUrl: candidate.termsUrl || null
        });
        continue;
      }
      if (outcome.error) {
        const status = classifyError(outcome.error);
        const message = safeMessage(outcome.error);
        attempts.push({
          id: candidate.id,
          title: candidate.title,
          provider: candidate.provider,
          kind: candidate.kind,
          url: candidate.endpoint || candidate.url || null,
          status,
          message,
          durationMs,
          foundFields: [],
          accessMode: candidate.accessMode || null,
          automatedQueryAllowed: candidate.automatedQueryAllowed === true,
          termsUrl: candidate.termsUrl || null
        });
        diagnostics.push({ connector: candidate.id, message });
        continue;
      }

      const result = outcome.result;
      attempts.push({
        id: candidate.id,
        title: candidate.title,
        provider: candidate.provider,
        kind: candidate.kind,
        url: candidate.endpoint || candidate.url || null,
        status: result.status,
        message: result.message,
        durationMs,
        foundFields: fieldNames(result.record?.fields),
        accessMode: candidate.accessMode || null,
        automatedQueryAllowed: candidate.automatedQueryAllowed === true,
        termsUrl: candidate.termsUrl || null
      });
      if (result.source) sources.push(result.source);
      if (Array.isArray(result.aiEvidence)) aiEvidence.push(...result.aiEvidence);
      if (result.record && hasActionableField(result.record.fields)) records.push(result.record);
      else if (result.record && hasAnyField(result.record.fields)) sources.push(result.record.source);

      for (const discovered of result.discovered || []) {
        const key = candidateKey(discovered);
        if (seen.has(key) || queue.length >= maxCandidates) continue;
        seen.add(key);
        queue.push(discovered);
        discoveredServices.push({ id: discovered.id, title: discovered.title, kind: discovered.kind, url: discovered.endpoint || discovered.url });
      }
    }
  }

  if (cursor < Math.min(queue.length, maxCandidates)) budgetLimited = true;
  const dedupedRecords = dedupeRecords(records);
  const foundFieldCount = new Set(dedupedRecords.flatMap((record) => fieldNames(record.fields))).size;
  const reachedSources = attempts.filter((item) => ['found', 'metadata-only', 'not-found'].includes(item.status)).length;
  const exhausted = !budgetLimited && cursor >= Math.min(queue.length, maxCandidates);
  const manualOnlyCount = attempts.filter((item) => item.status === 'manual-only').length;
  const transientFailure = attempts.some((item) => isTransientAttemptStatus(item.status));
  const scanStatus = dedupedRecords.length
    ? 'available'
    : !exhausted || transientFailure
      ? 'incomplete'
      : manualOnlyCount > 0 && attempts.every((item) => ['manual-only', 'not-found', 'metadata-only'].includes(item.status))
        ? 'manual-only'
        : 'exhausted';
  const value = {
    status: scanStatus,
    version: OPEN_OFFICIAL_SOURCE_VERSION,
    center,
    location,
    exhausted,
    budgetLimited,
    totalBudgetMs,
    elapsedMs: Date.now() - scanStartedAt,
    totalCandidateCount: queue.length,
    attemptedCount: attempts.length,
    reachableCount: reachedSources,
    manualOnlyCount,
    foundRecordCount: dedupedRecords.length,
    foundFieldCount,
    records: dedupedRecords,
    sources: dedupeSources(sources),
    aiEvidence: dedupeAiEvidence(aiEvidence).slice(0, 8),
    attempts,
    discoveredServices,
    diagnostics: diagnostics.slice(0, 30),
    message: dedupedRecords.length
      ? `${attempts.length} açık resmî kaynak denendi; ${dedupedRecords.length} kaynakta hesaplamaya uygun yapılaşma bilgisi bulundu.`
      : scanStatus === 'manual-only'
        ? `${manualOnlyCount} resmî portal yalnızca elle sorgulanabilir; Planlamasyon kullanım koşulları gereği otomatik form işlemi yapmadı.`
      : exhausted
        ? `${attempts.length} e-Devletsiz açık resmî kaynak denendi; güncel TAKS, emsal, kat veya çekme mesafesi veren açık bir sonuç bulunamadı.`
        : `${attempts.length} açık resmî kaynak denendi; süre sınırı nedeniyle tarama tamamlanamadı. Yeniden deneme yapılabilir.`
  };

  const cacheableNegative = value.status === 'exhausted' && value.exhausted && !value.budgetLimited && !transientFailure;
  if (!cacheDisabled && (value.status === 'available' || cacheableNegative)) {
    CACHE.set(cacheKey, { value, expiresAt: Date.now() + 30 * 60 * 1000 });
    trimCache();
  }
  return value;
}

function buildCandidateQueue({ providerDiscovery, env, location }) {
  const candidates = [...NATIONAL_CANDIDATES];
  const configured = parseConfiguredSources(env.OPEN_OFFICIAL_ZONING_SOURCES_JSON, location);
  candidates.push(...configured);

  const actions = Array.isArray(providerDiscovery?.actions) ? providerDiscovery.actions : [];
  for (const action of actions) {
    const url = safePublicUrl(action?.url);
    if (!url) continue;
    const accessMode = String(action?.accessMode || '');
    const kind = String(action?.kind || '');
    const isLogin = accessMode === 'official-login-service' || /turkiye\.gov\.tr/i.test(url);
    if (isLogin) continue;
    if (!['municipality-geodata', 'national-geodata', 'national-portal', 'official-portal', 'municipality-portal', 'configured-adapter'].includes(kind) && !action?.machineReadableCandidate) continue;
    candidates.push({
      id: `portal-${cleanId(action.id || action.title || url)}`,
      title: action.title || 'Resmî açık imar/CBS portalı',
      provider: action.provider || providerDiscovery?.authority?.label || 'Yetkili idare',
      kind: inferKind(url, action),
      url,
      endpoint: url,
      layers: normalizeLayers(action.layers || action.layer),
      official: true,
      priority: accessMode === 'manual-only' ? 140 : action.machineReadableCandidate ? 130 : 30,
      accessMode,
      automatedQueryAllowed: action.automatedQueryAllowed === true,
      configured: action.configured === true || kind === 'configured-adapter',
      authorized: action.authorized === true || action.automatedQueryAllowed === true,
      termsUrl: safePublicUrl(action.termsUrl),
      readOnlyResult: action.readOnlyResult === true || accessMode === 'read-only-result'
    });
  }

  return dedupeCandidates(candidates)
    .sort((a, b) => Number(b.priority || 0) - Number(a.priority || 0));
}

function parseConfiguredSources(raw, location) {
  const parsed = parseJson(raw, []);
  const list = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.sources) ? parsed.sources : [];
  return list
    .filter((item) => item && (item.url || item.endpoint) && matchesLocation(item, location))
    .map((item, index) => {
      const endpoint = safePublicUrl(item.endpoint || item.url);
      if (!endpoint) return null;
      return {
        id: cleanId(item.id || `configured-open-${index + 1}`),
        title: clean(item.title, 240) || 'Yapılandırılmış açık resmî kaynak',
        provider: clean(item.provider || item.authority, 240) || 'Yetkili idare',
        kind: String(item.kind || inferKind(endpoint, item)).toLowerCase(),
        endpoint,
        url: endpoint,
        layers: normalizeLayers(item.layers || item.layer || item.typeNames),
        layerNameKeywords: normalizeLayers(item.layerNameKeywords),
        official: true,
        priority: Number.isFinite(Number(item.priority)) ? Number(item.priority) : 90,
        accessMode: clean(item.accessMode, 80) || null,
        automatedQueryAllowed: item.automatedQueryAllowed === true,
        configured: true,
        authorized: item.authorized === true || item.automatedQueryAllowed === true,
        termsUrl: safePublicUrl(item.termsUrl),
        readOnlyResult: item.readOnlyResult === true || item.accessMode === 'read-only-result'
      };
    })
    .filter(Boolean);
}

async function queryCandidate(candidate, context) {
  if (candidate.accessMode === 'manual-only' || candidate.automatedQueryAllowed === false && candidate.status === 'manual-only') {
    return manualOnlyResult(candidate);
  }
  switch (candidate.kind) {
    case 'wms': return queryWms(candidate, context);
    case 'wfs': return queryWfs(candidate, context);
    case 'arcgis': return queryArcGis(candidate, context);
    case 'json': return queryGenericJson(candidate, context);
    default: return discoverPortal(candidate, context);
  }
}

async function queryWms(candidate, { center, timeoutMs, fetchImpl }) {
  const endpoint = allowedPublicUrl(candidate.endpoint || candidate.url);
  const layers = candidate.layers?.length ? candidate.layers : await discoverWmsLayers(endpoint, timeoutMs, fetchImpl, candidate.layerNameKeywords);
  if (!layers.length) return result('not-found', 'WMS katmanı bulunamadı.', candidate);
  const attributesList = [];
  const errors = [];
  for (const layer of layers.slice(0, 8)) {
    try {
      const attributes = await fetchWmsFeatureInfo(endpoint, layer, center, timeoutMs, fetchImpl);
      if (attributes && Object.keys(attributes).length) attributesList.push({ layer, attributes });
    } catch (error) {
      errors.push(error);
    }
  }
  if (!attributesList.length) {
    if (errors.length === layers.length) throw errors.at(-1);
    return result('not-found', 'WMS katmanında parsel merkezine ait kayıt bulunamadı.', candidate);
  }
  return buildResultFromAttributes(candidate, attributesList.map((item) => item.attributes), {
    note: `Açık resmî WMS katmanında parsel merkezine ait ${attributesList.length} kayıt okundu.`,
    detail: attributesList.map((item) => item.layer).join(', ')
  });
}

async function queryWfs(candidate, { center, timeoutMs, fetchImpl }) {
  const endpoint = allowedPublicUrl(candidate.endpoint || candidate.url);
  const layers = candidate.layers?.length ? candidate.layers : await discoverWfsLayers(endpoint, timeoutMs, fetchImpl, candidate.layerNameKeywords);
  if (!layers.length) return result('not-found', 'WFS katmanı bulunamadı.', candidate);
  const attributesList = [];
  const errors = [];
  for (const layer of layers.slice(0, 8)) {
    try {
      const attributes = await fetchWfsFeature(endpoint, layer, center, timeoutMs, fetchImpl);
      if (attributes && Object.keys(attributes).length) attributesList.push({ layer, attributes });
    } catch (error) {
      errors.push(error);
    }
  }
  if (!attributesList.length) {
    if (errors.length === layers.length) throw errors.at(-1);
    return result('not-found', 'WFS katmanında parsel merkezine ait kayıt bulunamadı.', candidate);
  }
  return buildResultFromAttributes(candidate, attributesList.map((item) => item.attributes), {
    note: `Açık resmî WFS katmanında parsel merkezine ait ${attributesList.length} kayıt okundu.`,
    detail: attributesList.map((item) => item.layer).join(', ')
  });
}

async function queryArcGis(candidate, { center, timeoutMs, fetchImpl }) {
  const endpoint = allowedPublicUrl(candidate.endpoint || candidate.url);
  const rootInfo = parseArcGisEndpoint(endpoint);
  const layerEndpoints = [];
  if (rootInfo.layerId != null) layerEndpoints.push(rootInfo.url);
  else {
    const metadata = await fetchJson(withQuery(rootInfo.url, { f: 'json' }), timeoutMs, fetchImpl, candidate.title);
    for (const layer of chooseArcGisLayers(metadata, candidate.layerNameKeywords).slice(0, 10)) {
      layerEndpoints.push(`${rootInfo.url.replace(/\/$/, '')}/${layer.id}`);
    }
  }
  if (!layerEndpoints.length) return result('not-found', 'ArcGIS imar katmanı bulunamadı.', candidate);
  const records = [];
  for (const layerUrl of layerEndpoints) {
    const queryUrl = withQuery(`${layerUrl.replace(/\/$/, '')}/query`, {
      f: 'json',
      where: '1=1',
      geometry: `${center.lon},${center.lat}`,
      geometryType: 'esriGeometryPoint',
      inSR: '4326',
      spatialRel: 'esriSpatialRelIntersects',
      outFields: '*',
      returnGeometry: 'false',
      resultRecordCount: '5'
    });
    const json = await fetchJson(queryUrl, timeoutMs, fetchImpl, candidate.title);
    for (const feature of json?.features || []) if (feature?.attributes) records.push(feature.attributes);
  }
  if (!records.length) return result('not-found', 'ArcGIS katmanında parsel merkezine ait kayıt bulunamadı.', candidate);
  return buildResultFromAttributes(candidate, records, { note: `Açık resmî ArcGIS katmanından ${records.length} kayıt okundu.` });
}

async function queryGenericJson(candidate, { center, parcel, query, timeoutMs, fetchImpl }) {
  const endpoint = allowedPublicUrl(candidate.endpoint || candidate.url);
  const p = parcel?.properties || {};
  const requestUrl = withQuery(endpoint, {
    province: p.province || query?.province || '',
    district: p.district || query?.district || '',
    neighbourhood: p.neighbourhood || query?.neighbourhood || '',
    block: p.block || query?.block || '',
    parcel: p.parcel || query?.parcel || '',
    lat: center.lat,
    lon: center.lon
  });
  const json = await fetchJson(requestUrl, timeoutMs, fetchImpl, candidate.title);
  const rows = Array.isArray(json) ? json : Array.isArray(json?.features) ? json.features.map((item) => item.properties || item.attributes || item) : [json?.data || json?.result || json].filter(Boolean);
  if (!rows.length) return result('not-found', 'Açık JSON kaynağında kayıt bulunamadı.', candidate);
  return buildResultFromAttributes(candidate, rows, { note: `Açık resmî JSON kaynağından ${rows.length} kayıt okundu.` });
}

async function discoverPortal(candidate, { timeoutMs, fetchImpl, parcel, query }) {
  const url = allowedPublicUrl(candidate.url || candidate.endpoint);
  const startedAt = Date.now();
  const response = await fetchWithTimeout(url, {
    headers: portalHeaders(url)
  }, Math.max(700, Math.min(timeoutMs, 2600)), fetchImpl);
  if ([401, 403].includes(response.status)) {
    const error = new Error('Resmî portal oturum veya yetki istiyor.');
    error.status = response.status;
    throw error;
  }
  if (!response.ok) throw httpStatusError(`${candidate.title} ${response.status} yanıtı verdi.`, response.status);
  const text = await response.text();

  // Doğrudan açılan, sorgudaki ada/parseli açıkça içeren sonuç sayfası salt-okunur GET
  // olarak işlenebilir. Bu yol hiçbir form veya portal işlemi tetiklemez.
  const directResult = parsePortalResultHtml({
    candidate,
    url: response.url || url,
    html: text,
    expected: expectedParcelNumbers(parcel, query),
    retrievalMode: 'read-only-get'
  });
  if (directResult) return directResult;

  // Belediye e-imar formu yalnız açıkça yetkilendirilmiş, yapılandırılmış bir
  // aday olduğunda POST edilir. Sonuç yine aynı ada + parseli açıkça göstermelidir.
  const queryResult = await queryMunicipalPortalForm({
    candidate, baseUrl: url, html: text, parcel, query, fetchImpl, cookieHeader: responseCookieHeader(response),
    timeoutMs: Math.max(650, timeoutMs - (Date.now() - startedAt))
  }).catch((error) => ({ status: 'error', message: safeMessage(error), aiEvidence: [] }));
  if (queryResult?.status === 'found' || queryResult?.status === 'metadata-only') return queryResult;

  const serviceItems = [...extractOfficialServiceUrls(text, url)];
  const remainingForScripts = Math.max(0, timeoutMs - (Date.now() - startedAt));
  const scriptUrls = remainingForScripts >= 700 ? extractFirstPartyScriptUrls(text, url).slice(0, 2) : [];
  if (scriptUrls.length) {
    const scriptResults = await Promise.allSettled(scriptUrls.map(async (scriptUrl) => {
      const remaining = Math.max(500, timeoutMs - (Date.now() - startedAt));
      const scriptResponse = await fetchWithTimeout(scriptUrl, { headers: standardHeaders('application/javascript,text/javascript,*/*;q=0.2') }, Math.max(500, Math.min(remaining, 1200)), fetchImpl);
      if (!scriptResponse.ok) return [];
      const scriptText = (await scriptResponse.text()).slice(0, 2_500_000);
      return extractOfficialServiceUrls(scriptText, scriptUrl);
    }));
    for (const item of scriptResults) if (item.status === 'fulfilled') serviceItems.push(...item.value);
  }
  const discovered = dedupeServiceItems(serviceItems).map((item, index) => ({
    id: `${candidate.id}-discovered-${index + 1}`,
    title: `${candidate.title} · ${serviceKindLabel(item.kind)}`,
    provider: candidate.provider,
    kind: item.kind,
    endpoint: item.url,
    url: item.url,
    layers: item.layers,
    official: true,
    priority: Math.max(1, Number(candidate.priority || 0) - 1)
  }));
  if (!discovered.length) {
    const base = result('not-found', queryResult?.message || 'Portal açıldı; ada/parsel sonucu veya otomatik okunabilen veri kapısı bulunamadı.', candidate);
    return { ...base, discovered: [], aiEvidence: queryResult?.aiEvidence || [] };
  }
  return {
    ...result('metadata-only', `${discovered.length} açık veri servisi adayı keşfedildi; sırayla deneniyor.`, candidate),
    discovered,
    aiEvidence: queryResult?.aiEvidence || []
  };
}

async function queryMunicipalPortalForm({ candidate, baseUrl, html, parcel, query, fetchImpl, timeoutMs, cookieHeader = '' }) {
  const expected = expectedParcelNumbers(parcel, query);
  if (!expected.block || !expected.parcel || timeoutMs < 550) return { status: 'not-found', message: 'Ada/parsel bilgisi portal sorgusu için yeterli değil.', aiEvidence: [] };
  if (!isAuthorizedConfiguredFormCandidate(candidate)) {
    return {
      status: 'not-found',
      message: 'Portalın otomatik form sorgusu yalnızca açıkça yetkilendirilmiş yapılandırılmış adaptörlerde çalıştırılır; bu kaynak elle açılmalıdır.',
      aiEvidence: []
    };
  }
  const forms = parseHtmlForms(html, baseUrl);
  const matching = forms.filter((form) => form.blockField && form.parcelField).slice(0, 2);
  const attempts = matching;
  let lastMessage = 'Portal açıldı; ada/parsel sorgu formu otomatik olarak belirlenemedi.';
  const queryStartedAt = Date.now();

  for (const form of attempts.slice(0, 3)) {
    const remaining = timeoutMs - (Date.now() - queryStartedAt);
    if (remaining < 450) break;
    try {
      const params = new URLSearchParams(form.defaults || {});
      params.set(form.blockField || 'ada', expected.block);
      params.set(form.parcelField || 'parsel', expected.parcel);
      if (form.neighbourhoodField && expected.neighbourhood) {
        const option = chooseNeighbourhoodOption(form.neighbourhoodOptions || [], expected.neighbourhood);
        if (option) params.set(form.neighbourhoodField, option.value);
      }
      if (form.submitField && form.submitValue != null) params.set(form.submitField, form.submitValue);
      const target = firstPartyFormUrl(form.action || baseUrl, baseUrl);
      const method = String(form.method || 'GET').toUpperCase() === 'POST' ? 'POST' : 'GET';
      let requestUrl = target;
      const headers = portalHeaders(baseUrl, cookieHeader);
      const init = { method, headers };
      if (method === 'POST') {
        headers['Content-Type'] = 'application/x-www-form-urlencoded; charset=UTF-8';
        init.body = params.toString();
      } else {
        const u = new URL(target);
        for (const [key, value] of params.entries()) u.searchParams.set(key, value);
        requestUrl = u.toString();
      }
      const response = await fetchWithTimeout(requestUrl, init, Math.max(450, Math.min(remaining, 1800)), fetchImpl);
      if ([401,403].includes(response.status)) { lastMessage = 'Resmî imar sonucu oturum/yetki istedi.'; continue; }
      if (!response.ok) { lastMessage = `Resmî imar sorgusu ${response.status} yanıtı verdi.`; continue; }
      const resultHtml = await response.text();
      const parsedResult = parsePortalResultHtml({
        candidate,
        url: response.url || requestUrl,
        html: resultHtml,
        expected,
        retrievalMode: method === 'POST' ? 'authorized-form-post' : 'form-get'
      });
      if (parsedResult) return parsedResult;
      lastMessage = 'İmar sayfası yanıt verdi fakat sonuçtaki ada/parsel sorguyla açıkça eşleşmedi.';
    } catch (error) {
      lastMessage = safeMessage(error);
    }
  }
  return { status: 'not-found', message: lastMessage, aiEvidence: [] };
}

function parsePortalResultHtml({ candidate, url, html, expected, retrievalMode }) {
  const plainText = htmlToEvidenceText(html, 24000);
  if (!hasExactParcelReference(plainText, expected)) return null;
  const fields = normalizeOpenZoningAttributes({ content: plainText });
  const actionable = hasActionableField(fields);
  const any = hasAnyField(fields);
  const readOnly = retrievalMode === 'read-only-get';
  const source = {
    id: `${candidate.id}-parcel-result`, title: candidate.title, provider: candidate.provider,
    url, kind: 'zoning', trust: actionable ? 'verified' : 'public-information',
    note: actionable
      ? `Açık belediye imar uygulamasında ${expected.block} ada ${expected.parcel} parsel sonucu ${readOnly ? 'salt-okunur sonuç sayfasından' : 'yetkili sorgudan'} okundu.`
      : `Açık belediye imar uygulamasında ${expected.block} ada ${expected.parcel} parsel sonucu bulundu; yapılaşma metni Plan AI incelemesine aktarıldı.`,
    retrievedAt: new Date().toISOString(), scanVersion: OPEN_OFFICIAL_SOURCE_VERSION,
    retrievalMode
  };
  const evidence = makePortalAiEvidence(candidate, url, plainText, expected);
  if (actionable || any) {
    return {
      status: actionable ? 'found' : 'metadata-only',
      message: actionable ? `Belediye imar uygulamasında yapılaşma bilgisi bulundu: ${fieldNames(fields).join(', ')}.` : 'Belediye imar uygulamasında parsele ait resmî sonuç bulundu; metin Plan AI ile ayrıca okunacak.',
      record: { fields, source, message: actionable ? 'Açık belediye imar uygulamasında yapılaşma koşulu bulundu.' : 'Açık belediye imar uygulamasında plan bilgisi bulundu.' },
      source, discovered: [], aiEvidence: evidence ? [evidence] : []
    };
  }
  return {
    ...result('metadata-only', 'Belediye imar uygulamasında parsele ait sonuç bulundu; yapılaşma değerleri metinden doğrudan çıkarılamadı.', candidate),
    source,
    aiEvidence: evidence ? [evidence] : [],
    discovered: []
  };
}

function isAuthorizedConfiguredFormCandidate(candidate) {
  return candidate?.configured === true
    && candidate?.authorized === true
    && candidate?.automatedQueryAllowed === true;
}

function parseHtmlForms(html, baseUrl) {
  const forms = [];
  const source = String(html || '');
  const formPattern = /<form\b([^>]*)>([\s\S]*?)<\/form>/gi;
  let match;
  while ((match = formPattern.exec(source)) && forms.length < 8) {
    const attrs = parseHtmlAttributes(match[1]);
    const body = match[2];
    const controls = parseFormControls(body);
    const blockControl = controls.find((item) => /ada|block/i.test(normalizeControlName(item.name || item.id)) && !/parsel|parcel/i.test(normalizeControlName(item.name || item.id)));
    const parcelControl = controls.find((item) => /parsel|parcel/i.test(normalizeControlName(item.name || item.id)));
    const neighbourhoodControl = controls.find((item) => /mahalle|mah(?:alle)?|neigh/i.test(normalizeControlName(item.name || item.id)));
    const submit = controls.find((item) => item.submit && /sorg|ara|getir|goster|göster|imar|liste/i.test(`${item.name || ''} ${item.id || ''} ${item.value || ''}`)) || controls.find((item) => item.submit);
    const defaults = {};
    for (const control of controls) if (control.name && control.value != null && (control.hidden || control.selected)) defaults[control.name] = control.value;
    forms.push({
      action: safeFormAction(attrs.action, baseUrl),
      method: attrs.method || 'GET', defaults,
      blockField: blockControl?.name || blockControl?.id || null,
      parcelField: parcelControl?.name || parcelControl?.id || null,
      neighbourhoodField: neighbourhoodControl?.name || neighbourhoodControl?.id || null,
      neighbourhoodOptions: neighbourhoodControl?.options || [],
      submitField: submit?.name || null,
      submitValue: submit?.value ?? null
    });
  }
  return forms;
}

function parseFormControls(body) {
  const controls = [];
  const inputPattern = /<input\b([^>]*)>/gi;
  let match;
  while ((match = inputPattern.exec(body))) {
    const attrs = parseHtmlAttributes(match[1]);
    const type = String(attrs.type || 'text').toLowerCase();
    controls.push({ name: attrs.name || null, id: attrs.id || null, value: decodeEntities(attrs.value || ''), hidden: type === 'hidden', submit: ['submit','button','image'].includes(type), selected: false });
  }
  const buttonPattern = /<button\b([^>]*)>([\s\S]*?)<\/button>/gi;
  while ((match = buttonPattern.exec(body))) {
    const attrs = parseHtmlAttributes(match[1]);
    controls.push({ name: attrs.name || null, id: attrs.id || null, value: decodeEntities(attrs.value || stripMarkup(match[2]) || ''), hidden: false, submit: true, selected: false });
  }
  const selectPattern = /<select\b([^>]*)>([\s\S]*?)<\/select>/gi;
  while ((match = selectPattern.exec(body))) {
    const attrs = parseHtmlAttributes(match[1]);
    const options = [];
    const optionPattern = /<option\b([^>]*)>([\s\S]*?)<\/option>/gi;
    let optionMatch;
    let selectedValue = null;
    while ((optionMatch = optionPattern.exec(match[2]))) {
      const oa = parseHtmlAttributes(optionMatch[1]);
      const item = { value: decodeEntities(oa.value ?? stripMarkup(optionMatch[2]) ?? ''), label: stripMarkup(optionMatch[2]) || '', selected: Object.prototype.hasOwnProperty.call(oa, 'selected') };
      options.push(item);
      if (item.selected) selectedValue = item.value;
    }
    controls.push({ name: attrs.name || null, id: attrs.id || null, value: selectedValue, hidden: false, submit: false, selected: selectedValue != null, options });
  }
  return controls;
}

function parseHtmlAttributes(source) {
  const attrs = {};
  const pattern = /([:\w-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let match;
  while ((match = pattern.exec(String(source || '')))) attrs[String(match[1]).toLowerCase()] = match[2] ?? match[3] ?? match[4] ?? '';
  return attrs;
}

function buildCommonParcelQueryForms(baseUrl, expected) {
  const variants = [
    ['ada','parsel'], ['Ada','Parsel'], ['ADA','PARSEL'], ['block','parcel']
  ];
  return variants.map(([blockField, parcelField]) => ({ action: baseUrl, method: 'GET', defaults: {}, blockField, parcelField, neighbourhoodField: null, neighbourhoodOptions: [] }));
}

function expectedParcelNumbers(parcel, query = {}) {
  const p = parcel?.properties || {};
  return {
    block: clean(p.block || query.block, 40), parcel: clean(p.parcel || query.parcel, 40),
    neighbourhood: clean(p.neighbourhood || query.neighbourhood, 160)
  };
}

function hasExactParcelReference(text, expected) {
  const normalized = normalizeForParcelMatch(text);
  const block = escapeRegExp(normalizeForParcelMatch(expected.block));
  const parcel = escapeRegExp(normalizeForParcelMatch(expected.parcel));
  if (!block || !parcel) return false;
  const patterns = [
    new RegExp(`(?:ada|block)\\s*[:#-]?\\s*${block}\\b[\\s\\S]{0,180}?(?:parsel|parcel)\\s*[:#-]?\\s*${parcel}\\b`, 'i'),
    new RegExp(`\\b${block}\\s*(?:ada)?[\\s/\\-]+${parcel}\\s*(?:parsel)?\\b`, 'i'),
    new RegExp(`\\b${block}\\s*[/\\-]\\s*${parcel}\\b`, 'i')
  ];
  return patterns.some((pattern) => pattern.test(normalized));
}

function makePortalAiEvidence(candidate, url, text, expected) {
  const cleaned = cleanEvidenceText(text, 26000);
  if (!cleaned || !hasExactParcelReference(cleaned, expected)) return null;
  return { id: `${candidate.id}-portal-evidence`, title: candidate.title, provider: candidate.provider, url, kind: 'official-portal-result', parcelMatch: 'exact', text: cleaned, retrievedAt: new Date().toISOString() };
}

function htmlToEvidenceText(html, maxChars = 26000) {
  const source = String(html || '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<\/p>|<\/div>|<\/tr>|<\/li>|<\/td>|<\/th>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  return cleanEvidenceText(decodeEntities(source), maxChars);
}

function cleanEvidenceText(value, maxChars = 26000) {
  const text = String(value || '').replace(/\r/g, '\n').replace(/[\t ]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  return text ? text.slice(0, maxChars) : '';
}

function chooseNeighbourhoodOption(options, neighbourhood) {
  const wanted = normalizeKey(neighbourhood);
  return (options || []).find((item) => normalizeKey(item.label) === wanted)
    || (options || []).find((item) => normalizeKey(item.label).includes(wanted) || wanted.includes(normalizeKey(item.label)));
}

function safeFormAction(value, baseUrl) { try { return value ? new URL(decodeEntities(value), baseUrl).toString() : baseUrl; } catch { return baseUrl; } }

function firstPartyFormUrl(value, baseUrl) {
  const url = new URL(value, baseUrl);
  const base = new URL(baseUrl);
  if (!isAllowedPublicUrl(url) || url.hostname !== base.hostname) throw new Error('Belediye formu farklı bir sunucuya yönlendiği için otomatik gönderilmedi.');
  return url.toString();
}

function responseCookieHeader(response) {
  try {
    const cookies = typeof response?.headers?.getSetCookie === 'function' ? response.headers.getSetCookie() : [];
    if (cookies?.length) return cookies.map((value) => String(value).split(';')[0]).filter(Boolean).join('; ');
    const raw = response?.headers?.get?.('set-cookie');
    return raw ? String(raw).split(/,(?=[^;,]+=)/).map((value) => value.split(';')[0].trim()).filter(Boolean).join('; ') : '';
  } catch { return ''; }
}

function portalHeaders(referer, cookieHeader = '') {
  const url = new URL(referer);
  return {
    Accept: 'text/html,application/xhtml+xml,application/json;q=0.8,*/*;q=0.2',
    'Accept-Language': 'tr-TR,tr;q=0.9,en;q=0.5',
    'User-Agent': 'Planlamasyon/3.4.0 (+https://planlamasyon.truva-ai.com)',
    Referer: referer,
    Origin: url.origin,
    ...(cookieHeader ? { Cookie: cookieHeader } : {})
  };
}

function normalizeControlName(value) { return String(value || '').replace(/[$:_-]+/g, ' '); }
function normalizeForParcelMatch(value) { return String(value || '').toLocaleLowerCase('tr-TR').replace(/ı/g,'i').replace(/\s+/g,' ').trim(); }
function escapeRegExp(value) { return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function dedupeAiEvidence(items) {
  const seen = new Set();
  return (items || []).filter((item) => {
    const key = `${item?.url || ''}:${String(item?.text || '').slice(0, 240)}`;
    if (!item?.text || seen.has(key)) return false;
    seen.add(key); return true;
  });
}

function buildResultFromAttributes(candidate, attributeRows, { note, detail } = {}) {
  const merged = mergeAttributeRows(attributeRows);
  const fields = normalizeOpenZoningAttributes(merged);
  const actionable = hasActionableField(fields);
  const any = hasAnyField(fields);
  const source = {
    id: candidate.id,
    title: candidate.title,
    provider: candidate.provider,
    url: candidate.endpoint || candidate.url || null,
    kind: 'zoning',
    trust: actionable ? 'verified' : 'public-information',
    note: [note, detail ? `Katman: ${detail}.` : null, actionable ? 'Açık resmî veri kaynağından otomatik okundu.' : 'Yalnızca plan/metaveri bilgisi bulundu; yapılaşma hesabı için yeterli değildir.'].filter(Boolean).join(' '),
    retrievedAt: new Date().toISOString(),
    scanVersion: OPEN_OFFICIAL_SOURCE_VERSION
  };
  const record = any ? { fields, source, message: actionable ? 'Açık resmî kaynakta yapılaşma koşulu bulundu.' : 'Açık resmî kaynakta plan metaverisi bulundu.' } : null;
  return {
    status: actionable ? 'found' : any ? 'metadata-only' : 'not-found',
    message: actionable ? `Yapılaşma bilgisi bulundu: ${fieldNames(fields).join(', ')}.` : any ? 'Plan/metaveri bulundu; hesaplamaya yeterli yapılaşma değeri bulunamadı.' : 'Yapılaşma değeri bulunamadı.',
    record,
    source,
    discovered: []
  };
}

/** Her belediyenin farklı yazdığı alan adlarını Planlamasyon ortak alanlarına çevirir. */
export function normalizeOpenZoningAttributes(input = {}) {
  const flat = flattenAttributes(input);
  const lookup = new Map();
  for (const [key, value] of Object.entries(flat)) {
    const normalizedKey = normalizeKey(key);
    if (normalizedKey && value != null && String(value).trim() !== '') lookup.set(normalizedKey, value);
  }
  const pick = (...aliases) => {
    for (const alias of aliases) {
      const value = lookup.get(normalizeKey(alias));
      if (value != null && String(value).trim() !== '') return value;
    }
    return null;
  };
  const textCorpus = Object.entries(flat).map(([key, value]) => `${key}: ${value}`).join(' | ');
  const parsed = parseZoningText(textCorpus);
  const rawYencok = pick('hmax', 'yencok', 'maksimumyukseklik', 'yapıyuksekligi', 'yapiyuksekligi', 'maxyukseklik');
  const rawBuildingOrder = pick('yapinizami', 'yapinizzami', 'yapinazim', 'yapinizam', 'nizam', 'yapiduzeni', 'buildingorder');
  const fields = normalizeZoningFields({
    landUse: pick('planfonksiyonu', 'fonksiyon', 'kullanimkarari', 'arazikullanimi', 'lejant', 'imarfonksiyonu', 'alanadi', 'kullanim', 'landuse') ?? parsed.landUse,
    taks: normalizeRatioValue(pick('taks', 'tabanalankatsayisi', 'tabanalaniyapilasmaorani', 'tabanalankatsayi')) ?? parsed.taks,
    emsal: normalizeRatioValue(pick('emsal', 'kaks', 'katlaralanikatsayisi', 'emsalorani', 'emsalkaks')) ?? parsed.emsal,
    floors: normalizeIntegerValue(pick('katadedi', 'katsayisi', 'maxkat', 'maksimumkat', 'yapikatadedi', 'kat')) ?? normalizeFloorsFromYencok(rawYencok) ?? parsed.floors,
    hmax: normalizeHmaxValue(rawYencok) ?? parsed.hmax,
    buildingOrder: normalizeBuildingOrderValue(rawBuildingOrder) ?? parsed.buildingOrder,
    frontSetback: normalizeLengthValue(pick('onbahce', 'onbahcemesafesi', 'onyapilasmamesafesi', 'oncekme')) ?? parsed.frontSetback,
    sideSetback: normalizeLengthValue(pick('yanbahce', 'yanbahcemesafesi', 'yanyapilasmamesafesi', 'yancekme')) ?? parsed.sideSetback,
    rearSetback: normalizeLengthValue(pick('arkabahce', 'arkabahcemesafesi', 'arkayapilasmamesafesi', 'arkacekme')) ?? parsed.rearSetback,
    planName: pick('planadi', 'planismi', 'planbasligi', 'plankismi', 'planname'),
    planNumber: pick('planislemnumarasi', 'planno', 'planpin', 'pinnumarasi', 'kararno', 'islemno'),
    planScale: normalizeScale(pick('planolcegi', 'olcek', 'scale')),
    planDate: normalizeDate(pick('planonaytarihi', 'onaytarihi', 'plantarihi', 'karartarihi', 'tarih')),
    authority: pick('kurumadi', 'yetkiliidare', 'idareadi', 'belediyeadi', 'onaylayankurum', 'kurum'),
    planNotes: pick('plannotu', 'plannotlari', 'aciklama', 'notlar', 'hukumler')
  });
  return fields;
}

export function extractOfficialServiceUrls(html, baseUrl) {
  const source = decodeEntities(String(html || '').replace(/\\\//g, '/').replace(/&amp;/gi, '&'));
  const raw = new Set();
  const patterns = [
    /https?:\/\/[^\s"'<>]+\/(?:rest\/services\/)?[^\s"'<>]*?(?:MapServer|FeatureServer)(?:\/\d+)?/gi,
    /https?:\/\/[^\s"'<>]+\/(?:geoserver\/[^\s"'<>]+|[^\s"'<>]*?(?:_wms|_wfs))(?:\?[^\s"'<>]*)?/gi,
    /(?:src|href|url|serviceUrl|wmsUrl|wfsUrl|apiUrl)\s*[:=]\s*["']([^"']+)["']/gi
  ];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(source))) {
      const value = match[1] || match[0];
      try {
        const url = new URL(value, baseUrl);
        if (!isAllowedPublicUrl(url)) continue;
        const kind = inferKind(url.toString(), {});
        if (!['wms', 'wfs', 'arcgis', 'json'].includes(kind)) continue;
        raw.add(url.toString());
      } catch {}
      if (raw.size >= 20) break;
    }
  }
  return [...raw].map((url) => ({ kind: inferKind(url, {}), url, layers: [] }));
}


function extractFirstPartyScriptUrls(html, baseUrl) {
  const output = [];
  let base;
  try { base = new URL(baseUrl); } catch { return output; }
  const pattern = /<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi;
  let match;
  while ((match = pattern.exec(String(html || '')))) {
    try {
      const url = new URL(decodeEntities(match[1]), base);
      if (!isAllowedPublicUrl(url) || url.hostname !== base.hostname) continue;
      if (!/\.(?:js|mjs)(?:\?|$)|\/js\/|\/assets\//i.test(url.pathname + url.search)) continue;
      output.push(url.toString());
    } catch {}
    if (output.length >= 8) break;
  }
  return [...new Set(output)];
}

function dedupeServiceItems(items) {
  const seen = new Set();
  return (items || []).filter((item) => {
    const key = `${item?.kind || ''}:${item?.url || ''}`;
    if (!item?.url || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 20);
}

async function discoverWmsLayers(endpoint, timeoutMs, fetchImpl, keywords = []) {
  const url = withQuery(endpoint, { SERVICE: 'WMS', REQUEST: 'GetCapabilities', VERSION: '1.3.0' });
  const response = await fetchWithTimeout(url, { headers: standardHeaders('application/xml,text/xml,*/*') }, timeoutMs, fetchImpl);
  if (!response.ok) throw httpStatusError(`WMS GetCapabilities ${response.status} yanıtı verdi.`, response.status);
  const xml = await response.text();
  return chooseLayerNames([...xml.matchAll(/<Name>([^<]+)<\/Name>/gi)].map((match) => decodeEntities(match[1])), keywords);
}

async function discoverWfsLayers(endpoint, timeoutMs, fetchImpl, keywords = []) {
  const url = withQuery(endpoint, { SERVICE: 'WFS', REQUEST: 'GetCapabilities', VERSION: '2.0.0' });
  const response = await fetchWithTimeout(url, { headers: standardHeaders('application/xml,text/xml,*/*') }, timeoutMs, fetchImpl);
  if (!response.ok) throw httpStatusError(`WFS GetCapabilities ${response.status} yanıtı verdi.`, response.status);
  const xml = await response.text();
  return chooseLayerNames([...xml.matchAll(/<(?:wfs:)?Name>([^<]+)<\/(?:wfs:)?Name>/gi)].map((match) => decodeEntities(match[1])), keywords);
}

function chooseLayerNames(names, keywords = []) {
  const unique = [...new Set(names.map((name) => clean(name, 240)).filter(Boolean))];
  const wanted = [...keywords, 'imar', 'plan', 'yapı', 'yapi', 'emsal', 'kaks', 'taks', 'fonksiyon', 'uip', 'nip'].map(normalizeKey);
  const scored = unique.map((name) => ({ name, score: wanted.reduce((total, keyword) => total + (normalizeKey(name).includes(keyword) ? 10 : 0), 0) }));
  return scored.sort((a, b) => b.score - a.score).filter((item, index) => item.score > 0 || index < 3).slice(0, 10).map((item) => item.name);
}

async function fetchWmsFeatureInfo(endpoint, layer, center, timeoutMs, fetchImpl) {
  const formats = ['application/json', 'text/html', 'text/xml'];
  const errors = [];
  for (const infoFormat of formats) {
    const delta = 0.0008;
    const bbox = [center.lon - delta, center.lat - delta, center.lon + delta, center.lat + delta].map((value) => value.toFixed(7)).join(',');
    const url = withQuery(endpoint, {
      SERVICE: 'WMS', VERSION: '1.1.1', REQUEST: 'GetFeatureInfo', LAYERS: layer, QUERY_LAYERS: layer,
      STYLES: '', SRS: 'EPSG:4326', BBOX: bbox, WIDTH: '101', HEIGHT: '101', X: '50', Y: '50',
      FORMAT: 'image/png', INFO_FORMAT: infoFormat, FEATURE_COUNT: '10', TRANSPARENT: 'true'
    });
    try {
      const response = await fetchWithTimeout(url, { headers: standardHeaders(`${infoFormat},application/vnd.ogc.gml;q=0.9,*/*;q=0.1`) }, timeoutMs, fetchImpl);
      if (!response.ok) throw httpStatusError(`WMS katmanı ${response.status} yanıtı verdi.`, response.status);
      const text = await response.text();
      const rows = parseFeaturePayload(text, response.headers?.get?.('content-type') || infoFormat);
      if (rows.length) return mergeAttributeRows(rows);
      return null;
    } catch (error) {
      errors.push(error);
      if (![400, 406, 415].includes(Number(error?.status))) break;
    }
  }
  if (errors.length) throw errors.at(-1);
  return null;
}

async function fetchWfsFeature(endpoint, layer, center, timeoutMs, fetchImpl) {
  const delta = 0.0009;
  const bbox = `${center.lon - delta},${center.lat - delta},${center.lon + delta},${center.lat + delta},EPSG:4326`;
  const attempts = [
    { VERSION: '2.0.0', typeNames: layer, count: '10' },
    { VERSION: '1.1.0', typeName: layer, maxFeatures: '10' }
  ];
  const errors = [];
  for (const attempt of attempts) {
    const url = withQuery(endpoint, {
      SERVICE: 'WFS', REQUEST: 'GetFeature', ...attempt,
      outputFormat: 'application/json', srsName: 'EPSG:4326', bbox
    });
    try {
      const response = await fetchWithTimeout(url, { headers: standardHeaders('application/json,application/gml+xml,text/xml,*/*') }, timeoutMs, fetchImpl);
      if (!response.ok) throw httpStatusError(`WFS katmanı ${response.status} yanıtı verdi.`, response.status);
      const text = await response.text();
      const rows = parseFeaturePayload(text, response.headers?.get?.('content-type') || '');
      if (rows.length) return mergeAttributeRows(rows);
      return null;
    } catch (error) {
      errors.push(error);
      if (![400, 404, 406, 415].includes(Number(error?.status))) break;
    }
  }
  if (errors.length) throw errors.at(-1);
  return null;
}

function parseFeaturePayload(text, contentType = '') {
  const source = String(text || '').trim();
  if (!source || /ServiceException|ExceptionReport|LayerNotDefined|InvalidFormat|OperationNotSupported/i.test(source)) return [];
  if (/json/i.test(contentType) || /^[\[{]/.test(source)) {
    try {
      const json = JSON.parse(source);
      const rows = Array.isArray(json?.features) ? json.features.map((feature) => feature?.properties || feature?.attributes || feature).filter(Boolean)
        : Array.isArray(json) ? json : [json?.data || json?.result || json].filter(Boolean);
      return rows.filter((item) => item && typeof item === 'object');
    } catch {}
  }
  const htmlRows = parseHtmlTables(source);
  if (htmlRows.length) return htmlRows;
  const xml = parseXmlRows(source);
  return xml.length ? xml : [];
}

function parseHtmlTables(source) {
  const rows = [];
  const tablePattern = /<table\b[^>]*>([\s\S]*?)<\/table>/gi;
  let table;
  while ((table = tablePattern.exec(source))) {
    const record = {};
    const rowPattern = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
    let row;
    while ((row = rowPattern.exec(table[1]))) {
      const cells = [...row[1].matchAll(/<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/gi)].map((match) => stripMarkup(match[1]));
      if (cells.length >= 2 && cells[0]) record[cells[0]] = cells.slice(1).join(' ');
    }
    if (Object.keys(record).length) rows.push(record);
  }
  return rows;
}

function parseXmlRows(source) {
  const rows = [];
  const members = [...source.matchAll(/<(?:gml:featureMember|wfs:member|featureMember)\b[^>]*>([\s\S]*?)<\/(?:gml:featureMember|wfs:member|featureMember)>/gi)];
  const blocks = members.length ? members.map((match) => match[1]) : [source];
  for (const block of blocks) {
    const record = {};
    const pattern = /<([A-Za-z_][\w.-]*(?::[A-Za-z_][\w.-]*)?)\b[^>]*>([^<]{1,2000})<\/\1>/g;
    let match;
    while ((match = pattern.exec(block))) {
      const key = match[1].split(':').at(-1);
      if (/^(boundedBy|coordinates|posList|pos|geometry|the_geom|geom)$/i.test(key)) continue;
      record[key] = decodeEntities(match[2]);
      if (Object.keys(record).length >= 100) break;
    }
    if (Object.keys(record).length) rows.push(record);
  }
  return rows;
}

function chooseArcGisLayers(metadata = {}, keywords = []) {
  const layers = [...(metadata.layers || []), ...(metadata.tables || [])];
  const wanted = [...keywords, 'imar', 'plan', 'yapı', 'yapi', 'emsal', 'kaks', 'taks', 'fonksiyon', 'uip', 'nazım', 'nazim'].map(normalizeKey);
  return layers.map((layer) => ({ ...layer, score: wanted.reduce((sum, keyword) => sum + (normalizeKey(layer.name).includes(keyword) ? 10 : 0), 0) }))
    .sort((a, b) => b.score - a.score)
    .filter((item, index) => item.score > 0 || index < 3);
}

function parseArcGisEndpoint(value) {
  const url = new URL(allowedPublicUrl(value));
  const match = url.pathname.match(/\/(MapServer|FeatureServer)(?:\/(\d+))?\/?$/i);
  if (!match) throw new Error('ArcGIS servis adresi MapServer veya FeatureServer olmalıdır.');
  url.search = '';
  return { url: url.toString().replace(/\/$/, ''), layerId: match[2] == null ? null : Number(match[2]) };
}

function mergeAttributeRows(rows) {
  const output = {};
  for (const row of rows || []) {
    if (!row || typeof row !== 'object') continue;
    for (const [key, value] of Object.entries(row)) {
      if (value == null || value === '') continue;
      if (!(key in output)) output[key] = value;
      else if (String(output[key]) !== String(value)) output[`${key}_${Object.keys(output).length}`] = value;
    }
  }
  return output;
}

function flattenAttributes(value, prefix = '', output = {}, depth = 0) {
  if (depth > 4 || value == null) return output;
  if (Array.isArray(value)) {
    value.slice(0, 20).forEach((item, index) => flattenAttributes(item, `${prefix}${index}`, output, depth + 1));
    return output;
  }
  if (typeof value === 'object') {
    Object.entries(value).slice(0, 200).forEach(([key, item]) => flattenAttributes(item, prefix ? `${prefix}.${key}` : key, output, depth + 1));
    return output;
  }
  output[prefix || 'value'] = String(value).slice(0, 4000);
  return output;
}

function parseZoningText(text) {
  const source = String(text || '').replace(/\s+/g, ' ');
  const normalizedSource = normalizeSearchText(source);
  const ratio = (label) => {
    const match = source.match(new RegExp(`(?:${label})\\s*[:=]?\\s*(\\d+(?:[.,]\\d+)?)`, 'i'));
    return match ? normalizeRatioValue(match[1]) : null;
  };
  const length = (label) => {
    const match = source.match(new RegExp(`(?:${label})\\s*[:=]?\\s*(\\d+(?:[.,]\\d+)?)\\s*m?`, 'i'));
    return match ? normalizeLengthValue(match[1]) : null;
  };
  const floorsMatch = source.match(/(?:kat\s*adedi|kat\s*sayısı|kat\s*sayisi|max\.?\s*kat|en\s*fazla)\s*[:=]?\s*(\d{1,3})\s*kat?/i)
    || source.match(/\b(\d{1,3})\s*katlı\b/i)
    || source.match(/(?:Hmax|Yençok|Yencok|Yençok\s*\(Hmax\))\s*[:=]?\s*(\d{1,3})\s*kat\b/i);
  const hmaxMatch = source.match(/(?:Hmax|Yençok|Yencok|Yençok\s*\(Hmax\)|maksimum\s*yükseklik)\s*[:=]?\s*(\d+(?:[.,]\d+)?)\s*(?:m|metre)\b/i);
  const landUseMatch = source.match(/(?:plan\s*fonksiyon(?:u)?|kullanım\s*kararı|arazi\s*kullanımı|imar\s*fonksiyonu|fonksiyon)\s*[:=-]?\s*([^|;,.]{3,120}?)(?=\s+(?:TAKS|Emsal|KAKS|Hmax|Yençok|Yencok|kat\s*adedi|kat\s*sayısı|kat\s*sayisi|yapı\s*nizamı|yapi\s*nizami|inşaat\s*nizamı|insaat\s*nizami|nizam|ön\s*bahçe|yan\s*bahçe|arka\s*bahçe)\b|\s*\||$)/i);
  const orderMatch = normalizedSource.match(/(?:yapi\s*nizami|yapinizami|insaat\s*nizami|yapi\s*duzeni|nizam)\s*[:=-]?\s*(ayrik|bitisik|blok|serbest)(?:\s+nizam)?\b(?=\s*(?:[|;,.]|taks\b|emsal\b|kaks\b|yencok\b|hmax\b|kat\s+(?:adedi|sayisi)\b|on\s+bahce\b|yan\s+bahce\b|arka\s+bahce\b|$))/i);
  return {
    taks: ratio('TAKS|taban alanı katsayısı'),
    emsal: ratio('Emsal|KAKS|katlar alanı katsayısı'),
    floors: floorsMatch ? Number(floorsMatch[1]) : null,
    hmax: hmaxMatch ? normalizeLengthValue(hmaxMatch[1]) : null,
    frontSetback: length('ön bahçe(?: mesafesi)?|ön çekme'),
    sideSetback: length('yan bahçe(?: mesafesi)?|yan çekme'),
    rearSetback: length('arka bahçe(?: mesafesi)?|arka çekme'),
    landUse: landUseMatch ? clean(landUseMatch[1], 180) : null,
    buildingOrder: orderMatch ? normalizeBuildingOrderValue(orderMatch[1]) : null
  };
}

function fieldNames(fields = {}) {
  const labels = {
    landUse: 'plan fonksiyonu', taks: 'TAKS', emsal: 'emsal', floors: 'kat adedi', hmax: 'Yençok/Hmax',
    buildingOrder: 'yapı nizamı', frontSetback: 'ön bahçe', sideSetback: 'yan bahçe', rearSetback: 'arka bahçe',
    planName: 'plan adı', planScale: 'plan ölçeği', planNumber: 'plan numarası', planDate: 'plan tarihi', authority: 'yetkili idare'
  };
  return Object.keys(labels).filter((key) => fields?.[key] != null && fields[key] !== '').map((key) => labels[key]);
}

function hasActionableField(fields) { return ACTIONABLE_FIELDS.some((key) => fields?.[key] != null && fields[key] !== ''); }
function hasAnyField(fields) { return [...ACTIONABLE_FIELDS, 'planName', 'planNumber', 'planScale', 'planDate', 'authority', 'planNotes'].some((key) => fields?.[key] != null && fields[key] !== ''); }

function result(status, message, candidate) {
  return {
    status,
    message,
    record: null,
    source: {
      id: candidate.id,
      title: candidate.title,
      provider: candidate.provider,
      url: candidate.endpoint || candidate.url || null,
      kind: candidate.kind === 'portal' ? 'official-portal' : 'official-open-source',
      trust: 'public-information',
      note: message,
      scanVersion: OPEN_OFFICIAL_SOURCE_VERSION
    },
    discovered: [],
    aiEvidence: []
  };
}

function manualOnlyResult(candidate) {
  const message = 'Bu resmî portal kullanım koşulları gereği yalnızca kullanıcı tarafından elle sorgulanır; otomatik form işlemi yapılmadı.';
  return {
    status: 'manual-only',
    message,
    record: null,
    source: {
      id: candidate.id,
      title: candidate.title,
      provider: candidate.provider,
      url: candidate.endpoint || candidate.url || null,
      kind: 'official-portal',
      trust: 'manual-verification-required',
      note: message,
      accessMode: 'manual-only',
      automatedQueryAllowed: false,
      termsUrl: candidate.termsUrl || null,
      scanVersion: OPEN_OFFICIAL_SOURCE_VERSION
    },
    discovered: [],
    aiEvidence: []
  };
}

function unavailableResult(message, center = null, attempts = [], exhausted = true) {
  return {
    status: exhausted ? 'exhausted' : 'disabled',
    version: OPEN_OFFICIAL_SOURCE_VERSION,
    center,
    location: {},
    exhausted,
    budgetLimited: false,
    totalBudgetMs: 0,
    elapsedMs: 0,
    totalCandidateCount: attempts.length,
    attemptedCount: attempts.length,
    reachableCount: 0,
    foundRecordCount: 0,
    foundFieldCount: 0,
    manualOnlyCount: attempts.filter((item) => item?.status === 'manual-only').length,
    records: [],
    sources: [],
    aiEvidence: [],
    attempts,
    discoveredServices: [],
    diagnostics: [],
    message
  };
}

function resolveLocation(parcel, query) {
  const p = parcel?.properties || {};
  const province = clean(p.province || query?.province, 120);
  const district = clean(p.district || query?.district, 120);
  const neighbourhood = clean(p.neighbourhood || query?.neighbourhood, 160);
  return { province, district, neighbourhood, provinceKey: normalizeKey(province), districtKey: normalizeKey(district), neighbourhoodKey: normalizeKey(neighbourhood) };
}

function matchesLocation(item, location) {
  const province = normalizeKey(item.province || item.il || '');
  const district = normalizeKey(item.district || item.ilce || '');
  if (province && province !== '*' && province !== location.provinceKey) return false;
  if (district && district !== '*' && district !== location.districtKey) return false;
  return true;
}

function inferKind(value, item = {}) {
  const text = String(value || '').toLowerCase();
  const explicit = String(item.kind || '').toLowerCase();
  if (['wms', 'wfs', 'arcgis', 'json', 'portal'].includes(explicit)) return explicit;
  if (/\/rest\/services\/|mapserver|featureserver/.test(text)) return 'arcgis';
  if (/(?:service=|request=)?wfs|_wfs|\/wfs(?:\?|$)/.test(text)) return 'wfs';
  if (/(?:service=|request=)?wms|_wms|\/wms(?:\?|$)/.test(text)) return 'wms';
  if (/\.json(?:\?|$)|\/api\//.test(text)) return 'json';
  return 'portal';
}

function normalizeLayers(value) {
  if (!value) return [];
  const list = Array.isArray(value) ? value : String(value).split(/[;,|]/);
  return list.map((item) => clean(item, 240)).filter(Boolean).slice(0, 20);
}

function normalizeRatioValue(value) {
  if (value == null || value === '') return null;
  const match = String(value).replace(',', '.').match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const number = Number(match[0]);
  return Number.isFinite(number) && number >= 0 && number <= 15 ? number : null;
}
function normalizeIntegerValue(value) {
  if (value == null || value === '') return null;
  const match = String(value).match(/\d{1,3}/);
  if (!match) return null;
  const number = Number(match[0]);
  return Number.isInteger(number) && number >= 1 && number <= 150 ? number : null;
}
function normalizeLengthValue(value) {
  if (value == null || value === '') return null;
  const match = String(value).replace(',', '.').match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const number = Number(match[0]);
  return Number.isFinite(number) && number >= 0 && number <= 1000 ? number : null;
}
function normalizeHmaxValue(value) {
  if (value == null || value === '') return null;
  if (/\bkat\b/iu.test(String(value))) return null;
  return normalizeLengthValue(value);
}
function normalizeFloorsFromYencok(value) {
  if (value == null || value === '') return null;
  const match = String(value).match(/\b(\d{1,3})\s*kat\b/iu);
  return match ? normalizeIntegerValue(match[1]) : null;
}
function normalizeBuildingOrderValue(value) {
  const text = clean(value, 120);
  if (!text) return null;
  const normalized = normalizeKey(text);
  if (normalized.includes('ayrik')) return 'Ayrık';
  if (normalized.includes('bitisik')) return 'Bitişik';
  if (normalized.includes('blok')) return 'Blok';
  if (normalized.includes('serbest')) return 'Serbest';
  return text;
}
function normalizeScale(value) {
  if (!value) return null;
  const text = clean(value, 80);
  const match = text.match(/(?:1\s*[:/]\s*)?(\d{3,7})/);
  return match ? `1/${Number(match[1]).toLocaleString('tr-TR')}` : text;
}
function normalizeDate(value) {
  if (!value) return null;
  const text = clean(value, 80);
  const tr = text.match(/(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})/);
  if (tr) return `${tr[3]}-${String(tr[2]).padStart(2, '0')}-${String(tr[1]).padStart(2, '0')}`;
  const iso = text.match(/(\d{4})[.\/-](\d{1,2})[.\/-](\d{1,2})/);
  return iso ? `${iso[1]}-${String(iso[2]).padStart(2, '0')}-${String(iso[3]).padStart(2, '0')}` : null;
}

function dedupeRecords(records) {
  const seen = new Set();
  return records.filter((record) => {
    const signature = JSON.stringify(record?.fields || {});
    const key = `${record?.source?.url || record?.source?.id}:${signature}`;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
function dedupeSources(sources) {
  const seen = new Set();
  return sources.filter((source) => {
    const key = source?.id || source?.url || source?.title;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
function dedupeCandidates(candidates) {
  const seen = new Set();
  return candidates.filter((candidate) => {
    const key = candidateKey(candidate);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
function candidateKey(candidate) { return `${candidate?.kind || ''}:${candidate?.endpoint || candidate?.url || candidate?.id || ''}`; }

async function fetchJson(url, timeoutMs, fetchImpl, title) {
  const response = await fetchWithTimeout(url, { headers: standardHeaders('application/json,*/*;q=0.2') }, timeoutMs, fetchImpl);
  if (!response.ok) throw httpStatusError(`${title || 'Resmî veri servisi'} ${response.status} yanıtı verdi.`, response.status);
  const text = await response.text();
  try { return JSON.parse(text); } catch { throw new Error(`${title || 'Resmî veri servisi'} geçerli JSON döndürmedi.`); }
}
async function fetchWithTimeout(url, options, timeoutMs, fetchImpl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try { return await fetchImpl(url, { ...options, signal: controller.signal }); }
  catch (error) {
    if (error?.name === 'AbortError') throw new Error('Resmî kaynak zaman aşımına uğradı.');
    throw error;
  } finally { clearTimeout(timer); }
}
function standardHeaders(accept) {
  return { Accept: accept, 'Accept-Language': 'tr-TR,tr;q=0.9,en;q=0.4', 'User-Agent': 'Planlamasyon/3.4.0 (+https://planlamasyon.truva-ai.com)' };
}
function withQuery(value, params) {
  const url = new URL(allowedPublicUrl(value));
  for (const [key, item] of Object.entries(params || {})) if (item != null) url.searchParams.set(key, String(item));
  return url.toString();
}
function allowedPublicUrl(value) {
  const url = new URL(String(value));
  if (!isAllowedPublicUrl(url)) throw new Error('Açık resmî kaynak adresi güvenli değil.');
  return url.toString();
}
function safePublicUrl(value) { try { return allowedPublicUrl(value); } catch { return null; } }
function isAllowedPublicUrl(url) {
  if (url.protocol !== 'https:') return false;
  const host = String(url.hostname).toLowerCase();
  if (host === 'localhost' || host.endsWith('.local')) return false;
  if (/^(127\.|10\.|192\.168\.|169\.254\.)/.test(host)) return false;
  const match = host.match(/^172\.(\d+)\./);
  if (match && Number(match[1]) >= 16 && Number(match[1]) <= 31) return false;
  return true;
}
function classifyError(error) {
  const status = Number(error?.status);
  if ([401, 403].includes(status)) return 'auth-required';
  if ([404, 204].includes(status)) return 'not-found';
  if (status === 429) return 'rate-limited';
  if (status >= 500 && status <= 599) return 'server-error';
  if (error?.name === 'AbortError' || /zaman aşım/i.test(error?.message || '')) return 'timeout';
  return 'unreachable';
}
function isTransientAttemptStatus(status) {
  return ['timeout', 'unreachable', 'auth-required', 'rate-limited', 'server-error', 'budget-skipped'].includes(status);
}
function httpStatusError(message, status) { const error = new Error(message); error.status = status; return error; }
function serviceKindLabel(kind) { return ({ wms: 'WMS katmanı', wfs: 'WFS katmanı', arcgis: 'ArcGIS servisi', json: 'JSON servisi' })[kind] || 'açık veri servisi'; }
function stripMarkup(value) { return clean(decodeEntities(String(value || '').replace(/<[^>]+>/g, ' ')), 1200); }
function decodeEntities(value) { return String(value || '').replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'").replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&nbsp;/gi, ' ').replace(/&#(\d+);/g, (_m, code) => String.fromCodePoint(Number(code))).replace(/&#x([0-9a-f]+);/gi, (_m, code) => String.fromCodePoint(parseInt(code, 16))); }
function normalizeKey(value) { return String(value || '').toLocaleLowerCase('tr-TR').replace(/ç/g, 'c').replace(/ğ/g, 'g').replace(/ı/g, 'i').replace(/ö/g, 'o').replace(/ş/g, 's').replace(/ü/g, 'u').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9*]/g, ''); }
function normalizeSearchText(value) { return String(value || '').toLocaleLowerCase('tr-TR').replace(/ç/g, 'c').replace(/ğ/g, 'g').replace(/ı/g, 'i').replace(/ö/g, 'o').replace(/ş/g, 's').replace(/ü/g, 'u').normalize('NFKD').replace(/[\u0300-\u036f]/g, ''); }
function cleanId(value) { return normalizeKey(value).slice(0, 120) || `source-${Math.random().toString(36).slice(2, 10)}`; }
function clean(value, max = 500) { if (value == null) return null; const text = String(value).replace(/[\u0000-\u001f<>]/g, ' ').replace(/\s+/g, ' ').trim(); return text ? text.slice(0, max) : null; }
function safeMessage(error) { return clean(error?.message || error, 500) || 'Bilinmeyen bağlantı hatası'; }
function parseJson(value, fallback) { if (!value) return fallback; try { return typeof value === 'string' ? JSON.parse(value) : value; } catch { return fallback; } }
function clampInt(value, min, max, fallback) { const number = Number(value); return Number.isFinite(number) ? Math.min(max, Math.max(min, Math.trunc(number))) : fallback; }
function trimCache() { while (CACHE.size > 500) CACHE.delete(CACHE.keys().next().value); }
