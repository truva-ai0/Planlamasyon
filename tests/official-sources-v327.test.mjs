import test from 'node:test';
import assert from 'node:assert/strict';

import { discoverMunicipalityProvider } from '../netlify/functions/lib/municipality-provider.mjs';
import {
  discoverOpenOfficialZoning,
  normalizeOpenZoningAttributes,
  OPEN_OFFICIAL_SOURCE_VERSION
} from '../netlify/functions/lib/open-official-source-client.mjs';
import {
  parseZoningDocumentText,
  ZONING_DOCUMENT_PARSER_VERSION
} from '../netlify/functions/lib/zoning-document-parser.mjs';

const sisliParcel = {
  type: 'Feature',
  geometry: { type: 'Point', coordinates: [28.9942, 41.0672] },
  properties: {
    province: 'İstanbul', district: 'Şişli', neighbourhood: 'Mecidiyeköy',
    block: '1946', parcel: '70'
  }
};

function fictionalParcel({ lon = 29.31, lat = 40.91 } = {}) {
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [lon, lat] },
    properties: {
      province: 'Deneme', district: 'Örnek', neighbourhood: 'Kurgusal',
      block: '321', parcel: '654'
    }
  };
}

const fictionalQuery = {
  province: 'Deneme', district: 'Örnek', neighbourhood: 'Kurgusal',
  block: '321', parcel: '654'
};

function htmlResponse(body, status = 200) {
  return new Response(body, {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8' }
  });
}

function scanEnv(extra = {}) {
  return {
    OPEN_OFFICIAL_SOURCE_MAX_CANDIDATES: 4,
    OPEN_OFFICIAL_SOURCE_TOTAL_BUDGET_MS: 5000,
    OPEN_OFFICIAL_SOURCE_TIMEOUT_MS: 1800,
    OPEN_OFFICIAL_SOURCE_CONCURRENCY: 1,
    ...extra
  };
}

test('v3.5.0 Şişli built-in portalı kullanım koşullarıyla manual-only yönlendirir', async () => {
  const provider = await discoverMunicipalityProvider({
    parcel: sisliParcel,
    query: sisliParcel.properties,
    env: {
      MUNICIPALITY_PROVIDER_CACHE_DISABLED: 'true',
      MUNICIPALITY_EDEVLET_DISCOVERY_ENABLED: 'false'
    },
    fetchImpl: async () => { throw new Error('Ağ çağrısı beklenmiyordu.'); }
  });

  const action = provider.actions.find((item) => item.id === 'istanbul-sisli-web-imar-durumu');
  assert.ok(action);
  assert.equal(provider.status, 'manual-only');
  assert.equal(provider.resultCapability, 'manual-official-query');
  assert.equal(action.status, 'manual-only');
  assert.equal(action.accessMode, 'manual-only');
  assert.equal(action.automatedQueryAllowed, false);
  assert.equal(action.machineReadableCandidate, false);
  assert.equal(action.termsUrl, 'https://kentrehberi.sisli.bel.tr/imardurum/legal.aspx');
});

test('manual-only portal için otomatik istek yapılmaz ve deneme durumu görünür', async () => {
  let manualPortalCalls = 0;
  const manualUrl = 'https://kentrehberi.sisli.bel.tr/imardurum/';
  const result = await discoverOpenOfficialZoning({
    parcel: sisliParcel,
    query: sisliParcel.properties,
    providerDiscovery: {
      actions: [{
        id: 'sisli-manual', title: 'Şişli Belediyesi Web İmar Durumu',
        provider: 'Şişli Belediyesi', url: manualUrl,
        kind: 'municipality-portal', status: 'manual-only', accessMode: 'manual-only',
        automatedQueryAllowed: false,
        termsUrl: 'https://kentrehberi.sisli.bel.tr/imardurum/legal.aspx'
      }]
    },
    env: scanEnv({ OPEN_OFFICIAL_SOURCE_CACHE_DISABLED: 'true' }),
    fetchImpl: async (url) => {
      if (String(url) === manualUrl) manualPortalCalls += 1;
      return htmlResponse('', 404);
    }
  });

  const attempt = result.attempts.find((item) => item.status === 'manual-only');
  assert.equal(manualPortalCalls, 0);
  assert.equal(result.status, 'manual-only');
  assert.equal(result.manualOnlyCount, 1);
  assert.ok(attempt);
  assert.equal(attempt.automatedQueryAllowed, false);
  assert.equal(attempt.termsUrl, 'https://kentrehberi.sisli.bel.tr/imardurum/legal.aspx');
});

