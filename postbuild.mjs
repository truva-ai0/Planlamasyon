import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

async function replaceRequired(file, replacements) {
  let text = await readFile(file, 'utf8');
  for (const [from, to] of replacements) {
    if (!text.includes(from)) throw new Error(`${file}: beklenen bölüm bulunamadı: ${from.slice(0, 90)}`);
    text = text.replace(from, to);
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
  ['}, { signal: controller.signal, timeoutMs: 25_000 });', '}, { signal: controller.signal, timeoutMs: 55_000 });'],
  ["{ timeoutMs: 15_000 });", "{ timeoutMs: 35_000 });"],
  ['Bu arsaya yaklaşık kaç metrekare inşaat yapılabilir?', 'Bu parselde yaklaşık kaç metrekare inşaat yapılabilir?'],
  ['Bu arsada neler yapılabilir, kısa anlatır mısın?', 'Bu parselde neler yapılabilir, kısa anlatır mısın?'],
  ['Örn. Bu arsaya kaç kat yapılabilir?', 'Örn. Bu parselde kaç kat yapılabilir?']
]);

await replaceRequired('dist/index.html', [
  ['<h2 id="resultTitle">Arsanız hakkında</h2>', '<h2 id="resultTitle">Parseliniz hakkında</h2>']
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
  ['        19_000,', '        45_000,'],
  ['        6_000,', '        20_000,'],
  ['İmar analizi 19 saniyelik süre sınırına ulaştı.', 'İmar analizi güvenli süre sınırına ulaştı.'],
  ['Yakın çevre servisi 6 saniye içinde yanıt vermedi;', 'Yakın çevre servisi süre içinde yanıt vermedi;']
]);

const css = await readFile('dist/styles.css', 'utf8');
await writeFile('dist/styles.css', `${css}\n
/* v3.2.8 mobile reliability */
@media(max-width:900px){
  .side-drawer{left:8px;right:8px;top:auto;bottom:8px;width:auto;max-height:calc(100dvh - 16px);border-radius:24px}
  .drawer-head{height:68px;padding:0 16px}
  .drawer-content{height:auto;max-height:calc(100dvh - 84px);overflow:auto;padding:16px}
  .plan-ai-chat{align-content:start;gap:12px}
  .plan-ai-chat textarea{min-height:92px}
  .plan-ai-chat-answer{max-height:32dvh;overflow:auto}
}
@media(max-width:640px){
  .map-shell{height:360px;min-height:360px}
  .leaflet-container{min-height:360px}
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
    .replaceAll('v3\\.2\\.7', 'v3\\.2\\.8')
    .replaceAll('3.2.7', '3.2.8');
  await writeFile(file, text);
}

await mkdir('postbuild-tests', { recursive: true });
await writeFile('postbuild-tests/v328-postbuild.test.mjs', `
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('v3.2.8 mobil harita ve istemci süreleri uygulandı', async () => {
  const app = await readFile('dist/app.js', 'utf8');
  assert.ok(app.includes('osm.addTo(map)'));
  assert.match(app, /refreshParcelMap/);
  assert.match(app, /timeoutMs: 55_000/);
  assert.match(app, /timeoutMs: 35_000/);
});

test('v3.2.8 canlı servis bütçeleri ve mobil panel uygulandı', async () => {
  const analyze = await readFile('netlify/functions/analyze.mjs', 'utf8');
  const css = await readFile('dist/styles.css', 'utf8');
  assert.match(analyze, /OPEN_OFFICIAL_SOURCE_TOTAL_BUDGET_MS: 16000/);
  assert.match(analyze, /PLAN_AI_TIMEOUT_MS: 24000/);
  assert.match(analyze, /45_000/);
  assert.match(css, /v3\.2\.8 mobile reliability/);
  assert.match(css, /max-width:900px/);
});
`);

console.log('Planlamasyon v3.2.8 post-build düzeltmeleri uygulandı.');
