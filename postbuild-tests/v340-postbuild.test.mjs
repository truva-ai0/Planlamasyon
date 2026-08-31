import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { discoverMunicipalityProvider } from '../netlify/functions/lib/municipality-provider.mjs';

test('v3.5.0 kadastro kaydı ile imar hakkını açıkça ayırır', async () => {
  const html = await readFile('dist/index.html', 'utf8');
  const app = await readFile('dist/app.js', 'utf8');
  assert.match(html, /id="cadastralRecordCard"/);
  assert.match(html, /TKGM kaydındaki taşınmaz niteliği/);
  assert.match(html, /İmar hakkı değildir/);
  assert.match(html, /id="zoningRightsCard"/);
  assert.doesNotMatch(app, /plainExplanation\.textContent = analysis\.explanation/);
  assert.match(app, /function renderDecisionSummary/);
});

test('v3.5.0 mobil karar özeti ve doğrulanmayan metrikleri gizleme sözleşmesini taşır', async () => {
  const html = await readFile('dist/index.html', 'utf8');
  const app = await readFile('dist/app.js', 'utf8');
  const css = await readFile('dist/styles.css', 'utf8');
  assert.match(html, /id="mobileResultSummary"[^>]*aria-live="polite"/);
  assert.match(html, /id="mobileSummaryParcel"/);
  assert.match(html, /id="mobileSummaryZoning"/);
  assert.match(app, /summaryGrid\.hidden = !hasAnyMetric/);
  assert.match(css, /\.mobile-result-summary/);
  assert.match(css, /@media\(max-width:640px\)/);
});

test('v3.5.0 hızlı ilk faz otomatik Plan AI beklemez ve süreyi sınırlar', async () => {
  const analyze = await readFile('netlify/functions/analyze.mjs', 'utf8');
  const zoning = await readFile('netlify/functions/lib/zoning-client.mjs', 'utf8');
  const app = await readFile('dist/app.js', 'utf8');
  const wrangler = await readFile('wrangler.toml', 'utf8');
  assert.match(analyze, /OPEN_OFFICIAL_SOURCE_TOTAL_BUDGET_MS: 9000/);
  assert.match(analyze, /12_000/);
  assert.match(zoning, /PLAN_AI_AUTO_ENABLED/);
  assert.match(zoning, /manualOnlySourceScan/);
  assert.match(zoning, /7_000/);
  assert.match(app, /void analyzeCurrentParcel\(\)/);
  assert.match(app, /timeoutMs: 18_000/);
  assert.match(wrangler, /OPEN_OFFICIAL_SOURCE_TOTAL_BUDGET_MS = "9000"/);
  assert.equal((wrangler.match(/^PLAN_AI_AUTO_ENABLED\s*=/gm) || []).length, 1);
});

test('v3.5.0 harita tabanı iki sağlayıcı arasında sınırlı geçiş yapar ve yeniden denetir', async () => {
  const app = await readFile('dist/app.js', 'utf8');
  const html = await readFile('dist/index.html', 'utf8');
  assert.match(app, /tileerror/);
  assert.match(app, /handleBaseFailure/);
  assert.match(app, /mapBaseAutomaticSwitches < 2/);
  assert.match(app, /maxNativeZoom: 18/);
  assert.match(app, /maxNativeZoom: 19/);
  assert.match(app, /layer\.on\('tileload'/);
  assert.doesNotMatch(app, /setTimeout\(switchToImageryFallback/);
  assert.match(app, /mapBaseRetryButton/);
  assert.match(html, /id="mapBaseStatus"/);
});

test('v3.5.0 Beşiktaş yönlendirmesi manuel ve izin koşullarıyla kayıtlıdır', async () => {
  const provider = await readFile('netlify/functions/lib/municipality-provider.mjs', 'utf8');
  assert.match(provider, /istanbul-besiktas-imar-durumu/);
  assert.match(provider, /Beşiktaş Belediyesi/);
  assert.match(provider, /writtenPermissionRequired: true/);
  assert.match(provider, /automatedQueryAllowed: false/);
  assert.match(provider, /keos\.besiktas\.bel\.tr\/imardurumu\/legal\.aspx/);
});

test('v3.5.0 Beşiktaş yönlendirmesi hiçbir otomatik ağ çağrısı yapmaz', async () => {
  let networkCalls = 0;
  const result = await discoverMunicipalityProvider({
    query: { province: 'İstanbul', district: 'Beşiktaş', neighbourhood: 'Muradiye', block: '816', parcel: '35' },
    env: { MUNICIPALITY_PROVIDER_CACHE_DISABLED: 'true' },
    fetchImpl: async () => {
      networkCalls += 1;
      throw new Error('Bu testte ağ çağrısı yasaktır.');
    }
  });
  const service = result.municipalServices.find((item) => item.id === 'istanbul-besiktas-imar-durumu');
  assert.equal(networkCalls, 0);
  assert.equal(result.status, 'manual-only');
  assert.equal(service?.automatedQueryAllowed, false);
  assert.equal(service?.writtenPermissionRequired, true);
  assert.equal(service?.url, 'https://os.besiktas.bel.tr/');
  assert.equal(service?.termsUrl, 'https://keos.besiktas.bel.tr/imardurumu/legal.aspx');
});

test('v3.8.1 sürüm ve önbellek anahtarları tek sürümdür', async () => {
  const html = await readFile('dist/index.html', 'utf8');
  const pkg = JSON.parse(await readFile('package.json', 'utf8'));
  assert.equal(pkg.version, '3.8.1');
  assert.match(html, /styles\.css\?v=3\.8\.1/);
  assert.match(html, /app\.js\?v=3\.8\.1/);
  assert.match(html, /PLANLAMASYON · v3\.8\.1/);
});