test('yetkisiz public-portal POST formu gönderilmez', async () => {
  const portalUrl = 'https://imar-public.deneme.gov.tr/';
  const form = '<form method="post" action="/sorgu"><input name="Ada"><input name="Parsel"><button name="Ara" value="Ara">Ara</button></form>';
  const requests = [];
  const result = await discoverOpenOfficialZoning({
    parcel: fictionalParcel(),
    query: fictionalQuery,
    providerDiscovery: {
      actions: [{
        id: 'unauthorized-public-form', title: 'Deneme Belediyesi İmar Portalı',
        provider: 'Deneme Belediyesi', url: portalUrl, kind: 'municipality-portal',
        accessMode: 'public-portal', machineReadableCandidate: true,
        automatedQueryAllowed: false
      }]
    },
    env: scanEnv({ OPEN_OFFICIAL_SOURCE_CACHE_DISABLED: 'true' }),
    fetchImpl: async (url, init = {}) => {
      requests.push({ url: String(url), method: init.method || 'GET' });
      return String(url) === portalUrl ? htmlResponse(form) : htmlResponse('', 404);
    }
  });

  assert.equal(requests.some((item) => item.method === 'POST'), false);
  assert.equal(result.records.length, 0);
  assert.match(result.attempts.find((item) => item.id.includes('unauthorizedpublicform'))?.message || '', /yetkilendirilmiş/i);
});

test('yetkisiz public-portal GET formu da gönderilmez', async () => {
  const portalUrl = 'https://imar-get.deneme.gov.tr/';
  const form = '<form method="get" action="/sorgu"><input name="Ada"><input name="Parsel"><button name="Ara" value="Ara">Ara</button></form>';
  const portalRequests = [];
  const result = await discoverOpenOfficialZoning({
    parcel: fictionalParcel({ lon: 29.315 }),
    query: fictionalQuery,
    providerDiscovery: {
      actions: [{
        id: 'unauthorized-get-form', title: 'GET Formlu Portal', provider: 'Deneme Belediyesi',
        url: portalUrl, kind: 'municipality-portal', accessMode: 'public-portal',
        machineReadableCandidate: true, automatedQueryAllowed: false
      }]
    },
    env: scanEnv({ OPEN_OFFICIAL_SOURCE_CACHE_DISABLED: 'true' }),
    fetchImpl: async (url, init = {}) => {
      if (String(url).startsWith('https://imar-get.deneme.gov.tr/')) {
        portalRequests.push({ url: String(url), method: init.method || 'GET' });
        return htmlResponse(form);
      }
      return htmlResponse('', 404);
    }
  });

  assert.deepEqual(portalRequests, [{ url: portalUrl, method: 'GET' }]);
  assert.equal(result.records.length, 0);
  assert.match(result.attempts.find((item) => item.id.includes('unauthorizedgetform'))?.message || '', /yetkilendirilmiş/i);
});

test('açıkça yetkilendirilmiş yapılandırılmış aday form POST edebilir', async () => {
  const portalUrl = 'https://imar-adapter.deneme.gov.tr/';
  const form = '<form method="post" action="/sorgu"><input name="Ada"><input name="Parsel"><button name="Ara" value="Ara">Ara</button></form>';
  const exactResult = '<div>Ada: 321</div><div>Parsel: 654</div><div>Emsal: 1,25</div><div>Yapinizami: Ayrik Nizam</div><div>Yençok: 6 kat</div>';
  const requests = [];
  const result = await discoverOpenOfficialZoning({
    parcel: fictionalParcel({ lon: 29.32 }),
    query: fictionalQuery,
    providerDiscovery: { actions: [] },
    env: scanEnv({
      OPEN_OFFICIAL_SOURCE_CACHE_DISABLED: 'true',
      OPEN_OFFICIAL_ZONING_SOURCES_JSON: JSON.stringify([{
        id: 'authorized-form-adapter', province: 'Deneme', district: 'Örnek',
        title: 'Yetkili Test Adaptörü', provider: 'Deneme Belediyesi',
        url: portalUrl, kind: 'portal', priority: 200,
        automatedQueryAllowed: true
      }])
    }),
    fetchImpl: async (url, init = {}) => {
      requests.push({ url: String(url), method: init.method || 'GET', body: init.body || '' });
      if (!String(url).startsWith('https://imar-adapter.deneme.gov.tr/')) return htmlResponse('', 404);
      return (init.method || 'GET') === 'POST' ? htmlResponse(exactResult) : htmlResponse(form);
    }
  });

  const post = requests.find((item) => item.method === 'POST');
  assert.ok(post);
  assert.match(post.body, /Ada=321/);
  assert.match(post.body, /Parsel=654/);
  assert.equal(result.status, 'available');
  assert.equal(result.records[0].fields.emsal, 1.25);
  assert.equal(result.records[0].fields.floors, 6);
  assert.equal(result.records[0].fields.hmax, null);
  assert.equal(result.records[0].fields.buildingOrder, 'Ayrık');
  assert.equal(result.records[0].source.retrievalMode, 'authorized-form-post');
});

