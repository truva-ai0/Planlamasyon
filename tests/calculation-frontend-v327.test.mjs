import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  mergeComplementaryZoningRecords,
  shouldUseManualOnlyStatus
} from '../netlify/functions/lib/zoning-client.mjs';
import { buildAnalysisEnv } from '../netlify/functions/analyze.mjs';
import { buildParcelAnalysis } from '../netlify/functions/lib/analysis-core.mjs';

function source(id, trust = 'verified') {
  return { id, title: `Kaynak ${id}`, provider: 'Yetkili idare', trust, url: `https://example.gov.tr/${id}` };
}

test('v3.5.0 çelişmeyen resmî kayıtların tamamlayıcı alanlarını ve alan kaynaklarını birleştirir', () => {
  const primary = {
    fields: { landUse: 'Konut Alanı', taks: 0.3, planName: 'Uygulama İmar Planı' },
    source: source('belediye')
  };
  const complementary = {
    fields: { landUse: 'Konut Alanı', emsal: 1.5, floors: 5, frontSetback: 5, sideSetback: 3, rearSetback: 3 },
    source: source('eplan', 'ai-assisted-official')
  };
  const result = mergeComplementaryZoningRecords([primary, complementary], primary);
  assert.equal(result.fields.taks, 0.3);
  assert.equal(result.fields.emsal, 1.5);
  assert.equal(result.fields.floors, 5);
  assert.equal(result.fields.frontSetback, 5);
  assert.equal(result.fieldSources.taks.id, 'belediye');
  assert.equal(result.fieldSources.emsal.id, 'eplan');
  assert.deepEqual(result.conflictFields, []);
});

test('v3.5.0 farklı dolu değerleri sessizce ezmek yerine çelişkili bırakır', () => {
  const first = { fields: { taks: 0.3, allowances: { pool: 'allowed' } }, source: source('a') };
  const second = { fields: { taks: 0.4, allowances: { pool: 'prohibited' } }, source: source('b') };
  const result = mergeComplementaryZoningRecords([first, second], first);
  assert.equal(result.fields.taks, null);
  assert.equal(result.fields.allowances.pool, 'unknown');
  assert.ok(result.conflictFields.includes('taks'));
  assert.ok(result.conflictFields.includes('allowances.pool'));
});

test('farklı plan kimliği taşıyan kayıtların tamamlayıcı hakları birbirine karıştırılmaz', () => {
  const currentPlan = { fields: { planName: 'A Planı', planNumber: '2026/1', taks: 0.3 }, source: source('a') };
  const otherPlan = { fields: { planName: 'B Planı', planNumber: '2025/9', emsal: 1.5 }, source: source('b') };
  const result = mergeComplementaryZoningRecords([currentPlan, otherPlan], currentPlan);
  assert.equal(result.fields.taks, 0.3);
  assert.equal(result.fields.emsal, null);
  assert.ok(result.conflictFields.includes('planName'));
  assert.ok(result.conflictFields.includes('planNumber'));
});

test('birleşen doğrulanmış değerler oturum, emsale esas alan, dış alan ve seçenekleri üretir', () => {
  const primary = {
    fields: { landUse: 'Konut Alanı', taks: 0.3, allowances: { pool: 'conditional' } },
    source: source('belediye')
  };
  const complementary = {
    fields: { landUse: 'Konut Alanı', emsal: 1.5, floors: 5 },
    source: source('eplan')
  };
  const merged = mergeComplementaryZoningRecords([primary, complementary], primary);
  const analysis = buildParcelAnalysis({
    parcel: {
      type: 'Feature', geometry: { type: 'Polygon', coordinates: [] },
      properties: { area: 1000, province: 'İstanbul', district: 'Şişli', block: '1', parcel: '2' }
    },
    zoning: { status: 'verified', conflict: false, fields: merged.fields, sources: [primary.source, complementary.source] },
    environment: { status: 'unavailable', categories: [], items: [] }
  });
  assert.equal(analysis.metrics.floors.value, 5);
  assert.equal(analysis.metrics.footprint.value, 300);
  assert.equal(analysis.metrics.construction.value, 1500);
  assert.equal(analysis.metrics.outside.value, 700);
  assert.equal(analysis.possibilities.find((item) => item.key === 'housing').status, 'conditional');
  assert.equal(analysis.possibilities.find((item) => item.key === 'pool').status, 'conditional');
});

