import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { discoverMunicipalityProvider } from '../netlify/functions/lib/municipality-provider.mjs';
import { discoverOpenOfficialZoning } from '../netlify/functions/lib/open-official-source-client.mjs';
import { mergeComplementaryZoningRecords } from '../netlify/functions/lib/zoning-client.mjs';

const noNetwork = async () => { throw new Error('Bu testte ağ çağrısı beklenmiyordu.'); };
const baseEnv = { MUNICIPALITY_PROVIDER_CACHE_DISABLED: 'true', MUNICIPALITY_EDEVLET_DISCOVERY_ENABLED: 'false' };

function parcel(overrides = {}) {
  return {
    type: 'Feature', geometry: { type: 'Point', coordinates: [29.12, 40.98] },
    properties: { province: 'Deneme', district: 'Örnek', neighbourhood: 'Merkez', block: '101', parcel: '22', ...overrides }
  };
}

function html(body, status = 200, url = '') {
  const response = new Response(body, { status, headers: { 'content-type': 'text/html; charset=utf-8' } });
  if (url) Object.defineProperty(response, 'url', { value: url });
  return response;
}

test('v3.6 büyükşehir, kırsal ilçe ve girişli hizmetler veri erişim türünü açıkça ayırır', async () => {
  const cases = [
    { query: { province: 'İstanbul', district: 'Beşiktaş' }, expected: 'public-manual' },
    { query: { province: 'Çanakkale', district: 'Bayramiç' }, expected: 'authenticated-official' },
    { query: { province: 'Ankara', district: 'Çankaya' }, expected: 'authenticated-official' },
    { query: { province: 'Van', district: 'İpekyolu' }, expected: 'public-manual' }
  ];
  for (const item of cases) {
    const result = await discoverMunicipalityProvider({ query: item.query, env: baseEnv, fetchImpl: noNetwork });
    assert.equal(result.municipalService?.sourceClass, item.expected, `${item.query.province}/${item.query.district}`);
    assert.equal(result.municipalService?.automatedQueryAllowed, false);
    assert.equal(result.municipalService?.dataClaim, 'not-read');
    assert.equal(result.automaticConnectorCount, 0);
  }
});

test('v3.6 e-Devlet dizin keşfi yalnız bağlantıyı bulur, kullanıcı sonucunu okunmuş saymaz ve GET bir kez yeniden denenir', async () => {
  let calls = 0;
  const result = await discoverMunicipalityProvider({
    query: { province: 'Deneme', district: 'Örnek' },
    env: { MUNICIPALITY_PROVIDER_CACHE_DISABLED: 'true', MUNICIPALITY_SOURCE_RETRY_COUNT: 1 },
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) return html('geçici hata', 503);
      return html('<a href="/ornek-belediyesi-imar-durum-sorgulama">Örnek Belediyesi İmar Durum Sorgulama</a>');
    }
  });
  assert.equal(calls, 2);
  assert.equal(result.municipalService?.sourceClass, 'authenticated-official');
  assert.equal(result.municipalService?.automationPolicy, 'routing-only');
  assert.equal(result.municipalService?.dataClaim, 'not-read');
  assert.equal(result.municipalService?.automatedQueryAllowed, false);
});

test('v3.6 belediye adaptörü açık yetki olmadan otomatik sağlayıcı sayılmaz', async () => {
  const connector = { id: 'deneme-adapter', province: 'Deneme', district: 'Örnek', title: 'Deneme İmar Adaptörü', url: 'https://imar-api.deneme.gov.tr/v1' };
  const unauthorized = await discoverMunicipalityProvider({
    query: { province: 'Deneme', district: 'Örnek' },
    env: { ...baseEnv, MUNICIPALITY_CONNECTORS_JSON: JSON.stringify([{ ...connector, authorized: false, automatedQueryAllowed: false }]) }, fetchImpl: noNetwork
  });
  assert.equal(unauthorized.configuredConnectorCount, 1);
  assert.equal(unauthorized.automaticConnectorCount, 0);
  assert.equal(unauthorized.authorizationRequiredConnectorCount, 1);
  const blocked = unauthorized.actions.find((item) => item.id === 'configured-deneme-adapter');
  assert.equal(blocked?.status, 'authorization-required');
  assert.equal(blocked?.dataClaim, 'not-read');

  const authorized = await discoverMunicipalityProvider({
    query: { province: 'Deneme', district: 'Örnek' },
    env: { ...baseEnv, MUNICIPALITY_CONNECTORS_JSON: JSON.stringify([{ ...connector, authorized: true, automatedQueryAllowed: true }]) }, fetchImpl: noNetwork
  });
  assert.equal(authorized.automaticConnectorCount, 1);
  assert.equal(authorized.actions.find((item) => item.id === 'configured-deneme-adapter')?.sourceClass, 'authorized-adapter');
});

