import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  BESIKTAS_KEOS_IMAR_PARSER_VERSION,
  isBesiktasKeosOfficialResultUrl,
  parseBesiktasKeosImarHtml
} from '../netlify/functions/lib/besiktas-keos-imar-parser.mjs';
import { resolveZoning } from '../netlify/functions/lib/zoning-client.mjs';

const fixtureUrl = new URL('./fixtures/besiktas-imar-816-35.html', import.meta.url);
const officialUrl = 'https://keos.besiktas.bel.tr/imardurumu/imar.aspx?parselid=2867';
const userEvidence = Object.freeze({ origin: 'user-upload', userConfirmedOfficialSource: true });

async function fixture() {
  return readFile(fixtureUrl, 'utf8');
}

function resultHtml({ block = '101', parcel = '22', hiddenBlock = block, hiddenParcel = parcel } = {}) {
  const row = (label, value) => `<div class="divTableRow"><div class="divTableCell divTableCellLabel">${label}</div><div class="divTableCell divTableContent">${value}</div></div>`;
  return `<!doctype html><html lang="tr"><head><title>T.C. Beşiktaş Belediyesi - İmar Durumu</title></head><body>
    <div id="htmlOutput">${[
      row('Ada/Parsel', `${block} / ${parcel}`),
      row("Mer'i İmar Planı", 'ÖRNEK UYGULAMA İMAR PLANI'),
      row('Fonksiyon', 'Ticaret + Konut Alanı'),
      row('Ölçek', '1 / 1000'),
      row('Tasdik Tarihi', '31.12.2024 00:00:00'),
      row('Bina Yüksekliği', '15,50 m'),
      row('T.A.K.S', '%30'),
      row('K.A.K.S (Emsal)', '1,80 (1,80)'),
      row('Kat Adedi', '5 Kat'),
      row('İnşaat Nizamı', 'AYRIK NİZAM'),
      row('Ön Bahçe', '5,00 m'),
      row('Yan Bahçe', '3 m'),
      row('Arka Bahçe', '3.00')
    ].join('')}</div>
    <span id="lblAda">${hiddenBlock}</span><span id="lblParsel">${hiddenParcel}</span>
  </body></html>`;
}

test('Beşiktaş 816/35 gerçek yapı fikstüründen doğrulanabilen alanları okur', async () => {
  const parsed = parseBesiktasKeosImarHtml({
    html: await fixture(),
    expected: { block: '816', parcel: '35' },
    sourceUrl: officialUrl,
    evidence: userEvidence
  });

  assert.equal(BESIKTAS_KEOS_IMAR_PARSER_VERSION, '3.4.0');
  assert.equal(parsed.status, 'matched');
  assert.equal(parsed.canApply, true);
  assert.deepEqual(parsed.detectedParcel, { block: '816', parcel: '35' });
  assert.equal(parsed.parcelMatch.status, 'exact');
  assert.equal(parsed.fields.planName, 'BEŞİKTAŞ – DİKİLİTAŞ – BALMUMCU UYGULAMA İMAR PLANI');
  assert.equal(parsed.fields.landUse, 'Konut Alanı');
  assert.equal(parsed.fields.planScale, '1/1000');
  assert.equal(parsed.fields.planDate, '2007-08-09');
  assert.equal(parsed.fields.hmax, 12.5);
  assert.equal(parsed.fields.taks, null);
  assert.equal(parsed.fields.emsal, null);
  assert.equal(parsed.fields.floors, null);
  assert.equal(parsed.fields.buildingOrder, null);
  assert.equal(parsed.fields.frontSetback, null);
  assert.equal(parsed.fields.sideSetback, null);
  assert.equal(parsed.fields.rearSetback, null);
  assert.equal(parsed.record.source.url, officialUrl);
  assert.equal(parsed.record.source.trust, 'user-evidence');
  assert.equal(parsed.record.source.retrievalMode, 'user-provided-html');
  assert.equal(parsed.record.source.evidenceOrigin, 'user-upload');
  assert.match(parsed.warnings[0], /bilgi amaçlıdır/i);
});

test('sorgulanan parsel sonuç satırıyla eşleşmezse hiçbir imar alanı döndürmez', async () => {
  const parsed = parseBesiktasKeosImarHtml({
    html: await fixture(),
    expected: { block: '816', parcel: '36' },
    sourceUrl: officialUrl,
    evidence: userEvidence
  });

  assert.equal(parsed.status, 'parcel-mismatch');
  assert.equal(parsed.canApply, false);
  assert.equal(parsed.fields, null);
  assert.equal(parsed.record, null);
  assert.deepEqual(parsed.detectedParcel, { block: '816', parcel: '35' });
});

test('sonuç satırı ve gizli parsel alanı çelişirse veri uygulanmaz', () => {
  const parsed = parseBesiktasKeosImarHtml({
    html: resultHtml({ block: '101', parcel: '22', hiddenParcel: '23' }),
    expected: { block: '101', parcel: '22' },
    sourceUrl: officialUrl,
    evidence: userEvidence
  });

  assert.equal(parsed.status, 'ambiguous-parcel');
  assert.equal(parsed.canApply, false);
  assert.equal(parsed.fields, null);
  assert.equal(parsed.record, null);
});

