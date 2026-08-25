const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const STORE_KEYS = {
  works: 'planlamasyon-works-v3-1',
  favorites: 'planlamasyon-favorites-v3-1',
  requests: 'planlamasyon-requests-v3-1',
  evidence: 'planlamasyon-evidence-v3-1',
  profile: 'planlamasyon-profile-v3-1',
  session: 'planlamasyon-identity-session-v3-1'
};

const elements = {
  themeSwitch: $('#themeSwitch'), startButton: $('#startButton'), openAiButton: $('#openAiButton'),
  profileButton: $('#profileButton'), profileMenu: $('#profileMenu'), profileIdentity: $('#profileIdentity'),
  profileInitials: $('#profileInitials'), profileSvg: $('#profileSvg'), profileMenuUser: $('#profileMenuUser'),
  profileMenuName: $('#profileMenuName'), profileMenuEmail: $('#profileMenuEmail'), profileAuthButton: $('#profileAuthButton'),
  profileLogoutButton: $('#profileLogoutButton'), parcelSection: $('#parcelSection'), connectionBanner: $('#connectionBanner'),
  parcelForm: $('#parcelForm'), province: $('#provinceSelect'), district: $('#districtSelect'), neighbourhood: $('#neighbourhoodSelect'),
  block: $('#blockInput'), parcel: $('#parcelInput'), submit: $('#parcelSubmit'), resetMap: $('#resetMapButton'),
  mapClick: $('#mapClickButton'), mapCaption: $('#mapCaption'), mapLoading: $('#mapLoading'), mapUnavailable: $('#mapUnavailable'),
  mapBaseStatus: $('#mapBaseStatus'), mapBaseRetryButton: $('#mapBaseRetryButton'),
  resultSection: $('#resultSection'), analysisProgress: $('#analysisProgress'), analysisStatus: $('#analysisStatus'),
  analysisStatusIcon: $('#analysisStatusIcon'), analysisStatusTitle: $('#analysisStatusTitle'), analysisStatusText: $('#analysisStatusText'),
  parcelAddress: $('#parcelAddress'), plainExplanation: $('#plainExplanation'), metricArea: $('#metricArea'),
  mobileResultSummary: $('#mobileResultSummary'), mobileSummaryParcel: $('#mobileSummaryParcel'), mobileSummaryCadastre: $('#mobileSummaryCadastre'), mobileSummaryZoning: $('#mobileSummaryZoning'),
  cadastreStatusChip: $('#cadastreStatusChip'), zoningStatusChip: $('#zoningStatusChip'), aiStatusChip: $('#aiStatusChip'), summaryGrid: $('#summaryGrid'),
  metricQuality: $('#metricQuality'), metricMapSheet: $('#metricMapSheet'), metricBlockParcel: $('#metricBlockParcel'),
  zoningOverviewTitle: $('#zoningOverviewTitle'), zoningOverviewText: $('#zoningOverviewText'), zoningMiniList: $('#zoningMiniList'),
  summaryFloors: $('#summaryFloors'), summaryFootprint: $('#summaryFootprint'), summaryConstruction: $('#summaryConstruction'), summaryOutside: $('#summaryOutside'),
  possibilityGrid: $('#possibilityGrid'), warningList: $('#warningList'), zoningCompletionCard: $('#zoningCompletionCard'),
  addEvidenceButton: $('#addEvidenceButton'), requestAnalysisButton: $('#requestAnalysisButton'), technicalList: $('#technicalList'),
  environmentBadge: $('#environmentBadge'), environmentIntro: $('#environmentIntro'), environmentGrid: $('#environmentGrid'),
  officialServicesCard: $('#officialServicesCard'), officialServicesBadge: $('#officialServicesBadge'), officialServicesIntro: $('#officialServicesIntro'),
  officialServicesGrid: $('#officialServicesGrid'), primaryOfficialServiceLink: $('#primaryOfficialServiceLink'),
  planRecordsCard: $('#planRecordsCard'), planRecordsBadge: $('#planRecordsBadge'), planRecordsIntro: $('#planRecordsIntro'), planRecordsGrid: $('#planRecordsGrid'),
  sourceScanCard: $('#sourceScanCard'), sourceScanBadge: $('#sourceScanBadge'), sourceScanIntro: $('#sourceScanIntro'), sourceScanGrid: $('#sourceScanGrid'), retrySourceScanButton: $('#retrySourceScanButton'),
  planAiCard: $('#planAiCard'), planAiBadge: $('#planAiBadge'), planAiIntro: $('#planAiIntro'), planAiEvidence: $('#planAiEvidence'), planAiAskButton: $('#planAiAskButton'),
  roadmap: $('#roadmap'), claimList: $('#claimList'), sourceList: $('#sourceList'), favoriteButton: $('#favoriteButton'), shareSummaryButton: $('#shareSummaryButton'),
  drawer: $('#sideDrawer'), drawerBackdrop: $('#drawerBackdrop'), drawerTitle: $('#drawerTitle'), drawerContent: $('#drawerContent'),
  drawerClose: $('#drawerClose'), toast: $('#toast')
};

const state = {
  provinces: [], districts: [], neighbourhoods: [], parcelFeature: null, analysis: null,
  map: null, boundaryLayer: null, parcelLayer: null, parcelMarker: null, mapClickActive: false,
  lastQuery: null, toastTimer: null, analysisAbort: null, identityEnabled: false, user: null, session: null,
  syncTimer: null, syncInProgress: false, accountSyncEnabled: false,
  mapBaseLayer: null, mapBaseFallbackActivated: false, mapBaseUserSelected: false, mapBaseLoaded: false,
  mapBaseAutomaticSwitches: 0, mapBaseFailureTimer: null
};

boot().catch((error) => {
  console.error(error);
  setConnection('error', 'Bağlantı kurulamadı', readableError(error));
});

async function boot() {
  setupTheme();
  setupHeader();
  setupDrawer();
  setupForm();
  setupMap();
  setupActions();
  setupFooter();
  updateProfileUi();
  void initializeIdentity();

  if (location.protocol === 'file:') {
    setConnection('error', 'Bu dosya sunucu üzerinden açılmalı', 'Canlı servisler için yayın sunucusu veya yerel geliştirme sunucusu kullanılmalıdır.');
    throw new Error('STATIC_FILE_MODE');
  }

  const status = await apiTkgm('status');
  if (!status.enabled) throw new Error('TKGM bilgi bağlantısı bu kurulumda kapalı.');
  await loadProvinces();
  setConnection('ok', 'Parsel sorgusu bilgi amaçlı hazır', 'Kadastro bağlantısı bilgi amaçlıdır; ticari/kurumsal veri kullanımı için TAKPAS ve ilgili kurum yetkileri gerekir.');
}

function setupTheme() {
  syncTheme();
  elements.themeSwitch.addEventListener('click', () => {
    const root = document.documentElement;
    const next = root.dataset.theme === 'light' ? 'dark' : 'light';
    root.classList.add('theme-changing');
    root.dataset.theme = next;
    root.style.colorScheme = next;
    try { localStorage.setItem('planlamasyon-theme-v3-2-0', next); } catch {}
    syncTheme();
    requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove('theme-changing')));
  });
}

function syncTheme() {
  const light = document.documentElement.dataset.theme === 'light';
  elements.themeSwitch.setAttribute('aria-pressed', String(light));
  elements.themeSwitch.setAttribute('aria-label', light ? 'Koyu temaya geç' : 'Açık temaya geç');
  $('meta[name="theme-color"]').setAttribute('content', light ? '#f4f7fb' : '#06111f');
  document.documentElement.style.colorScheme = light ? 'light' : 'dark';
}

function setupHeader() {
  elements.startButton.addEventListener('click', () => elements.parcelSection.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  elements.openAiButton.addEventListener('click', () => openPlanAiDrawer());
  elements.profileButton.addEventListener('click', (event) => {
    event.stopPropagation();
    elements.profileMenu.hidden = !elements.profileMenu.hidden;
    elements.profileButton.setAttribute('aria-expanded', String(!elements.profileMenu.hidden));
  });
  document.addEventListener('click', (event) => {
    if (!event.target.closest('.profile-wrap')) closeProfileMenu();
  });
  elements.profileMenu.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-panel]');
    if (!button) return;
    closeProfileMenu();
    openProfilePanel(button.dataset.panel);
  });
}

function closeProfileMenu() {
  elements.profileMenu.hidden = true;
  elements.profileButton.setAttribute('aria-expanded', 'false');
}

function setupDrawer() {
  elements.drawerClose.addEventListener('click', closeDrawer);
  elements.drawerBackdrop.addEventListener('click', closeDrawer);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') { closeDrawer(); closeProfileMenu(); }
  });
}

function openDrawer(title, html) {
  elements.drawerTitle.textContent = title;
  elements.drawerContent.innerHTML = html;
  elements.drawer.classList.toggle('is-plan-ai', title.includes('Plan AI'));
  elements.drawer.hidden = false;
  elements.drawerBackdrop.hidden = false;
  document.body.style.overflow = 'hidden';
  requestAnimationFrame(() => elements.drawerClose.focus({ preventScroll: true }));
}

function closeDrawer() {
  elements.drawer.hidden = true;
  elements.drawer.classList.remove('is-plan-ai');
  elements.drawerBackdrop.hidden = true;
  document.body.style.overflow = '';
}

function setupForm() {
  elements.province.addEventListener('change', onProvinceChange);
  elements.district.addEventListener('change', onDistrictChange);
  elements.neighbourhood.addEventListener('change', onNeighbourhoodChange);
  elements.block.addEventListener('input', syncSubmitState);
  elements.parcel.addEventListener('input', syncSubmitState);
  elements.parcelForm.addEventListener('submit', onParcelSubmit);
}

async function loadProvinces() {
  setSelectLoading(elements.province, 'İller yükleniyor…');
  const response = await apiTkgm('provinces');
  state.provinces = response.items || [];
  populateSelect(elements.province, state.provinces, 'İl seçin');
  elements.province.disabled = false;
}

async function onProvinceChange() {
  resetSelect(elements.district, 'Önce il seçin');
  resetSelect(elements.neighbourhood, 'Önce ilçe seçin');
  disableParcelInputs();
  clearResult();
  const item = selectedItem(elements.province, state.provinces);
  if (!item) { resetMapToTurkey(); return; }
  showAdministrativeGeometry(item, item.name);
  setSelectLoading(elements.district, 'İlçeler yükleniyor…');
  try {
    const response = await apiTkgm('districts', { provinceId: item.id });
    state.districts = response.items || [];
    populateSelect(elements.district, state.districts, 'İlçe seçin');
    elements.district.disabled = false;
  } catch (error) {
    resetSelect(elements.district, 'İlçe listesi alınamadı');
    showToast(readableError(error));
  }
}

async function onDistrictChange() {
  resetSelect(elements.neighbourhood, 'Önce ilçe seçin');
  disableParcelInputs();
  clearResult();
  const item = selectedItem(elements.district, state.districts);
  if (!item) {
    const province = selectedItem(elements.province, state.provinces);
    if (province) showAdministrativeGeometry(province, province.name);
    return;
  }
  showAdministrativeGeometry(item, `${selectedName(elements.province)} / ${item.name}`);
  setSelectLoading(elements.neighbourhood, 'Mahalle ve köyler yükleniyor…');
  try {
    const response = await apiTkgm('neighbourhoods', { districtId: item.id });
    state.neighbourhoods = response.items || [];
    populateSelect(elements.neighbourhood, state.neighbourhoods, 'Mahalle / köy seçin');
    elements.neighbourhood.disabled = false;
  } catch (error) {
    resetSelect(elements.neighbourhood, 'Mahalle/köy listesi alınamadı');
    showToast(readableError(error));
  }
}

function onNeighbourhoodChange() {
  clearResult();
  const item = selectedItem(elements.neighbourhood, state.neighbourhoods);
  if (!item) {
    disableParcelInputs();
    const district = selectedItem(elements.district, state.districts);
    if (district) showAdministrativeGeometry(district, `${selectedName(elements.province)} / ${district.name}`);
    return;
  }
  showAdministrativeGeometry(item, `${selectedName(elements.province)} / ${selectedName(elements.district)} / ${item.name}`);
  elements.block.disabled = false;
  elements.parcel.disabled = false;
  syncSubmitState();
}

function syncSubmitState() {
  const ready = Boolean(elements.neighbourhood.value && elements.block.value.trim() && elements.parcel.value.trim());
  elements.submit.disabled = !ready;
}

async function onParcelSubmit(event) {
  event.preventDefault();
  const neighbourhood = selectedItem(elements.neighbourhood, state.neighbourhoods);
  if (!neighbourhood) { showToast('Mahalle veya köy seçin.'); return; }
  const block = elements.block.value.trim();
  const parcel = elements.parcel.value.trim();
  if (!block || !parcel) { showToast('Ada ve parsel numarasını yazın.'); return; }

  setSubmitLoading(true);
  setMapLoading(true);
  try {
    const feature = await apiTkgm('parcel', { neighbourhoodId: neighbourhood.id, block, parcel });
    state.lastQuery = {
      province: selectedName(elements.province), district: selectedName(elements.district), neighbourhood: neighbourhood.name,
      neighbourhoodId: neighbourhood.id, block, parcel
    };
    await renderParcelAndAnalyze(feature, { scroll: true });
  } catch (error) {
    showToast(readableError(error));
  } finally {
    setSubmitLoading(false);
    setMapLoading(false);
  }
}

function setupMap() {
  if (!globalThis.L) {
    elements.mapUnavailable.hidden = false;
    return;
  }
  const map = L.map('parcelMap', { zoomControl: true, attributionControl: true, preferCanvas: true }).setView([39.05, 35.2], 6);
  const imagery = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 20,
    maxNativeZoom: 18,
    attribution: 'Tiles © Esri, Maxar, Earthstar Geographics'
  });
  const osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 20,
    maxNativeZoom: 19,
    attribution: '© OpenStreetMap katkıda bulunanlar'
  });
  const baseLayers = [osm, imagery];
  const errorCounts = new Map(baseLayers.map((layer) => [layer, 0]));
  let automaticSwitch = false;
  const hideMapBaseStatus = () => { if (elements.mapBaseStatus) elements.mapBaseStatus.hidden = true; };
  const showMapBaseStatus = () => { if (elements.mapBaseStatus) elements.mapBaseStatus.hidden = false; };
  const clearBaseFailureTimer = () => {
    clearTimeout(state.mapBaseFailureTimer);
    state.mapBaseFailureTimer = null;
  };
  const armBaseFailureTimer = () => {
    clearBaseFailureTimer();
    state.mapBaseFailureTimer = setTimeout(() => {
      if (!state.mapBaseLoaded) showMapBaseStatus();
    }, 8000);
  };
  const markBaseLoaded = (layer) => {
    if (state.mapBaseLayer !== layer) return;
    state.mapBaseLoaded = true;
    errorCounts.set(layer, 0);
    clearBaseFailureTimer();
    hideMapBaseStatus();
  };
  const activateBaseLayer = (layer, { automatic = false } = {}) => {
    if (!layer || state.mapBaseLayer === layer) return;
    automaticSwitch = true;
    for (const candidate of baseLayers) if (candidate !== layer && map.hasLayer(candidate)) map.removeLayer(candidate);
    if (!map.hasLayer(layer)) layer.addTo(map);
    state.mapBaseLayer = layer;
    state.mapBaseLoaded = false;
    if (automatic) {
      state.mapBaseAutomaticSwitches += 1;
      state.mapBaseFallbackActivated = true;
    }
    hideMapBaseStatus();
    armBaseFailureTimer();
    setTimeout(() => { automaticSwitch = false; }, 0);
  };
  const handleBaseFailure = (layer) => {
    const count = Number(errorCounts.get(layer) || 0) + 1;
    errorCounts.set(layer, count);
    if (state.mapBaseLayer !== layer || count < 4) return;
    const alternate = layer === osm ? imagery : osm;
    if (state.mapBaseAutomaticSwitches < 2) activateBaseLayer(alternate, { automatic: true });
    else showMapBaseStatus();
  };
  for (const layer of baseLayers) {
    layer.on('tileload', () => markBaseLoaded(layer));
    layer.on('tileerror', () => handleBaseFailure(layer));
  }
  osm.addTo(map);
  state.mapBaseLayer = osm;
  armBaseFailureTimer();
  L.control.layers({ Uydu: imagery, Harita: osm }, {}, { position: 'bottomright', collapsed: true }).addTo(map);
  map.on('baselayerchange', (event) => {
    state.mapBaseLayer = event.layer;
    state.mapBaseLoaded = false;
    if (!automaticSwitch) {
      state.mapBaseUserSelected = true;
      state.mapBaseAutomaticSwitches = 0;
    }
    errorCounts.set(event.layer, 0);
    hideMapBaseStatus();
    armBaseFailureTimer();
  });
  elements.mapBaseRetryButton?.addEventListener('click', () => {
    for (const layer of baseLayers) errorCounts.set(layer, 0);
    state.mapBaseAutomaticSwitches = 0;
    state.mapBaseLoaded = false;
    hideMapBaseStatus();
    state.mapBaseLayer?.redraw?.();
    if (state.parcelLayer) fitLayer(state.parcelLayer, 20);
    armBaseFailureTimer();
  });
  state.map = map;
  map.on('click', onMapClick);
  const refreshMapSize = () => {
    if (!state.map) return;
    state.map.invalidateSize({ pan: false, animate: false });
  };
  [100, 350, 900].forEach((delay) => setTimeout(refreshMapSize, delay));
  window.addEventListener('resize', () => setTimeout(refreshMapSize, 120), { passive: true });
  window.addEventListener('orientationchange', () => setTimeout(refreshMapSize, 240), { passive: true });
}

function showAdministrativeGeometry(item, caption) {
  clearMapLayers({ parcel: true, boundary: true });
  updateMapCaption(caption);
  if (!state.map || !item?.geometry) return;
  state.boundaryLayer = L.geoJSON({ type: 'Feature', properties: {}, geometry: item.geometry }, {
    style: { color: '#4d91ff', weight: 2, opacity: .8, dashArray: '7 7', fillColor: '#4d91ff', fillOpacity: .045 }
  }).addTo(state.map);
  fitLayer(state.boundaryLayer, 13);
}

async function renderParcelAndAnalyze(feature, { scroll = false } = {}) {
  state.parcelFeature = feature;
  state.analysis = null;
  renderParcelMap(feature);
  renderCadastralBase(feature);
  elements.resultSection.hidden = false;
  elements.analysisProgress.hidden = false;
  elements.analysisStatus.hidden = true;
  resetAnalysisPanels();
  syncFavoriteButton();
  if (scroll) elements.resultSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  void analyzeCurrentParcel();
}