test('doğrudan exact sonuç sayfası salt-okunur GET ile pars edilir', async () => {
  const resultUrl = 'https://imar-result.deneme.gov.tr/imar.aspx?parselid=fixture-1';
  const exactResult = '<h1>İmar Durumu</h1><div>Ada: 321</div><div>Parsel: 654</div><div>TAKS: 0,30</div><div>Hmax: 12,50 metre</div>';
  const requests = [];
  const result = await discoverOpenOfficialZoning({
    parcel: fictionalParcel({ lon: 29.33 }),
    query: fictionalQuery,
    providerDiscovery: {
      actions: [{
        id: 'read-only-result', title: 'Salt Okunur Resmî Sonuç', provider: 'Deneme Belediyesi',
        url: resultUrl, kind: 'municipality-portal', accessMode: 'read-only-result',
        readOnlyResult: true, machineReadableCandidate: true
      }]
    },
    env: scanEnv({ OPEN_OFFICIAL_SOURCE_CACHE_DISABLED: 'true' }),
    fetchImpl: async (url, init = {}) => {
      requests.push({ url: String(url), method: init.method || 'GET' });
      return String(url) === resultUrl ? htmlResponse(exactResult) : htmlResponse('', 404);
    }
  });

  assert.equal(requests.some((item) => item.method === 'POST'), false);
  assert.equal(result.status, 'available');
  assert.equal(result.records[0].fields.taks, 0.3);
  assert.equal(result.records[0].fields.hmax, 12.5);
  assert.equal(result.records[0].source.retrievalMode, 'read-only-get');
});

test('geçici ağ hatası olan negatif tarama cachelenmez', async () => {
  const resultUrl = 'https://transient.deneme.gov.tr/result?fixture=1';
  const parcel = fictionalParcel({ lon: 29.34123, lat: 40.92123 });
  let phase = 'fail';
  let resultUrlCalls = 0;
  const providerDiscovery = {
    actions: [{
      id: 'transient-read-only', title: 'Geçici Kaynak', provider: 'Deneme Belediyesi',
      url: resultUrl, kind: 'municipality-portal', accessMode: 'read-only-result',
      readOnlyResult: true, machineReadableCandidate: true
    }]
  };
  const fetchImpl = async (url) => {
    if (String(url) === resultUrl) {
      resultUrlCalls += 1;
      if (phase === 'fail') throw new TypeError('geçici bağlantı hatası');
      return htmlResponse('<div>Ada: 321</div><div>Parsel: 654</div><div>Emsal: 0,80</div>');
    }
    return htmlResponse('', 404);
  };
  const env = scanEnv();

  const first = await discoverOpenOfficialZoning({ parcel, query: fictionalQuery, providerDiscovery, env, fetchImpl });
  assert.equal(first.status, 'incomplete');
  assert.ok(first.attempts.some((item) => item.status === 'unreachable'));

  phase = 'success';
  const second = await discoverOpenOfficialZoning({ parcel, query: fictionalQuery, providerDiscovery, env, fetchImpl });
  assert.equal(second.status, 'available');
  assert.equal(second.records[0].fields.emsal, 0.8);
  assert.equal(resultUrlCalls, 3);
});

test('bütçe nedeniyle incomplete kalan negatif tarama cachelenmez', async () => {
  const firstUrl = 'https://budget.deneme.gov.tr/first';
  const parcel = fictionalParcel({ lon: 29.35123, lat: 40.93123 });
  let phase = 'budget';
  let firstUrlCalls = 0;
  let clock = 1_000_000;
  const realNow = Date.now;
  Date.now = () => clock;
  try {
    const providerDiscovery = {
      actions: [
        { id: 'budget-first', title: 'Bütçe Testi', provider: 'Deneme Belediyesi', url: firstUrl, kind: 'municipality-portal', accessMode: 'read-only-result', readOnlyResult: true, machineReadableCandidate: true },
        { id: 'budget-second', title: 'İkinci Kaynak', provider: 'Deneme Belediyesi', url: 'https://budget.deneme.gov.tr/second', kind: 'municipality-portal', accessMode: 'read-only-result', readOnlyResult: true, machineReadableCandidate: true }
      ]
    };
    const fetchImpl = async (url) => {
      if (String(url) === firstUrl) {
        firstUrlCalls += 1;
        if (phase === 'budget') {
          clock += 4000;
          return htmlResponse('<div>Sonuç bulunamadı</div>');
        }
        return htmlResponse('<div>Ada: 321</div><div>Parsel: 654</div><div>TAKS: 0,20</div>');
      }
      return htmlResponse('', 404);
    };
    const env = scanEnv({ OPEN_OFFICIAL_SOURCE_TOTAL_BUDGET_MS: 3000 });

    const first = await discoverOpenOfficialZoning({ parcel, query: fictionalQuery, providerDiscovery, env, fetchImpl });
    assert.equal(first.status, 'incomplete');
    assert.equal(first.budgetLimited, true);

    phase = 'success';
    const second = await discoverOpenOfficialZoning({ parcel, query: fictionalQuery, providerDiscovery, env, fetchImpl });
    assert.equal(second.status, 'available');
    assert.equal(second.records[0].fields.taks, 0.2);
    assert.equal(firstUrlCalls, 2);
  } finally {
    Date.now = realNow;
  }
});

