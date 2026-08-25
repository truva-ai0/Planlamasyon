import { readFile, writeFile, readdir, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';

const currentBuildPackage = JSON.parse(await readFile('package.json', 'utf8'));
if (['3.5.0', '3.6.0', '3.7.0', '3.8.0'].includes(currentBuildPackage.version)) {
  console.log(`Planlamasyon v${currentBuildPackage.version} kaynakları güncel; eski yükseltme adımları atlandı.`);
  process.exit(0);
}

async function replaceRequired(file, replacements) {
  let text = await readFile(file, 'utf8');
  for (const [from, to] of replacements) {
    if (!text.includes(from)) throw new Error(`${file}: beklenen bölüm bulunamadı: ${from.slice(0, 90)}`);
    text = text.replace(from, to);
  }
  await writeFile(file, text);
}

async function replaceAllRequired(file, replacements) {
  let text = await readFile(file, 'utf8');
  for (const [from, to] of replacements) {
    if (!text.includes(from)) throw new Error(`${file}: beklenen bölüm bulunamadı: ${from.slice(0, 90)}`);
    text = text.replaceAll(from, to);
  }
  await writeFile(file, text);
}

async function textFiles(directory) {
  const output = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) output.push(...await textFiles(path));
    else if (/\.(?:js|mjs|html|css|json|webmanifest)$/.test(entry.name)) output.push(path);
  }
  return output;
}

const officialRouting = JSON.parse(await readFile('official-source-routing.json', 'utf8'));
const routingPortals = officialRouting.portals;

await replaceRequired('dist/app.js', [
  ['imagery.addTo(map);', 'osm.addTo(map);'],
  [
    'setTimeout(() => map.invalidateSize(), 100);',
    `const refreshMapSize = () => {
    if (!state.map) return;
    state.map.invalidateSize({ pan: false, animate: false });
  };
  [100, 350, 900].forEach((delay) => setTimeout(refreshMapSize, delay));
  window.addEventListener('resize', () => setTimeout(refreshMapSize, 120), { passive: true });
  window.addEventListener('orientationchange', () => setTimeout(refreshMapSize, 240), { passive: true });`
  ],
  [
    'fitLayer(state.parcelLayer, 20);\n    const center = state.parcelLayer.getBounds().getCenter();',
    `fitLayer(state.parcelLayer, 20);
    const parcelBounds = state.parcelLayer.getBounds();
    const refreshParcelMap = () => {
      if (!state.map || !parcelBounds.isValid()) return;
      state.map.invalidateSize({ pan: false, animate: false });
      state.map.fitBounds(parcelBounds, { padding: [28, 28], maxZoom: 20, animate: false });
    };
    requestAnimationFrame(refreshParcelMap);
    setTimeout(refreshParcelMap, 320);
    setTimeout(refreshParcelMap, 900);
    const center = parcelBounds.getCenter();`
  ],
  ['}, { signal: controller.signal, timeoutMs: 25_000 });', '}, { signal: controller.signal, timeoutMs: 65_000 });'],
  ["{ timeoutMs: 15_000 });", "{ timeoutMs: 35_000 });"],
  ['Bu arsaya yaklaşık kaç metrekare inşaat yapılabilir?', 'Bu parselde yaklaşık kaç metrekare inşaat yapılabilir?'],
  ['Bu arsada neler yapılabilir, kısa anlatır mısın?', 'Bu parselde neler yapılabilir, kısa anlatır mısın?'],
  ['Örn. Bu arsaya kaç kat yapılabilir?', 'Örn. Bu parselde kaç kat yapılabilir?']
]);

const v340Css = await readFile('dist/styles.css', 'utf8');
await writeFile('dist/styles.css', `${v340Css}

/* v3.5.0 kadastro/imar ayrımı, mobil karar özeti ve harita yedeği */
.record-badge-row{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap}
.rights-warning-badge{padding:7px 10px;border-radius:999px;border:1px solid rgba(239,182,93,.35);background:rgba(239,182,93,.08);color:var(--amber);font-size:11px;font-weight:800}
.mobile-result-summary{display:none;margin-bottom:14px;padding:18px}
.mobile-result-summary>strong{display:block;font-size:15px;margin-bottom:11px}
.mobile-result-summary dl{display:grid;gap:8px;margin:0}
.mobile-result-summary dl>div{display:grid;grid-template-columns:minmax(105px,.8fr) minmax(0,1.2fr);gap:10px;padding:9px 10px;border:1px solid var(--line);border-radius:13px;background:var(--surface-soft)}
.mobile-result-summary dt{color:var(--muted);font-size:11px}.mobile-result-summary dd{margin:0;font-size:12px;font-weight:750;line-height:1.4}
.map-base-status{position:absolute;left:12px;right:12px;bottom:12px;z-index:650;display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 12px;border:1px solid rgba(239,182,93,.45);border-radius:13px;background:rgba(7,19,34,.94);color:#eef5ff;font-size:12px;box-shadow:0 10px 30px rgba(0,0,0,.28)}
.map-base-status[hidden]{display:none}.map-base-status button{border:0;border-radius:9px;padding:7px 10px;background:var(--blue);color:#fff;font-weight:800;white-space:nowrap;cursor:pointer}
.document-source-confirm{border-color:rgba(77,145,255,.28)!important;background:rgba(77,145,255,.06)!important}
@media(max-width:640px){
  .mobile-result-summary{display:block}
  .result-grid{gap:12px}
  .record-badge-row{align-items:flex-start}
  .cadastral-strip>div span{line-height:1.35}
}
`);

await replaceRequired('dist/app.js', [
  [
    `function renderCadastralBase(feature) {
  const p = feature?.properties || {};
  const location = [p.province, p.district, p.neighbourhood].filter(Boolean).join(' / ') || 'Konum bilgisi yok';
  const areaText = formatArea(p.area, p.areaText);
  elements.parcelAddress.textContent = \`\${location} · \${p.block || '—'} ada \${p.parcel || '—'} parsel\`;
  elements.plainExplanation.textContent = 'Parsel bulundu. Plan, plan notu, yapılaşma koşulları ve yakın çevre kaynakları inceleniyor.';
  elements.metricArea.textContent = areaText;
  elements.metricQuality.textContent = p.quality || 'Belirtilmemiş';
  elements.metricMapSheet.textContent = p.mapSheet || 'Belirtilmemiş';
  elements.metricBlockParcel.textContent = \`\${p.block || '—'} / \${p.parcel || '—'}\`;
  elements.zoningOverviewTitle.textContent = 'Plan verisi kontrol ediliyor';
  elements.zoningOverviewText.textContent = 'Doğrulanmış yapılaşma koşulları aranıyor.';
  elements.zoningMiniList.innerHTML = '<div><dt>Resmî kaynaklar</dt><dd>Kontrol ediliyor…</dd></div>';
}`,
    `function renderCadastralBase(feature) {
  const p = feature?.properties || {};
  const location = [p.province, p.district, p.neighbourhood].filter(Boolean).join(' / ') || 'Konum bilgisi yok';
  const areaText = formatArea(p.area, p.areaText);
  elements.parcelAddress.textContent = \`\${location} · \${p.block || '—'} ada \${p.parcel || '—'} parsel\`;
  elements.plainExplanation.textContent = \`TKGM açık CBS kaydında bu parsel \${areaText} olarak görünüyor. Taşınmaz niteliği imar planı fonksiyonu veya yeni yapı hakkı değildir.\`;
  elements.metricArea.textContent = areaText;
  elements.metricQuality.textContent = p.quality || 'Belirtilmemiş';
  elements.metricMapSheet.textContent = p.mapSheet || 'Belirtilmemiş';
  elements.metricBlockParcel.textContent = \`\${p.block || '—'} / \${p.parcel || '—'}\`;
  elements.zoningOverviewTitle.textContent = 'İmar ve yeni yapı hakkı kontrol ediliyor';
  elements.zoningOverviewText.textContent = 'Kadastro kaydından ayrı olarak güncel resmî plan ve yapılaşma koşulları aranıyor.';
  elements.zoningMiniList.innerHTML = '<div><dt>Resmî imar kaynakları</dt><dd>Kontrol ediliyor…</dd></div>';
  renderDecisionSummary(null);
}`
  ],
  [
    `function renderAnalysis(analysis) {
  elements.plainExplanation.textContent = analysis.explanation || 'Analiz sonucu hazırlanamadı.';
  renderAnalysisStatus(analysis);`,
    `function renderAnalysis(analysis) {
  renderDecisionSummary(analysis);
  renderAnalysisStatus(analysis);`
  ],
  [
    `  elements.plainExplanation.textContent = \`\${buildCadastralExplanation(state.parcelFeature)} İmar ve yakın çevre analizi geçici bir hata nedeniyle tamamlanamadı.\`;`,
    `  elements.plainExplanation.textContent = buildCadastralExplanation(state.parcelFeature);
  renderDecisionSummary({ status: 'cadastral-only', zoningStatus: 'unavailable', zoning: { fields: {} } });`
  ],
  [
    `function renderSummary(metrics) {
  elements.summaryFloors.textContent = metrics.floors?.display || 'Doğrulanamadı';
  elements.summaryFootprint.textContent = metrics.footprint?.display || 'Doğrulanamadı';
  elements.summaryConstruction.textContent = metrics.construction?.display || 'Doğrulanamadı';
  elements.summaryOutside.textContent = metrics.outside?.display || 'Doğrulanamadı';
}

function renderPossibilities(items) {`,
    `function renderSummary(metrics) {
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
  if (elements.mobileSummaryParcel) elements.mobileSummaryParcel.textContent = p.block && p.parcel ? \`Bulundu · \${p.block}/\${p.parcel}\` : 'Parsel bekleniyor';
  if (elements.mobileSummaryCadastre) elements.mobileSummaryCadastre.textContent = p.quality ? \`\${p.quality} · imar hakkı değildir\` : 'Nitelik belirtilmemiş · imar hakkı değildir';
  if (!elements.mobileSummaryZoning) return;
  if (!analysis) {
    elements.mobileSummaryZoning.textContent = 'Güncel resmî kaynaklar kontrol ediliyor';
    return;
  }
  const fields = analysis.zoning?.fields || {};
  const manualOnly = Boolean(analysis.manualOnly || analysis.zoningStatus === 'manual-only' || analysis.zoning?.manualOnly);
  if (hasVerifiedZoning(analysis)) {
    const parts = [fields.landUse, fields.planScale, fields.hmax != null ? \`Yençok \${formatNumber(fields.hmax)} m\` : null].filter(Boolean);
    elements.mobileSummaryZoning.textContent = parts.length ? \`Doğrulanan: \${parts.join(' · ')}\` : 'Kısmi resmî imar değeri doğrulandı';
  } else if (manualOnly) {
    elements.mobileSummaryZoning.textContent = 'Manuel resmî sorgu veya güncel belge gerekli';
  } else {
    elements.mobileSummaryZoning.textContent = 'Doğrulanmadı · yapı hakkı hesabı üretilmedi';
  }
}

function renderPossibilities(items) {`
  ]
]);