test('v3.6 URL koruması özel ağ, kullanıcı bilgisi, farklı port ve izinsiz alan adını reddeder', async () => {
  const unsafe = [
    'https://127.0.0.1/imar', 'https://[::1]/imar', 'https://[::ffff:127.0.0.1]/imar', 'https://metadata.google.internal/imar',
    'https://kullanici:sifre@imar.deneme.gov.tr/', 'https://imar.deneme.gov.tr:8443/', 'https://api.vendor.example/imar'
  ].map((url, index) => ({ id: `unsafe-${index}`, province: 'Deneme', district: 'Örnek', url, authorized: true, automatedQueryAllowed: true }));
  const rejected = await discoverMunicipalityProvider({
    query: { province: 'Deneme', district: 'Örnek' }, env: { ...baseEnv, MUNICIPALITY_CONNECTORS_JSON: JSON.stringify(unsafe) }, fetchImpl: noNetwork
  });
  assert.equal(rejected.configuredConnectorCount, 0);
  assert.equal(rejected.automaticConnectorCount, 0);

  const allowlisted = await discoverMunicipalityProvider({
    query: { province: 'Deneme', district: 'Örnek' },
    env: {
      ...baseEnv, MUNICIPALITY_CONNECTOR_ALLOWED_HOSTS: 'api.vendor.example',
      MUNICIPALITY_CONNECTORS_JSON: JSON.stringify([{ id: 'vendor', province: 'Deneme', district: 'Örnek', url: 'https://api.vendor.example/imar', authorized: true, automatedQueryAllowed: true }])
    }, fetchImpl: noNetwork
  });
  assert.equal(allowlisted.automaticConnectorCount, 1);
});

test('v3.6 açık resmî salt-okunur GET geçici sunucu hatasında yalnız bir kez yeniden denenir', async () => {
  const sourceUrl = 'https://imar.deneme.gov.tr/result?ada=101&parsel=22';
  let calls = 0;
  const result = await discoverOpenOfficialZoning({
    parcel: parcel(), query: parcel().properties, providerDiscovery: { actions: [] },
    env: {
      OPEN_OFFICIAL_SOURCE_CACHE_DISABLED: 'true', OPEN_OFFICIAL_SOURCE_MAX_CANDIDATES: 1,
      OPEN_OFFICIAL_SOURCE_TOTAL_BUDGET_MS: 4000, OPEN_OFFICIAL_SOURCE_TIMEOUT_MS: 1800, OPEN_OFFICIAL_SOURCE_CONCURRENCY: 1,
      OPEN_OFFICIAL_ZONING_SOURCES_JSON: JSON.stringify([{
        id: 'retry-source', province: 'Deneme', district: 'Örnek', priority: 999,
        title: 'Deneme Belediyesi Açık Sonuç', provider: 'Deneme Belediyesi', url: sourceUrl,
        kind: 'portal', accessMode: 'read-only-result', readOnlyResult: true, verifiedAt: '2026-08-25', documentDate: '2026-08-24'
      }])
    },
    fetchImpl: async (url) => {
      assert.equal(String(url), sourceUrl);
      calls += 1;
      if (calls === 1) return html('geçici', 503, sourceUrl);
      return html('<div>Ada: 101</div><div>Parsel: 22</div><div>TAKS: 0,30</div><div>Emsal: 1,50</div>', 200, sourceUrl);
    }
  });
  assert.equal(calls, 2);
  assert.equal(result.status, 'available');
  assert.equal(result.records[0].source.sourceClass, 'open-machine-readable');
  assert.equal(result.records[0].source.documentDate, '2026-08-24');
  assert.equal(result.records[0].source.verifiedAt, '2026-08-25');
  assert.equal(result.records[0].source.fieldEvidence.taks.confidence, 'medium');
});

