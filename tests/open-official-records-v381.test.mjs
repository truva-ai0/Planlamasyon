import test from 'node:test';
import assert from 'node:assert/strict';

import { buildParcelAnalysis } from '../netlify/functions/lib/analysis-core.mjs';
import { discoverOpenOfficialZoning } from '../netlify/functions/lib/open-official-source-client.mjs';
import {
  EMBEDDED_OPEN_OFFICIAL_ZONING_RECORDS,
  matchOpenOfficialZoningRecords,
  OPEN_OFFICIAL_ZONING_RECORD_VERSION
} from '../netlify/functions/lib/open-official-zoning-records.mjs';
import { resolveZoning } from '../netlify/functions/lib/zoning-client.mjs';

function arnavutkoyParcel(area = 111) {
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [28.731, 41.189] },
    properties: {
      province: 'İstanbul', district: 'Arnavutköy', neighbourhood: 'Taşoluk',
      neighbourhoodId: 'fixture-tasoluk', block: '6597', parcel: '2',
      area, areaText: `${area} m²`, quality: 'Arsa'
    }
  };
}

const notFoundFetch = async () => new Response('', {
  status: 404,
  headers: { 'content-type': 'text/plain; charset=utf-8' }
});

test('v3.8.1 gömülü açık resmî kayıt yalnız tam parsel ve alan eşleşmesinde uygulanır', () => {
  assert.equal(OPEN_OFFICIAL_ZONING_RECORD_VERSION, '2026-08-27-v3.8.1');
  assert.ok(EMBEDDED_OPEN_OFFICIAL_ZONING_RECORDS.length >= 1);

  const matches = matchOpenOfficialZoningRecords({
    parcel: arnavutkoyParcel(),
    query: arnavutkoyParcel().properties
  });
  assert.equal(matches.length, 1);
  assert.equal(matches[0].fields.landUse, 'Konut Alanı');
  assert.equal(matches[0].fields.emsal, 0.95);
  assert.equal(matches[0].fields.floors, 3);
  assert.equal(matches[0].fields.hmax, null, '3 kat bilgisi metre yüksekliği gibi kullanılmamalı');
  assert.equal(matches[0].source.parcelMatchStatus, 'exact');
  assert.equal(matches[0].source.currentness, 'unclear');
  assert.match(matches[0].source.url, /^https:\/\/www\.ilan\.gov\.tr\//);

  assert.equal(matchOpenOfficialZoningRecords({ parcel: arnavutkoyParcel(140) }).length, 0, 'belirgin alan uyuşmazlığı eski/yanlış parsel riskinde kaydı durdurmalı');
  assert.equal(matchOpenOfficialZoningRecords({
    parcel: { ...arnavutkoyParcel(), properties: { ...arnavutkoyParcel().properties, parcel: '3' } }
  }).length, 0);

  const configuredBase = {
    province: 'İstanbul', district: 'Arnavutköy', neighbourhood: 'Taşoluk', block: '6597', parcel: '2',
    fields: { emsal: 9.9 }, fieldEvidence: { emsal: { value: 9.9, excerpt: 'Emsal 9.9' } }
  };
  assert.equal(matchOpenOfficialZoningRecords({
    parcel: arnavutkoyParcel(),
    configuredRecords: [{ ...configuredBase, sourceUrl: 'https://example.com/sahte' }]
  }).length, 1, 'resmî olmayan yapılandırılmış kayıt reddedilir; yalnız gömülü resmî kayıt kalır');
  assert.equal(matchOpenOfficialZoningRecords({
    parcel: { ...arnavutkoyParcel(), properties: { ...arnavutkoyParcel().properties, block: '7000' } },
    configuredRecords: [{ ...configuredBase, block: '7000', sourceUrl: 'https://acik.arnavutkoy.bel.tr/kayit', fieldEvidence: {} }]
  }).length, 0, 'alan kanıtı olmayan yapılandırılmış teknik değer uygulanmamalı');
});

test('v3.8.1 açık kaynak taraması resmî ada/parsel kaydını kullanıcı belgesi olmadan bulur', async () => {
  const parcel = arnavutkoyParcel();
  const scan = await discoverOpenOfficialZoning({
    parcel,
    query: parcel.properties,
    providerDiscovery: { actions: [] },
    env: {
      OPEN_OFFICIAL_SOURCE_CACHE_DISABLED: 'true',
      OPEN_OFFICIAL_SOURCE_MAX_CANDIDATES: 4,
      OPEN_OFFICIAL_SOURCE_TOTAL_BUDGET_MS: 5000,
      OPEN_OFFICIAL_SOURCE_TIMEOUT_MS: 1000,
      OPEN_OFFICIAL_SOURCE_CONCURRENCY: 1
    },
    fetchImpl: notFoundFetch
  });

  assert.equal(scan.status, 'available');
  assert.equal(scan.foundRecordCount, 1);
  assert.equal(scan.records[0].fields.emsal, 0.95);
  assert.ok(scan.attempts.some((attempt) => attempt.kind === 'official-record' && attempt.status === 'found'));
});

test('v3.8.1 tam analiz 111 m² x 0,95 hesabını otomatik üretir ve güncellik uyarısını korur', async () => {
  const parcel = arnavutkoyParcel();
  const zoning = await resolveZoning({
    parcel,
    query: parcel.properties,
    env: {
      PUBLIC_PLAN_COVERAGE_ENABLED: 'false',
      PUBLIC_PLAN_RECORD_DISCOVERY_ENABLED: 'false',
      MUNICIPALITY_PROVIDER_CACHE_DISABLED: 'true',
      MUNICIPALITY_EDEVLET_DISCOVERY_ENABLED: 'false',
      OPEN_OFFICIAL_SOURCE_CACHE_DISABLED: 'true',
      OPEN_OFFICIAL_SOURCE_MAX_CANDIDATES: 4,
      OPEN_OFFICIAL_SOURCE_TOTAL_BUDGET_MS: 5000,
      OPEN_OFFICIAL_SOURCE_TIMEOUT_MS: 1000,
      OPEN_OFFICIAL_SOURCE_CONCURRENCY: 1,
      PLAN_AI_AUTO_ENABLED: 'false'
    },
    fetchImpl: notFoundFetch
  });

  assert.equal(zoning.status, 'verified');
  assert.equal(zoning.manualOnly, false);
  assert.equal(zoning.fields.landUse, 'Konut Alanı');
  assert.equal(zoning.fields.emsal, 0.95);
  assert.equal(zoning.fields.floors, 3);
  assert.equal(zoning.fieldSources.emsal.sourceClass, 'open-official-record');

  const analysis = buildParcelAnalysis({
    parcel,
    zoning,
    environment: { status: 'unavailable', categories: [], items: [] }
  });
  assert.equal(analysis.version, '3.8.1');
  assert.equal(analysis.parcel.quality, 'Arsa');
  assert.equal(analysis.metrics.floors.value, 3);
  assert.equal(analysis.metrics.construction.value, 105.45);
  assert.equal(analysis.metrics.construction.display, '105,45 m²');
  assert.match(analysis.explanation, /açık resmî kayıttan otomatik alınmıştır/i);
  assert.match(analysis.warnings.map((item) => item.text).join(' '), /kaynak belge tarihi açıkça doğrulanamadı/i);
});