await replaceRequired('dist/app.js', [
  [
    `function setupMap() {
  if (!globalThis.L) {
    elements.mapUnavailable.hidden = false;
    return;
  }
  const map = L.map('parcelMap', { zoomControl: true, attributionControl: true, preferCanvas: true }).setView([39.05, 35.2], 6);
  const imagery = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 20,
    attribution: 'Tiles © Esri, Maxar, Earthstar Geographics'
  });
  const osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 20,
    attribution: '© OpenStreetMap katkıda bulunanlar'
  });
  osm.addTo(map);
  L.control.layers({ Uydu: imagery, Harita: osm }, {}, { position: 'bottomright', collapsed: true }).addTo(map);
  state.map = map;
  map.on('click', onMapClick);
  const refreshMapSize = () => {
    if (!state.map) return;
    state.map.invalidateSize({ pan: false, animate: false });
  };
  [100, 350, 900].forEach((delay) => setTimeout(refreshMapSize, delay));
  window.addEventListener('resize', () => setTimeout(refreshMapSize, 120), { passive: true });
  window.addEventListener('orientationchange', () => setTimeout(refreshMapSize, 240), { passive: true });
}`,
    `function setupMap() {
  if (!globalThis.L) {
    elements.mapUnavailable.hidden = false;
    return;
  }
  const map = L.map('parcelMap', { zoomControl: true, attributionControl: true, preferCanvas: true }).setView([39.05, 35.2], 6);
  const imagery = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 20,
    attribution: 'Tiles © Esri, Maxar, Earthstar Geographics'
  });
  const osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 20,
    attribution: '© OpenStreetMap katkıda bulunanlar'
  });
  let osmErrors = 0;
  let imageryErrors = 0;
  let automaticSwitch = false;
  let fallbackTimer = null;
  const hideMapBaseStatus = () => { if (elements.mapBaseStatus) elements.mapBaseStatus.hidden = true; };
  const showMapBaseStatus = () => { if (elements.mapBaseStatus) elements.mapBaseStatus.hidden = false; };
  const markBaseLoaded = (layer) => {
    if (state.mapBaseLayer !== layer) return;
    state.mapBaseLoaded = true;
    clearTimeout(fallbackTimer);
    hideMapBaseStatus();
  };
  const switchToImageryFallback = () => {
    if (state.mapBaseFallbackActivated || state.mapBaseUserSelected || state.mapBaseLoaded) return;
    state.mapBaseFallbackActivated = true;
    automaticSwitch = true;
    if (map.hasLayer(osm)) map.removeLayer(osm);
    imagery.addTo(map);
    state.mapBaseLayer = imagery;
    state.mapBaseLoaded = false;
    setTimeout(() => { automaticSwitch = false; }, 0);
  };
  osm.on('load', () => markBaseLoaded(osm));
  osm.on('tileerror', () => {
    osmErrors += 1;
    if (osmErrors >= 4) switchToImageryFallback();
  });
  imagery.on('load', () => markBaseLoaded(imagery));
  imagery.on('tileerror', () => {
    imageryErrors += 1;
    if (imageryErrors >= 4 && state.mapBaseLayer === imagery) showMapBaseStatus();
  });
  osm.addTo(map);
  state.mapBaseLayer = osm;
  L.control.layers({ Uydu: imagery, Harita: osm }, {}, { position: 'bottomright', collapsed: true }).addTo(map);
  map.on('baselayerchange', (event) => {
    state.mapBaseLayer = event.layer;
    state.mapBaseLoaded = false;
    if (!automaticSwitch) state.mapBaseUserSelected = true;
    hideMapBaseStatus();
  });
  fallbackTimer = setTimeout(switchToImageryFallback, 4000);
  elements.mapBaseRetryButton?.addEventListener('click', () => {
    osmErrors = 0;
    imageryErrors = 0;
    state.mapBaseLoaded = false;
    hideMapBaseStatus();
    state.mapBaseLayer?.redraw?.();
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
}`
  ],
  [
    `  await analyzeCurrentParcel();
}`,
    `  void analyzeCurrentParcel();
}`
  ],
  [
    `    }, { signal: controller.signal, timeoutMs: 65_000 });`,
    `    }, { signal: controller.signal, timeoutMs: 18_000 });`
  ]
]);