test('dolu yapılaşma satırlarını ortak Planlamasyon alanlarına güvenli biçimde çevirir', () => {
  const parsed = parseBesiktasKeosImarHtml({
    html: resultHtml(),
    query: { block: '101', parcel: '22' },
    sourceUrl: officialUrl,
    evidence: { origin: 'user-paste', userConfirmedOfficialSource: true }
  });

  assert.equal(parsed.status, 'matched');
  assert.deepEqual({
    landUse: parsed.fields.landUse,
    planScale: parsed.fields.planScale,
    planDate: parsed.fields.planDate,
    hmax: parsed.fields.hmax,
    taks: parsed.fields.taks,
    emsal: parsed.fields.emsal,
    floors: parsed.fields.floors,
    buildingOrder: parsed.fields.buildingOrder,
    frontSetback: parsed.fields.frontSetback,
    sideSetback: parsed.fields.sideSetback,
    rearSetback: parsed.fields.rearSetback
  }, {
    landUse: 'Ticaret + Konut Alanı',
    planScale: '1/1000',
    planDate: '2024-12-31',
    hmax: 15.5,
    taks: 0.3,
    emsal: 1.8,
    floors: 5,
    buildingOrder: 'Ayrık',
    frontSetback: 5,
    sideSetback: 3,
    rearSetback: 3
  });
});

test('script içine yazılmış ada/parsel ifadesi sonuç eşleşmesi sayılmaz', () => {
  const html = '<!doctype html><html><head><title>T.C. Beşiktaş Belediyesi - İmar Durumu</title><script>Ada/Parsel 101 / 22</script></head><body><div id="htmlOutput"></div></body></html>';
  const parsed = parseBesiktasKeosImarHtml({ html, expected: { block: '101', parcel: '22' }, evidence: userEvidence });
  assert.equal(parsed.status, 'parcel-not-found');
  assert.equal(parsed.record, null);
});

test('yalnız resmî HTTPS Beşiktaş sonuç URL adresi kaynak olarak kabul edilir', () => {
  assert.equal(isBesiktasKeosOfficialResultUrl(officialUrl), true);
  assert.equal(isBesiktasKeosOfficialResultUrl('http://keos.besiktas.bel.tr/imardurumu/imar.aspx?parselid=2867'), false);
  assert.equal(isBesiktasKeosOfficialResultUrl('https://evil.example/?next=keos.besiktas.bel.tr'), false);
  assert.equal(isBesiktasKeosOfficialResultUrl('https://user:pass@keos.besiktas.bel.tr/imardurumu/imar.aspx'), false);

  const parsed = parseBesiktasKeosImarHtml({
    html: resultHtml(),
    expected: { block: '101', parcel: '22' },
    sourceUrl: 'https://evil.example/imar.aspx',
    evidence: userEvidence
  });
  assert.equal(parsed.status, 'matched');
  assert.equal(parsed.source.url, null);
});

test('ada veya parsel eksikse HTML içeriği ayrıştırılmaz', async () => {
  const parsed = parseBesiktasKeosImarHtml({ html: await fixture(), expected: { block: '816' }, evidence: userEvidence });
  assert.equal(parsed.status, 'invalid-query');
  assert.equal(parsed.record, null);
  assert.equal(parsed.fields, null);
});

test('kullanıcı kaynağı ve açık onay olmadan HTML ayrıştırılmaz', async () => {
  const html = await fixture();
  for (const evidence of [
    undefined,
    { origin: 'automatic-scan', userConfirmedOfficialSource: true },
    { origin: 'user-upload', userConfirmedOfficialSource: false },
    { origin: 'user-paste' }
  ]) {
    const parsed = parseBesiktasKeosImarHtml({
      html,
      expected: { block: '816', parcel: '35' },
      sourceUrl: officialUrl,
      evidence
    });
    assert.equal(parsed.status, 'permission-required');
    assert.equal(parsed.canApply, false);
    assert.equal(parsed.fields, null);
    assert.equal(parsed.record, null);
  }
});

test('Beşiktaş manual-only akışı korumalı portala istek atmadan hızlı yönlendirme döndürür', async (t) => {
  const zoningSource = await readFile(new URL('../netlify/functions/lib/zoning-client.mjs', import.meta.url), 'utf8');
  if (!zoningSource.includes('manualOnlySourceScan')) {
    t.skip('Bu sözleşme v3.4 postbuild yükseltmesinden sonra doğrulanır.');
    return;
  }
  let networkCalls = 0;
  const parcel = {
    type: 'Feature',
    geometry: { type: 'Polygon', coordinates: [[[28.99917, 41.04842], [28.99943, 41.04822], [28.99949, 41.04831], [28.99917, 41.04842]]] },
    properties: { province: 'İstanbul', district: 'Beşiktaş', neighbourhood: 'Muradiye', neighbourhoodId: 147951, block: '816', parcel: '35', area: 338 }
  };
  const result = await resolveZoning({
    parcel,
    query: { province: 'İstanbul', district: 'Beşiktaş', neighbourhood: 'Muradiye', neighbourhoodId: 147951, block: '816', parcel: '35' },
    env: {
      PUBLIC_PLAN_COVERAGE_ENABLED: 'false',
      PUBLIC_PLAN_RECORD_DISCOVERY_ENABLED: 'false',
      MUNICIPALITY_EDEVLET_DISCOVERY_ENABLED: 'false',
      MUNICIPALITY_PROVIDER_CACHE_DISABLED: 'true',
      OPEN_OFFICIAL_SOURCE_CACHE_DISABLED: 'true',
      PLAN_AI_AUTO_ENABLED: 'false'
    },
    fetchImpl: async () => {
      networkCalls += 1;
      throw new Error('Manual-only akışında ağ çağrısı yapılmamalı.');
    }
  });

  assert.equal(networkCalls, 0);
  assert.equal(result.status, 'manual-only');
  assert.equal(result.providerDiscovery.municipalService.id, 'istanbul-besiktas-imar-durumu');
  assert.equal(result.sourceScan.status, 'manual-only');
  assert.equal(result.sourceScan.attemptedCount, 1);
  assert.equal(result.sourceScan.attempts[0].status, 'manual-only');
  assert.match(result.planAi.message, /otomatik beklenmedi/i);
});