function renderParcelMap(feature) {
  clearMapLayers({ parcel: true, boundary: true });
  if (state.map && feature?.geometry) {
    state.parcelLayer = L.geoJSON(feature, {
      style: { color: '#e6333f', weight: 4, opacity: 1, fillColor: '#f5d83d', fillOpacity: .23 }
    }).addTo(state.map);
    fitLayer(state.parcelLayer, 20);
    const parcelBounds = state.parcelLayer.getBounds();
    const refreshParcelMap = () => {
      if (!state.map || !parcelBounds.isValid()) return;
      state.map.invalidateSize({ pan: false, animate: false });
      state.map.fitBounds(parcelBounds, { padding: [28, 28], maxZoom: 20, animate: false });
    };
    requestAnimationFrame(refreshParcelMap);
    setTimeout(refreshParcelMap, 320);
    setTimeout(refreshParcelMap, 900);
    const center = parcelBounds.getCenter();
    const p = feature.properties || {};
    state.parcelMarker = L.marker(center).addTo(state.map).bindTooltip(`${p.block || '—'}/${p.parcel || '—'}`, {
      permanent: true, direction: 'center', className: 'parcel-label'
    });
    state.parcelLayer.bindPopup(parcelPopup(feature));
  }
  updateMapCaption(parcelLocation(feature));
}

function renderCadastralBase(feature) {
  const p = feature?.properties || {};
  const location = [p.province, p.district, p.neighbourhood].filter(Boolean).join(' / ') || 'Konum bilgisi yok';
  const areaText = formatArea(p.area, p.areaText);
  elements.parcelAddress.textContent = `${location} · ${p.block || '—'} ada ${p.parcel || '—'} parsel`;
  elements.plainExplanation.textContent = `TKGM açık CBS kaydında bu parsel ${areaText} olarak görünüyor. Taşınmaz niteliği imar planı fonksiyonu veya yeni yapı hakkı değildir.`;
  elements.metricArea.textContent = areaText;
  elements.metricQuality.textContent = p.quality || 'Belirtilmemiş';
  elements.metricMapSheet.textContent = p.mapSheet || 'Belirtilmemiş';
  elements.metricBlockParcel.textContent = `${p.block || '—'} / ${p.parcel || '—'}`;
  elements.zoningOverviewTitle.textContent = 'İmar ve yeni yapı hakkı kontrol ediliyor';
  elements.zoningOverviewText.textContent = 'Kadastro kaydından ayrı olarak güncel resmî plan ve yapılaşma koşulları aranıyor.';
  elements.zoningMiniList.innerHTML = '<div><dt>Resmî imar kaynakları</dt><dd>Kontrol ediliyor…</dd></div>';
  setVerificationChip(elements.cadastreStatusChip, 'Kadastro doğrulandı', 'is-ok');
  setVerificationChip(elements.zoningStatusChip, 'İmar kontrol ediliyor', 'is-loading');
  setVerificationChip(elements.aiStatusChip, 'AI isteğe bağlı', 'is-neutral');
  renderDecisionSummary(null);
}

async function analyzeCurrentParcel(explicitEvidence = undefined, { forceRefresh = false } = {}) {
  if (!state.parcelFeature) return;
  if (state.analysisAbort) state.analysisAbort.abort();
  const controller = new AbortController();
  state.analysisAbort = controller;
  elements.analysisProgress.hidden = false;
  elements.analysisStatus.hidden = true;
  if (forceRefresh) {
    elements.sourceScanCard.hidden = false;
    elements.sourceScanBadge.className = 'data-badge is-loading';
    elements.sourceScanBadge.textContent = 'Yeniden taranıyor';
    elements.sourceScanIntro.textContent = 'Önceki önbellek kullanılmadan, bu turda yarım kalan resmî kaynaklar yeniden kontrol ediliyor.';
    if (elements.retrySourceScanButton) elements.retrySourceScanButton.disabled = true;
  }
  const evidence = explicitEvidence === undefined ? getSavedEvidence() : explicitEvidence;
  try {
    const result = await apiPost('/api/analyze', {
      parcel: state.parcelFeature,
      query: state.lastQuery || {},
      evidence: evidence || null,
      forceRefresh
    }, { signal: controller.signal, timeoutMs: 18_000 });
    if (state.analysisAbort !== controller) return;
    state.analysis = result;
    renderAnalysis(result);
    saveWork();
  } catch (error) {
    if (error?.name === 'AbortError') return;
    if (state.analysisAbort !== controller) return;
    renderAnalysisFailure(error);
    saveWork();
  } finally {
    if (state.analysisAbort === controller) {
      state.analysisAbort = null;
      elements.analysisProgress.hidden = true;
      if (elements.retrySourceScanButton) elements.retrySourceScanButton.disabled = false;
    }
  }
}

function renderAnalysis(analysis) {
  renderDecisionSummary(analysis);
  renderVerificationStatus(analysis);
  renderAnalysisStatus(analysis);
  renderZoningOverview(analysis);
  renderSummary(analysis.metrics || {});
  renderPossibilities(analysis);
  renderWarnings(analysis.warnings || []);
  renderTechnical(analysis.technical || []);
  renderEnvironment(analysis.environment || {});
  renderOfficialServices(analysis.providerDiscovery || {});
  renderPlanRecords(analysis.planRecords || analysis.planContext?.records || [], analysis.planContext || {});
  renderSourceScan(analysis.sourceScan || {});
  renderPlanAi(analysis.planAi || {});
  renderRoadmap(analysis.roadmap || [], analysis);
  renderClaims(analysis.claims || [], analysis.sources || []);
  renderSources(analysis.sources || []);
  const needsCompletion = analysis.status !== 'complete';
  elements.zoningCompletionCard.hidden = !needsCompletion;
}

function setVerificationChip(element, text, variant) {
  if (!element) return;
  element.textContent = text;
  element.className = `verification-chip ${variant || 'is-neutral'}`;
}

function renderVerificationStatus(analysis = {}) {
  setVerificationChip(elements.cadastreStatusChip, 'Kadastro doğrulandı', 'is-ok');
  const manualOnly = Boolean(analysis.manualOnly || analysis.zoningStatus === 'manual-only' || analysis.zoning?.manualOnly);
  if (analysis.status === 'conflict') setVerificationChip(elements.zoningStatusChip, 'İmar kaynağı çelişkili', 'is-error');
  else if (hasVerifiedZoning(analysis)) setVerificationChip(elements.zoningStatusChip, analysis.status === 'complete' ? 'İmar doğrulandı' : 'İmar kısmen doğrulandı', analysis.status === 'complete' ? 'is-ok' : 'is-warn');
  else if (manualOnly) setVerificationChip(elements.zoningStatusChip, 'İmar: resmî sorgu gerekli', 'is-warn');
  else setVerificationChip(elements.zoningStatusChip, 'İmar doğrulanamadı', 'is-warn');
  const ai = analysis.planAi || {};
  if (ai.status === 'applied') setVerificationChip(elements.aiStatusChip, 'AI kanıt destekli', 'is-ok');
  else if (ai.status === 'review-required') setVerificationChip(elements.aiStatusChip, 'AI: kontrol gerekli', 'is-warn');
  else setVerificationChip(elements.aiStatusChip, 'AI isteğe bağlı', 'is-neutral');
}

function renderAnalysisStatus(analysis) {
  elements.analysisStatus.hidden = false;
  elements.analysisStatus.className = 'analysis-status card';
  if (analysis.status === 'complete') {
    elements.analysisStatusIcon.textContent = '✓';
    elements.analysisStatusTitle.textContent = analysis.zoningStatus === 'ai-assisted-official' ? 'Plan AI destekli resmî analiz hazır' : 'Doğrulanabilen analiz hazır';
    elements.analysisStatusText.textContent = analysis.zoningStatus === 'ai-assisted-official'
      ? 'Plan AI açık resmî kaynaklarda kanıtı bulunan imar değerlerini çıkardı; hesaplar bu değerlere göre oluşturuldu.'
      : 'Parsel, imar değerleri, hesaplar, yakın çevre ve kaynak ilişkisi oluşturuldu.';
  } else if (analysis.status === 'partial') {
    elements.analysisStatus.classList.add('is-partial');
    elements.analysisStatusIcon.textContent = '◐';
    elements.analysisStatusTitle.textContent = 'Kısmi imar analizi hazır';
    elements.analysisStatusText.textContent = 'Bazı yapılaşma değerleri doğrulandı; eksik alanlar açıkça işaretlendi.';
  } else if (analysis.status === 'conflict') {
    elements.analysisStatus.classList.add('is-warning');
    elements.analysisStatusIcon.textContent = '!';
    elements.analysisStatusTitle.textContent = 'Kaynak çelişkisi tespit edildi';
    elements.analysisStatusText.textContent = 'Çelişen değerler nedeniyle otomatik yapılaşma hesabı durduruldu.';
  } else {
    elements.analysisStatus.classList.add('is-partial');
    elements.analysisStatusIcon.textContent = 'i';
    const manualOnly = Boolean(analysis.manualOnly || analysis.zoningStatus === 'manual-only' || analysis.zoning?.manualOnly);
    const hasPlanMetadata = Boolean(analysis.planContext?.metadata && Object.keys(analysis.planContext.metadata).length);
    const planRecordCount = Number(analysis.planRecords?.length || analysis.planContext?.records?.length || 0);
    const catalogMatches = Number(analysis.providerDiscovery?.catalog?.matchCount || 0);
    elements.analysisStatusTitle.textContent = manualOnly
      ? 'Parsel hazır; resmî portalda manuel sorgu gerekli'
      : planRecordCount
      ? 'Kadastro ve resmî plan kaydı hazır'
      : hasPlanMetadata
        ? 'Kadastro ve plan metaverisi hazır'
        : catalogMatches
          ? 'Kadastro ve resmî belediye kaynağı hazır'
          : 'Kadastro sonucu hazır';
    const scan = analysis.sourceScan || {};
    const scanSummary = scan.exhausted
      ? `${Number(scan.attemptedCount || 0)} e-Devletsiz açık resmî kaynak denendi${Number(scan.reachableCount || 0) ? `; ${Number(scan.reachableCount || 0)} kaynağa erişildi` : ''}.`
      : `${Number(scan.attemptedCount || 0)} açık resmî kaynak denendi; tarama süre sınırı nedeniyle tamamlanamadı.`;
    elements.analysisStatusText.textContent = manualOnly
      ? `Parsel doğrulandı. ${scanSummary} Otomatik okunabilen güncel yapılaşma değeri bulunamadı; TAKS, emsal, kat ve çekme mesafeleri için aşağıdaki yetkili resmî imar bağlantısını açın.`
      : planRecordCount
      ? `Parsel doğrulandı ve ${planRecordCount} resmî plan/askı kaydı bulundu. ${scanSummary} Güncel yapılaşma değeri bulunmadığı için eksik hesaplar yapılmadı.`
      : hasPlanMetadata
        ? `Parsel ve kamuya açık plan kaydı bulundu. ${scanSummary} TAKS, emsal ve kat değeri bulunursa hesap otomatik yapılır.`
        : catalogMatches
          ? `Parsel ve ${catalogMatches} resmî belediye hizmeti bulundu. ${scanSummary} Açık veride değer bulunamadığı için yalnızca eksik alanlar işaretlendi.`
          : `Parsel doğrulandı. ${scanSummary} Güncel yapılaşma değeri bulunamadığı için hesap yapılamadı.`;
  }
}

function renderZoningOverview(analysis) {
  const fields = analysis.zoning?.fields || {};
  if (analysis.status === 'cadastral-only') {
    const metadata = analysis.planContext?.metadata || {};
    const scan = analysis.sourceScan || {};
    const sourceCount = Number(scan.attemptedCount || 0);
    const manualOnly = Boolean(analysis.manualOnly || analysis.zoningStatus === 'manual-only' || analysis.zoning?.manualOnly);
    elements.zoningOverviewTitle.textContent = manualOnly
      ? 'Resmî imar portalında manuel sorgu gerekli'
      : metadata.planName ? 'Plan kaydı bulundu; eksik hesaplar yapılamadı' : 'Açık resmî kaynaklarda yapılaşma değeri bulunamadı';
    elements.zoningOverviewText.textContent = manualOnly
      ? 'Yetkili resmî imar hizmeti bulundu; ancak sonuç ekranı otomatik veri aktarmıyor veya giriş gerektiriyor. Değerler tahmin edilmedi.'
      : scan.exhausted
      ? `${sourceCount} e-Devletsiz açık resmî kaynak sırayla kontrol edildi. ${metadata.planName ? `“${metadata.planName}” plan kaydı bulundu; ancak ` : ''}güncel TAKS, emsal, kat veya çekme mesafesi bulunmadığı için ilgili hesaplar yapılmadı.`
      : `${sourceCount} açık resmî kaynak kontrol edildi; tarama tamamlanamadı. Yeniden analiz ederek kalan kaynakları tekrar deneyebilirsiniz.`;
  } else if (analysis.status === 'conflict') {
    elements.zoningOverviewTitle.textContent = 'İmar kaynakları çelişiyor';
    elements.zoningOverviewText.textContent = 'Güncel ve yürürlükte olan kaynağın yetkili idareden teyit edilmesi gerekir.';
  } else {
    elements.zoningOverviewTitle.textContent = fields.landUse || 'Yapılaşma bilgileri';
    elements.zoningOverviewText.textContent = analysis.zoningStatus === 'user-evidence'
      ? 'Aşağıdaki değerler sizin eklediğiniz resmî belge bilgisine dayanır.'
      : analysis.zoningStatus === 'ai-assisted-official'
        ? 'Aşağıdaki değerler Plan AI tarafından açık resmî kaynak metninden kanıtıyla çıkarılmıştır.'
        : 'Aşağıdaki değerler yapılandırılmış ve doğrulanmış imar kaynağından alınmıştır.';
  }
  const planMetadata = analysis.planContext?.metadata || {};
  const isPublicPlanRecord = planMetadata.metadataKind === 'public-plan-record';
  const recordScale = planMetadata.planScale || null;
  const planCoverage = analysis.planContext?.coverageStatus === 'available'
    ? (analysis.planContext.matches || []).map((item) => item.shortLabel || item.title).filter(Boolean).join(' + ')
    : null;
  const fieldSources = analysis.zoning?.fieldSources || {};
  const conditionalSetbacks = Array.isArray(fields.setbackConditions) ? fields.setbackConditions : [];
  const conditionsFor = (type) => conditionalSetbacks.filter((item) => item?.type === type && Number.isFinite(Number(item.value)));
  const setbackValue = (type, scalar) => {
    const conditions = conditionsFor(type);
    if (conditions.length) return conditions.map((item) => `${item.qualifier ? `${item.qualifier}: ` : ''}${formatNumber(item.value)} m`).join(' · ');
    return scalar != null ? `${formatNumber(scalar)} m` : null;
  };
  const rows = [
    { label: 'Plan kapsamı', value: planCoverage },
    { label: isPublicPlanRecord ? 'Eşleşen plan kayıt adı' : 'Plan adı', value: planMetadata.planName || fields.planName, field: 'planName' },
    { label: isPublicPlanRecord ? 'Plan kayıt ölçeği' : 'Plan ölçeği', value: recordScale || fields.planScale, field: 'planScale' },
    { label: 'Plan fonksiyonu', value: fields.landUse, field: 'landUse' },
    { label: 'Net imar parseli alanı', value: fields.netParcelArea != null ? `${formatNumber(fields.netParcelArea)} m²` : null, field: 'netParcelArea' },
    { label: 'TAKS', value: fields.taks != null ? formatNumber(fields.taks) : null, field: 'taks' },
    { label: 'KAKS / Emsal', value: fields.emsal != null ? formatNumber(fields.emsal) : null, field: 'emsal' },
    { label: 'Kat adedi', value: fields.floors != null ? `${formatNumber(fields.floors)} kat` : null, field: 'floors' },
    { label: 'Yençok / Hmax', value: fields.hmax != null ? `${formatNumber(fields.hmax)} m` : null, field: 'hmax' },
    { label: 'Yapı nizamı', value: fields.buildingOrder, field: 'buildingOrder' },
    { label: conditionsFor('front').length > 1 ? 'Ön bahçe (cepheye göre)' : 'Ön bahçe', value: setbackValue('front', fields.frontSetback), field: conditionsFor('front').length ? 'setbackConditions' : 'frontSetback' },
    { label: conditionsFor('side').length > 1 ? 'Yan bahçe (koşula göre)' : 'Yan bahçe', value: setbackValue('side', fields.sideSetback), field: conditionsFor('side').length ? 'setbackConditions' : 'sideSetback' },
    { label: conditionsFor('rear').length > 1 ? 'Arka bahçe (koşula göre)' : 'Arka bahçe', value: setbackValue('rear', fields.rearSetback), field: conditionsFor('rear').length ? 'setbackConditions' : 'rearSetback' }
  ];
  elements.zoningMiniList.innerHTML = rows.map(({ label, value, field }) => {
    const source = field ? fieldSources[field] : null;
    const provenance = value != null ? zoningFieldProvenance(source) : '';
    return `<div class="${value == null ? 'is-missing' : 'is-verified'}"><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value ?? 'Resmî belgede bulunamadı')}${provenance ? `<small>${escapeHtml(provenance)}</small>` : ''}</dd></div>`;
  }).join('');
}

function zoningFieldProvenance(source = {}) {
  if (!source || typeof source !== 'object') return '';
  const confidence = { high: 'yüksek güven', medium: 'orta güven', low: 'düşük güven' }[source.confidence || source.extractionConfidence] || '';
  const rawDate = source.documentDate || source.retrievedAt || '';
  const date = rawDate ? String(rawDate).slice(0, 10) : '';
  return [source.title || source.provider, date, confidence].filter(Boolean).join(' · ');
}

function renderSummary(metrics) {
  const values = [metrics.floors, metrics.footprint, metrics.construction, metrics.outside];
  const hasAnyMetric = values.some((item) => item && item.value != null && item.display && item.display !== 'Doğrulanamadı');
  if (elements.summaryGrid) elements.summaryGrid.hidden = !hasAnyMetric;
  elements.summaryFloors.textContent = metrics.floors?.display || 'Doğrulanamadı';
  elements.summaryFootprint.textContent = metrics.footprint?.display || 'Doğrulanamadı';
  elements.summaryConstruction.textContent = metrics.construction?.display || 'Doğrulanamadı';
  elements.summaryOutside.textContent = metrics.outside?.display || 'Doğrulanamadı';
}