test('Yençok kat değeri floors olur, metre Hmax ile karışmaz ve yapinizami etiketi okunur', () => {
  const parsed = parseZoningDocumentText({
    text: [
      'Deneme Belediyesi İmar Durumu Belgesi',
      'Ada: 321 Parsel: 654',
      'Yapinizami: Ayrik Nizam',
      'Yençok: 25 kat'
    ].join('\n'),
    query: fictionalQuery
  });
  assert.equal(ZONING_DOCUMENT_PARSER_VERSION, '3.6.0');
  assert.equal(parsed.fields.floors, 25);
  assert.equal(parsed.fields.hmax, undefined);
  assert.equal(parsed.fields.buildingOrder, 'Ayrık');
  assert.equal(parsed.fieldEvidence.floors.label, 'Kat adedi / Yençok (kat)');

  const height = parseZoningDocumentText({
    text: 'Deneme Belediyesi İmar Durumu Belgesi\nAda: 321 Parsel: 654\nYençok: 12,50 metre',
    query: fictionalQuery
  });
  assert.equal(height.fields.hmax, 12.5);
  assert.equal(height.fields.floors, undefined);
  assert.equal(height.fieldEvidence.hmax.label, 'Yençok / Hmax (metre)');
});

test('ayraçsız plan fonksiyonu ve inşaat nizamı etiketleri yüksek güvenle okunur', () => {
  const parsed = parseZoningDocumentText({
    text: [
      'Deneme Belediyesi İmar Durumu Belgesi',
      'Ada: 321 Parsel: 654',
      'Plan Fonksiyon Konut Alanı',
      'İnşaat Nizamı BLOK'
    ].join('\n'),
    query: fictionalQuery
  });

  assert.equal(parsed.fields.landUse, 'Konut Alanı');
  assert.equal(parsed.fields.buildingOrder, 'Blok');
  assert.equal(parsed.fieldEvidence.landUse.confidence, 'high');
  assert.equal(parsed.fieldEvidence.buildingOrder.confidence, 'high');

  const openFields = normalizeOpenZoningAttributes({
    content: 'Plan Fonksiyon Konut Alanı | İnşaat Nizamı BLOK'
  });
  assert.equal(openFields.landUse, 'Konut Alanı');
  assert.equal(openFields.buildingOrder, 'Blok');
});

test('WMS adayının hata mesajı yanlışlıkla WFS olarak etiketlenmez', async () => {
  const result = await discoverOpenOfficialZoning({
    parcel: fictionalParcel({ lon: 29.36123, lat: 40.94123 }),
    query: fictionalQuery,
    providerDiscovery: { actions: [] },
    env: scanEnv({
      OPEN_OFFICIAL_SOURCE_CACHE_DISABLED: 'true',
      OPEN_OFFICIAL_ZONING_SOURCES_JSON: JSON.stringify([{
        id: 'fixture-wms', province: 'Deneme', district: 'Örnek',
        title: 'Fixture WMS', provider: 'Deneme Belediyesi',
        url: 'https://wms.deneme.gov.tr/service', kind: 'wms',
        layers: ['fixture_layer'], priority: 200
      }])
    }),
    fetchImpl: async () => htmlResponse('', 404)
  });

  const attempt = result.attempts.find((item) => item.title === 'Fixture WMS');
  assert.ok(attempt);
  assert.match(attempt.message, /WMS/);
  assert.doesNotMatch(attempt.message, /WFS/);
});

test('açık kaynak etiket normalizasyonu yapinizami ve Yençok kat ayrımını korur', () => {
  const fields = normalizeOpenZoningAttributes({
    yapinizami: 'Ayrık Nizam',
    yencok: '25 kat'
  });
  assert.equal(OPEN_OFFICIAL_SOURCE_VERSION, '3.6.0');
  assert.equal(fields.buildingOrder, 'Ayrık');
  assert.equal(fields.floors, 25);
  assert.equal(fields.hmax, null);
});