await replaceRequired('dist/app.js', [
  [
    `function openDrawer(title, html) {
  elements.drawerTitle.textContent = title;
  elements.drawerContent.innerHTML = html;
  elements.drawer.hidden = false;
  elements.drawerBackdrop.hidden = false;
  document.body.style.overflow = 'hidden';
}

function closeDrawer() {
  elements.drawer.hidden = true;
  elements.drawerBackdrop.hidden = true;
  document.body.style.overflow = '';
}`,
    `function openDrawer(title, html) {
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
}`
  ],
  ['  renderPossibilities(analysis.possibilities || []);', '  renderPossibilities(analysis);'],
  ['  renderRoadmap(analysis.roadmap || []);', '  renderRoadmap(analysis.roadmap || [], analysis);'],
  [
    `function renderPossibilities(items) {
  if (!items.length) {
    elements.possibilityGrid.innerHTML = '<div class="empty-state-inline">Bu parsel için kullanım seçeneği doğrulanamadı.</div>';
    return;
  }
  const icon = { allowed: '✓', conditional: '!', prohibited: '×', required: '!', unknown: '?' };
  elements.possibilityGrid.innerHTML = items.map((item) => \`
    <div class="possibility-item is-\${escapeHtml(item.status)}">
      <span class="possibility-icon">\${icon[item.status] || '?'}</span>
      <span><strong>\${escapeHtml(item.label)}</strong><b>\${escapeHtml(item.statusLabel)}</b><small>\${escapeHtml(item.note || '')}</small></span>
    </div>\`).join('');
}`,
    `function hasVerifiedZoning(analysis = {}) {
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
    elements.possibilityGrid.innerHTML = '<div class="empty-state-inline context-safe-note"><strong>Yapılaşma izni bulunmuş değildir.</strong><span>' + escapeHtml(parcelQualityWarning()) + '</span></div>';
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
}`
  ],
  [
    'function renderOfficialServices(discovery = {}) {\n  const actions = Array.isArray(discovery.actions) ? discovery.actions : [];',
    `function normalizedDisplayKey(item = {}) {
  const rawUrl = String(item.url || item.sourceUrl || '').trim();
  if (rawUrl) {
    try {
      const url = new URL(rawUrl, location.origin);
      url.hash = '';
      url.search = '';
      return 'url:' + url.origin.toLocaleLowerCase('tr-TR') + url.pathname.replace(/\\/+$/, '').toLocaleLowerCase('tr-TR');
    } catch {
      return 'url:' + rawUrl.replace(/[?#].*$/, '').replace(/\\/+$/, '').toLocaleLowerCase('tr-TR');
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
  const actions = dedupeDisplayItems(Array.isArray(discovery.actions) ? discovery.actions : []);`
  ],
  ['  const visibleActions = actions.slice(0, 12);', '  const visibleActions = actions.slice(0, 6);'],
  ['  const attempts = Array.isArray(scan.attempts) ? scan.attempts : [];', '  const attempts = dedupeDisplayItems(Array.isArray(scan.attempts) ? scan.attempts : []);'],
  [
    `function renderRoadmap(items) {
  elements.roadmap.innerHTML = items.map((item) => \`
    <article class="roadmap-step"><span class="roadmap-number">\${escapeHtml(item.step)}</span><h4>\${escapeHtml(item.title)}</h4><p>\${escapeHtml(item.description)}</p></article>\`).join('');
}`,
    `function renderRoadmap(items, analysis = state.analysis || {}) {
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
}`
  ],
  [
    `function renderSources(sources) {
  if (!sources.length) {
    elements.sourceList.innerHTML = '<div class="empty-state-inline">Kaynak kaydı bulunamadı.</div>';
    return;
  }
  const symbol = { cadastre: 'T', zoning: 'P', environment: 'Ç', calculation: '∑', 'official-portal': 'e', 'official-authority': 'B', 'national-portal': 'e', 'national-geodata': 'T', 'national-directory': 'D', 'municipality-portal': 'B', 'municipality-geodata': 'C', 'configured-adapter': '✓', 'official-plan-metadata': 'M', 'official-plan-coverage': 'S', 'official-plan-record': 'P' };
  const trust = { verified: 'Doğrulanmış', 'user-evidence': 'Belge girişi', 'public-information': 'Bilgi amaçlı', calculated: 'Hesaplandı', 'community-data': 'Açık veri', 'lookup-required': 'Kontrol gerekli' };
  elements.sourceList.innerHTML = sources.map((source) => \`
    <div class="source-item">
      <span class="source-symbol">\${escapeHtml(symbol[source.kind] || 'K')}</span>
      <span><strong>\${escapeHtml(source.title || source.provider || 'Kaynak')}</strong><small>\${escapeHtml(source.note || source.provider || '')}</small></span>
      \${source.url ? \`<a href="\${escapeHtml(source.url)}" target="_blank" rel="noopener noreferrer" aria-label="Kaynağı aç">↗</a>\` : \`<span class="source-trust">\${escapeHtml(trust[source.trust] || source.trust || '')}</span>\`}
    </div>\`).join('');
}`,
    `function renderSources(sources) {
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
}`
  ],
  [
    `async function initializeIdentity() {
  try {
    const settings = await fetch('/.netlify/identity/settings', { headers: { Accept: 'application/json' } });
    state.identityEnabled = settings.ok;
  } catch { state.identityEnabled = false; }
  const session = readSession();
  if (state.identityEnabled && session?.access_token) {
    state.session = session;
    try { state.user = await getIdentityUser(); await pullUserData(); }
    catch { clearSession(); state.user = null; }
  }
  updateProfileUi();
}`,
    `async function initializeIdentity() {
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
}`
  ],
  ["  elements.profileAuthButton.textContent = logged ? 'Profilim' : 'Giriş Yap / Kayıt Ol';", "  elements.profileAuthButton.textContent = logged ? 'Profilim' : state.identityEnabled ? 'Giriş Yap / Kayıt Ol' : 'Kayıtlar bu cihazda';"],
  ["    area.innerHTML = '<div class=\"auth-status\"><strong>Hesap eşitleme sistemi bu sunucuda etkin değil.</strong><br>Parsel sorgusu, Çalışmalarım ve Favorilerim bu cihazda çalışır. Hesap sistemi daha sonra ayrıca etkinleştirilebilir.</div>';", "    area.innerHTML = '<div class=\"auth-status\"><strong>Kayıtlar yalnız bu cihazda saklanıyor.</strong><br>Çalışmalarım, Favorilerim ve Taleplerim bu tarayıcıda kullanılabilir; başka cihazlara otomatik aktarılmaz.</div>';"],
  ["  openDrawer(title, html);\n  $$('[data-open-index]', elements.drawerContent)", "  openDrawer(title, (state.accountSyncEnabled ? '' : '<div class=\"auth-status local-storage-notice\"><strong>Bu cihazda saklanıyor.</strong><br>Bu kayıtlar başka cihazlara otomatik aktarılmaz.</div>') + html);\n  $$('[data-open-index]', elements.drawerContent)"],
  ['      privacy: [\'Gizlilik\', \'Misafir çalışmaları bu cihazın tarayıcı hafızasında tutulur. Hesap sistemi etkinleştirildiğinde çalışmalar güvenli sunucu hesabıyla eşitlenebilir. Şifreler Planlamasyon tarafından saklanmaz.\'],', "      privacy: ['Gizlilik', 'Bu yayında çalışmalar, favoriler ve talepler yalnız bu cihazın tarayıcı hafızasında tutulur; başka cihazlara otomatik aktarılmaz. Şifre saklama ve hesap eşitleme sistemi etkin değildir.'],"],
  ['      <h4>Bu arsada yapılabilecekler</h4>', '      <h4>Resmî belgede belirtilen kullanım seçenekleri</h4>']
]);

await replaceRequired('dist/app.js', [
  [
    "<strong>Yapılaşma izni bulunmuş değildir.</strong><span>' + escapeHtml(parcelQualityWarning()) + '</span>",
    "<strong>Yapılaşma izni doğrulanamadı.</strong><span>Bu, yapı yapılamayacağı anlamına gelmez. " + "' + escapeHtml(parcelQualityWarning()) + '</span>"
  ],
  [
    String.raw`function normalizedDisplayKey(item = {}) {
  const rawUrl = String(item.url || item.sourceUrl || '').trim();
  if (rawUrl) {
    try {
      const url = new URL(rawUrl, location.origin);
      url.hash = '';
      url.search = '';
      return 'url:' + url.origin.toLocaleLowerCase('tr-TR') + url.pathname.replace(/\/+$/, '').toLocaleLowerCase('tr-TR');
    } catch {
      return 'url:' + rawUrl.replace(/[?#].*$/, '').replace(/\/+$/, '').toLocaleLowerCase('tr-TR');
    }
  }
  return 'text:' + [item.title, item.provider, item.kind].map((value) => String(value || '').trim().toLocaleLowerCase('tr-TR')).join('|');
}`,
    String.raw`function normalizedDisplayKey(item = {}) {
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
}`
  ],
  [
    `  const catalogText = catalog.embedded
    ? \`Gömülü katalog: \${formatNumber(catalog.recordCount || 0)} kayıt · bu parsel için \${formatNumber(catalog.matchCount || 0)} belediye hizmeti eşleşti.\`
    : null;`,
    `  const catalogText = catalog.embedded
    ? \`Türkiye geneli dinamik resmî yönlendirme hazır · bu konum için \${formatNumber(catalog.matchCount || 0)} doğrulanmış doğrudan hizmet eşleşti.\`
    : 'Türkiye geneli resmî yönlendirme hazır.';`
  ],
  [
    `    const isMunicipal = ['municipality-portal', 'municipality-geodata'].includes(primary.kind);
    elements.primaryOfficialServiceLink.textContent = \`\${isMunicipal ? 'Belediye İmar Kaynağını' : 'Resmî İmar Kaynağını'} Aç ↗\`;`,
    `    const isSearch = primary.accessMode === 'official-search';
    const isMunicipal = ['municipality-portal', 'municipality-geodata'].includes(primary.kind);
    elements.primaryOfficialServiceLink.textContent = isSearch
      ? 'e-Devlet’te İmar Hizmetini Ara ↗'
      : \`\${isMunicipal ? 'Yetkili İmar Sorgusunu' : 'Resmî İmar Kaynağını'} Aç ↗\`;`
  ],
  [
    "    'municipality-portal': 'B', 'municipality-geodata': 'C', 'configured-adapter': '✓'",
    "    'municipality-portal': 'B', 'municipality-geodata': 'C', 'configured-adapter': '✓', 'discovery-search': 'G', 'national-plan-directory': 'P'"
  ],
  [
    "    'public-portal': 'Açık portal', 'official-service': 'Resmî hizmet'",
    "    'public-portal': 'Açık portal', 'official-service': 'Resmî hizmet', 'discovery-only': 'Doğrulama araması', 'manual-only': 'Kullanıcı açar'"
  ],
  [
    "    'national-portals-ready': 'Ulusal portallar hazır',\n    unavailable: 'Bağlantı bulunamadı'",
    "    'national-portals-ready': 'Ulusal portallar hazır',\n    'manual-only': 'Resmî portalda açılmalı',\n    unavailable: 'Bağlantı bulunamadı'"
  ],
  ['  const visibleActions = actions.slice(0, 6);', '  const visibleActions = actions.slice(0, 8);'],
  [
    "setConnection('ok', 'TKGM parsel bağlantısı hazır', 'İl, ilçe, mahalle/köy ve gerçek parsel geometrisi canlı servisten alınır.');",
    "setConnection('ok', 'Parsel sorgusu bilgi amaçlı hazır', 'Kadastro bağlantısı bilgi amaçlıdır; ticari/kurumsal veri kullanımı için TAKPAS ve ilgili kurum yetkileri gerekir.');"
  ],
  [
    "terms: ['Kullanım Koşulları', 'Planlamasyon sonuçları bilgi amaçlıdır. Kesin imar durumu, sınır, aplikasyon, proje ve ruhsat işlemlerinde yetkili kurumların güncel ve yazılı kayıtları esas alınır.']",
    "terms: ['Kullanım Koşulları', 'Planlamasyon sonuçları bilgi amaçlıdır. Kesin imar, sınır, aplikasyon, proje ve ruhsat işlemlerinde yetkili kurumların güncel yazılı kayıtları esastır. Bağlantı bulunması otomatik veri kullanım izni anlamına gelmez; ticari kadastro kullanımı için TAKPAS ve ilgili kurum yetkileri gerekir.']"
  ]
]);

await replaceRequired('dist/app.js', [
  ['  syncTimer: null, syncInProgress: false\n};', '  syncTimer: null, syncInProgress: false, accountSyncEnabled: false\n};']
]);

