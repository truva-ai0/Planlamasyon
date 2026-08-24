import { readFile, writeFile, readdir, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';

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

const css = await readFile('dist/styles.css', 'utf8');
await writeFile('dist/styles.css', `${css}\n
/* v3.2.9 truthful results, compact sources and mobile Plan AI */
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
    .replaceAll('https://e-plan.gov.tr/e-plan/html/imarDurumu.html', 'https://eplan.csb.gov.tr/')
    .replaceAll('https://e-plan.gov.tr/', 'https://eplan.csb.gov.tr/')
    .replaceAll('v3\\.2\\.7', 'v3\\.2\\.9')
    .replaceAll('v3\\.2\\.8', 'v3\\.2\\.9')
    .replaceAll('3.2.7', '3.2.9')
    .replaceAll('3.2.8', '3.2.9');
  await writeFile(file, text);
}

const packageJson = JSON.parse(await readFile('package.json', 'utf8'));
packageJson.version = '3.2.9';
await writeFile('package.json', `${JSON.stringify(packageJson, null, 2)}\n`);

await mkdir('postbuild-tests', { recursive: true });
await rm('postbuild-tests/v328-postbuild.test.mjs', { force: true });
await writeFile('postbuild-tests/v329-postbuild.test.mjs', `
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('v3.2.9 mobil harita ve istemci süreleri korundu', async () => {
  const app = await readFile('dist/app.js', 'utf8');
  assert.ok(app.includes('osm.addTo(map)'));
  assert.match(app, /refreshParcelMap/);
  assert.match(app, /timeoutMs: 65_000/);
  assert.match(app, /timeoutMs: 35_000/);
});

test('v3.2.9 canlı servis bütçeleri ve Plan AI alt paneli uygulandı', async () => {
  const analyze = await readFile('netlify/functions/analyze.mjs', 'utf8');
  const css = await readFile('dist/styles.css', 'utf8');
  const app = await readFile('dist/app.js', 'utf8');
  assert.match(analyze, /OPEN_OFFICIAL_SOURCE_TOTAL_BUDGET_MS: 16000/);
  assert.match(analyze, /PLAN_AI_TIMEOUT_MS: 24000/);
  assert.match(analyze, /60_000/);
  assert.match(css, /v3\.2\.9 truthful results/);
  assert.match(css, /max-width:1100px/);
  assert.match(css, /\.side-drawer\.is-plan-ai/);
  assert.match(css, /max-height:90dvh/);
  assert.match(app, /classList\.toggle\\('is-plan-ai'/);
  assert.match(app, /classList\.remove\\('is-plan-ai'/);
});

test('v3.2.9 doğrulanmayan imar için yanıltıcı kullanım ve ruhsat kartı üretmez', async () => {
  const html = await readFile('dist/index.html', 'utf8');
  const app = await readFile('dist/app.js', 'utf8');
  assert.doesNotMatch(html, /Bu arsada neler yapabilirsiniz/);
  assert.doesNotMatch(html, /Bu arsada bina yapmak/);
  assert.match(html, /id="possibilityTitle"/);
  assert.match(html, /id="roadmapTitle"/);
  assert.match(app, /function hasVerifiedZoning/);
  assert.match(app, /Yapılaşma izni bulunmuş değildir/);
  assert.match(app, /Bu parselde yapı yapılabileceği henüz doğrulanmadı/);
  assert.match(app, /mezarlık/i);
});

test('v3.2.9 kaynakları tekilleştirir ve ayrıntıları kapalı tutar', async () => {
  const html = await readFile('dist/index.html', 'utf8');
  const app = await readFile('dist/app.js', 'utf8');
  assert.match(app, /function normalizedDisplayKey/);
  assert.match(app, /function dedupeDisplayItems/);
  assert.match(app, /const actions = dedupeDisplayItems/);
  assert.match(app, /const uniqueSources = dedupeDisplayItems/);
  assert.match(html, /<details class="card official-services-card compact-details"/);
  assert.match(html, /<details class="card source-card compact-details"/);
});

test('v3.2.9 Cloudflare hesap durumunu doğru algılar ve yerel kayıt uyarısı gösterir', async () => {
  const app = await readFile('dist/app.js', 'utf8');
  const worker = await readFile('src/worker.js', 'utf8');
  assert.match(app, /ACCOUNT_SYNC_DISABLED/);
  assert.match(app, /Kayıtlar yalnız bu cihazda saklanıyor/);
  assert.match(app, /Bu cihazda saklanıyor/);
  assert.match(app, /content-type/);
  assert.match(worker, /ACCOUNT_SYNC_DISABLED/);
});

test('v3.2.9 sürümü ve önbellek anahtarları tek sürümdür', async () => {
  const html = await readFile('dist/index.html', 'utf8');
  const pkg = JSON.parse(await readFile('package.json', 'utf8'));
  assert.equal(pkg.version, '3.2.9');
  assert.match(html, /styles\.css\\?v=3\.2\.9/);
  assert.match(html, /app\.js\\?v=3\.2\.9/);
  assert.match(html, /PLANLAMASYON · v3\.2\.9/);
  assert.doesNotMatch(html, /3\.2\.8/);
});
`);

console.log('Planlamasyon v3.2.9 post-build düzeltmeleri uygulandı.');