function renderDecisionSummary(analysis) {
  const p = state.parcelFeature?.properties || {};
  if (elements.mobileSummaryParcel) elements.mobileSummaryParcel.textContent = p.block && p.parcel ? `Bulundu · ${p.block}/${p.parcel}` : 'Parsel bekleniyor';
  if (elements.mobileSummaryCadastre) elements.mobileSummaryCadastre.textContent = p.quality ? `${p.quality} · imar hakkı değildir` : 'Nitelik belirtilmemiş · imar hakkı değildir';
  if (!elements.mobileSummaryZoning) return;
  if (!analysis) {
    elements.mobileSummaryZoning.textContent = 'Güncel resmî kaynaklar kontrol ediliyor';
    return;
  }
  const fields = analysis.zoning?.fields || {};
  const manualOnly = Boolean(analysis.manualOnly || analysis.zoningStatus === 'manual-only' || analysis.zoning?.manualOnly);
  if (hasVerifiedZoning(analysis)) {
    const parts = [fields.landUse, fields.planScale, fields.hmax != null ? `Yençok ${formatNumber(fields.hmax)} m` : null].filter(Boolean);
    elements.mobileSummaryZoning.textContent = parts.length ? `Doğrulanan: ${parts.join(' · ')}` : 'Kısmi resmî imar değeri doğrulandı';
  } else if (manualOnly) {
    elements.mobileSummaryZoning.textContent = 'Manuel resmî sorgu veya güncel belge gerekli';
  } else {
    elements.mobileSummaryZoning.textContent = 'Doğrulanmadı · yapı hakkı hesabı üretilmedi';
  }
}

function hasVerifiedZoning(analysis = {}) {
  const fields = analysis.zoning?.fields || {};
  const hasOfficialValue = Boolean(fields.landUse || fields.taks != null || fields.emsal != null || fields.floors != null || fields.hmax != null || fields.buildingOrder);
  const trustedStatus = ['complete', 'partial'].includes(analysis.status) || ['verified', 'user-evidence', 'ai-assisted-official'].includes(analysis.zoningStatus);
  return Boolean(hasOfficialValue && trustedStatus && !analysis.zoning?.conflict && analysis.status !== 'conflict');
}

function parcelQualityWarning() {
  const quality = String(state.parcelFeature?.properties?.quality || '').trim();
  if (!quality) return 'Güncel resmî plan fonksiyonu doğrulanmadığı için konut, villa, havuz ve benzeri seçenekler gösterilmiyor.';
  const sensitive = /mezarlık|tarla|orman|mera|park|yol|su|koru|sit/i.test(quality);
  return sensitive
    ? 'TKGM kaydındaki nitelik “' + quality + '”. Bu kadastro kaydı tek başına imar hakkı değildir; konut, villa veya başka bir yapı kullanımı güncel resmî imar durumu doğrulanmadan gösterilmez.'
    : 'TKGM kaydındaki nitelik “' + quality + '”. Güncel resmî plan fonksiyonu doğrulanmadığı için yapı kullanım seçenekleri gösterilmiyor.';
}

function renderPossibilities(input) {
  const analysis = Array.isArray(input) ? (state.analysis || { possibilities: input }) : (input || {});
  const title = $('#possibilityTitle');
  if (!hasVerifiedZoning(analysis)) {
    if (title) title.textContent = 'Kullanım seçenekleri doğrulanmadı';
    elements.possibilityGrid.innerHTML = '<div class="empty-state-inline context-safe-note"><strong>Yapılaşma izni doğrulanamadı.</strong><span>Bu, yapı yapılamayacağı anlamına gelmez. ' + escapeHtml(parcelQualityWarning()) + '</span></div>';
    return;
  }
  if (title) title.textContent = 'Bu parsel için doğrulanan kullanım seçenekleri';
  const items = Array.isArray(analysis.possibilities) ? analysis.possibilities : [];
  if (!items.length) {
    elements.possibilityGrid.innerHTML = '<div class="empty-state-inline">Resmî kaynakta ayrıca doğrulanmış kullanım seçeneği bulunamadı.</div>';
    return;
  }
  const icon = { allowed: '✓', conditional: '!', prohibited: '×', required: '!', unknown: '?' };
  elements.possibilityGrid.innerHTML = items.map((item) =>
    '<div class="possibility-item is-' + escapeHtml(item.status) + '"><span class="possibility-icon">' + (icon[item.status] || '?') + '</span><span><strong>' + escapeHtml(item.label) + '</strong><b>' + escapeHtml(item.statusLabel) + '</b><small>' + escapeHtml(item.note || '') + '</small></span></div>'
  ).join('');
}

function renderWarnings(items) {
  if (!items.length) {
    elements.warningList.innerHTML = '<div class="empty-state-inline">Doğrulanmış ek bir uyarı bulunmadı. Ruhsat öncesi yetkili idare kontrolü yine gereklidir.</div>';
    return;
  }
  elements.warningList.innerHTML = items.map((item) => `
    <div class="warning-item is-${escapeHtml(item.level || 'info')}"><span>${item.level === 'danger' ? '!' : item.level === 'warning' ? '⚠' : 'i'}</span><p>${escapeHtml(item.text)}</p></div>`).join('');
}

function renderTechnical(rows) {
  elements.technicalList.innerHTML = rows.map((row) => `
    <div class="${row.value == null ? 'is-missing' : ''}"><dt>${escapeHtml(row.label)}</dt><dd>${escapeHtml(row.value ?? 'Doğrulanamadı')}</dd><small>Kaynak: ${escapeHtml(row.source || 'Belirtilmemiş')}</small></div>`).join('');
}