await replaceRequired('dist/index.html', [
  ['<h2 id="resultTitle">Arsanız hakkında</h2>', '<h2 id="resultTitle">Parseliniz hakkında</h2>'],
  [
    '<article class="card possibility-card">\n          <div class="card-heading"><span class="section-kicker">Kullanım seçenekleri</span><h3>Bu arsada neler yapabilirsiniz?</h3></div>',
    '<article class="card possibility-card" id="possibilityCard">\n          <div class="card-heading"><span class="section-kicker">Kullanım seçenekleri</span><h3 id="possibilityTitle">Kullanım seçenekleri doğrulanıyor</h3></div>'
  ],
  [
    '<article class="card roadmap-card">\n        <div class="card-heading"><span class="section-kicker">Yapı ruhsatı yolu</span><h3>Bu arsada bina yapmak için ne yapmalıyım?</h3></div>',
    '<article class="card roadmap-card" id="roadmapCard">\n        <div class="card-heading"><span class="section-kicker" id="roadmapKicker">Genel yol · yapı izni değildir</span><h3 id="roadmapTitle">Yapı düşünülüyorsa önce ne doğrulanmalı?</h3></div>'
  ],
  [
    `<article class="card official-services-card" id="officialServicesCard">
        <div class="card-heading split-heading">
          <div><span class="section-kicker">Türkiye geneli resmî bağlantılar</span><h3>Bu parsel için hangi imar kaynağı kullanılacak?</h3></div>
          <span class="data-badge" id="officialServicesBadge">Hazırlanıyor</span>
        </div>
        <p class="section-intro" id="officialServicesIntro">e-Plan, TUCBS ve ilgili belediyenin resmî imar hizmeti aranıyor.</p>
        <div class="official-services-grid" id="officialServicesGrid"></div>
      </article>`,
    `<details class="card official-services-card compact-details" id="officialServicesCard">
        <summary class="compact-summary"><span><span class="section-kicker">Resmî imar bağlantıları</span><strong>Bulunan resmî kaynakları göster</strong></span><span class="data-badge" id="officialServicesBadge">Hazırlanıyor</span></summary>
        <div class="compact-body"><p class="section-intro" id="officialServicesIntro">e-Plan, TUCBS ve ilgili belediyenin resmî imar hizmeti aranıyor.</p>
        <div class="official-services-grid" id="officialServicesGrid"></div></div>
      </details>`
  ],
  [
    `<article class="card plan-records-card" id="planRecordsCard">
        <div class="card-heading split-heading">
          <div><span class="section-kicker">Ada–parsel plan kaydı</span><h3>Bu parsel için resmî plan veya askı kaydı var mı?</h3></div>
          <span class="data-badge" id="planRecordsBadge">Hazırlanıyor</span>
        </div>
        <p class="section-intro" id="planRecordsIntro">Kamuya açık resmî plan ve askı kayıtlarında ada/parsel eşleşmesi aranıyor.</p>
        <div class="plan-records-grid" id="planRecordsGrid"></div>
      </article>`,
    `<details class="card plan-records-card compact-details" id="planRecordsCard">
        <summary class="compact-summary"><span><span class="section-kicker">Ada–parsel plan kaydı</span><strong>Plan ve askı kayıtlarını göster</strong></span><span class="data-badge" id="planRecordsBadge">Hazırlanıyor</span></summary>
        <div class="compact-body"><p class="section-intro" id="planRecordsIntro">Kamuya açık resmî plan ve askı kayıtlarında ada/parsel eşleşmesi aranıyor.</p>
        <div class="plan-records-grid" id="planRecordsGrid"></div></div>
      </details>`
  ],
  [
    `<article class="card claims-card">
        <div class="card-heading"><span class="section-kicker">Kaynak–sonuç ilişkisi</span><h3>Hangi bilgi nereden geldi?</h3></div>
        <div class="claim-list" id="claimList"></div>
      </article>`,
    `<details class="card claims-card compact-details">
        <summary class="compact-summary"><span><span class="section-kicker">Kaynak–sonuç ilişkisi</span><strong>Hangi bilgi nereden geldi?</strong></span><span aria-hidden="true">⌄</span></summary>
        <div class="compact-body"><div class="claim-list" id="claimList"></div></div>
      </details>`
  ],
  [
    `<article class="card source-card">
        <div class="card-heading"><span class="section-kicker">Kaynaklar</span><h3>Bu sonuç neye dayanıyor?</h3></div>
        <div class="source-list" id="sourceList"></div>
        <div class="static-source-links">
          <a href="https://parselsorgu.tkgm.gov.tr/" target="_blank" rel="noopener noreferrer">TKGM Parsel Sorgu ↗</a>
          <a href="https://e-plan.gov.tr/e-plan/html/imarDurumu.html" target="_blank" rel="noopener noreferrer">e-Plan ↗</a>
          <a href="https://www.mevzuat.gov.tr/" target="_blank" rel="noopener noreferrer">Mevzuat Bilgi Sistemi ↗</a>
        </div>
      </article>`,
    `<details class="card source-card compact-details">
        <summary class="compact-summary"><span><span class="section-kicker">Kaynaklar</span><strong>Bu sonuç neye dayanıyor?</strong></span><span aria-hidden="true">⌄</span></summary>
        <div class="compact-body"><div class="source-list" id="sourceList"></div>
        <div class="static-source-links">
          <a href="https://parselsorgu.tkgm.gov.tr/" target="_blank" rel="noopener noreferrer">TKGM Parsel Sorgu ↗</a>
          <a href="https://eplan.csb.gov.tr/" target="_blank" rel="noopener noreferrer">e-Plan ↗</a>
          <a href="https://www.mevzuat.gov.tr/" target="_blank" rel="noopener noreferrer">Mevzuat Bilgi Sistemi ↗</a>
        </div></div>
      </details>`
  ],
  ['<aside class="side-drawer" id="sideDrawer" hidden aria-label="Planlamasyon paneli">', '<aside class="side-drawer" id="sideDrawer" hidden role="dialog" aria-modal="true" aria-label="Planlamasyon paneli">']
]);

await replaceRequired('dist/index.html', [
  ['<span class="section-kicker">Son çare: belgeyle tamamlayın</span>', '<span class="section-kicker">Resmî doğrulama yolu</span>'],
  ['<h3>Açık resmî kaynaklar tarandı; bazı yapılaşma değerleri bulunamadı</h3>', '<h3>Yapılaşma değerleri bulunamadı; yetkili sorguyu açın</h3>'],
  [
    '<p>Planlamasyon önce e-Devlet istemeyen açık resmî kaynakları otomatik tarar. Değer bulunamazsa güncel imar durumu, imar çapı ya da plan notunu isteğe bağlı olarak yükleyebilirsiniz. Belge yüklemek ana yöntem değil, son tamamlama yoludur.</p>',
    '<p>Planlamasyon yalnız açık veya izinli kaynakları otomatik okur. Diğer resmî hizmetler kullanıcı tarafından açılır; bağlantı bulunması TAKS, emsal veya yapı izni doğrulandığı anlamına gelmez. İsterseniz güncel resmî belgeyle analizi tamamlayabilirsiniz.</p>'
  ],
  ['<strong>Bulunan resmî kaynakları göster</strong>', '<strong>Yetkili ve ulusal resmî yolları göster</strong>'],
  ['<p>TKGM kaynaklı kadastro geometrisi ve temel bilgiler alınır.</p>', '<p>Kadastro geometrisi bilgi amaçlı alınır; ticari veri kullanımı gerekli kurum yetkilerine tabidir.</p>']
]);

await replaceRequired('netlify/functions/analyze.mjs', [
  ['OPEN_OFFICIAL_SOURCE_TIMEOUT_MS: 2600,', 'OPEN_OFFICIAL_SOURCE_TIMEOUT_MS: 6000,'],
  ['OPEN_OFFICIAL_SOURCE_TOTAL_BUDGET_MS: 5600,', 'OPEN_OFFICIAL_SOURCE_TOTAL_BUDGET_MS: 16000,'],
  ['PUBLIC_PLAN_COVERAGE_TIMEOUT_MS: 3200,', 'PUBLIC_PLAN_COVERAGE_TIMEOUT_MS: 8000,'],
  ['PUBLIC_PLAN_RECORD_TOTAL_TIMEOUT_MS: 3800,', 'PUBLIC_PLAN_RECORD_TOTAL_TIMEOUT_MS: 9000,'],
  ['PUBLIC_PLAN_RECORD_TIMEOUT_MS: 1700,', 'PUBLIC_PLAN_RECORD_TIMEOUT_MS: 4000,'],
  ['MUNICIPALITY_EDEVLET_DISCOVERY_TIMEOUT_MS: 1500,', 'MUNICIPALITY_EDEVLET_DISCOVERY_TIMEOUT_MS: 3500,'],
  ['PLAN_AI_SOURCE_TIMEOUT_MS: 1500,', 'PLAN_AI_SOURCE_TIMEOUT_MS: 4500,'],
  ['PLAN_AI_EVIDENCE_TOTAL_BUDGET_MS: 2600,', 'PLAN_AI_EVIDENCE_TOTAL_BUDGET_MS: 9000,'],
  ['PLAN_AI_TIMEOUT_MS: 6000,', 'PLAN_AI_TIMEOUT_MS: 24000,'],
  ['PLAN_AI_MAX_TOKENS: 1800,', 'PLAN_AI_MAX_TOKENS: 900,'],
  ['OVERPASS_TOTAL_TIMEOUT_MS: 5000,', 'OVERPASS_TOTAL_TIMEOUT_MS: 8000,'],
  ['OVERPASS_TIMEOUT_MS: 1700,', 'OVERPASS_TIMEOUT_MS: 3500,'],
  ["NOMINATIM_FALLBACK_ENABLED: 'false'", "NOMINATIM_FALLBACK_ENABLED: 'true'"],
  ['        19_000,', '        60_000,'],
  ['        6_000,', '        20_000,'],
  ['İmar analizi 19 saniyelik süre sınırına ulaştı.', 'İmar analizi güvenli süre sınırına ulaştı.'],
  ['Yakın çevre servisi 6 saniye içinde yanıt vermedi;', 'Yakın çevre servisi süre içinde yanıt vermedi;']
]);