test('v3.6 özel ağ ve e-Devlet giriş bağlantısına açık kaynak taramasında istek yapılmaz', async () => {
  const forbidden = ['https://169.254.169.254/latest/meta-data', 'https://www.turkiye.gov.tr/giris'];
  const called = [];
  await discoverOpenOfficialZoning({
    parcel: parcel({ block: '102' }), query: { ...parcel().properties, block: '102' },
    providerDiscovery: { actions: [
      { id: 'private', title: 'Özel ağ', url: forbidden[0], kind: 'municipality-geodata', machineReadableCandidate: true },
      { id: 'login', title: 'e-Devlet', url: forbidden[1], kind: 'municipality-portal', accessMode: 'official-login-service', sourceClass: 'authenticated-official' }
    ] },
    env: { OPEN_OFFICIAL_SOURCE_CACHE_DISABLED: 'true', OPEN_OFFICIAL_SOURCE_MAX_CANDIDATES: 1, OPEN_OFFICIAL_SOURCE_TOTAL_BUDGET_MS: 3000, OPEN_OFFICIAL_SOURCE_TIMEOUT_MS: 1000, OPEN_OFFICIAL_SOURCE_CONCURRENCY: 1 },
    fetchImpl: async (url) => { called.push(String(url)); return html('', 404); }
  });
  assert.equal(called.some((url) => forbidden.includes(url)), false);
});

test('v3.6 alan bazlı kaynak tarih, güven ve erişim sınıfını birleştirmede kaybetmez', () => {
  const source = {
    id: 'official-101-22', title: 'Örnek Belediyesi İmar Durumu', provider: 'Örnek Belediyesi',
    url: 'https://imar.ornek.bel.tr/101-22', trust: 'verified', sourceClass: 'open-machine-readable',
    accessMode: 'read-only-result', automationPolicy: 'read-only', dataClaim: 'read-and-parcel-matched',
    documentDate: '2026-08-24', retrievedAt: '2026-08-25T03:00:00.000Z', verifiedAt: '2026-08-25',
    retrievalMode: 'read-only-get', scanVersion: '3.6.0', extractionConfidence: 'high',
    fieldEvidence: { taks: { confidence: 'high', excerpt: 'TAKS: 0,30', method: 'structured-json' } }
  };
  const merged = mergeComplementaryZoningRecords([{ fields: { taks: 0.3 }, source }]);
  assert.deepEqual(
    {
      sourceClass: merged.fieldSources.taks.sourceClass, documentDate: merged.fieldSources.taks.documentDate,
      retrievedAt: merged.fieldSources.taks.retrievedAt, verifiedAt: merged.fieldSources.taks.verifiedAt,
      confidence: merged.fieldSources.taks.confidence, method: merged.fieldSources.taks.method, dataClaim: merged.fieldSources.taks.dataClaim
    },
    {
      sourceClass: 'open-machine-readable', documentDate: '2026-08-24', retrievedAt: '2026-08-25T03:00:00.000Z',
      verifiedAt: '2026-08-25', confidence: 'high', method: 'structured-json', dataClaim: 'read-and-parcel-matched'
    }
  );
});

test('v3.6 genel kaynak manifesti erişim, güvenlik ve provenance politikalarını yayımlar', async () => {
  const routingText = await readFile(new URL('../official-source-routing.json', import.meta.url), 'utf8');
  const publicRoutingText = await readFile(new URL('../dist/data/official-source-routing.json', import.meta.url), 'utf8');
  const routing = JSON.parse(routingText);
  assert.deepEqual(JSON.parse(publicRoutingText), routing);
  assert.equal(routing.accessClasses['authenticated-official'].automaticRead, false);
  assert.equal(routing.accessClasses['open-machine-readable'].automaticRead, true);
  assert.ok(routing.policies.security.some((item) => /localhost|özel ağ/i.test(item)));
  assert.ok(routing.policies.provenance.some((item) => /Belge tarihi|erişim tarihi/i.test(item)));
});