function renderEnvironment(environment) {
  elements.environmentBadge.className = 'data-badge';
  if (environment.status !== 'available') {
    elements.environmentBadge.classList.add('is-warn');
    elements.environmentBadge.textContent = 'Alınamadı';
    elements.environmentIntro.textContent = environment.message || 'Yakın çevre verisi geçici olarak alınamadı.';
    elements.environmentGrid.innerHTML = '<div class="environment-empty"><p>Parsel ve imar analizi kullanılabilir. Yakın çevre servisi daha sonra tekrar denenebilir.</p><button type="button" class="inline-action-button" id="retryEnvironmentButton">Yakın çevreyi yeniden dene</button></div>';
    $('#retryEnvironmentButton', elements.environmentGrid)?.addEventListener('click', async () => {
      showToast('Yakın çevre yeniden sorgulanıyor…');
      await analyzeCurrentParcel();
    });
    return;
  }
  elements.environmentBadge.classList.add('is-ok');
  elements.environmentBadge.textContent = `${formatNumber(environment.radius)} m çevre`;
  elements.environmentIntro.textContent = `Parsel merkezinin yaklaşık ${formatNumber(environment.radius)} metre çevresindeki açık harita kayıtlarından en yakın noktalar listelenmiştir.`;
  if (!environment.categories?.length) {
    elements.environmentGrid.innerHTML = '<div class="environment-empty">Belirlenen yarıçap içinde sınıflandırılmış yakın çevre kaydı bulunamadı.</div>';
    return;
  }
  elements.environmentGrid.innerHTML = environment.categories.map((category) => {
    const seen = new Set();
    const items = (Array.isArray(category.items) ? category.items : []).filter((item) => {
      const key = String(item?.name || '').trim().toLocaleLowerCase('tr-TR').replace(/\s+/g, ' ');
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    return `
    <section class="environment-category"><h4>${escapeHtml(category.label)}</h4><div class="nearby-list">${items.map((item) => `
      <div class="nearby-item"><strong>${escapeHtml(item.name)}</strong><span>${escapeHtml(item.distanceText || '—')}</span></div>`).join('')}</div></section>`;
  }).join('');
}

function normalizedDisplayKey(item = {}) {
  const rawUrl = String(item.url || item.sourceUrl || '').trim();
  if (rawUrl) {
    try {
      const url = new URL(rawUrl, location.origin);
      url.hash = '';
      for (const key of [...url.searchParams.keys()]) {
        if (/^(?:utm_.+|gclid|fbclid|mc_[ce]id)$/i.test(key)) url.searchParams.delete(key);
      }
      const sorted = [...url.searchParams.entries()].sort(([a, av], [b, bv]) => a.localeCompare(b) || av.localeCompare(bv));
      url.search = '';
      for (const [key, value] of sorted) url.searchParams.append(key, value);
      const path = url.pathname.replace(/\/+$/, '') || '/';
      return 'url:' + url.origin.toLocaleLowerCase('tr-TR') + path + url.search;
    } catch {
      return 'url:' + rawUrl.replace(/#.*$/, '').replace(/\/+$/, '');
    }
  }
  return 'text:' + [item.title, item.provider, item.kind].map((value) => String(value || '').trim().toLocaleLowerCase('tr-TR')).join('|');
}

function dedupeDisplayItems(items = []) {
  const seen = new Set();
  const result = [];
  for (const item of items) {
    if (!item) continue;
    const key = normalizedDisplayKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

function renderOfficialServices(discovery = {}) {
  const actions = dedupeDisplayItems(Array.isArray(discovery.actions) ? discovery.actions : []);
  const catalog = discovery.catalog || {};
  const statusLabels = {
    'automatic-adapter-configured': 'Otomatik bağlantı hazır',
    'official-service-found': catalog.matchCount ? 'Katalog eşleşmesi bulundu' : 'Resmî hizmet bulundu',
    'official-search-ready': 'Resmî arama hazır',
    'national-portals-ready': 'Ulusal portallar hazır',
    'manual-only': 'Resmî portalda açılmalı',
    unavailable: 'Bağlantı bulunamadı'
  };
  elements.officialServicesBadge.className = 'data-badge';
  if (discovery.status === 'automatic-adapter-configured') elements.officialServicesBadge.classList.add('is-ok');
  else elements.officialServicesBadge.classList.add('is-warn');
  elements.officialServicesBadge.textContent = statusLabels[discovery.status] || 'Resmî kaynaklar';

  const catalogText = catalog.embedded
    ? `Türkiye geneli dinamik resmî yönlendirme hazır · bu konum için ${formatNumber(catalog.matchCount || 0)} doğrulanmış doğrudan hizmet eşleşti.`
    : 'Türkiye geneli resmî yönlendirme hazır.';
  elements.officialServicesIntro.textContent = [catalogText, discovery.message || 'Türkiye geneli e-Plan, TUCBS ve ilgili belediyenin resmî imar hizmeti listelenir.'].filter(Boolean).join(' ');

  const primary = actions.find((action) => action.kind === 'configured-adapter')
    || actions.find((action) => action.kind === 'municipality-geodata')
    || actions.find((action) => action.kind === 'municipality-portal' && action.accessMode === 'public-portal')
    || actions.find((action) => action.kind === 'municipality-portal')
    || actions.find((action) => action.kind === 'national-portal')
    || actions[0];
  if (primary?.url) {
    elements.primaryOfficialServiceLink.href = primary.url;
    const isSearch = primary.accessMode === 'official-search';
    const isMunicipal = ['municipality-portal', 'municipality-geodata'].includes(primary.kind);
    elements.primaryOfficialServiceLink.textContent = isSearch
      ? 'e-Devlet’te İmar Hizmetini Ara ↗'
      : `${isMunicipal ? 'Yetkili İmar Sorgusunu' : 'Resmî İmar Kaynağını'} Aç ↗`;
  } else {
    elements.primaryOfficialServiceLink.href = 'https://eplan.csb.gov.tr/e-plan/html/imarDurumu.html';
    elements.primaryOfficialServiceLink.textContent = 'e-Plan’da Kontrol Et ↗';
  }

  if (!actions.length) {
    elements.officialServicesGrid.innerHTML = '<div class="official-services-empty">Bu parsel için resmî imar sorgu bağlantısı bulunamadı. e-Plan ve ilgili belediye imar müdürlüğü manuel olarak kontrol edilmelidir.</div>';
    return;
  }
  const icons = {
    'national-portal': 'e', 'national-geodata': 'T', 'national-directory': 'D', cadastre: 'K',
    'municipality-portal': 'B', 'municipality-geodata': 'C', 'configured-adapter': '✓', 'discovery-search': 'G', 'national-plan-directory': 'P'
  };
  const accessLabels = {
    'automatic-adapter': 'Otomatik veri', 'official-login-service': 'Resmî oturum', 'official-search': 'Resmî arama',
    'public-portal': 'Açık portal', 'official-service': 'Resmî hizmet', 'discovery-only': 'Doğrulama araması', 'manual-only': 'Kullanıcı açar'
  };
  const visibleActions = actions.slice(0, 8);
  elements.officialServicesGrid.innerHTML = visibleActions.map((action) => {
    const catalogueLabel = action.catalogRecordId ? ' · Gömülü katalog' : '';
    const verification = action.verifiedAt ? ` · ${action.verifiedAt}` : '';
    return `
    <article class="official-service-item ${action.kind === 'configured-adapter' ? 'is-configured' : ''} ${action.catalogRecordId ? 'is-catalog' : ''}">
      <span class="official-service-icon">${escapeHtml(icons[action.kind] || 'K')}</span>
      <span>
        <strong>${escapeHtml(action.title || 'Resmî kaynak')}</strong>
        <small>${escapeHtml(action.provider || '')}</small>
        ${action.note ? `<small class="official-service-note">${escapeHtml(action.note)}</small>` : ''}
        <em class="official-service-status">${escapeHtml(accessLabels[action.accessMode] || action.status || 'Kontrol')}${escapeHtml(catalogueLabel)}${escapeHtml(verification)}</em>
      </span>
      ${action.url ? `<a href="${escapeHtml(action.url)}" target="_blank" rel="noopener noreferrer" aria-label="${escapeHtml(action.title || 'Kaynağı')} aç">↗</a>` : '<span></span>'}
    </article>`;
  }).join('');
}
function renderPlanRecords(records = [], planContext = {}) {
  const list = Array.isArray(records) ? records : [];
  elements.planRecordsBadge.className = 'data-badge';
  if (!list.length) {
    elements.planRecordsBadge.classList.add('is-warn');
    elements.planRecordsBadge.textContent = planContext?.publicRecords?.status === 'not-found' ? 'Eşleşme yok' : 'Kayıt alınamadı';
    elements.planRecordsIntro.textContent = planContext?.publicRecords?.message || 'Kamuya açık resmî plan/askı kayıtlarında bu ada-parsel için eşleşme bulunamadı.';
    elements.planRecordsGrid.innerHTML = '<div class="plan-records-empty">Plan kaydı bulunamaması imarsız olduğu anlamına gelmez. Güncel imar durumu e-Plan ve yetkili belediye üzerinden ayrıca kontrol edilmelidir.</div>';
    return;
  }
  elements.planRecordsBadge.classList.add('is-ok');
  elements.planRecordsBadge.textContent = `${list.length} resmî kayıt`;
  elements.planRecordsIntro.textContent = `${list.length} kamuya açık plan/askı kaydı ada-parsel ile eşleştirildi. Bu kayıtlar tarihsel veya askı ilanı olabilir; güncel TAKS, emsal, kat ve yürürlük bilgisi yerine geçmez.`;
  const statusLabel = {
    'historical-announcement': 'Tarihî askı kaydı',
    'public-announcement': 'Resmî askı kaydı',
    'published-current-reference': 'Yürürlük referansı'
  };
  elements.planRecordsGrid.innerHTML = list.slice(0, 8).map((record) => {
    const dates = [formatIsoDate(record.announcementStart), formatIsoDate(record.announcementEnd)].filter(Boolean).join(' → ');
    const scale = record.planScale || null;
    const metadata = [record.planType, scale, dates].filter(Boolean).join(' · ');
    const indicators = recordIndicatorText(record.indicators);
    return `<article class="plan-record-item">
      <span class="plan-record-icon">P</span>
      <span class="plan-record-body">
        <strong>${escapeHtml(record.title || 'Resmî plan kaydı')}</strong>
        <small>${escapeHtml(record.authority || '')}${metadata ? ` · ${escapeHtml(metadata)}` : ''}</small>
        ${record.description && record.description !== record.title ? `<small class="plan-record-description">${escapeHtml(record.description)}</small>` : ''}
        ${record.functionCandidate ? `<small class="plan-record-candidate">Açıklamada geçen kullanım: ${escapeHtml(record.functionCandidate)}</small>` : ''}
        ${indicators ? `<small class="plan-record-indicators">Kayıt metninde geçen göstergeler: ${escapeHtml(indicators)} <b>· Güncel hak değildir</b></small>` : ''}
        <em>${escapeHtml(statusLabel[record.recordStatus] || 'Kamu plan kaydı')} · Güncel imar durumu ayrıca doğrulanmalı</em>
      </span>
      ${record.sourceUrl ? `<a href="${escapeHtml(record.sourceUrl)}" target="_blank" rel="noopener noreferrer" aria-label="Plan kaydını aç">↗</a>` : '<span></span>'}
    </article>`;
  }).join('');
}

function recordIndicatorText(indicators) {
  if (!indicators || typeof indicators !== 'object') return '';
  const values = [];
  if (indicators.taksMentioned != null) values.push(`TAKS ${formatNumber(indicators.taksMentioned)}`);
  if (indicators.emsalMentioned != null) values.push(`Emsal ${formatNumber(indicators.emsalMentioned)}`);
  if (indicators.floorsMentioned != null) values.push(`${indicators.floorsMentioned} kat`);
  if (indicators.hmaxMentioned != null) values.push(`Yençok/Hmax ${formatNumber(indicators.hmaxMentioned)} m`);
  if (Array.isArray(indicators.landUsesMentioned) && indicators.landUsesMentioned.length) values.push(indicators.landUsesMentioned.join(', '));
  return values.join(' · ');
}

function renderSourceScan(scan = {}) {
  elements.sourceScanCard.hidden = false;
  elements.sourceScanBadge.className = 'data-badge';
  const attempts = dedupeDisplayItems(Array.isArray(scan.attempts) ? scan.attempts : []);
  const attempted = Number(scan.attemptedCount || attempts.length || 0);
  const reachable = Number(scan.reachableCount || 0);
  const found = Number(scan.foundRecordCount || 0);
  const total = Number(scan.totalCandidateCount || attempted || 0);
  const onlyManualOnly = attempts.length > 0 && attempts.every((item) => item?.status === 'manual-only');
  const canRetryRemaining = !onlyManualOnly && (scan.exhausted === false || Boolean(scan.budgetLimited));
  if (elements.retrySourceScanButton) {
    elements.retrySourceScanButton.hidden = !canRetryRemaining;
    elements.retrySourceScanButton.disabled = false;
    elements.retrySourceScanButton.textContent = 'Kalan Kaynakları Yeniden Tara';
  }
  if (onlyManualOnly) {
    elements.sourceScanBadge.classList.add('is-warn');
    elements.sourceScanBadge.textContent = 'Manuel sorgu gerekli';
    elements.sourceScanIntro.textContent = `${attempted} resmî kaynak otomatik veri aktarmıyor. Yeniden tarama yerine aşağıdaki resmî bağlantıyı açarak parseli manuel sorgulayın.`;
  } else if (found > 0) {
    elements.sourceScanBadge.classList.add('is-ok');
    elements.sourceScanBadge.textContent = `${found} sonuç bulundu`;
    elements.sourceScanIntro.textContent = `${attempted} e-Devletsiz açık resmî kaynak kontrol edildi. Hesaplamaya uygun bulunan değerler sonuç ekranına aktarıldı.`;
  } else if (scan.exhausted) {
    elements.sourceScanBadge.classList.add('is-warn');
    elements.sourceScanBadge.textContent = 'Tüm açık kaynaklar denendi';
    elements.sourceScanIntro.textContent = `${attempted} açık resmî kaynak denendi; ${reachable} kaynağa erişildi. Güncel TAKS, emsal, kat veya çekme mesafesi bulunamadığı için eksik hesaplar yapılmadı.`;
  } else {
    elements.sourceScanBadge.classList.add('is-warn');
    elements.sourceScanBadge.textContent = 'Tarama tamamlanamadı';
    elements.sourceScanIntro.textContent = `${attempted}${total > attempted ? ` / ${total}` : ''} açık resmî kaynak denendi. Süre veya bağlantı sınırı nedeniyle kalan kaynaklar için aşağıdaki düğmeyle önbelleksiz yeniden tarama yapabilirsiniz.`;
  }
  if (!attempts.length) {
    elements.sourceScanGrid.innerHTML = '<div class="source-scan-empty">Açık resmî kaynak deneme kaydı bulunamadı.</div>';
    return;
  }
  const labels = {
    found: 'Veri bulundu', 'metadata-only': 'Plan bilgisi bulundu', 'not-found': 'Parsel için değer yok',
    'auth-required': 'Giriş / yetki istiyor', 'manual-only': 'Resmî sayfada açılmalı', timeout: 'Zaman aşımı', unreachable: 'Bağlantı kurulamadı', 'budget-skipped': 'Sonraki denemeye kaldı'
  };
  elements.sourceScanGrid.innerHTML = attempts.slice(0, 24).map((item) => {
    const stateClass = item.status === 'found' ? 'is-ok' : item.status === 'metadata-only' || item.status === 'not-found' ? 'is-neutral' : 'is-warn';
    const fields = Array.isArray(item.foundFields) && item.foundFields.length ? ` · ${item.foundFields.join(', ')}` : '';
    return `<article class="source-scan-item ${stateClass}">
      <span class="source-scan-dot" aria-hidden="true"></span>
      <span><strong>${escapeHtml(item.title || item.provider || 'Resmî kaynak')}</strong><small>${escapeHtml(item.provider || '')}</small><em>${escapeHtml(labels[item.status] || item.status || 'Kontrol edildi')}${escapeHtml(fields)}</em></span>
      ${item.url ? `<a href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer" aria-label="Kaynağı aç">↗</a>` : '<span></span>'}
    </article>`;
  }).join('');
}


function renderPlanAi(planAi = {}) {
  if (!elements.planAiCard) return;
  const status = planAi.status || 'disabled';
  const evidence = Array.isArray(planAi.evidence) ? planAi.evidence : [];
  const fieldEvidence = planAi.fieldEvidence && typeof planAi.fieldEvidence === 'object' ? planAi.fieldEvidence : {};
  const hasEvidence = evidence.length > 0 || Object.keys(fieldEvidence).length > 0;
  elements.planAiCard.hidden = !hasEvidence && !['applied', 'review-required'].includes(status);
  if (elements.planAiCard.hidden) return;
  elements.planAiBadge.className = 'data-badge';
  const fieldCount = Number(planAi.evidenceBackedFields?.length || 0);
  const evidenceCount = Number(planAi.evidenceCount || 0);
  if (status === 'applied') {
    elements.planAiBadge.classList.add('is-ok');
    elements.planAiBadge.textContent = `${fieldCount} alan bulundu`;
    elements.planAiIntro.textContent = `Plan AI ${evidenceCount} açık resmî içerik okudu. Kaynak alıntısıyla desteklenen imar değerleri hesap motoruna aktarıldı.`;
  } else if (status === 'review-required') {
    elements.planAiBadge.classList.add('is-warn');
    elements.planAiBadge.textContent = 'Kontrol gerekli';
    elements.planAiIntro.textContent = 'Plan AI bazı değerler buldu; fakat parsel eşleşmesi veya yürürlük bilgisi yeterli olmadığı için hesapta kullanmadı.';
  } else if (status === 'no-values') {
    elements.planAiBadge.classList.add('is-warn');
    elements.planAiBadge.textContent = 'Değer bulunamadı';
    elements.planAiIntro.textContent = planAi.message || 'Plan AI açık resmî içerikleri okudu fakat hesaplamaya uygun yapılaşma değeri bulamadı.';
  } else if (status === 'disabled' && planAi.configured === false) {
    elements.planAiBadge.classList.add('is-warn');
    elements.planAiBadge.textContent = 'Sınırlı mod';
    elements.planAiIntro.textContent = 'Canlı Plan AI bağlantısı şu anda etkin değil. “Mevcut Sonucu Açıkla” düğmesi yalnız ekrandaki doğrulanmış ve eksik bilgileri özetler; yeni değer tahmin etmez.';
  } else {
    elements.planAiBadge.classList.add('is-warn');
    elements.planAiBadge.textContent = 'Sınırlı mod';
    elements.planAiIntro.textContent = `${planAi.message || 'Plan AI bu analizde kullanılamadı.'} Mevcut sonuçlar yine güvenli özet modunda açıklanabilir.`;
  }
  const fieldLabels = { landUse:'Plan fonksiyonu', netParcelArea:'Net imar parseli alanı', taks:'TAKS', emsal:'Emsal', floors:'Kat', hmax:'Yençok / Hmax', buildingOrder:'Yapı nizamı', frontSetback:'Ön bahçe', sideSetback:'Yan bahçe', rearSetback:'Arka bahçe', setbackConditions:'Koşullu çekme mesafeleri' };
  const fieldRows = Object.entries(fieldEvidence).slice(0, 12).map(([key, item]) => `
    <div class="plan-ai-evidence-item"><span><strong>${escapeHtml(fieldLabels[key] || key)}</strong><small>${escapeHtml(item.quote || '')}</small></span>${item.sourceUrl ? `<a href="${escapeHtml(item.sourceUrl)}" target="_blank" rel="noopener noreferrer">Kaynak ↗</a>` : ''}</div>`).join('');
  const sourceRows = evidence.slice(0, 6).map((item) => `
    <div class="plan-ai-source-item"><span><strong>${escapeHtml(item.title || 'Resmî kaynak')}</strong><small>${escapeHtml(item.provider || '')}${item.parcelMatch === 'exact' ? ' · Ada/parsel eşleşti' : ''}</small></span>${item.url ? `<a href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer">↗</a>` : ''}</div>`).join('');
  elements.planAiEvidence.innerHTML = fieldRows || sourceRows || '<div class="source-scan-empty">Plan AI kaynak kanıtı henüz bulunamadı.</div>';
  if (elements.planAiAskButton) {
    elements.planAiAskButton.disabled = false;
    elements.planAiAskButton.textContent = planAi.degraded || status !== 'applied' ? 'Mevcut Sonucu Açıkla' : "Plan AI'ye Sor";
  }
}

function openPlanAiDrawer() {
  if (!state.analysis) {
    openDrawer('✦ Plan AI · v3.5.0', '<div class="drawer-empty"><div><strong>Önce bir parsel sorgulayın.</strong><p>Plan AI, parsel ve resmî kaynak analizi oluştuktan sonra sorularınızı yanıtlar.</p></div></div>');
    return;
  }
  const ai = state.analysis.planAi || {};
  const degraded = Boolean(ai.degraded || ai.configured === false || ['disabled', 'unavailable', 'no-values', 'review-required'].includes(ai.status));
  openDrawer('✦ Plan AI · v3.5.0', `
    <div class="plan-ai-chat">
      <div class="plan-ai-chat-status"><strong>${escapeHtml(degraded ? 'Sınırlı açıklama modu' : 'Plan AI aktif')}</strong><span>${escapeHtml(degraded ? 'Canlı AI yanıt veremezse yalnız mevcut analizde yazan değerler özetlenir; yeni imar değeri tahmin edilmez.' : ai.message || 'Mevcut analiz üzerinden soru sorabilirsiniz.')}</span></div>
      <div class="plan-ai-suggestions">
        <button type="button" data-ai-question="Bu parselde yaklaşık kaç metrekare inşaat yapılabilir?">İnşaat hakkı</button>
        <button type="button" data-ai-question="Bu parselde neler yapılabilir, kısa anlatır mısın?">Neler yapılabilir?</button>
        <button type="button" data-ai-question="Eksik veya doğrulanamayan bilgiler hangileri?">Eksikler</button>
      </div>
      <label class="plan-ai-chat-label" for="planAiQuestionInput">Sorunuz</label>
      <textarea id="planAiQuestionInput" rows="4" maxlength="1800" placeholder="Örn. Bu parselde kaç kat yapılabilir?"></textarea>
      <button class="button button-primary" id="planAiSendButton" type="button">${degraded ? 'Mevcut Sonucu Açıkla' : "Plan AI'ye Sor"}</button>
      <div class="plan-ai-chat-answer" id="planAiChatAnswer"><span>Plan AI yalnızca mevcut resmî kaynak ve hesap sonuçlarına dayanarak cevap verir.</span></div>
    </div>`);
  const input = $('#planAiQuestionInput', elements.drawerContent);
  const send = $('#planAiSendButton', elements.drawerContent);
  const answer = $('#planAiChatAnswer', elements.drawerContent);
  $$('[data-ai-question]', elements.drawerContent).forEach((button) => button.addEventListener('click', () => { input.value = button.dataset.aiQuestion || ''; input.focus(); }));
  send.addEventListener('click', async () => {
    const question = input.value.trim();
    if (!question) return showToast('Plan AI için bir soru yazın.');
    send.disabled = true; send.textContent = degraded ? 'Mevcut sonuç hazırlanıyor…' : 'Plan AI düşünüyor…';
    answer.innerHTML = '<span>Doğrulanmış analiz bağlamı inceleniyor…</span>';
    try {
      if (ai.configured === false) throw Object.assign(new Error('Canlı Plan AI bağlantısı etkin değil.'), { code: 'PLAN_AI_DEGRADED' });
      const result = await apiPost('/api/plan-ai', { question, analysis: state.analysis }, { timeoutMs: 35_000 });
      const answerNotice = result.degraded
        ? `Sınırlı mod · ${result.notice || 'Mevcut doğrulanmış sonuç özetlendi'}`
        : result.model || 'Plan AI';
      answer.innerHTML = `<p>${escapeHtml(result.answer || 'Yanıt alınamadı.').replace(/\n/g, '<br>')}</p><small>${escapeHtml(answerNotice)}</small>`;
    } catch (error) {
      const fallback = buildPlanAiFallbackAnswer(question, state.analysis);
      answer.innerHTML = `<p>${escapeHtml(fallback).replace(/\n/g, '<br>')}</p><small>Sınırlı mod · Canlı yanıt kullanılamadı; yalnız mevcut analiz özetlendi.</small>`;
    } finally {
      send.disabled = false; send.textContent = degraded ? 'Mevcut Sonucu Açıkla' : "Plan AI'ye Sor";
    }
  });
}

function buildPlanAiFallbackAnswer(question, analysis = {}) {
  const normalizedQuestion = String(question || '').toLocaleLowerCase('tr-TR');
  const metrics = analysis.metrics || {};
  const fields = analysis.zoning?.fields || {};
  const missing = Array.isArray(analysis.zoning?.missing) ? analysis.zoning.missing : [];
  const unknown = 'Bu bilgi açık resmî kaynaklarda doğrulanamadığı için tahmin edemem.';
  if (/inşaat|insaat|metrekare|m²|emsal/.test(normalizedQuestion)) {
    if (metrics.construction?.value != null) return `Mevcut doğrulanmış emsal hesabına göre yaklaşık emsale esas alan ${metrics.construction.display}. Bu değer toplam ruhsat alanı değildir; yetkili idare teyidi gerekir.`;
    return `${unknown} Yaklaşık inşaat hesabı için en az parsel alanı ve emsal değerinin doğrulanması gerekir.`;
  }
  if (/kat|yükseklik|yukseklik|yençok|hmax/.test(normalizedQuestion)) {
    if (fields.floors != null || fields.hmax != null) return `Mevcut sonuçta ${fields.floors != null ? `kat sınırı ${fields.floors}` : 'kat sayısı doğrulanamadı'}${fields.hmax != null ? `${fields.floors != null ? ', ' : ''}Yençok/Hmax ${formatNumber(fields.hmax)} m` : ''}. Ruhsat öncesinde resmî imar durumunu kontrol edin.`;
    return unknown;
  }
  if (/eksik|doğrulan|dogrulan/.test(normalizedQuestion)) {
    const labels = { landUse:'plan fonksiyonu', taks:'TAKS', emsal:'emsal', floors:'kat adedi', hmax:'Yençok/Hmax', buildingOrder:'yapı nizamı', frontSetback:'ön bahçe', sideSetback:'yan bahçe', rearSetback:'arka bahçe' };
    return missing.length ? `Doğrulanamayan başlıca bilgiler: ${missing.map((key) => labels[key] || key).join(', ')}.` : 'Ana hesap alanlarında eksik işareti yok; özel plan notları ve ruhsat koşulları yine yetkili idareden kontrol edilmelidir.';
  }
  const knownPossibilities = (analysis.possibilities || []).filter((item) => ['allowed', 'conditional', 'required'].includes(item.status));
  if (/neler|yapılabilir|yapilabilir|konut|villa|havuz|çatı|cati|otopark/.test(normalizedQuestion)) {
    if (!knownPossibilities.length) return `${unknown} Konut, villa, havuz, çatı ve otopark için ilgili plan notu veya idare görüşü bulunamadı.`;
    return `Mevcut sonuçta yalnız şu seçenekler işaretli: ${knownPossibilities.map((item) => `${item.label}: ${item.statusLabel}`).join('; ')}. Diğer seçenekler doğrulanmadı.`;
  }
  const parts = [];
  if (fields.landUse) parts.push(`plan fonksiyonu ${fields.landUse}`);
  if (metrics.floors?.value != null) parts.push(`en fazla ${metrics.floors.display}`);
  if (metrics.footprint?.value != null) parts.push(`TAKS'a göre yaklaşık oturum ${metrics.footprint.display}`);
  if (metrics.construction?.value != null) parts.push(`emsale esas yaklaşık alan ${metrics.construction.display}`);
  return parts.length ? `Mevcut doğrulanmış sonuç: ${parts.join(', ')}. Kaynakta olmayan değerler tahmin edilmedi.` : unknown;
}

function renderRoadmap(items, analysis = state.analysis || {}) {
  const title = $('#roadmapTitle');
  const kicker = $('#roadmapKicker');
  if (!hasVerifiedZoning(analysis)) {
    if (kicker) kicker.textContent = 'Genel yol · yapı izni değildir';
    if (title) title.textContent = 'Yapı düşünülüyorsa önce ne doğrulanmalı?';
    elements.roadmap.innerHTML = '<article class="roadmap-step is-gate"><span class="roadmap-number">1</span><h4>Önce resmî imar durumunu doğrulayın</h4><p>Bu parselde yapı yapılabileceği henüz doğrulanmadı. Plan fonksiyonu, TAKS, emsal, kat ve çekme mesafeleri yetkili idarenin güncel kaydından alınmadan proje veya ruhsat aşamasına geçilmemelidir.</p></article>';
    return;
  }
  if (kicker) kicker.textContent = 'Doğrulanmış imardan sonraki genel yol';
  if (title) title.textContent = 'Yapı düşünülüyorsa sonraki adımlar';
  elements.roadmap.innerHTML = items.map((item) =>
    '<article class="roadmap-step"><span class="roadmap-number">' + escapeHtml(item.step) + '</span><h4>' + escapeHtml(item.title) + '</h4><p>' + escapeHtml(item.description) + '</p></article>'
  ).join('');
}

function renderClaims(claims, sources) {
  const sourceMap = new Map(sources.map((source) => [source.id, source.title]));
  if (!claims.length) {
    elements.claimList.innerHTML = '<div class="empty-state-inline">Kaynakla eşleşen sonuç bulunamadı.</div>';
    return;
  }
  elements.claimList.innerHTML = claims.map((claim) => `
    <div class="claim-item"><strong>${escapeHtml(claim.claim)}</strong><span class="claim-value">${escapeHtml(claim.value)}</span><span class="claim-source">${escapeHtml(sourceMap.get(claim.sourceId) || 'Kaynak belirtilmemiş')}</span></div>`).join('');
}

function renderSources(sources) {
  const uniqueSources = dedupeDisplayItems(Array.isArray(sources) ? sources : []);
  if (!uniqueSources.length) {
    elements.sourceList.innerHTML = '<div class="empty-state-inline">Kaynak kaydı bulunamadı.</div>';
    return;
  }
  const symbol = { cadastre: 'T', zoning: 'P', environment: 'Ç', calculation: '∑', 'official-portal': 'e', 'official-authority': 'B', 'national-portal': 'e', 'national-geodata': 'T', 'national-directory': 'D', 'municipality-portal': 'B', 'municipality-geodata': 'C', 'configured-adapter': '✓', 'official-plan-metadata': 'M', 'official-plan-coverage': 'S', 'official-plan-record': 'P' };
  const trust = { verified: 'Doğrulanmış', 'user-evidence': 'Belge girişi', 'public-information': 'Bilgi amaçlı', calculated: 'Hesaplandı', 'community-data': 'Açık veri', 'lookup-required': 'Kontrol gerekli' };
  elements.sourceList.innerHTML = uniqueSources.slice(0, 12).map((source) => {
    const link = source.url
      ? '<a href="' + escapeHtml(source.url) + '" target="_blank" rel="noopener noreferrer" aria-label="Kaynağı aç">↗</a>'
      : '<span class="source-trust">' + escapeHtml(trust[source.trust] || source.trust || '') + '</span>';
    return '<div class="source-item"><span class="source-symbol">' + escapeHtml(symbol[source.kind] || 'K') + '</span><span><strong>' + escapeHtml(source.title || source.provider || 'Kaynak') + '</strong><small>' + escapeHtml(source.note || source.provider || '') + '</small></span>' + link + '</div>';
  }).join('');
}

function renderAnalysisFailure(error) {
  elements.analysisStatus.hidden = false;
  elements.analysisStatus.className = 'analysis-status card is-warning';
  elements.analysisStatusIcon.textContent = '!';
  elements.analysisStatusTitle.textContent = 'Parsel bulundu, analiz tamamlanamadı';
  elements.analysisStatusText.textContent = readableError(error);
  elements.plainExplanation.textContent = buildCadastralExplanation(state.parcelFeature);
  renderDecisionSummary({ status: 'cadastral-only', zoningStatus: 'unavailable', zoning: { fields: {} } });
  elements.zoningOverviewTitle.textContent = 'Analiz servisi yanıt vermedi';
  elements.zoningOverviewText.textContent = 'Parsel kaydı kullanılabilir; analizi yeniden deneyebilir veya talep gönderebilirsiniz.';
  elements.zoningMiniList.innerHTML = [['Plan fonksiyonu','Doğrulanamadı'],['TAKS / Emsal','Doğrulanamadı'],['Kat / Yençok','Doğrulanamadı'],['Yapı nizamı','Doğrulanamadı']].map(([l,v])=>`<div><dt>${l}</dt><dd>${v}</dd></div>`).join('');
  renderSummary({}); renderPossibilities([]); renderWarnings([{ level: 'info', text: readableError(error) }]);
  renderTechnical(cadastralTechnicalRows()); renderEnvironment({ status: 'unavailable', message: 'Yakın çevre analizi tamamlanamadı.' });
  renderOfficialServices({ status: 'national-portals-ready', message: 'e-Plan ve belediye resmî imar sorgusu manuel olarak kontrol edilebilir.', actions: defaultOfficialActions() });
  renderSourceScan({ status: 'incomplete', exhausted: false, attemptedCount: 0, reachableCount: 0, foundRecordCount: 0, attempts: [] });
  renderPlanAi({ status: 'unavailable', enabled: true, configured: true, degraded: true, fallbackAvailable: true, message: 'Canlı analiz tamamlanamadı; yalnız ekrandaki kadastro bilgisi güvenli özet modunda açıklanabilir.', evidence: [], evidenceBackedFields: [] });
  renderRoadmap(defaultRoadmap()); renderClaims([], []); renderSources(defaultSources());
  elements.zoningCompletionCard.hidden = false;
}

function resetAnalysisPanels() {
  renderSummary({});
  elements.possibilityGrid.innerHTML = '<div class="empty-state-inline">Analiz hazırlanıyor…</div>';
  elements.warningList.innerHTML = '<div class="empty-state-inline">Kaynaklar kontrol ediliyor…</div>';
  elements.technicalList.innerHTML = '<div class="is-missing"><dt>Resmî kaynaklar</dt><dd>Kontrol ediliyor…</dd><small>Parsel, plan ve belediye bağlantıları inceleniyor.</small></div>';
  elements.officialServicesBadge.className = 'data-badge'; elements.officialServicesBadge.textContent = 'Hazırlanıyor';
  elements.officialServicesIntro.textContent = 'e-Plan, TUCBS ve ilgili belediyenin resmî imar hizmeti aranıyor.';
  elements.officialServicesGrid.innerHTML = '<div class="official-services-empty">Resmî imar sorgu yolları hazırlanıyor…</div>';
  elements.planRecordsBadge.className = 'data-badge'; elements.planRecordsBadge.textContent = 'Hazırlanıyor';
  elements.planRecordsIntro.textContent = 'Kamuya açık resmî plan ve askı kayıtlarında ada/parsel eşleşmesi aranıyor.';
  elements.planRecordsGrid.innerHTML = '<div class="plan-records-empty">Resmî plan kayıtları kontrol ediliyor…</div>';
  elements.sourceScanCard.hidden = false;
  elements.sourceScanBadge.className = 'data-badge is-loading'; elements.sourceScanBadge.textContent = 'Taranıyor';
  elements.sourceScanIntro.textContent = 'e-Devlet girişi istemeyen e-Plan, TUCBS ve belediye açık veri kaynakları kontrollü süre içinde taranıyor; yanıt vermeyen kaynak bütün sonucu bekletmez.';
  elements.sourceScanGrid.innerHTML = '<div class="source-scan-empty">Açık resmî veri kaynakları taranıyor…</div>';
  if (elements.retrySourceScanButton) { elements.retrySourceScanButton.hidden = true; elements.retrySourceScanButton.disabled = true; }
  elements.planAiCard.hidden = false;
  elements.planAiBadge.className = 'data-badge is-loading'; elements.planAiBadge.textContent = 'Hazırlanıyor';
  elements.planAiIntro.textContent = 'Plan AI için açık resmî kaynak kanıtı hazırlanıyor.';
  elements.planAiEvidence.innerHTML = '<div class="source-scan-empty">Yeni parselin Plan AI kanıtı hazırlanıyor…</div>';
  if (elements.planAiAskButton) { elements.planAiAskButton.disabled = true; elements.planAiAskButton.textContent = "Plan AI'ye Sor"; }
  elements.environmentBadge.className = 'data-badge'; elements.environmentBadge.textContent = 'Hazırlanıyor';
  elements.environmentIntro.textContent = 'Parsel merkezinin yakınındaki ulaşım, eğitim, sağlık, park ve günlük ihtiyaç noktaları inceleniyor.';
  elements.environmentGrid.innerHTML = '<div class="environment-empty">Yakın çevre verisi hazırlanıyor… Yanıt gecikirse parsel ve imar sonucu bekletilmeden gösterilir.</div>';
  renderRoadmap(defaultRoadmap());
  elements.claimList.innerHTML = '<div class="empty-state-inline">Kaynak ilişkisi hazırlanıyor…</div>';
  renderSources(defaultSources());
  elements.zoningCompletionCard.hidden = true;
}

function setupActions() {
  elements.analysisStatus?.insertAdjacentElement('afterend', elements.zoningCompletionCard);
  elements.resetMap.addEventListener('click', resetMapToTurkey);
  elements.planAiAskButton?.addEventListener('click', () => openPlanAiDrawer());
  elements.retrySourceScanButton?.addEventListener('click', async () => {
    if (!state.parcelFeature || elements.retrySourceScanButton.disabled) return;
    showToast('Kalan resmî kaynaklar önbelleksiz yeniden taranıyor…');
    await analyzeCurrentParcel(undefined, { forceRefresh: true });
  });
  elements.mapClick.addEventListener('click', () => {
    state.mapClickActive = !state.mapClickActive;
    elements.mapClick.setAttribute('aria-pressed', String(state.mapClickActive));
    state.map?.getContainer().classList.toggle('map-click-active', state.mapClickActive);
    showToast(state.mapClickActive ? 'Haritada bir noktaya dokunun.' : 'Haritadan sorgulama kapatıldı.');
  });
  elements.favoriteButton.addEventListener('click', toggleFavorite);
  elements.shareSummaryButton?.addEventListener('click', shareCurrentSummary);
  elements.metricQuality?.addEventListener('click', () => elements.metricQuality.classList.toggle('is-expanded'));
  elements.addEvidenceButton.addEventListener('click', openEvidenceForm);
  elements.requestAnalysisButton.addEventListener('click', openRequestForm);
}

async function shareCurrentSummary() {
  if (!state.parcelFeature) return showToast('Önce bir parsel sorgulayın.');
  const text = buildShareSummary();
  const data = { title: 'Planlamasyon parsel özeti', text };
  try {
    if (navigator.share) await navigator.share(data);
    else if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      showToast('Doğrulanmış parsel özeti panoya kopyalandı.');
    } else showToast('Paylaşım bu tarayıcıda kullanılamıyor.');
  } catch (error) {
    if (error?.name !== 'AbortError') showToast('Özet paylaşılamadı.');
  }
}

function buildShareSummary() {
  const p = state.parcelFeature?.properties || {};
  const analysis = state.analysis || {};
  const fields = analysis.zoning?.fields || {};
  const metrics = analysis.metrics || {};
  const lines = [
    `Parsel: ${[p.province, p.district, p.neighbourhood].filter(Boolean).join(' / ')} · ${p.block || '—'}/${p.parcel || '—'}`,
    `Kadastro alanı: ${formatArea(p.area, p.areaText)}`,
    `İmar durumu: ${hasVerifiedZoning(analysis) ? 'doğrulanan resmî değerlere dayanıyor' : 'henüz doğrulanmadı'}`
  ];
  if (fields.netParcelArea != null) lines.push(`Net imar parseli alanı: ${formatNumber(fields.netParcelArea)} m²`);
  if (fields.landUse) lines.push(`Plan fonksiyonu: ${fields.landUse}`);
  if (fields.taks != null) lines.push(`TAKS: ${formatNumber(fields.taks)}`);
  if (fields.emsal != null) lines.push(`KAKS/Emsal: ${formatNumber(fields.emsal)}`);
  if (fields.floors != null) lines.push(`Kat: ${formatNumber(fields.floors)}`);
  if (fields.hmax != null) lines.push(`Yençok/Hmax: ${formatNumber(fields.hmax)} m`);
  if (metrics.footprint?.value != null) lines.push(`Teorik taban oturumu: ${metrics.footprint.display}`);
  if (metrics.construction?.value != null) lines.push(`Emsale esas teorik alan: ${metrics.construction.display}`);
  lines.push('Bilgi amaçlıdır; ruhsat ve kesin hak için yetkili idarenin güncel kaydı esas alınır.');
  return lines.join('\n');
}

async function onMapClick(event) {
  if (!state.mapClickActive) return;
  setMapLoading(true);
  try {
    const feature = await apiTkgm('coordinate', { lat: event.latlng.lat, lon: event.latlng.lng });
    const p = feature.properties || {};
    state.lastQuery = { province: p.province, district: p.district, neighbourhood: p.neighbourhood, neighbourhoodId: p.neighbourhoodId, block: p.block, parcel: p.parcel };
    await renderParcelAndAnalyze(feature, { scroll: true });
    state.mapClickActive = false;
    elements.mapClick.setAttribute('aria-pressed', 'false');
    state.map?.getContainer().classList.remove('map-click-active');
  } catch (error) {
    showToast(readableError(error));
  } finally {
    setMapLoading(false);
  }
}

function openEvidenceForm() {
  if (!state.parcelFeature) return;
  const saved = getSavedEvidence() || {};
  const allowances = saved.allowances || {};
  const allowanceLabels = { housing: 'Konut', villa: 'Villa', pool: 'Havuz', landscaping: 'Bahçe / Peyzaj', roof: 'Çatı', terraceRoof: 'Teras çatı', balcony: 'Balkon', basement: 'Bodrum', parking: 'Otopark', solar: 'Güneş paneli' };
  openDrawer('Resmî İmar Belgesini Yükle ve Oku', `
    <form class="drawer-form" id="evidenceForm">
      <div class="drawer-help document-reader-intro"><strong>Resmî belgeyi doğrulanmış hesaba dönüştürün.</strong><br>Güncel imar durumu, imar çapı veya plan notunu PDF, fotoğraf, metin ya da resmî bağlantı olarak ekleyebilirsiniz. Sistem ada/parseli karşılaştırır; net imar alanı, TAKS, KAKS/emsal, kat, Yençok ve cepheye bağlı çekme mesafelerini kanıtıyla doldurur. Son onay yine sizdedir.</div>

      <section class="document-reader-card" aria-labelledby="documentReaderTitle">
        <div class="document-reader-heading">
          <div><span class="section-kicker">Belge okuma motoru · v3.5.0</span><h4 id="documentReaderTitle">Resmî belgeyi güvenli biçimde oku</h4></div>
          <span class="data-badge" id="documentReaderBadge">Hazır</span>
        </div>
        <div class="document-tabs" role="tablist" aria-label="Belge giriş yöntemi">
          <button type="button" class="document-tab is-active" data-document-tab="file">Dosya</button>
          <button type="button" class="document-tab" data-document-tab="url">Bağlantı</button>
          <button type="button" class="document-tab" data-document-tab="text">Metin</button>
        </div>
        <div class="document-tab-panel" data-document-panel="file">
          <label class="document-drop-zone" for="officialDocumentFile">
            <input id="officialDocumentFile" type="file" accept=".pdf,.txt,.html,.htm,.json,.xml,.gml,.png,.jpg,.jpeg,image/png,image/jpeg,application/pdf,text/plain,text/html,application/json,application/xml">
            <span class="document-drop-icon">⇧</span>
            <strong>PDF, fotoğraf veya metin belgesi seçin</strong>
            <small>PDF metin katmanı cihazınızda okunur. Taranmış PDF ve görseller için Türkçe OCR otomatik denenir. En fazla 12 MB.</small>
          </label>
          <div class="document-file-summary" id="documentFileSummary" hidden></div>
        </div>
        <div class="document-tab-panel" data-document-panel="url" hidden>
          <div class="field"><label for="documentSourceUrl">Resmî PDF / belge bağlantısı</label><input id="documentSourceUrl" type="url" placeholder="https://...pdf"></div>
          <p class="field-help">Herkese açık HTTPS PDF, HTML, JSON veya XML bağlantıları sunucu üzerinden okunabilir. e-Devlet oturumu isteyen ekranlar için belgeyi indirip Dosya sekmesinden yükleyin.</p>
        </div>
        <div class="document-tab-panel" data-document-panel="text" hidden>
          <div class="field"><label for="documentPastedText">Belge metnini yapıştırın</label><textarea id="documentPastedText" rows="8" placeholder="İmar durumu veya plan notu metni..."></textarea></div>
        </div>
        <label class="drawer-check document-source-confirm"><input type="checkbox" id="documentOfficialSourceConfirm"><span>Bu dosyayı veya metni resmî kurum sayfasından ben aldım ve yalnız kendi sorgum için okunmasını onaylıyorum.</span></label>
        <label class="drawer-check document-parcel-confirm" id="documentParcelConfirmWrap" hidden><input type="checkbox" id="documentParcelConfirm"><span>Belgede ada/parsel metni otomatik okunamadı; bu belgenin sorguladığım parsele ait olduğunu resmî belgeden kontrol ettim.</span></label>
        <button class="button button-primary" id="readOfficialDocumentButton" type="button"><span class="document-read-label">Belgeyi Oku ve Alanları Doldur</span><span class="button-spinner" hidden></span></button>
        <div class="document-reader-status" id="documentReaderStatus" hidden aria-live="polite"></div>
        <div class="document-extraction-result" id="documentExtractionResult" hidden></div>
      </section>

      <input type="hidden" name="documentName" value="${escapeHtml(saved.documentName || '')}">
      <input type="hidden" name="documentMimeType" value="${escapeHtml(saved.documentMimeType || '')}">
      <input type="hidden" name="documentHash" value="${escapeHtml(saved.documentHash || '')}">
      <input type="hidden" name="parserVersion" value="${escapeHtml(saved.parserVersion || '')}">
      <input type="hidden" name="documentType" value="${escapeHtml(saved.documentType || '')}">
      <input type="hidden" name="extractionConfidence" value="${escapeHtml(saved.extractionConfidence || '')}">
      <input type="hidden" name="parcelMatchStatus" value="${escapeHtml(saved.parcelMatchStatus || '')}">
      <input type="hidden" name="fieldEvidence" value="${escapeHtml(JSON.stringify(saved.fieldEvidence || {}))}">
      <input type="hidden" name="setbackConditions" value="${escapeHtml(JSON.stringify(saved.setbackConditions || []))}">
      <input type="hidden" name="extractedAt" value="${escapeHtml(saved.extractedAt || '')}">

      <div class="document-review-divider"><span>Okunan değerleri kontrol edin</span></div>
      <div class="field"><label>Belge / kaynak başlığı</label><input name="sourceTitle" required value="${escapeHtml(saved.sourceTitle || '')}" placeholder="Örn. Güncel imar durumu belgesi"></div>
      <div class="field"><label>Yetkili idare</label><input name="authority" required value="${escapeHtml(saved.authority || '')}" placeholder="Örn. Pendik Belediyesi"></div>
      <div class="field"><label>Kaynak bağlantısı (varsa)</label><input name="sourceUrl" type="url" value="${escapeHtml(saved.sourceUrl || '')}" placeholder="https://..."></div>
      <div class="drawer-form-grid">
        <div class="field"><label>Plan adı</label><input name="planName" value="${escapeHtml(saved.planName || '')}"></div>
        <div class="field"><label>Plan işlem / karar no</label><input name="planNumber" value="${escapeHtml(saved.planNumber || '')}"></div>
        <div class="field"><label>Plan ölçeği</label><input name="planScale" value="${escapeHtml(saved.planScale || '')}" placeholder="1/1000"></div>
        <div class="field"><label>Plan / belge tarihi</label><input name="planDate" type="date" value="${escapeHtml(saved.planDate || '')}"></div>
      </div>
      <h4>Yapılaşma koşulları</h4>
      <div class="field"><label>Plan fonksiyonu</label><input name="landUse" value="${escapeHtml(saved.landUse || '')}" placeholder="Konut alanı, ticaret alanı..."></div>
      <div class="drawer-form-grid">
        <div class="field"><label>Net imar parseli alanı (m²)</label><input name="netParcelArea" inputmode="decimal" value="${escapeHtml(saved.netParcelArea ?? '')}" placeholder="Belgede açıkça yazıyorsa"></div>
        <div class="field"><label>TAKS</label><input name="taks" inputmode="decimal" value="${escapeHtml(saved.taks ?? '')}" placeholder="0,30"></div>
        <div class="field"><label>Emsal / KAKS</label><input name="emsal" inputmode="decimal" value="${escapeHtml(saved.emsal ?? '')}" placeholder="1,50"></div>
        <div class="field"><label>Kat adedi</label><input name="floors" inputmode="numeric" value="${escapeHtml(saved.floors ?? '')}" placeholder="5"></div>
        <div class="field"><label>Yençok / Hmax (m)</label><input name="hmax" inputmode="decimal" value="${escapeHtml(saved.hmax ?? '')}" placeholder="15,50"></div>
        <div class="field"><label>Yapı nizamı</label><input name="buildingOrder" value="${escapeHtml(saved.buildingOrder || '')}" placeholder="Ayrık"></div>
      </div>
      <div class="drawer-form-grid">
        <div class="field"><label>Ön bahçe (m)</label><input name="frontSetback" inputmode="decimal" value="${escapeHtml(saved.frontSetback ?? '')}"></div>
        <div class="field"><label>Yan bahçe (m)</label><input name="sideSetback" inputmode="decimal" value="${escapeHtml(saved.sideSetback ?? '')}"></div>
        <div class="field"><label>Arka bahçe (m)</label><input name="rearSetback" inputmode="decimal" value="${escapeHtml(saved.rearSetback ?? '')}"></div>
      </div>
      <h4>Resmî belgede belirtilen kullanım seçenekleri</h4>
      <div class="allowance-list">${Object.entries(allowanceLabels).map(([key, label]) => `
        <div class="allowance-row"><label>${escapeHtml(label)}</label><select name="allowance_${key}">${possibilityOptions(allowances[key])}</select></div>`).join('')}</div>
      <div class="drawer-form-grid">
        <div class="field"><label>Otopark zorunluluğu</label><select name="parkingRequired"><option value="">Belirtilmemiş</option><option value="true" ${saved.parkingRequired === true ? 'selected' : ''}>Gerekli</option><option value="false" ${saved.parkingRequired === false ? 'selected' : ''}>Gerekli değil / belirtilmemiş</option></select></div>
        <div class="field"><label>Yol terki ihtimali</label><select name="roadDedicationPossible"><option value="">Belirtilmemiş</option><option value="true" ${saved.roadDedicationPossible === true ? 'selected' : ''}>Var</option><option value="false" ${saved.roadDedicationPossible === false ? 'selected' : ''}>Yok</option></select></div>
        <div class="field"><label>Taşkın bilgisi</label><select name="floodDataStatus"><option value="">Belirtilmemiş</option><option value="clear" ${saved.floodDataStatus === 'clear' ? 'selected' : ''}>Risk kaydı yok</option><option value="risk" ${saved.floodDataStatus === 'risk' ? 'selected' : ''}>Risk / kısıt var</option><option value="unknown" ${saved.floodDataStatus === 'unknown' ? 'selected' : ''}>Doğrulanamadı</option></select></div>
      </div>
      <div class="field"><label>Özel plan notları / açıklama</label><textarea name="planNotes" placeholder="Belgede açıkça yazan özel hükümler...">${escapeHtml(saved.planNotes || '')}</textarea></div>
      <div class="field"><label>Kısıtlar (her satıra bir madde)</label><textarea name="constraints" placeholder="Yol terki gerekebilir\nKurum görüşü alınmalı">${escapeHtml(Array.isArray(saved.constraints) ? saved.constraints.join('\n') : saved.constraints || '')}</textarea></div>
      <label class="drawer-check"><input type="checkbox" name="confirmed" required ${saved.confirmed ? 'checked' : ''}><span>Yukarıdaki değerleri yüklediğim güncel resmî belgeyle karşılaştırdım. Planlamasyon’un otomatik okumasının bağlayıcı olmadığını ve ruhsat öncesi yetkili idare teyidi gerektiğini kabul ediyorum.</span></label>
      <button class="button button-primary" id="applyEvidenceButton" type="submit">Belge Bilgileriyle Analizi Yenile</button>
      <button class="button button-secondary" id="deleteEvidenceButton" type="button">Kayıtlı Belge Bilgisini Sil</button>
    </form>`);

  const form = $('#evidenceForm', elements.drawerContent);
  setupDocumentReader(form);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = evidenceFromForm(new FormData(form));
    if (!data.confirmed) { showToast('Belge doğrulama kutusunu işaretleyin.'); return; }
    if (data.parcelMatchStatus === 'mismatch') { showToast('Belge ada/parseli mevcut sorguyla eşleşmiyor; bu belge uygulanamaz.'); return; }
    if (['plan-announcement', 'public-plan-record'].includes(String(data.documentType || '').toLowerCase())) { showToast('Askı veya tarihsel plan kaydı güncel imar hakkı olarak uygulanamaz. Güncel imar durumu/plan notu belgesi ekleyin.'); return; }
    if (data.parcelMatchStatus === 'unverified' && !$('#documentParcelConfirm', form)?.checked) { showToast('Belgenin bu parsele ait olduğunu onaylayın.'); return; }
    data.parcelConfirmed = data.parcelMatchStatus === 'exact' || Boolean($('#documentParcelConfirm', form)?.checked);
    saveEvidence(data);
    closeDrawer();
    showToast('Resmî belge bilgileri kaydedildi; analiz yenileniyor.');
    await analyzeCurrentParcel(data);
  });
  $('#deleteEvidenceButton', elements.drawerContent).addEventListener('click', async () => {
    deleteEvidence(); closeDrawer(); showToast('Belge bilgisi silindi; analiz yeniden kontrol ediliyor.'); await analyzeCurrentParcel(null);
  });
}

function setupDocumentReader(form) {
  const tabs = $$('.document-tab', form);
  const panels = $$('.document-tab-panel', form);
  const fileInput = $('#officialDocumentFile', form);
  const fileSummary = $('#documentFileSummary', form);
  const readButton = $('#readOfficialDocumentButton', form);
  const status = $('#documentReaderStatus', form);
  const result = $('#documentExtractionResult', form);
  const badge = $('#documentReaderBadge', form);
  const label = $('.document-read-label', readButton);
  const spinner = $('.button-spinner', readButton);
  let activeTab = 'file';

  tabs.forEach((button) => button.addEventListener('click', () => {
    activeTab = button.dataset.documentTab;
    tabs.forEach((item) => item.classList.toggle('is-active', item === button));
    panels.forEach((panel) => { panel.hidden = panel.dataset.documentPanel !== activeTab; });
  }));

  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (!file) { fileSummary.hidden = true; return; }
    fileSummary.hidden = false;
    fileSummary.innerHTML = `<strong>${escapeHtml(file.name)}</strong><span>${formatFileSize(file.size)} · ${escapeHtml(file.type || 'Dosya')}</span>`;
  });

  readButton.addEventListener('click', async () => {
    setDocumentReaderBusy(true);
    status.hidden = false;
    result.hidden = true;
    badge.textContent = 'Okunuyor';
    badge.className = 'data-badge is-loading';
    try {
      const officialSourceConfirmed = Boolean($('#documentOfficialSourceConfirm', form)?.checked);
      if (activeTab !== 'url' && !officialSourceConfirmed) throw new Error('Dosya veya metnin resmî kaynaktan alındığını ve okunmasını onayladığınızı işaretleyin.');
      let payload;
      if (activeTab === 'file') {
        const file = fileInput.files?.[0];
        if (!file) throw new Error('Önce bir belge dosyası seçin.');
        if (file.size > 12 * 1024 * 1024) throw new Error('Belge 12 MB sınırını aşıyor.');
        status.innerHTML = '<strong>Belge cihazınızda okunuyor</strong><span>PDF metni veya Türkçe OCR hazırlanıyor. Belge dosyanız sunucuya yüklenmez; yalnızca çıkarılan metin analiz edilir.</span>';
        const extracted = await extractTextFromOfficialFile(file, (message, progress) => {
          status.innerHTML = `<strong>${escapeHtml(message)}</strong><span>${progress != null ? `%${Math.round(progress * 100)} tamamlandı` : 'Lütfen bekleyin.'}</span>`;
        });
        payload = {
          mode: 'text', text: extracted.text, fileName: file.name, mimeType: file.type || extracted.mimeType,
          sourceTitle: file.name.replace(/\.[^.]+$/, ''), sourceUrl: $('[name="sourceUrl"]', form)?.value || null
        };
        form.elements.documentName.value = file.name;
        form.elements.documentMimeType.value = file.type || extracted.mimeType || '';
      } else if (activeTab === 'url') {
        const sourceUrl = String($('#documentSourceUrl', form).value || '').trim();
        if (!sourceUrl) throw new Error('Resmî belge bağlantısını girin.');
        status.innerHTML = '<strong>Resmî bağlantı okunuyor</strong><span>Herkese açık belge sunucu üzerinden alınıyor.</span>';
        payload = { mode: 'url', sourceUrl };
        form.elements.sourceUrl.value = sourceUrl;
      } else {
        const text = String($('#documentPastedText', form).value || '').trim();
        if (text.length < 20) throw new Error('En az 20 karakter belge metni yapıştırın.');
        status.innerHTML = '<strong>Yapıştırılan metin inceleniyor</strong><span>Ada/parsel ve yapılaşma koşulları aranıyor.</span>';
        payload = { mode: 'text', text, fileName: 'Yapıştırılan resmî belge metni.txt', mimeType: 'text/plain', sourceTitle: 'Yapıştırılan resmî belge metni' };
      }
      payload.query = state.lastQuery || {};
      payload.parcel = state.parcelFeature;
      payload.evidenceOrigin = activeTab === 'file' ? 'user-upload' : activeTab === 'text' ? 'user-paste' : 'automatic-url';
      payload.userConfirmedOfficialSource = officialSourceConfirmed;
      const response = await fetch('/api/parse-zoning-document', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok || !json.ok) throw new Error(json.message || `Belge okuma servisi ${response.status} yanıtı verdi.`);
      const parsed = json.data;
      applyParsedEvidenceToForm(form, parsed);
      renderDocumentExtractionResult(result, parsed);
      status.hidden = true;
      result.hidden = false;
      badge.textContent = parsed.canApply ? (parsed.status === 'ready' ? 'Tam okundu' : 'Kısmi okundu') : 'Kontrol gerekli';
      badge.className = `data-badge ${parsed.canApply ? 'is-success' : 'is-warning'}`;
      showToast(parsed.canApply ? 'Belge okundu; doldurulan alanları kontrol edin.' : 'Belge okundu; ada/parsel veya belge türü için kontrol gerekiyor.');
    } catch (error) {
      badge.textContent = 'Okunamadı';
      badge.className = 'data-badge is-error';
      status.hidden = false;
      status.innerHTML = `<strong>Belge okunamadı</strong><span>${escapeHtml(readableError(error))}</span>`;
    } finally {
      setDocumentReaderBusy(false);
    }
  });

  function setDocumentReaderBusy(busy) {
    readButton.disabled = busy;
    spinner.hidden = !busy;
    label.textContent = busy ? 'Belge Okunuyor…' : 'Belgeyi Oku ve Alanları Doldur';
  }
}

async function extractTextFromOfficialFile(file, onProgress = () => {}) {
  const type = String(file.type || '').toLowerCase();
  const name = String(file.name || '').toLowerCase();
  if (type.startsWith('text/') || /\.(txt|html?|json|xml|gml|csv)$/i.test(name)) {
    onProgress('Metin dosyası okunuyor', 0.5);
    return { text: await file.text(), mimeType: type || 'text/plain' };
  }
  if (type === 'application/pdf' || name.endsWith('.pdf')) {
    const pdfText = await extractPdfTextInBrowser(file, onProgress);
    if (pdfText.text.replace(/\s/g, '').length >= 80) return { text: pdfText.text, mimeType: 'application/pdf' };
    onProgress('PDF taranmış görünüyor; OCR başlatılıyor', 0.05);
    const ocrText = await ocrScannedPdf(file, onProgress);
    return { text: ocrText, mimeType: 'application/pdf' };
  }
  if (type.startsWith('image/') || /\.(png|jpe?g)$/i.test(name)) {
    onProgress('Görsel için Türkçe OCR başlatılıyor', 0.05);
    return { text: await ocrImages([file], onProgress), mimeType: type || 'image/jpeg' };
  }
  throw new Error('Bu dosya türü desteklenmiyor. PDF, TXT, HTML, JSON, XML, PNG veya JPG kullanın.');
}

async function extractPdfTextInBrowser(file, onProgress) {
  const pdfjs = await import('https://cdn.jsdelivr.net/npm/pdfjs-dist@6.2.108/build/pdf.min.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.2.108/build/pdf.worker.min.mjs';
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false, useSystemFonts: true, maxImageSize: 16_777_216 }).promise;
  const totalPages = pdf.numPages;
  if (totalPages > 80) { await pdf.destroy(); throw new Error('PDF 80 sayfadan uzun olduğu için otomatik işlenemedi.'); }
  const pages = [];
  for (let pageNumber = 1; pageNumber <= totalPages; pageNumber += 1) {
    onProgress(`PDF metni okunuyor · Sayfa ${pageNumber}/${totalPages}`, pageNumber / totalPages);
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    pages.push(content.items.map((item) => item.str || '').join(' '));
    page.cleanup();
    if (pages.join('\n').length > 350_000) break;
  }
  await pdf.destroy();
  return { text: pages.join('\n'), pages: totalPages };
}

async function ocrScannedPdf(file, onProgress) {
  const pdfjs = await import('https://cdn.jsdelivr.net/npm/pdfjs-dist@6.2.108/build/pdf.min.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.2.108/build/pdf.worker.min.mjs';
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false, maxImageSize: 16_777_216 }).promise;
  const totalPages = pdf.numPages;
  const pageCount = Math.min(totalPages, 4);
  const images = [];
  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
    onProgress(`Taranmış PDF hazırlanıyor · Sayfa ${pageNumber}/${pageCount}`, pageNumber / (pageCount * 3));
    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1.55 });
    const canvas = document.createElement('canvas');
    canvas.width = Math.min(2400, Math.ceil(viewport.width));
    canvas.height = Math.min(3200, Math.ceil(viewport.height));
    const scaleX = canvas.width / viewport.width;
    const adjustedViewport = page.getViewport({ scale: 1.55 * scaleX });
    await page.render({ canvasContext: canvas.getContext('2d', { alpha: false }), viewport: adjustedViewport }).promise;
    images.push(canvas);
    page.cleanup();
  }
  await pdf.destroy();
  if (totalPages > pageCount) showToast(`OCR ilk ${pageCount} sayfayı okudu; gerekli alanlar sonraki sayfalardaysa metni ayrıca yapıştırın.`);
  return ocrImages(images, onProgress);
}