await replaceRequired('netlify/functions/lib/zoning-client.mjs', [
  ['    3800,', '    9000,'],
  ['    4300,', '    10000,'],
  ['    2800,', '    5000,'],
  ['), 4700, () => null)', '), 8000, () => null)'],
  ['    6200,', '    18000,'],
  ['    6500,', '    26000,']
]);

await replaceRequired('netlify/functions/lib/municipality-catalog.mjs', [[
  `  "provinceCount": 29,
  "nationalRecordCount": 5,`,
  `  "provinceCount": 29,
  "directProvinceCount": ${officialRouting.coverage.directCatalogProvinceCount},
  "directDistrictPairCount": ${officialRouting.coverage.directCatalogDistrictPairCount},
  "routingProvinceCount": ${officialRouting.coverage.provinceCount},
  "nationwideRouting": true,
  "routingMode": "${officialRouting.coverage.mode}",
  "nationalRecordCount": 5,`
]]);

await replaceRequired('dist/data/municipality-official-services.json', [[
  `    "provinceCount": 29,
    "nationalRecordCount": 5,`,
  `    "provinceCount": 29,
    "directProvinceCount": ${officialRouting.coverage.directCatalogProvinceCount},
    "directDistrictPairCount": ${officialRouting.coverage.directCatalogDistrictPairCount},
    "routingProvinceCount": ${officialRouting.coverage.provinceCount},
    "nationwideRouting": true,
    "routingMode": "${officialRouting.coverage.mode}",
    "nationalRecordCount": 5,`
]]);
await writeFile('dist/data/official-source-routing.json', `${JSON.stringify(officialRouting, null, 2)}\n`);

await replaceRequired('netlify/functions/lib/municipality-provider.mjs', [
  [
    `const OFFICIAL_PORTALS = {
  eplan: 'https://e-plan.gov.tr/e-plan/html/imarDurumu.html',
  eplanHome: 'https://e-plan.gov.tr/',
  tucbs: 'https://tucbs.gov.tr/',
  tucbsOpenData: 'https://ucbp.tucbs.gov.tr/cografi-acik-veri-platformu',
  eDevletSearch: 'https://www.turkiye.gov.tr/arama',
  eDevletMunicipalities: 'https://www.turkiye.gov.tr/belediyeler'
};`,
    `const OFFICIAL_PORTALS = {
  eplan: ${JSON.stringify(routingPortals.eplanImar)},
  eplanHome: 'https://eplan.csb.gov.tr/',
  eplanPlans: ${JSON.stringify(routingPortals.eplanPlans)},
  tucbs: ${JSON.stringify(routingPortals.tucbs)},
  tucbsOpenData: ${JSON.stringify(routingPortals.tucbsOpenData)},
  eDevletSearch: ${JSON.stringify(routingPortals.eDevletSearch)},
  eDevletMunicipalities: ${JSON.stringify(routingPortals.eDevletMunicipalities)},
  googleSearch: ${JSON.stringify(routingPortals.googleSearch)}
};`
  ],
  [
    `    municipalServices.map((item) => item.id).join('|'),
    configuredConnectors.map((item) => item.id).join('|')`,
    `    municipalServices.map((item) => [item.id, canonicalUrlKey(item.url), item.accessMode, item.status].join('~')).join('|'),
    configuredConnectors.map((item) => [item.id, canonicalUrlKey(item.publicUrl || item.sourceUrl || item.url), item.accessMode].join('~')).join('|')`
  ],
  [
    `  const actions = [
    ...nationalCatalogActions(),`,
    `  const actions = [
    ...nationalCatalogActions(),
    ...locationRoutingActions(location),`
  ],
  [
    `      url: safeHttpsUrl(connector.publicUrl || connector.sourceUrl || null),`,
    `      url: safeHttpsUrl(connector.publicUrl || connector.sourceUrl || connector.url || null),`
  ],
  [
    `  const finalActions = sortActions(dedupeActions(actions));`,
    `  const finalActions = dedupeActions(actions);`
  ],
  [
    `      selectedServiceCount: municipalServices.length,
      publicCatalogUrl: '/data/municipality-official-services.json'`,
    `      selectedServiceCount: municipalServices.length,
      routingProvinceCount: 81,
      nationwideRouting: true,
      automaticDataClaim: false,
      publicCatalogUrl: '/data/municipality-official-services.json',
      publicRoutingUrl: '/data/official-source-routing.json'`
  ],
  [
    `export function buildEDevletSearchUrl({ district, province } = {}) {
  const parts = [district ? \`\${district} Belediyesi\` : null, 'İmar Durum Bilgisi Sorgulama', province].filter(Boolean);
  const url = new URL(OFFICIAL_PORTALS.eDevletSearch);
  url.searchParams.set('aranan', parts.join(' '));
  return url.toString();
}`,
    `export function buildEDevletSearchUrl({ district, province } = {}) {
  const parts = [district ? \`\${district} Belediyesi\` : null, 'İmar Durum Bilgisi Sorgulama', province].filter(Boolean);
  const url = new URL(OFFICIAL_PORTALS.eDevletSearch);
  url.searchParams.set('aranan', parts.join(' '));
  return url.toString();
}

export function buildGoogleOfficialSearchUrl({ district, province, neighbourhood, block, parcel } = {}) {
  const url = new URL(OFFICIAL_PORTALS.googleSearch);
  const parcelRef = block && parcel ? \`ada \${block} parsel \${parcel}\` : null;
  const parts = [district ? \`"\${district} Belediyesi"\` : null, province, neighbourhood, '"imar durumu"', parcelRef, 'site:bel.tr OR site:gov.tr'].filter(Boolean);
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
}`
  ],
  [
    `function matchingConnectors(raw, location) {
  const parsed = parseJson(raw, []);
  const list = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.connectors) ? parsed.connectors : [];
  return list.filter((item) => item?.url && matchesLocation(item, location)).slice(0, 20).map((item, index) => ({
    ...item,
    id: clean(item.id, 120) || \`municipality-\${index + 1}\`
  }));
}`,
    `function matchingConnectors(raw, location) {
  const parsed = parseJson(raw, []);
  const list = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.connectors) ? parsed.connectors : [];
  return list.filter((item) => {
    const url = safeHttpsUrl(item?.publicUrl || item?.sourceUrl || item?.url);
    return Boolean(url && matchesLocation(item, location));
  }).slice(0, 20).map((item, index) => ({
    ...item,
    id: clean(item.id, 120) || \`municipality-\${index + 1}\`
  }));
}`
  ],
  [
    `  const neighbourhood = clean(p.neighbourhood || query?.neighbourhood, 160);
  return {
    province,
    district,
    neighbourhood,
    provinceKey: normalize(province),
    districtKey: normalize(district),
    neighbourhoodKey: normalize(neighbourhood)
  };`,
    `  const neighbourhood = clean(p.neighbourhood || query?.neighbourhood, 160);
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
  };`
  ],
  [
    `function servicePriority(service) {
  let score = 0;
  if (service.status === 'manual-only' || service.accessMode === 'manual-only') score += 110;
  if (service.kind === 'configured-adapter') score += 200;
  if (service.kind === 'municipality-geodata') score += 120;
  if (service.kind === 'municipality-portal') score += 80;
  if (service.accessMode === 'public-portal') score += 50;
  if (service.machineReadableCandidate) score += 70;
  if (service.accessMode === 'official-login-service') score += 10;
  if (/imar durum/i.test(service.title || '')) score += 12;
  return score;
}

function sortActions(actions) {
  return [...actions].sort((a, b) => servicePriority(b) - servicePriority(a) || String(a.title || '').localeCompare(String(b.title || ''), 'tr'));
}

function dedupeServices(services) {
  const seen = new Set();
  return services.filter((item) => {
    const key = item?.url || item?.id || \`\${item?.provider}:\${item?.title}\`;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((a, b) => servicePriority(b) - servicePriority(a));
}

function dedupeActions(actions) {
  const seen = new Set();
  return actions.filter((item) => {
    const key = item?.kind === 'configured-adapter'
      ? \`configured:\${item?.id || item?.url || item?.title}\`
      : item?.url || item?.id || item?.title;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function safeHttpsUrl(value) {
  if (!value) return null;
  try {
    const url = new URL(String(value));
    return url.protocol === 'https:' ? url.toString() : null;
  } catch { return null; }
}`,
    `function servicePriority(service = {}) {
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
    const pathname = url.pathname.replace(/\\/+$/, '') || '/';
    return \`\${url.origin.toLowerCase()}\${pathname}\${url.search}\`;
  } catch { return null; }
}

function serviceKey(item = {}) {
  const urlKey = canonicalUrlKey(item.url);
  if (urlKey) return \`url:\${urlKey}\`;
  return \`id:\${item.id || item.title || item.provider || 'unknown'}\`;
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
  const host = String(hostname || '').toLowerCase().replace(/^\\[|\\]$/g, '').replace(/\\.$/, '');
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return true;
  if (host === '::' || host === '::1' || host.startsWith('fc') || host.startsWith('fd') || /^fe[89ab]/.test(host)) return true;
  if (host.startsWith('::ffff:127.') || host.startsWith('::ffff:10.') || host.startsWith('::ffff:192.168.')) return true;
  const parts = host.split('.');
  if (parts.length === 4 && parts.every((part) => /^\\d+$/.test(part) && Number(part) >= 0 && Number(part) <= 255)) {
    const [a, b] = parts.map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || (a === 198 && [18, 19].includes(b));
  }
  return false;
}

function safeHttpsUrl(value) {
  if (!value) return null;
  try {
    const url = new URL(String(value));
    if (url.protocol !== 'https:' || url.username || url.password || blockedHostname(url.hostname)) return null;
    return url.toString();
  } catch { return null; }
}`
  ]
]);

