
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
  assert.match(css, /v3.3.0 nationwide official routing/);
  assert.match(css, /max-width:1100px/);
  assert.match(css, /.side-drawer.is-plan-ai/);
  assert.match(css, /max-height:90dvh/);
  assert.match(app, /classList.toggle\('is-plan-ai'/);
  assert.match(app, /classList.remove\('is-plan-ai'/);
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
  assert.match(app, /searchParams.entries/);
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
  assert.match(provider, /site:bel.tr OR site:gov.tr/);
  assert.match(provider, /canonicalUrlKey/);
  assert.match(provider, /blockedHostname/);
  assert.match(provider, /automaticDataClaim: false/);
});

test('v3.3.0 ticari veri yetkisini doğru açıklar ve resmî doğrudan linkleri kullanır', async () => {
  const html = await readFile('dist/index.html', 'utf8');
  const app = await readFile('dist/app.js', 'utf8');
  assert.match(html, /yalnız açık veya izinli kaynakları otomatik okur/);
  assert.match(app, /TAKPAS ve ilgili kurum yetkileri gerekir/);
  assert.match(html, /eplan.csb.gov.tr\/e-plan\/html\/imarDurumu.html/);
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
  assert.match(html, /styles.css\?v=3.3.0/);
  assert.match(html, /app.js\?v=3.3.0/);
  assert.match(html, /PLANLAMASYON · v3.3.0/);
  assert.doesNotMatch(html, /3.2.[789]/);
});