async function ocrImages(images, onProgress) {
  if (!('Worker' in window) || !('WebAssembly' in window)) throw new Error('Bu tarayıcı OCR özelliğini desteklemiyor. Belge metnini Metin sekmesine yapıştırın.');
  const tesseract = await import('https://cdn.jsdelivr.net/npm/tesseract.js@6/dist/tesseract.esm.min.js');
  const createWorker = tesseract.createWorker || tesseract.default?.createWorker;
  if (!createWorker) throw new Error('OCR modülü yüklenemedi.');
  const worker = await createWorker(['tur', 'eng'], undefined, {
    logger: (message) => {
      const base = Number(message.progress || 0);
      onProgress(`OCR · ${ocrStatusLabel(message.status)}`, base);
    }
  });
  const output = [];
  try {
    for (let index = 0; index < images.length; index += 1) {
      onProgress(`OCR yapılıyor · Sayfa ${index + 1}/${images.length}`, index / images.length);
      const result = await worker.recognize(images[index]);
      output.push(result.data?.text || '');
    }
  } finally {
    await worker.terminate();
  }
  return output.join('\n');
}

function applyParsedEvidenceToForm(form, parsed) {
  const evidence = parsed.evidence || {};
  const names = ['sourceTitle','authority','sourceUrl','planName','planNumber','planScale','planDate','landUse','netParcelArea','taks','emsal','floors','hmax','buildingOrder','frontSetback','sideSetback','rearSetback','setbackConditions','parkingRequired','roadDedicationPossible','floodDataStatus','planNotes','constraints','documentName','documentMimeType','documentHash','parserVersion','documentType','extractionConfidence','parcelMatchStatus','fieldEvidence','extractedAt'];
  for (const name of names) {
    const field = form.elements[name];
    if (!field) continue;
    let value = evidence[name];
    if (name === 'constraints' && Array.isArray(value)) value = value.join('\n');
    if ((name === 'fieldEvidence' || name === 'setbackConditions') && typeof value === 'object') value = JSON.stringify(value);
    if (typeof value === 'boolean') value = String(value);
    if (value != null) field.value = value;
  }
  for (const [key, value] of Object.entries(evidence.allowances || {})) {
    const field = form.elements[`allowance_${key}`];
    if (field) field.value = value || 'unknown';
  }
  const parcelConfirmWrap = $('#documentParcelConfirmWrap', form);
  const parcelConfirm = $('#documentParcelConfirm', form);
  if (parcelConfirmWrap && parcelConfirm) {
    parcelConfirmWrap.hidden = parsed.parcelMatch?.status !== 'unverified';
    parcelConfirm.checked = parsed.parcelMatch?.status === 'exact';
  }
  const submit = $('#applyEvidenceButton', form);
  if (submit) {
    const historical = ['plan-announcement', 'public-plan-record'].includes(parsed.documentType);
    submit.disabled = parsed.parcelMatch?.status === 'mismatch' || historical;
    submit.textContent = parsed.parcelMatch?.status === 'mismatch'
      ? 'Belge Bu Parsele Ait Değil'
      : historical
        ? 'Tarihsel Kayıt Güncel İmar Hakkı Olarak Kullanılamaz'
        : parsed.canApply
          ? 'Belge Bilgileriyle Analizi Yenile'
          : 'Alanları Resmî Belgeyle Tamamlayıp Uygula';
  }
}