await replaceRequired('netlify/functions/parse-zoning-document.mjs', [
  [
    `import { parseZoningDocumentText, ZONING_DOCUMENT_PARSER_VERSION } from './lib/zoning-document-parser.mjs';`,
    `import { parseZoningDocumentText, ZONING_DOCUMENT_PARSER_VERSION } from './lib/zoning-document-parser.mjs';
import { parseBesiktasKeosImarHtml, BESIKTAS_KEOS_IMAR_PARSER_VERSION } from './lib/besiktas-keos-imar-parser.mjs';`
  ],
  [
    `    const parsed = parseZoningDocumentText({ text, query, parcel, metadata });`,
    `    const parsed = looksLikeBesiktasKeosHtml(text)
      ? parseUserProvidedBesiktasHtml({ text, query, parcel, metadata, body, mode })
      : parseZoningDocumentText({ text, query, parcel, metadata });`
  ],
  [
    `async function fetchOfficialDocument(inputUrl) {`,
    `function looksLikeBesiktasKeosHtml(text) {
  return /Beşiktaş Belediyesi[^<]{0,120}İmar Durumu|T\.C\.\s*Beşiktaş Belediyesi/iu.test(String(text || ''))
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
    excerpt: \`\${item.label || key}: \${item.rawValue ?? item.value ?? ''}\`,
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

async function fetchOfficialDocument(inputUrl) {`
  ],
  [
    `  if (url.protocol !== 'https:') throw httpError('Belge bağlantısı HTTPS olmalıdır.', 400, 'DOCUMENT_URL_HTTPS_REQUIRED');`,
    `  if (url.protocol !== 'https:') throw httpError('Belge bağlantısı HTTPS olmalıdır.', 400, 'DOCUMENT_URL_HTTPS_REQUIRED');
  if (url.hostname.toLowerCase() === 'keos.besiktas.bel.tr' && url.pathname.toLowerCase().startsWith('/imardurumu')) {
    throw httpError('Beşiktaş Belediyesi kullanım koşulları otomatik üçüncü taraf işlemini yasaklıyor. Sonucu belediye sitesinden açıp güncel belgeyi Dosya sekmesinden yükleyin.', 403, 'BESIKTAS_AUTOMATIC_READ_FORBIDDEN');
  }`
  ]
]);

await replaceRequired('dist/app.js', [
  [
    '<div><span class="section-kicker">Belge okuma motoru · v3.2.0</span><h4 id="documentReaderTitle">Resmî belgeyi otomatik tara</h4></div>',
    '<div><span class="section-kicker">Belge okuma motoru · v3.5.0</span><h4 id="documentReaderTitle">Resmî belgeyi güvenli biçimde oku</h4></div>'
  ],
  [
    `        <label class="drawer-check document-parcel-confirm" id="documentParcelConfirmWrap" hidden><input type="checkbox" id="documentParcelConfirm"><span>Belgede ada/parsel metni otomatik okunamadı; bu belgenin sorguladığım parsele ait olduğunu resmî belgeden kontrol ettim.</span></label>
        <button class="button button-primary" id="readOfficialDocumentButton" type="button">`,
    `        <label class="drawer-check document-source-confirm"><input type="checkbox" id="documentOfficialSourceConfirm"><span>Bu dosyayı veya metni resmî kurum sayfasından ben aldım ve yalnız kendi sorgum için okunmasını onaylıyorum.</span></label>
        <label class="drawer-check document-parcel-confirm" id="documentParcelConfirmWrap" hidden><input type="checkbox" id="documentParcelConfirm"><span>Belgede ada/parsel metni otomatik okunamadı; bu belgenin sorguladığım parsele ait olduğunu resmî belgeden kontrol ettim.</span></label>
        <button class="button button-primary" id="readOfficialDocumentButton" type="button">`
  ],
  [
    `    try {
      let payload;
      if (activeTab === 'file') {`,
    `    try {
      const officialSourceConfirmed = Boolean($('#documentOfficialSourceConfirm', form)?.checked);
      if (activeTab !== 'url' && !officialSourceConfirmed) throw new Error('Dosya veya metnin resmî kaynaktan alındığını ve okunmasını onayladığınızı işaretleyin.');
      let payload;
      if (activeTab === 'file') {`
  ],
  [
    `      payload.query = state.lastQuery || {};
      payload.parcel = state.parcelFeature;`,
    `      payload.query = state.lastQuery || {};
      payload.parcel = state.parcelFeature;
      payload.evidenceOrigin = activeTab === 'file' ? 'user-upload' : activeTab === 'text' ? 'user-paste' : 'automatic-url';
      payload.userConfirmedOfficialSource = officialSourceConfirmed;`
  ]
]);

await replaceRequired('netlify/functions/lib/municipality-provider.mjs', [[
  `    automatedQueryAllowed: record.automatedQueryAllowed === true,
    configured: record.configured === true,`,
  `    automatedQueryAllowed: record.automatedQueryAllowed === true,
    writtenPermissionRequired: record.writtenPermissionRequired === true,
    configured: record.configured === true,`
]]);

const css = await readFile('dist/styles.css', 'utf8');
await writeFile('dist/styles.css', `${css}\n
/* v3.3.0 nationwide official routing, truthful results and mobile Plan AI */
.context-safe-note{display:grid;gap:8px;text-align:left}
.context-safe-note strong{color:var(--text)}
.context-safe-note span{color:var(--muted);line-height:1.6}
.roadmap-step.is-gate{grid-column:1/-1;min-height:0;border-color:rgba(239,182,93,.3);background:rgba(239,182,93,.06)}
.compact-details{padding:0!important;overflow:hidden}
.compact-summary{min-height:78px;padding:18px 25px;display:flex;align-items:center;justify-content:space-between;gap:16px;cursor:pointer;list-style:none}
.compact-summary::-webkit-details-marker{display:none}
.compact-summary>span:first-child{display:grid;gap:6px}
.compact-summary strong{font-size:18px;line-height:1.3}
.compact-details[open] .compact-summary{border-bottom:1px solid var(--line)}
.compact-body{padding:20px 25px 25px}
.compact-body>.section-intro:first-child{margin-top:0}
.local-storage-notice{margin-bottom:14px}

@media(max-width:1100px), (hover:none) and (pointer:coarse){
  .side-drawer.is-plan-ai{left:0!important;right:0!important;top:auto!important;bottom:0!important;width:100%!important;height:auto!important;max-height:90dvh;border-radius:24px 24px 0 0}
  .side-drawer.is-plan-ai .drawer-head{height:64px;padding:0 max(16px,env(safe-area-inset-right)) 0 max(16px,env(safe-area-inset-left))}
  .side-drawer.is-plan-ai .drawer-content{height:auto;max-height:calc(90dvh - 64px);overflow:auto;padding:16px max(16px,env(safe-area-inset-right)) calc(16px + env(safe-area-inset-bottom)) max(16px,env(safe-area-inset-left))}
  .side-drawer.is-plan-ai .plan-ai-chat{align-content:start;gap:12px}
  .side-drawer.is-plan-ai .plan-ai-chat textarea{min-height:86px;max-height:20dvh}
  .side-drawer.is-plan-ai .plan-ai-chat-answer{max-height:24dvh;overflow:auto}
}
@media(max-width:640px){
  .map-shell{height:360px;min-height:360px}
  .leaflet-container{min-height:360px}
  .compact-summary{min-height:72px;padding:15px 20px}
  .compact-body{padding:16px 20px 20px}
  .side-drawer.is-plan-ai{max-height:94dvh}
  .side-drawer.is-plan-ai .drawer-content{max-height:calc(94dvh - 64px)}
}
`);

for (const file of [
  ...await textFiles('dist'),
  ...await textFiles('netlify'),
  ...await textFiles('src'),
  ...await textFiles('functions'),
  ...await textFiles('tests')
]) {
  let text = await readFile(file, 'utf8');
  text = text
    .replaceAll('https://e-plan.gov.tr/e-plan/html/imarDurumu.html', routingPortals.eplanImar)
    .replaceAll('https://e-plan.gov.tr/', 'https://eplan.csb.gov.tr/')
    .replaceAll('v3\\.2\\.7', 'v3\\.3\\.0')
    .replaceAll('v3\\.2\\.8', 'v3\\.3\\.0')
    .replaceAll('v3\\.2\\.9', 'v3\\.3\\.0')
    .replaceAll('3.2.7', '3.3.0')
    .replaceAll('3.2.8', '3.3.0')
    .replaceAll('3.2.9', '3.3.0');
  await writeFile(file, text);
}