test('manual-only sonuç TAKS/emsal/kat tahmini ve yapılaşma hesabı üretmez', () => {
  const analysis = buildParcelAnalysis({
    parcel: {
      type: 'Feature', geometry: { type: 'Polygon', coordinates: [] },
      properties: { area: 1000, province: 'İstanbul', district: 'Şişli', block: '1', parcel: '2' }
    },
    zoning: { status: 'manual-only', manualOnly: true, conflict: false, fields: {}, sources: [] },
    environment: { status: 'unavailable', categories: [], items: [] }
  });
  assert.equal(analysis.status, 'cadastral-only');
  assert.equal(analysis.metrics.floors.value, null);
  assert.equal(analysis.metrics.footprint.value, null);
  assert.equal(analysis.metrics.construction.value, null);
  assert.equal(analysis.metrics.outside.value, null);
  assert.ok(analysis.possibilities.every((item) => item.status === 'unknown'));
});

test('v3.5.0 resmî portal bağlantısı olup otomatik değer yoksa manual-only yolu tanınır', () => {
  assert.equal(shouldUseManualOnlyStatus({ actions: [{ url: 'https://belediye.gov.tr/imar', kind: 'municipality-portal', accessMode: 'public-portal' }] }), true);
  assert.equal(shouldUseManualOnlyStatus({ actions: [{ url: 'https://belediye.gov.tr/wfs', kind: 'municipality-geodata', accessMode: 'open-data' }] }), false);
});

test('forceRefresh bütün imar kaynak önbelleklerini bu istek için devre dışı bırakır', () => {
  const normal = buildAnalysisEnv({ PLAN_AI_CACHE_DISABLED: 'false' }, false, { OPEN_OFFICIAL_SOURCE_CACHE_DISABLED: 'false' });
  assert.equal(normal.PLAN_AI_CACHE_DISABLED, 'false');
  const forced = buildAnalysisEnv({}, true, {});
  for (const key of [
    'OPEN_OFFICIAL_SOURCE_CACHE_DISABLED', 'PLAN_AI_CACHE_DISABLED', 'MUNICIPALITY_PROVIDER_CACHE_DISABLED',
    'PUBLIC_PLAN_COVERAGE_CACHE_DISABLED', 'PUBLIC_PLAN_RECORD_CACHE_DISABLED', 'ZONING_CONNECTOR_CACHE_DISABLED'
  ]) assert.equal(forced[key], 'true', `${key} forceRefresh sırasında true olmalı`);
});

test('mobil arayüzde gerçek yeniden tarama ve Plan AI sınırlı-mod akışı bulunur', async () => {
  const [app, index, styles] = await Promise.all([
    readFile(new URL('../dist/app.js', import.meta.url), 'utf8'),
    readFile(new URL('../dist/index.html', import.meta.url), 'utf8'),
    readFile(new URL('../dist/styles.css', import.meta.url), 'utf8')
  ]);
  assert.match(index, /id="retrySourceScanButton"/);
  assert.match(index, /Kalan Kaynakları Yeniden Tara/);
  assert.match(app, /forceRefresh\s*\}/);
  assert.match(app, /buildPlanAiFallbackAnswer/);
  assert.match(app, /Sınırlı açıklama modu/);
  assert.match(app, /'manual-only': 'Resmî sayfada açılmalı'/);
  assert.match(app, /attempts\.every\(\(item\) => item\?\.status === 'manual-only'\)/);
  assert.match(app, /result\.notice \|\| 'Mevcut doğrulanmış sonuç özetlendi'/);
  assert.doesNotMatch(app, /result\.notice\s*\|\|\s*result\.errorCode/);
  assert.match(app, /Sınırlı mod ·/);
  assert.match(app, /state\.analysisAbort !== controller/);
  assert.match(styles, /source-scan-actions/);
  assert.match(index, /v3\.7\.0/);
});