function renderDocumentExtractionResult(container, parsed) {
  const confidenceLabel = { high: 'Yüksek', medium: 'Orta', low: 'Düşük' }[parsed.confidence] || 'Düşük';
  const parcelClass = parsed.parcelMatch?.status === 'exact' ? 'is-success' : parsed.parcelMatch?.status === 'mismatch' ? 'is-error' : 'is-warning';
  const fieldEntries = Object.entries(parsed.fieldEvidence || {});
  container.innerHTML = `
    <div class="document-result-summary">
      <div><span>Belge türü</span><strong>${escapeHtml(parsed.documentTypeLabel || 'Resmî belge')}</strong></div>
      <div><span>Ada/parsel</span><strong class="${parcelClass}">${escapeHtml(parsed.parcelMatch?.message || 'Kontrol gerekli')}</strong></div>
      <div><span>Okuma güveni</span><strong>${escapeHtml(confidenceLabel)}</strong></div>
      <div><span>Tamamlanma</span><strong>%${Number(parsed.completeness?.percentage || 0)}</strong></div>
    </div>
    ${fieldEntries.length ? `<details class="document-field-evidence"><summary>Bulunan ${fieldEntries.length} değerin belge kanıtlarını göster</summary><div>${fieldEntries.map(([key, item]) => `<article><strong>${escapeHtml(item.label || key)}</strong><span>${escapeHtml(item.excerpt || 'Belge metninden bulundu.')}</span><small>Güven: ${escapeHtml(({ high:'yüksek', medium:'orta', low:'düşük' })[item.confidence] || item.confidence || '—')}</small></article>`).join('')}</div></details>` : '<p class="document-no-fields">Belgede yapılaşma değeri bulunamadı.</p>'}
    ${(parsed.warnings || []).length ? `<div class="document-warning-list">${parsed.warnings.map((warning) => `<p>⚠ ${escapeHtml(warning)}</p>`).join('')}</div>` : ''}`;
}