const packageJson = JSON.parse(await readFile('package.json', 'utf8'));
packageJson.version = '3.3.0';
packageJson.scripts.check = String(packageJson.scripts.check || '')
  .replace(/node --check postbuild-tests\/v\d+-postbuild\.test\.mjs(?: && node --check postbuild-tests\/v330-provider-routing\.test\.mjs)?/, 'node --check postbuild-tests/v330-postbuild.test.mjs && node --check postbuild-tests/v330-provider-routing.test.mjs');
await writeFile('package.json', `${JSON.stringify(packageJson, null, 2)}\n`);

await mkdir('postbuild-tests', { recursive: true });
await rm('postbuild-tests/v328-postbuild.test.mjs', { force: true });
await rm('postbuild-tests/v329-postbuild.test.mjs', { force: true });
await writeFile('postbuild-tests/v330-postbuild.test.mjs', `
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('v3.3.0 mobil harita ve istemci süreleri korundu', async () => {
  const app = await readFile('dist/app.js', 'utf8');
  assert.ok(app.includes('osm.addTo(map)'));
  assert.match(app, /refreshParcelMap/);
  assert.match(app, /timeoutMs: 65_000/);
  assert.match(app, /timeoutMs: 35_000/);
});

test('v3.3.0 canlı servis bütçeleri ve Plan AI alt paneli uygulandı', async () => {
  const analyze = await readFile('netlify/functions/analyze.mjs', 'utf8');
  const css = await readFile('dist/styles.css', 'utf8');
  const app = await readFile('dist/app.js', 'utf8');
  assert.match(analyze, /OPEN_OFFICIAL_SOURCE_TOTAL_BUDGET_MS: 16000/);
  assert.match(analyze, /PLAN_AI_TIMEOUT_MS: 24000/);
  assert.match(analyze, /60_000/);
  assert.match(css, /v3\.3\.0 nationwide official routing/);
  assert.match(css, /max-width:1100px/);
  assert.match(css, /\.side-drawer\.is-plan-ai/);
  assert.match(css, /max-height:90dvh/);
  assert.match(app, /classList\.toggle\\('is-plan-ai'/);
  assert.match(app, /classList\.remove\\('is-plan-ai'/);
});

test('v3.3.0 doğrulanmayan imar için yanıltıcı kullanım ve ruhsat kartı üretmez', async () => {
  const html = await readFile('dist/index.html', 'utf8');
  const app = await readFile('dist/app.js', 'utf8');
  assert.doesNotMatch(html, /Bu arsada neler yapabilirsiniz/);
  assert.doesNotMatch(html, /Bu arsada bina yapmak/);
  assert.match(html, /id="possibilityTitle"/);
  assert.match(html, /id="roadmapTitle"/);
  assert.match(app, /function hasVerifiedZoning/);
  assert.match(app, /Yapılaşma izni doğrulanamadı/);
  assert.match(app, /Bu, yapı yapılamayacağı anlamına gelmez/);
  assert.doesNotMatch(app, /Yapılaşma izni bulunmuş değildir/);
  assert.match(app, /Bu parselde yapı yapılabileceği henüz doğrulanmadı/);
  assert.match(app, /mezarlık/i);
});

test('v3.3.0 kaynakları anlamlı sorguyu koruyarak tekilleştirir', async () => {
  const html = await readFile('dist/index.html', 'utf8');
  const app = await readFile('dist/app.js', 'utf8');
  assert.match(app, /function normalizedDisplayKey/);
  assert.match(app, /function dedupeDisplayItems/);
  assert.match(app, /utm_/);
  assert.match(app, /searchParams\.entries/);
  assert.match(app, /const actions = dedupeDisplayItems/);
  assert.match(app, /const uniqueSources = dedupeDisplayItems/);
  assert.match(html, /<details class="card official-services-card compact-details"/);
  assert.match(html, /<details class="card source-card compact-details"/);
});

test('v3.3.0 81 il resmî yönlendirme ve güvenli URL motoru üretildi', async () => {
  const provider = await readFile('netlify/functions/lib/municipality-provider.mjs', 'utf8');
  const routing = JSON.parse(await readFile('dist/data/official-source-routing.json', 'utf8'));
  const catalog = JSON.parse(await readFile('dist/data/municipality-official-services.json', 'utf8'));
  assert.equal(routing.coverage.provinceCount, 81);
  assert.equal(routing.coverage.automaticDataClaim, false);
  assert.equal(catalog.stats.routingProvinceCount, 81);
  assert.equal(catalog.stats.nationwideRouting, true);
  assert.match(provider, /buildGoogleOfficialSearchUrl/);
  assert.match(provider, /site:bel\.tr OR site:gov\.tr/);
  assert.match(provider, /canonicalUrlKey/);
  assert.match(provider, /blockedHostname/);
  assert.match(provider, /automaticDataClaim: false/);
});

test('v3.3.0 ticari veri yetkisini doğru açıklar ve resmî doğrudan linkleri kullanır', async () => {
  const html = await readFile('dist/index.html', 'utf8');
  const app = await readFile('dist/app.js', 'utf8');
  assert.match(html, /yalnız açık veya izinli kaynakları otomatik okur/);
  assert.match(app, /TAKPAS ve ilgili kurum yetkileri gerekir/);
  assert.match(html, /eplan\.csb\.gov\.tr\\/e-plan\\/html\\/imarDurumu\.html/);
});

test('v3.3.0 Cloudflare hesap durumunu doğru algılar ve yerel kayıt uyarısı gösterir', async () => {
  const app = await readFile('dist/app.js', 'utf8');
  const worker = await readFile('src/worker.js', 'utf8');
  assert.match(app, /ACCOUNT_SYNC_DISABLED/);
  assert.match(app, /Kayıtlar yalnız bu cihazda saklanıyor/);
  assert.match(app, /Bu cihazda saklanıyor/);
  assert.match(app, /content-type/);
  assert.match(worker, /ACCOUNT_SYNC_DISABLED/);
});

test('v3.3.0 sürümü ve önbellek anahtarları tek sürümdür', async () => {
  const html = await readFile('dist/index.html', 'utf8');
  const pkg = JSON.parse(await readFile('package.json', 'utf8'));
  assert.equal(pkg.version, '3.3.0');
  assert.match(html, /styles\.css\\?v=3\.3\.0/);
  assert.match(html, /app\.js\\?v=3\.3\.0/);
  assert.match(html, /PLANLAMASYON · v3\.3\.0/);
  assert.doesNotMatch(html, /3\.2\.[789]/);
});
`);

console.log('Planlamasyon v3.3.0 ulusal resmî kaynak yönlendirmesi uygulandı.');

// v3.5.0 — izinli belge okuma, kadastro/imar ayrımı, hızlı ilk faz ve harita yedeği.
await replaceRequired('dist/index.html', [
  [
    '            <div class="map-unavailable" id="mapUnavailable" hidden><strong>Harita yüklenemedi</strong><span>İnternet bağlantısını kontrol edip sayfayı yenileyin.</span></div>',
    `            <div class="map-unavailable" id="mapUnavailable" hidden><strong>Harita yüklenemedi</strong><span>İnternet bağlantısını kontrol edip sayfayı yenileyin.</span></div>
            <div class="map-base-status" id="mapBaseStatus" hidden role="status"><span>Harita tabanı yüklenemedi; parsel sınırı korunuyor.</span><button type="button" id="mapBaseRetryButton">Yeniden dene</button></div>`
  ],
  [
    `      <div class="analysis-status card" id="analysisStatus" hidden>`,
    `      <aside class="mobile-result-summary card" id="mobileResultSummary" aria-live="polite">
        <strong>Hızlı karar özeti</strong>
        <dl>
          <div><dt>Parsel</dt><dd id="mobileSummaryParcel">Hazırlanıyor</dd></div>
          <div><dt>Tapu/kadastro kaydı</dt><dd id="mobileSummaryCadastre">Hazırlanıyor</dd></div>
          <div><dt>İmar ve yapı hakkı</dt><dd id="mobileSummaryZoning">Kontrol ediliyor</dd></div>
        </dl>
      </aside>

      <div class="analysis-status card" id="analysisStatus" hidden>`
  ],
  [
    `        <article class="card parcel-summary">
          <div class="verified-badge">TKGM açık CBS yanıtı · Bilgi amaçlı</div>`,
    `        <article class="card parcel-summary" id="cadastralRecordCard">
          <div class="record-badge-row"><div class="verified-badge">TKGM açık CBS yanıtı · Bilgi amaçlı</div><div class="rights-warning-badge">İmar hakkı değildir</div></div>`
  ],
  [
    '<div><span>Nitelik</span><strong id="metricQuality">—</strong></div>',
    '<div><span>TKGM kaydındaki taşınmaz niteliği</span><strong id="metricQuality">—</strong></div>'
  ],
  [
    '<article class="card zoning-overview" id="zoningOverview">',
    '<article class="card zoning-overview" id="zoningRightsCard">'
  ],
  [
    '<span class="section-kicker">İmar özeti</span>',
    '<span class="section-kicker">İmar planı ve yeni yapı hakkı</span>'
  ]
]);