function evidenceFromForm(formData) {
  const value = (name) => String(formData.get(name) || '').trim();
  const number = (name) => {
    const text = value(name).replace(',', '.');
    return text === '' ? null : Number(text);
  };
  const allowances = {};
  for (const key of ['housing','villa','pool','landscaping','roof','terraceRoof','balcony','basement','parking','solar']) allowances[key] = value(`allowance_${key}`) || 'unknown';
  let fieldEvidence = {};
  try { fieldEvidence = JSON.parse(value('fieldEvidence') || '{}'); } catch {}
  let setbackConditions = [];
  try { setbackConditions = JSON.parse(value('setbackConditions') || '[]'); } catch {}
  if (!Array.isArray(setbackConditions)) setbackConditions = [];
  return {
    confirmed: formData.get('confirmed') === 'on', sourceTitle: value('sourceTitle'), authority: value('authority'), sourceUrl: value('sourceUrl') || null,
    planName: value('planName'), planNumber: value('planNumber'), planScale: value('planScale'), planDate: value('planDate'), landUse: value('landUse'),
    netParcelArea: number('netParcelArea'), taks: number('taks'), emsal: number('emsal'), floors: number('floors'), hmax: number('hmax'), buildingOrder: value('buildingOrder'),
    frontSetback: number('frontSetback'), sideSetback: number('sideSetback'), rearSetback: number('rearSetback'), setbackConditions, allowances,
    parkingRequired: parseBoolean(value('parkingRequired')), roadDedicationPossible: parseBoolean(value('roadDedicationPossible')),
    floodDataStatus: value('floodDataStatus') || null, planNotes: value('planNotes'), constraints: value('constraints').split(/\r?\n/).map((item) => item.trim()).filter(Boolean),
    documentName: value('documentName') || null, documentMimeType: value('documentMimeType') || null, documentHash: value('documentHash') || null,
    parserVersion: value('parserVersion') || null, documentType: value('documentType') || null, extractionConfidence: value('extractionConfidence') || null,
    parcelMatchStatus: value('parcelMatchStatus') || null, fieldEvidence, extractedAt: value('extractedAt') || null
  };
}

function formatFileSize(bytes) { const value = Number(bytes || 0); if (value < 1024) return `${value} B`; if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`; return `${(value / 1024 / 1024).toFixed(1)} MB`; }
function ocrStatusLabel(status) { return ({ 'loading tesseract core': 'OCR motoru yükleniyor', 'initializing tesseract': 'OCR başlatılıyor', 'loading language traineddata': 'Türkçe dil verisi yükleniyor', 'initializing api': 'Belge hazırlığı', 'recognizing text': 'Metin okunuyor' })[status] || status || 'Metin okunuyor'; }


function possibilityOptions(selected = 'unknown') {
  const options = [['unknown','Doğrulanamadı'],['allowed','Yapılabilir'],['conditional','Belirli şartlarla'],['prohibited','Uygun değil'],['required','Gerekli']];
  return options.map(([value,label]) => `<option value="${value}" ${selected === value ? 'selected' : ''}>${label}</option>`).join('');
}

function getSavedEvidence() {
  if (!state.parcelFeature) return null;
  return readObjectStore(STORE_KEYS.evidence)[parcelKey(state.parcelFeature)] || null;
}
function saveEvidence(data) {
  const all = readObjectStore(STORE_KEYS.evidence); all[parcelKey(state.parcelFeature)] = data; writeObjectStore(STORE_KEYS.evidence, all); scheduleUserSync();
}
function deleteEvidence() {
  const all = readObjectStore(STORE_KEYS.evidence); delete all[parcelKey(state.parcelFeature)]; writeObjectStore(STORE_KEYS.evidence, all); scheduleUserSync();
}

function openRequestForm() {
  if (!state.parcelFeature) return;
  const p = state.parcelFeature.properties || {};
  const userEmail = state.user?.email || '';
  const profile = readObjectStore(STORE_KEYS.profile);
  openDrawer('Analiz Talebi Gönder', `
    <form class="drawer-form" id="requestForm">
      <div class="drawer-help">Talep; parselin plan, plan notu ve imar koşullarının incelenmesi için kaydedilir. E-posta servisi yapılandırılmışsa analiz ekibine de iletilir.</div>
      <div class="account-card"><strong>${escapeHtml([p.province,p.district,p.neighbourhood].filter(Boolean).join(' / '))}</strong><span>${escapeHtml(p.block || '—')} ada ${escapeHtml(p.parcel || '—')} parsel · ${escapeHtml(formatArea(p.area,p.areaText))}</span></div>
      <div class="field"><label>Adınız</label><input name="name" value="${escapeHtml(profile.fullName || state.user?.user_metadata?.full_name || '')}"></div>
      <div class="field"><label>E-posta</label><input name="email" type="email" required value="${escapeHtml(userEmail)}"></div>
      <div class="field"><label>Telefon (isteğe bağlı)</label><input name="phone" type="tel"></div>
      <div class="field"><label>Notunuz</label><textarea name="note" placeholder="Özellikle incelenmesini istediğiniz konu..."></textarea></div>
      <button class="button button-primary" type="submit">Talebi Kaydet ve Gönder</button>
    </form>`);
  const form = $('#requestForm', elements.drawerContent);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = $('button[type="submit"]', form); button.disabled = true; button.textContent = 'Gönderiliyor…';
    const data = new FormData(form);
    try {
      const result = await apiPost('/api/request-analysis', {
        name: data.get('name'), email: data.get('email'), phone: data.get('phone'), note: data.get('note'),
        parcel: { ...p }, missing: state.analysis?.zoning?.missing || [], sourcePage: location.href
      }, { authenticated: true });
      const item = {
        id: result.id, title: `${p.block || '—'} ada ${p.parcel || '—'} parsel`,
        subtitle: `${[p.province,p.district,p.neighbourhood].filter(Boolean).join(' / ')} · ${result.status}`,
        status: result.status, createdAt: result.createdAt, query: state.lastQuery || parcelQueryFromFeature(state.parcelFeature)
      };
      upsertCollection(STORE_KEYS.requests, item, 80);
      scheduleUserSync();
      closeDrawer();
      showToast(result.emailSent ? 'Analiz talebi kaydedildi ve ekibe e-posta gönderildi.' : 'Analiz talebi kaydedildi. E-posta servisi henüz yapılandırılmamış olabilir.');
    } catch (error) {
      button.disabled = false; button.textContent = 'Talebi Kaydet ve Gönder'; showToast(readableError(error));
    }
  });
}

function openProfilePanel(panel) {
  if (panel === 'logout') return logoutIdentity();
  if (panel === 'works') return openSavedList('Çalışmalarım', readArrayStore(STORE_KEYS.works), 'works');
  if (panel === 'favorites') return openSavedList('Favorilerim', readArrayStore(STORE_KEYS.favorites), 'favorites');
  if (panel === 'requests') return openSavedList('Taleplerim', readArrayStore(STORE_KEYS.requests), 'requests');
  if (panel === 'auth') return state.user ? openAccountPanel() : openAuthPanel();
  if (panel === 'account') return state.user ? openAccountPanel() : openAuthPanel();
}

function openSavedList(title, items, kind) {
  const html = items.length ? `<div class="drawer-list">${items.map((item, index) => `
    <article class="drawer-item"><strong>${escapeHtml(item.title || 'Kayıt')}</strong><span>${escapeHtml(item.subtitle || item.createdAt || '')}</span>
    <div class="drawer-item-meta">${item.status ? `<span class="drawer-chip">${escapeHtml(item.status)}</span>` : ''}${item.snapshot?.analysisStatus ? `<span class="drawer-chip">${escapeHtml(item.snapshot.analysisStatus)}</span>` : ''}</div>
    <div class="drawer-list-actions">${item.query?.neighbourhoodId && item.query?.block && item.query?.parcel ? `<button data-open-index="${index}">Parseli Aç</button>` : ''}<button data-delete-index="${index}">Sil</button></div></article>`).join('')}</div>` : '<div class="drawer-empty">Henüz kayıt bulunmuyor.</div>';
  openDrawer(title, (state.accountSyncEnabled ? '' : '<div class="auth-status local-storage-notice"><strong>Bu cihazda saklanıyor.</strong><br>Bu kayıtlar başka cihazlara otomatik aktarılmaz.</div>') + html);
  $('[data-open-index]', elements.drawerContent).forEach((button) => button.addEventListener('click', async () => {
    const item = items[Number(button.dataset.openIndex)]; closeDrawer(); await reopenSavedItem(item);
  }));
  $$('[data-delete-index]', elements.drawerContent).forEach((button) => button.addEventListener('click', () => {
    const index = Number(button.dataset.deleteIndex); const next = items.filter((_, itemIndex) => itemIndex !== index);
    writeArrayStore(STORE_KEYS[kind], next); scheduleUserSync(); openSavedList(title, next, kind); showToast('Kayıt silindi.');
  }));
}

async function reopenSavedItem(item) {
  if (!item?.query?.neighbourhoodId) return;
  setMapLoading(true);
  try {
    const feature = await apiTkgm('parcel', { neighbourhoodId: item.query.neighbourhoodId, block: item.query.block, parcel: item.query.parcel });
    state.lastQuery = item.query;
    await renderParcelAndAnalyze(feature, { scroll: true });
  } catch (error) { showToast(readableError(error)); }
  finally { setMapLoading(false); }
}

function saveWork() {
  if (!state.parcelFeature) return;
  const p = state.parcelFeature.properties || {};
  const item = {
    id: parcelKey(state.parcelFeature),
    title: `${p.province || ''} ${p.district || ''} · ${p.block || '—'}/${p.parcel || '—'}`.trim(),
    subtitle: `${p.neighbourhood || ''} · ${formatArea(p.area,p.areaText)}`,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), status: state.analysis?.status || 'Kadastro sonucu',
    query: state.lastQuery || parcelQueryFromFeature(state.parcelFeature),
    snapshot: { area: Number(p.area) || null, quality: p.quality, mapSheet: p.mapSheet, analysisStatus: state.analysis?.status, explanation: state.analysis?.explanation, metrics: state.analysis?.metrics || {} },
    sources: (state.analysis?.sources || []).map((source) => ({ id: source.id, title: source.title, url: source.url }))
  };
  upsertCollection(STORE_KEYS.works, item, 60); scheduleUserSync();
}

function toggleFavorite() {
  if (!state.parcelFeature) return;
  const key = parcelKey(state.parcelFeature);
  const items = readArrayStore(STORE_KEYS.favorites);
  const exists = items.some((item) => item.id === key);
  if (exists) writeArrayStore(STORE_KEYS.favorites, items.filter((item) => item.id !== key));
  else {
    const p = state.parcelFeature.properties || {};
    const item = {
      id: key, title: `${p.province || ''} ${p.district || ''} · ${p.block || '—'}/${p.parcel || '—'}`.trim(),
      subtitle: `${p.neighbourhood || ''} · ${formatArea(p.area,p.areaText)}`, createdAt: new Date().toISOString(),
      status: state.analysis?.status || 'Kadastro sonucu', query: state.lastQuery || parcelQueryFromFeature(state.parcelFeature),
      snapshot: { area: Number(p.area) || null, quality: p.quality, analysisStatus: state.analysis?.status, explanation: state.analysis?.explanation, metrics: state.analysis?.metrics || {} },
      sources: (state.analysis?.sources || []).map((source) => ({ id: source.id, title: source.title, url: source.url }))
    };
    writeArrayStore(STORE_KEYS.favorites, [item, ...items].slice(0, 80));
  }
  syncFavoriteButton(); scheduleUserSync(); showToast(exists ? 'Favorilerden çıkarıldı.' : 'Favorilere eklendi.');
}

function syncFavoriteButton() {
  if (!state.parcelFeature) return;
  const exists = readArrayStore(STORE_KEYS.favorites).some((item) => item.id === parcelKey(state.parcelFeature));
  elements.favoriteButton.classList.toggle('is-active', exists);
  elements.favoriteButton.textContent = exists ? '★ Favorilere Eklendi' : '☆ Favorilere Ekle';
}

async function initializeIdentity() {
  state.identityEnabled = false;
  state.accountSyncEnabled = false;
  try {
    const syncProbe = await fetch('/api/user-data', { headers: { Accept: 'application/json' } });
    const syncPayload = await safeJson(syncProbe);
    state.accountSyncEnabled = !(syncProbe.status === 401 && syncPayload?.code === 'ACCOUNT_SYNC_DISABLED');
  } catch { state.accountSyncEnabled = false; }
  if (state.accountSyncEnabled) {
    try {
      const settings = await fetch('/.netlify/identity/settings', { headers: { Accept: 'application/json' } });
      const contentType = String(settings.headers.get('content-type') || '').toLowerCase();
      const payload = contentType.includes('application/json') ? await safeJson(settings) : null;
      state.identityEnabled = Boolean(settings.ok && payload && typeof payload === 'object');
    } catch { state.identityEnabled = false; }
  }
  const session = readSession();
  if (state.identityEnabled && session?.access_token) {
    state.session = session;
    try { state.user = await getIdentityUser(); await pullUserData(); }
    catch { clearSession(); state.user = null; }
  } else if (!state.identityEnabled) {
    clearSession(); state.session = null; state.user = null;
  }
  updateProfileUi();
}

function openAuthPanel(active = 'login') {
  openDrawer('Giriş Yap / Kayıt Ol', `
    <div class="auth-tabs"><button class="auth-tab ${active === 'login' ? 'is-active' : ''}" data-auth-tab="login">Giriş Yap</button><button class="auth-tab ${active === 'signup' ? 'is-active' : ''}" data-auth-tab="signup">Kayıt Ol</button></div>
    <div id="authFormArea"></div>`);
  $$('[data-auth-tab]', elements.drawerContent).forEach((button) => button.addEventListener('click', () => renderAuthForm(button.dataset.authTab)));
  renderAuthForm(active);
}

function renderAuthForm(mode) {
  $$('.auth-tab', elements.drawerContent).forEach((button) => button.classList.toggle('is-active', button.dataset.authTab === mode));
  const area = $('#authFormArea', elements.drawerContent);
  if (!state.identityEnabled) {
    area.innerHTML = '<div class="auth-status"><strong>Kayıtlar yalnız bu cihazda saklanıyor.</strong><br>Çalışmalarım, Favorilerim ve Taleplerim bu tarayıcıda kullanılabilir; başka cihazlara otomatik aktarılmaz.</div>';
    return;
  }
  if (mode === 'signup') {
    area.innerHTML = `<form class="drawer-form" id="signupForm"><div class="field"><label>Ad / Nick</label><input name="name" required></div><div class="field"><label>E-posta</label><input name="email" type="email" required></div><div class="field"><label>Şifre</label><input name="password" type="password" minlength="8" required></div><button class="button button-primary" type="submit">Kayıt Ol</button><p class="auth-note">E-posta doğrulaması açıksa gelen bağlantıyla hesabınızı doğrulamanız gerekir.</p></form>`;
    $('#signupForm', area).addEventListener('submit', handleSignup);
  } else {
    area.innerHTML = `<form class="drawer-form" id="loginForm"><div class="field"><label>E-posta</label><input name="email" type="email" required></div><div class="field"><label>Şifre</label><input name="password" type="password" required></div><button class="button button-primary" type="submit">Giriş Yap</button><button class="button button-secondary" id="recoverButton" type="button">Şifremi Unuttum</button></form>`;
    $('#loginForm', area).addEventListener('submit', handleLogin);
    $('#recoverButton', area).addEventListener('click', handleRecover);
  }
}

async function handleSignup(event) {
  event.preventDefault(); const form = event.currentTarget; const data = new FormData(form); const button = $('button[type="submit"]', form); button.disabled = true;
  try {
    const response = await fetch('/.netlify/identity/signup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: data.get('email'), password: data.get('password'), data: { full_name: data.get('name'), nick: data.get('name') } }) });
    const payload = await safeJson(response);
    if (!response.ok) throw new Error(payload?.msg || payload?.message || 'Kayıt oluşturulamadı.');
    showToast('Kayıt oluşturuldu. E-posta doğrulaması gerekiyorsa gelen bağlantıyı açın.'); renderAuthForm('login');
  } catch (error) { showToast(readableError(error)); button.disabled = false; }
}

async function handleLogin(event) {
  event.preventDefault(); const form = event.currentTarget; const data = new FormData(form); const button = $('button[type="submit"]', form); button.disabled = true;
  try {
    const session = await identityToken({ grant_type: 'password', username: data.get('email'), password: data.get('password') });
    state.session = session; writeSession(session); state.user = session.user || await getIdentityUser();
    await pullUserData(); updateProfileUi(); closeDrawer(); showToast('Giriş başarılı. Çalışmalarınız hesabınızla eşitlendi.');
  } catch (error) { showToast(readableError(error)); button.disabled = false; }
}

async function handleRecover() {
  const emailValue = $('#loginForm input[name="email"]', elements.drawerContent)?.value?.trim();
  if (!emailValue) { showToast('Önce e-posta adresinizi yazın.'); return; }
  try {
    const response = await fetch('/.netlify/identity/recover', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: emailValue }) });
    if (!response.ok) throw new Error('Şifre yenileme e-postası gönderilemedi.');
    showToast('Şifre yenileme bağlantısı e-posta adresinize gönderildi.');
  } catch (error) { showToast(readableError(error)); }
}

function openAccountPanel() {
  const profile = readObjectStore(STORE_KEYS.profile);
  const nick = profile.nick || state.user?.user_metadata?.nick || state.user?.user_metadata?.full_name || '';
  const fullName = profile.fullName || state.user?.user_metadata?.full_name || '';
  openDrawer('Hesabım', `
    <div class="account-card"><strong>${escapeHtml(nick || fullName || 'Planlamasyon Kullanıcısı')}</strong><span>${escapeHtml(state.user?.email || '')}</span></div>
    <form class="drawer-form" id="accountForm"><div class="field"><label>Nick</label><input name="nick" value="${escapeHtml(nick)}"></div><div class="field"><label>Ad Soyad</label><input name="fullName" value="${escapeHtml(fullName)}"></div><button class="button button-primary" type="submit">Hesap Bilgilerini Kaydet</button></form>
    <form class="drawer-form" id="passwordForm"><h4>Şifre değiştir</h4><div class="field"><label>Yeni şifre</label><input name="password" type="password" minlength="8" required></div><button class="button button-secondary" type="submit">Şifreyi Değiştir</button></form>`);
  $('#accountForm', elements.drawerContent).addEventListener('submit', async (event) => {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    try {
      const payload = await identityUserUpdate({ data: { nick: data.get('nick'), full_name: data.get('fullName') } });
      state.user = payload; writeObjectStore(STORE_KEYS.profile, { nick: String(data.get('nick') || ''), fullName: String(data.get('fullName') || '') });
      updateProfileUi(); scheduleUserSync(); showToast('Hesap bilgileri güncellendi.');
    } catch (error) { showToast(readableError(error)); }
  });
  $('#passwordForm', elements.drawerContent).addEventListener('submit', async (event) => {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    try { await identityUserUpdate({ password: data.get('password') }); event.currentTarget.reset(); showToast('Şifre güncellendi.'); }
    catch (error) { showToast(readableError(error)); }
  });
}

async function logoutIdentity() {
  clearSession(); state.session = null; state.user = null; updateProfileUi(); closeProfileMenu(); showToast('Çıkış yapıldı. Bu cihazdaki misafir kayıtları korunur.');
}

function updateProfileUi() {
  const profile = readObjectStore(STORE_KEYS.profile);
  const name = profile.nick || state.user?.user_metadata?.nick || state.user?.user_metadata?.full_name || '';
  const emailValue = state.user?.email || '';
  const logged = Boolean(state.user);
  elements.profileIdentity.hidden = !logged;
  elements.profileIdentity.textContent = name || emailValue;
  elements.profileInitials.hidden = !logged;
  elements.profileSvg.hidden = logged;
  elements.profileInitials.textContent = initials(name || emailValue);
  elements.profileMenuUser.hidden = !logged;
  elements.profileMenuName.textContent = name || 'Planlamasyon Kullanıcısı';
  elements.profileMenuEmail.textContent = emailValue;
  elements.profileAuthButton.textContent = logged ? 'Profilim' : state.identityEnabled ? 'Giriş Yap / Kayıt Ol' : 'Kayıtlar bu cihazda';
  elements.profileLogoutButton.hidden = !logged;
}

async function getIdentityUser() {
  let response = await fetch('/.netlify/identity/user', { headers: authHeaders() });
  if (response.status === 401 && state.session?.refresh_token) {
    state.session = await identityToken({ grant_type: 'refresh_token', refresh_token: state.session.refresh_token }); writeSession(state.session);
    response = await fetch('/.netlify/identity/user', { headers: authHeaders() });
  }
  const payload = await safeJson(response);
  if (!response.ok) throw new Error(payload?.msg || 'Oturum doğrulanamadı.');
  return payload;
}

async function identityToken(values) {
  const response = await fetch('/.netlify/identity/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(values) });
  const payload = await safeJson(response);
  if (!response.ok) throw new Error(payload?.error_description || payload?.msg || 'Giriş yapılamadı.');
  return payload;
}

async function identityUserUpdate(body) {
  const response = await fetch('/.netlify/identity/user', { method: 'PUT', headers: { ...authHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const payload = await safeJson(response);
  if (!response.ok) throw new Error(payload?.msg || 'Hesap güncellenemedi.');
  return payload;
}

function authHeaders() { return state.session?.access_token ? { Authorization: `Bearer ${state.session.access_token}`, Accept: 'application/json' } : { Accept: 'application/json' }; }
function writeSession(session) { try { localStorage.setItem(STORE_KEYS.session, JSON.stringify(session)); } catch {} }
function readSession() { try { return JSON.parse(localStorage.getItem(STORE_KEYS.session) || 'null'); } catch { return null; } }
function clearSession() { try { localStorage.removeItem(STORE_KEYS.session); } catch {} }

async function pullUserData() {
  if (!state.user || !state.session?.access_token) return;
  try {
    const response = await fetch('/api/user-data', { headers: authHeaders() });
    const payload = await safeJson(response);
    if (!response.ok || !payload?.ok) throw new Error(payload?.message || 'Hesap verisi alınamadı.');
    const remote = payload.data || {};
    writeArrayStore(STORE_KEYS.works, mergeCollections(readArrayStore(STORE_KEYS.works), remote.works || []));
    writeArrayStore(STORE_KEYS.favorites, mergeCollections(readArrayStore(STORE_KEYS.favorites), remote.favorites || []));
    writeArrayStore(STORE_KEYS.requests, mergeCollections(readArrayStore(STORE_KEYS.requests), remote.requests || []));
    writeObjectStore(STORE_KEYS.evidence, { ...(remote.evidence || {}), ...readObjectStore(STORE_KEYS.evidence) });
    writeObjectStore(STORE_KEYS.profile, { ...(remote.profile || {}), ...readObjectStore(STORE_KEYS.profile) });
    await pushUserData(); updateProfileUi();
  } catch (error) { console.warn('Kullanıcı verisi eşitlenemedi:', error); }
}

function scheduleUserSync() {
  if (!state.user || !state.session?.access_token) return;
  clearTimeout(state.syncTimer); state.syncTimer = setTimeout(() => void pushUserData(), 900);
}

async function pushUserData() {
  if (!state.user || !state.session?.access_token || state.syncInProgress) return;
  state.syncInProgress = true;
  try {
    const response = await fetch('/api/user-data', {
      method: 'PUT', headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ profile: readObjectStore(STORE_KEYS.profile), works: readArrayStore(STORE_KEYS.works), favorites: readArrayStore(STORE_KEYS.favorites), requests: readArrayStore(STORE_KEYS.requests), evidence: readObjectStore(STORE_KEYS.evidence) })
    });
    if (!response.ok) throw new Error('Hesap verisi kaydedilemedi.');
  } catch (error) { console.warn(error); }
  finally { state.syncInProgress = false; }
}

function setupFooter() {
  $$('[data-footer-panel]').forEach((button) => button.addEventListener('click', () => {
    const content = {
      about: ['Hakkımızda', 'Planlamasyon; parsel, plan, mevzuat ve çevre verilerini teknik olmayan kullanıcıların anlayacağı şekilde bir araya getirmeyi amaçlayan bir bilgilendirme platformudur.'],
      contact: ['İletişim', 'İletişim bilgileri sunucu ayarları veya işletme bilgileriyle yayın öncesinde güncellenmelidir. Analiz talepleri Taleplerim bölümünden gönderilebilir.'],
      privacy: ['Gizlilik', 'Bu yayında çalışmalar, favoriler ve talepler yalnız bu cihazın tarayıcı hafızasında tutulur; başka cihazlara otomatik aktarılmaz. Şifre saklama ve hesap eşitleme sistemi etkin değildir.'],
      terms: ['Kullanım Koşulları', 'Planlamasyon sonuçları bilgi amaçlıdır. Kesin imar, sınır, aplikasyon, proje ve ruhsat işlemlerinde yetkili kurumların güncel yazılı kayıtları esastır. Bağlantı bulunması otomatik veri kullanım izni anlamına gelmez; ticari kadastro kullanımı için TAKPAS ve ilgili kurum yetkileri gerekir.']
    }[button.dataset.footerPanel];
    openDrawer(content[0], `<div class="footer-copy"><h4>${escapeHtml(content[0])}</h4><p>${escapeHtml(content[1])}</p></div>`);
  }));
}

function parcelPopup(feature) {
  const p = feature?.properties || {};
  return `<strong>${escapeHtml(p.block || '—')} ada / ${escapeHtml(p.parcel || '—')} parsel</strong><br>${escapeHtml([p.province,p.district,p.neighbourhood].filter(Boolean).join(' / '))}<br>${escapeHtml(formatArea(p.area,p.areaText))}`;
}

function fitLayer(layer, maxZoom) {
  if (!state.map || !layer) return;
  const bounds = layer.getBounds?.();
  if (bounds?.isValid?.()) state.map.fitBounds(bounds, { padding: [28, 28], maxZoom, animate: true, duration: .55 });
}

function clearMapLayers({ parcel = false, boundary = false } = {}) {
  if (!state.map) return;
  if (parcel) {
    if (state.parcelLayer) state.map.removeLayer(state.parcelLayer);
    if (state.parcelMarker) state.map.removeLayer(state.parcelMarker);
    state.parcelLayer = null; state.parcelMarker = null;
  }
  if (boundary) {
    if (state.boundaryLayer) state.map.removeLayer(state.boundaryLayer);
    state.boundaryLayer = null;
  }
}

function resetMapToTurkey() {
  clearMapLayers({ parcel: true, boundary: true });
  state.map?.setView([39.05, 35.2], 6, { animate: true });
  updateMapCaption('Türkiye');
}

function clearResult() {
  if (state.analysisAbort) state.analysisAbort.abort();
  state.parcelFeature = null; state.analysis = null;
  elements.resultSection.hidden = true;
  clearMapLayers({ parcel: true });
}

function setSubmitLoading(loading) {
  elements.submit.disabled = loading || !(elements.neighbourhood.value && elements.block.value.trim() && elements.parcel.value.trim());
  $('.button-text', elements.submit).textContent = loading ? 'Parsel sorgulanıyor…' : 'Parseli Sorgula ve Analiz Et';
  $('.button-spinner', elements.submit).hidden = !loading;
}
function setMapLoading(loading) { elements.mapLoading.hidden = !loading; }
function disableParcelInputs() { elements.block.disabled = true; elements.parcel.disabled = true; elements.submit.disabled = true; elements.block.value = ''; elements.parcel.value = ''; }

function setConnection(type, title, description) {
  const dot = $('.status-dot', elements.connectionBanner);
  dot.className = `status-dot is-${type}`;
  $('strong', elements.connectionBanner).textContent = title;
  $('span:last-child', elements.connectionBanner).textContent = description;
}

function populateSelect(select, items, placeholder) { select.innerHTML = `<option value="">${escapeHtml(placeholder)}</option>${items.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}</option>`).join('')}`; }
function setSelectLoading(select, text) { select.disabled = true; select.innerHTML = `<option value="">${escapeHtml(text)}</option>`; }
function resetSelect(select, text) { select.disabled = true; select.innerHTML = `<option value="">${escapeHtml(text)}</option>`; }
function selectedItem(select, items) { return items.find((item) => String(item.id) === String(select.value)) || null; }
function selectedName(select) { return select.selectedOptions?.[0]?.textContent?.trim() || ''; }
function updateMapCaption(text) { $('span:last-child', elements.mapCaption).textContent = text || 'Türkiye'; }