await replaceRequired('dist/app.js', [
  [
    `  mapClick: $('#mapClickButton'), mapCaption: $('#mapCaption'), mapLoading: $('#mapLoading'), mapUnavailable: $('#mapUnavailable'),`,
    `  mapClick: $('#mapClickButton'), mapCaption: $('#mapCaption'), mapLoading: $('#mapLoading'), mapUnavailable: $('#mapUnavailable'),
  mapBaseStatus: $('#mapBaseStatus'), mapBaseRetryButton: $('#mapBaseRetryButton'),`
  ],
  [
    `  parcelAddress: $('#parcelAddress'), plainExplanation: $('#plainExplanation'), metricArea: $('#metricArea'),`,
    `  parcelAddress: $('#parcelAddress'), plainExplanation: $('#plainExplanation'), metricArea: $('#metricArea'),
  mobileResultSummary: $('#mobileResultSummary'), mobileSummaryParcel: $('#mobileSummaryParcel'), mobileSummaryCadastre: $('#mobileSummaryCadastre'), mobileSummaryZoning: $('#mobileSummaryZoning'), summaryGrid: $('#summaryGrid'),`
  ],
  [
    `  syncTimer: null, syncInProgress: false, accountSyncEnabled: false`,
    `  syncTimer: null, syncInProgress: false, accountSyncEnabled: false,
  mapBaseLayer: null, mapBaseFallbackActivated: false, mapBaseUserSelected: false, mapBaseLoaded: false`
  ]
]);

await replaceRequired('netlify/functions/analyze.mjs', [
  ['OPEN_OFFICIAL_SOURCE_TIMEOUT_MS: 6000,', 'OPEN_OFFICIAL_SOURCE_TIMEOUT_MS: 3200,'],
  ['OPEN_OFFICIAL_SOURCE_TOTAL_BUDGET_MS: 16000,', 'OPEN_OFFICIAL_SOURCE_TOTAL_BUDGET_MS: 9000,'],
  ['PUBLIC_PLAN_COVERAGE_TIMEOUT_MS: 8000,', 'PUBLIC_PLAN_COVERAGE_TIMEOUT_MS: 5000,'],
  ['PUBLIC_PLAN_RECORD_TOTAL_TIMEOUT_MS: 9000,', 'PUBLIC_PLAN_RECORD_TOTAL_TIMEOUT_MS: 5500,'],
  ['PUBLIC_PLAN_RECORD_TIMEOUT_MS: 4000,', 'PUBLIC_PLAN_RECORD_TIMEOUT_MS: 2500,'],
  ['MUNICIPALITY_EDEVLET_DISCOVERY_TIMEOUT_MS: 3500,', 'MUNICIPALITY_EDEVLET_DISCOVERY_TIMEOUT_MS: 2000,'],
  ['PLAN_AI_TIMEOUT_MS: 24000,', "PLAN_AI_TIMEOUT_MS: 9000,\n      PLAN_AI_AUTO_ENABLED: 'false',"],
  ['OVERPASS_TOTAL_TIMEOUT_MS: 8000,', 'OVERPASS_TOTAL_TIMEOUT_MS: 7000,'],
  ['OVERPASS_TIMEOUT_MS: 3500,', 'OVERPASS_TIMEOUT_MS: 2800,'],
  ['        60_000,', '        12_000,'],
  ['        20_000,', '        8_000,']
]);

await replaceRequired('netlify/functions/lib/zoning-client.mjs', [
  [
    `  const [basePlanContext, publicPlanRecords, providerDiscovery] = await Promise.all([planContextPromise, publicPlanRecordsPromise, providerDiscoveryPromise]);
  const planContext = mergePlanContext(basePlanContext, publicPlanRecords);

  // Önce açık resmî kaynak sonucu alınır. Böylece belediye portalında POST/form ile elde edilen
  // parsel sonucu yeniden GET edilmeye çalışılmadan doğrudan Plan AI kanıtına aktarılabilir.
  const openSourceScan = await settleWithin(
    discoverOpenOfficialZoning({ parcel, query, providerDiscovery, env: fastEnv, fetchImpl }),
    18000,
    () => incompleteSourceScan('Açık resmî kaynak taraması süre sınırına ulaştı; bulunan diğer bilgiler gösteriliyor.')
  );
  const planAiResult = await settleWithin(
    enhanceZoningWithPlanAI({ parcel, query, providerDiscovery, planContext, openSourceScan, env: fastEnv, fetchImpl }),
    26000,
    () => unavailablePlanAi(fastEnv, 'Plan AI süre sınırı içinde yanıt vermedi; diğer resmî kaynak sonuçları gösteriliyor.')
  );`,
    `  const providerDiscovery = await providerDiscoveryPromise;
  const manualOnlyWithoutConnector = shouldUseManualOnlyStatus(providerDiscovery)
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
    : unavailablePlanAi(fastEnv, 'Hızlı ilk sonuç için Plan AI otomatik beklenmedi. İsterseniz Plan AI panelinden mevcut sonucu ayrıca açıklatabilirsiniz.');`
  ],
  [
    `  configuration.planAiEnabled = Boolean(planAi?.enabled);`,
    `  configuration.planAiAutoEnabled = planAiAutoEnabled;
  configuration.planAiEnabled = Boolean(planAi?.enabled);`
  ],
  [
    `function unavailablePlanAi(env, message) {`,
    `function manualOnlySourceScan(providerDiscovery = {}) {
  const services = Array.isArray(providerDiscovery?.municipalServices)
    ? providerDiscovery.municipalServices.filter((item) => item?.accessMode === 'manual-only' || item?.status === 'manual-only')
    : [];
  const attempts = services.map((item) => ({
    id: item.id,
    title: item.title,
    provider: item.provider,
    url: item.url,
    status: 'manual-only',
    message: item.note || 'Bu resmî portal yalnız kullanıcı tarafından açılır; otomatik sorgu yapılmadı.'
  }));
  const message = providerDiscovery?.message || 'Resmî imar portalı manuel kullanım gerektiriyor; otomatik kaynak taraması yapılmadı.';
  return {
    status: 'manual-only', exhausted: true, budgetLimited: false,
    totalCandidateCount: attempts.length, attemptedCount: attempts.length, reachableCount: 0,
    foundRecordCount: 0, foundFieldCount: 0, records: [], sources: [], attempts, diagnostics: [], message
  };
}

function unavailablePlanAi(env, message) {`
  ],
  ["configuration.boundedAnalysisVersion = '3.3.0';", "configuration.boundedAnalysisVersion = '3.5.0';"]
]);

await replaceRequired('netlify/functions/lib/municipality-provider.mjs', [
  [
    `    machineReadableCandidate: false,
    automatedQueryAllowed: false
  }
];`,
    `    machineReadableCandidate: false,
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
];`
  ],
  [
    `      automatedQueryAllowed: service.automatedQueryAllowed === true,
      configured: service.configured === true,`,
    `      automatedQueryAllowed: service.automatedQueryAllowed === true,
      writtenPermissionRequired: service.writtenPermissionRequired === true,
      configured: service.configured === true,`
  ]
]);

for (const file of [
  ...await textFiles('dist'),
  ...await textFiles('netlify'),
  ...await textFiles('src'),
  ...await textFiles('functions'),
  ...await textFiles('tests')
]) {
  let text = await readFile(file, 'utf8');
  text = text
    .replaceAll('v3\\.3\\.0', 'v3\\.4\\.0')
    .replaceAll('3\\.3\\.0', '3\\.4\\.0')
    .replaceAll('v3.3.0', 'v3.5.0')
    .replaceAll('3.3.0', '3.5.0');
  await writeFile(file, text);
}

const packageJson340 = JSON.parse(await readFile('package.json', 'utf8'));
packageJson340.version = '3.5.0';
const checkCommands340 = String(packageJson340.scripts.check || '')
  .split(' && ')
  .map((command) => command.trim())
  .filter(Boolean)
  .filter((command) => command !== 'node --check postbuild-tests/v330-postbuild.test.mjs');
for (const command of [
  'node --check netlify/functions/lib/besiktas-keos-imar-parser.mjs',
  'node --check postbuild-tests/v340-postbuild.test.mjs'
]) {
  if (!checkCommands340.includes(command)) checkCommands340.push(command);
}
packageJson340.scripts.check = [...new Set(checkCommands340)].join(' && ');
await writeFile('package.json', `${JSON.stringify(packageJson340, null, 2)}\n`);
await rm('postbuild-tests/v330-postbuild.test.mjs', { force: true });

const wrangler340 = (await readFile('wrangler.toml', 'utf8'))
  .replace(/^PLAN_AI_AUTO_ENABLED\s*=.*(?:\r?\n|$)/gm, '')
  .replace('OPEN_OFFICIAL_SOURCE_TOTAL_BUDGET_MS = "16000"', 'OPEN_OFFICIAL_SOURCE_TOTAL_BUDGET_MS = "9000"')
  .replace(
    'PLAN_AI_TIMEOUT_MS = "24000"',
    'PLAN_AI_TIMEOUT_MS = "24000"\nPLAN_AI_AUTO_ENABLED = "false"'
  );
await writeFile('wrangler.toml', wrangler340);

console.log('Planlamasyon v3.5.0 güvenli belge okuma ve hızlı karar sürümü uygulandı.');