async function apiTkgm(action, params = {}) {
  const url = new URL('/api/tkgm', location.origin);
  url.searchParams.set('action', action);
  for (const [key, value] of Object.entries(params)) if (value != null && value !== '') url.searchParams.set(key, value);
  let lastError = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(url, { headers: { Accept: 'application/json' }, cache: 'no-store' });
      const payload = await safeJson(response);
      if (response.ok && payload?.ok) return payload.data;
      const error = new Error(payload?.message || `İşlem ${response.status} koduyla başarısız oldu.`);
      error.code = payload?.code; error.status = response.status; error.diagnostics = payload?.diagnostics || null;
      lastError = error;
      if (!isRetryableTkgmError(error) || attempt === 2) throw error;
    } catch (error) {
      lastError = error;
      if (!isRetryableTkgmError(error) || attempt === 2) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 450 * (attempt + 1)));
  }
  throw lastError || new Error('TKGM isteği tamamlanamadı.');
}

function isRetryableTkgmError(error) {
  if (!error) return true;
  if (['TKGM_AUTH_OR_ACCESS_REQUIRED','TKGM_ACCESS_RESTRICTED','PARCEL_NOT_FOUND','INVALID_QUERY'].includes(error.code)) return false;
  return !error.status || [429, 500, 502, 503, 504].includes(Number(error.status));
}

async function apiPost(path, body, options = {}) {
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
  if (options.authenticated && state.session?.access_token) headers.Authorization = `Bearer ${state.session.access_token}`;
  const controller = new AbortController();
  let timedOut = false;
  let timer = null;
  const externalAbort = () => controller.abort();
  if (options.signal) {
    if (options.signal.aborted) controller.abort();
    else options.signal.addEventListener('abort', externalAbort, { once: true });
  }
  if (Number(options.timeoutMs) > 0) {
    timer = setTimeout(() => { timedOut = true; controller.abort(); }, Number(options.timeoutMs));
  }
  try {
    const response = await fetch(path, { method: 'POST', headers, body: JSON.stringify(body), signal: controller.signal });
    const payload = await safeJson(response);
    if (!response.ok || !payload?.ok) {
      const error = new Error(payload?.message || `İşlem ${response.status} koduyla başarısız oldu.`); error.code = payload?.code; error.status = response.status; throw error;
    }
    return payload.data;
  } catch (error) {
    if (timedOut) {
      const timeoutError = new Error('Analiz bekleme süresini aştı. Parsel kaydı korunur; yanıt vermeyen kaynaklar daha sonra yeniden denenebilir.');
      timeoutError.code = 'CLIENT_TIMEOUT';
      throw timeoutError;
    }
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
    if (options.signal) options.signal.removeEventListener?.('abort', externalAbort);
  }
}

async function safeJson(response) { try { return await response.json(); } catch { return null; } }

function formatArea(area, areaText) {
  if (Number.isFinite(Number(area))) return `${new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 2 }).format(Number(area))} m²`;
  if (areaText) return `${areaText} m²`;
  return 'Doğrulanamadı';
}
function formatNumber(value) { if (value == null || String(value).trim() === '') return null; const number = Number(value); return Number.isFinite(number) ? new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 2 }).format(number) : null; }
function parcelLocation(feature) { const p = feature?.properties || {}; return `${[p.province,p.district,p.neighbourhood].filter(Boolean).join(' / ')} · ${p.block || '—'}/${p.parcel || '—'}`; }
function parcelQueryFromFeature(feature) { const p = feature?.properties || {}; return { province:p.province,district:p.district,neighbourhood:p.neighbourhood,neighbourhoodId:p.neighbourhoodId,block:p.block,parcel:p.parcel }; }
function parcelKey(feature) { const p = feature?.properties || {}; return [p.neighbourhoodId || p.neighbourhood, p.block, p.parcel].filter(Boolean).join(':'); }
function parseBoolean(value) { if (value === 'true' || value === true) return true; if (value === 'false' || value === false) return false; return null; }

function readableError(error) {
  if (error?.code === 'TKGM_AUTH_OR_ACCESS_REQUIRED') return 'TKGM açık servisleri bu ada/parsel sorgusuna erişim vermedi; diğer açık TKGM yolları da denendi.';
  if (error?.code === 'TKGM_ACCESS_RESTRICTED') return 'Tanımlanan TKGM erişimi bu sorgu için kabul edilmedi.';
  if (error?.code === 'TKGM_DIRECTORY_UNAVAILABLE') return 'TKGM il/ilçe/mahalle servisine şu anda ulaşılamadı. Açık yedek bağlantılar da denendi.';
  if (error?.code === 'TKGM_NETWORK_ERROR') return 'TKGM bağlantısı geçici olarak kurulamadı. Sistem otomatik olarak yeniden denedi.';
  if (error?.code === 'TKGM_TIMEOUT') return 'TKGM yanıt vermekte gecikti. Sistem otomatik olarak yeniden denedi.';
  if (error?.code === 'PARCEL_NOT_FOUND') return 'Parsel bulunamadı. Mahalle/köy, ada ve parsel bilgilerini kontrol edin.';
  if (error?.code === 'AUTH_REQUIRED') return 'Bu işlem için giriş yapmanız gerekiyor.';
  if (error?.code === 'CLIENT_TIMEOUT') return 'Analiz süre sınırına ulaştı. Parsel sonucu korunur; yanıt vermeyen imar/çevre kaynağı daha sonra yeniden denenebilir.';
  if (error?.message === 'STATIC_FILE_MODE') return 'Dosyayı doğrudan açmak yerine sunucu üzerinden çalıştırın.';
  return String(error?.message || 'İşlem tamamlanamadı.');
}

function buildCadastralExplanation(feature) {
  const p = feature?.properties || {}; const area = formatArea(p.area,p.areaText);
  return `${p.block || '—'} ada ${p.parcel || '—'} parsel bulundu${area !== 'Doğrulanamadı' ? ` ve alanı ${area} olarak gösteriliyor` : ''}.`;
}
function cadastralTechnicalRows() {
  const p = state.parcelFeature?.properties || {};
  return [['İl',p.province],['İlçe',p.district],['Mahalle / Köy',p.neighbourhood],['Ada',p.block],['Parsel',p.parcel],['Parsel alanı',formatArea(p.area,p.areaText)],['Nitelik',p.quality],['Pafta',p.mapSheet]].map(([label,value])=>({label,value,source:'TKGM'}));
}
function defaultRoadmap() { return [{step:1,title:'İmar durumunu doğrula',description:'Yürürlükteki plan ve belediye imar durumunu kontrol edin.'},{step:2,title:'Belgeleri hazırla',description:'Parselinize özel teknik ve kurum belgelerini tamamlayın.'},{step:3,title:'Mimari projeyi hazırlat',description:'Yetkili mimarla yapılaşma koşullarına uygun proje hazırlayın.'},{step:4,title:'Kurum onaylarını al',description:'Gerekli kurum görüşlerini ve proje onaylarını tamamlayın.'},{step:5,title:'Ruhsata başvur',description:'Onaylı projelerle yetkili idareye yapı ruhsatı başvurusu yapın.'}]; }
function defaultOfficialActions() { return [{id:'eplan-national',title:'e-Plan İmar Durumu',provider:'Çevre, Şehircilik ve İklim Değişikliği Bakanlığı',url:'https://eplan.csb.gov.tr/e-plan/html/imarDurumu.html',kind:'national-portal',status:'official-portal',accessMode:'public-portal',note:'Türkiye geneli resmî imar durumu portalı.'},{id:'tucbs-national',title:'TUCBS Coğrafi Açık Veri',provider:'Ulusal Coğrafi Bilgi Platformu',url:'https://ucbp.tucbs.gov.tr/cografi-acik-veri-platformu',kind:'national-geodata',status:'official-portal',accessMode:'public-portal',note:'Kamuya açık coğrafi katmanlar.'}]; }
function defaultSources() { return [{id:'tkgm-parcel',title:'TKGM Parsel Sorgu / MEGSİS',kind:'cadastre',trust:'public-information',url:'https://parselsorgu.tkgm.gov.tr/',note:'Parsel konumu ve temel kadastro bilgileri bilgi amaçlıdır.'},{id:'eplan-official',title:'e-Plan',kind:'official-portal',trust:'lookup-required',url:'https://eplan.csb.gov.tr/e-plan/html/imarDurumu.html',note:'Yürürlükteki plan, plan notu ve imar durumu için resmî portal.'}]; }

function readArrayStore(key) { try { const value = JSON.parse(localStorage.getItem(key) || '[]'); return Array.isArray(value) ? value : []; } catch { return []; } }
function writeArrayStore(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} }
function readObjectStore(key) { try { const value = JSON.parse(localStorage.getItem(key) || '{}'); return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; } catch { return {}; } }
function writeObjectStore(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} }
function upsertCollection(key, item, max) { const items = readArrayStore(key); writeArrayStore(key, [item, ...items.filter((entry) => entry.id !== item.id)].slice(0,max)); }
function mergeCollections(local, remote) { const map = new Map(); for (const item of [...remote,...local]) if (item?.id && !map.has(item.id)) map.set(item.id,item); return [...map.values()].sort((a,b)=>String(b.updatedAt||b.createdAt||'').localeCompare(String(a.updatedAt||a.createdAt||''))); }
function initials(value) { const words = String(value || 'P').trim().split(/\s+/).filter(Boolean); return words.slice(0,2).map((word)=>word[0]).join('').toLocaleUpperCase('tr-TR') || 'P'; }
function formatIsoDate(value) {
  if (!value) return null;
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[3]}.${match[2]}.${match[1]}` : String(value);
}

function escapeHtml(value) { return String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;' })[char]); }

function showToast(message) {
  clearTimeout(state.toastTimer); elements.toast.textContent = message; elements.toast.classList.add('show');
  state.toastTimer = setTimeout(() => elements.toast.classList.remove('show'), 4800);
}
