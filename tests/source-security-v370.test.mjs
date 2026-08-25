import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  OFFICIAL_SOURCE_SECURITY_VERSION,
  describeSourceFreshness,
  fetchOfficialResource,
  readResponseBytesLimited,
  safePublicHttpsUrl,
  validatePublicHttpsUrl
} from '../netlify/functions/lib/official-source-security.mjs';
import { discoverMunicipalityProvider } from '../netlify/functions/lib/municipality-provider.mjs';
import { discoverOpenOfficialZoning } from '../netlify/functions/lib/open-official-source-client.mjs';
import { enhanceZoningWithPlanAI } from '../netlify/functions/lib/plan-ai-client.mjs';

const baseProviderEnv = {
  MUNICIPALITY_PROVIDER_CACHE_DISABLED: 'true',
  MUNICIPALITY_EDEVLET_DISCOVERY_ENABLED: 'false'
};

function parcel(overrides = {}) {
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [29.12, 40.98] },
    properties: {
      province: 'Deneme', district: 'Örnek', neighbourhood: 'Merkez',
      block: '101', parcel: '22', ...overrides
    }
  };
}

function response(body = '', status = 200, headers = {}) {
  return new Response(body, { status, headers });
}

test('v3.7 URL doğrulaması alternatif IP, yerel DNS, kimlik bilgisi ve alan adı kandırmacasını reddeder', () => {
  assert.equal(OFFICIAL_SOURCE_SECURITY_VERSION, '3.8.0');
  const blocked = [
    'https://2130706433/imar',
    'https://0x7f000001/imar',
    'https://0177.0.0.1/imar',
    'https://127.1/imar',
    'https://[::ffff:7f00:1]/imar',
    'https://metadata.google.internal/latest',
    'https://imar.intranet/sonuc',
    'https://kullanici:sifre@imar.deneme.gov.tr/',
    'https://imar.deneme.gov.tr:8443/',
    'https://imar.deneme.gov.tr/%0d%0aHost:evil.example'
  ];
  for (const url of blocked) assert.equal(safePublicHttpsUrl(url), null, url);

  assert.throws(
    () => validatePublicHttpsUrl('https://api.gov.tr.evil.example/imar', { requireOfficialHost: true }),
    /izin listesi|resmî alan adı/i
  );
  assert.equal(
    validatePublicHttpsUrl('https://api.vendor.example/imar', { requireOfficialHost: true, allowedHosts: 'api.vendor.example' }),
    'https://api.vendor.example/imar'
  );
});

test('v3.7 her yönlendirme yeniden doğrulanır; özel ağ ve farklı origin hedefi çağrılmaz', async () => {
  const calls = [];
  await assert.rejects(
    fetchOfficialResource('https://imar.deneme.gov.tr/basla', {}, {
      timeoutMs: 1000,
      fetchImpl: async (url) => {
        calls.push(String(url));
        return response('', 302, { location: 'https://169.254.169.254/latest/meta-data' });
      }
    }),
    /yerel|özel|sayısal/i
  );
  assert.deepEqual(calls, ['https://imar.deneme.gov.tr/basla']);

  await assert.rejects(
    fetchOfficialResource('https://imar.deneme.gov.tr/basla', {}, {
      timeoutMs: 1000,
      fetchImpl: async () => response('', 302, { location: 'https://api.baska.gov.tr/sonuc' })
    }),
    /farklı bir sunucu/i
  );

  await assert.rejects(
    fetchOfficialResource('https://imar.deneme.gov.tr/basla', {}, {
      timeoutMs: 1000,
      fetchImpl: async () => {
        const followed = response('gizli', 200);
        Object.defineProperty(followed, 'url', { value: 'https://127.0.0.1/sonuc' });
        return followed;
      }
    }),
    /yerel|özel|sayısal/i
  );
});

test('v3.7 aynı-origin güvenli yönlendirme izlenir ve nihai URL korunur', async () => {
  const calls = [];
  const result = await fetchOfficialResource('https://imar.deneme.gov.tr/basla', {}, {
    timeoutMs: 1000,
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), redirect: init.redirect });
      if (String(url).endsWith('/basla')) return response('', 302, { location: '/sonuc' });
      return response('tamam', 200, { 'content-type': 'text/plain' });
    }
  });
  assert.deepEqual(calls, [
    { url: 'https://imar.deneme.gov.tr/basla', redirect: 'manual' },
    { url: 'https://imar.deneme.gov.tr/sonuc', redirect: 'manual' }
  ]);
  assert.equal(result.officialFinalUrl, 'https://imar.deneme.gov.tr/sonuc');
});

test('v3.7 GET yalnız bir kez yeniden denenir; POST ve abort hatası tekrar edilmez', async () => {
  let getCalls = 0;
  const getResult = await fetchOfficialResource('https://api.deneme.gov.tr/veri', {}, {
    timeoutMs: 1000,
    fetchImpl: async () => {
      getCalls += 1;
      return getCalls === 1 ? response('', 503) : response('{}', 200, { 'content-type': 'application/json' });
    }
  });
  assert.equal(getResult.status, 200);
  assert.equal(getCalls, 2);

  let postCalls = 0;
  const postResult = await fetchOfficialResource('https://api.deneme.gov.tr/sorgu', { method: 'POST', body: 'ada=101&parsel=22' }, {
    timeoutMs: 1000,
    allowPost: true,
    fetchImpl: async () => { postCalls += 1; return response('', 503); }
  });
  assert.equal(postResult.status, 503);
  assert.equal(postCalls, 1);

  let abortCalls = 0;
  await assert.rejects(fetchOfficialResource('https://api.deneme.gov.tr/veri', {}, {
    timeoutMs: 1000,
    fetchImpl: async () => {
      abortCalls += 1;
      const error = new Error('abort');
      error.name = 'AbortError';
      throw error;
    }
  }), /zaman aşım/i);
  assert.equal(abortCalls, 1);
});

test('v3.7 güvenli yanıt boyutu başlıktan aşılırsa içerik okunmadan durdurulur', async () => {
  await assert.rejects(fetchOfficialResource('https://api.deneme.gov.tr/buyuk', {}, {
    timeoutMs: 1000,
    maxResponseBytes: 4096,
    fetchImpl: async () => response('', 200, { 'content-length': '5000' })
  }), /boyut sınırını/i);

  const bodyWithoutLength = response(new Uint8Array(5000), 200);
  await assert.rejects(readResponseBytesLimited(bodyWithoutLength, 4096), /boyut sınırını/i);
});

test('v3.7 erişim tarihi veri güncelliği gibi sunulmaz; belge tarihi ayrı sınıflandırılır', () => {
  const unknown = describeSourceFreshness({ retrievedAt: '2026-08-25T03:00:00.000Z' }, { now: new Date('2026-08-25T12:00:00.000Z') });
  assert.equal(unknown.dataStatus, 'unknown');
  assert.equal(unknown.basis, 'unknown');
  assert.match(unknown.note, /erişim tarihi güncellik kanıtı sayılmadı/i);

  const current = describeSourceFreshness({ documentDate: '2026-08-24', verifiedAt: '2026-08-25' }, { now: new Date('2026-08-25T12:00:00.000Z') });
  assert.equal(current.dataStatus, 'current');
  assert.equal(current.basis, 'document-date');
  assert.equal(current.ageDays, 1);
});

test('v3.7 ortam kayıtlı adaptör hem authorized hem automatedQueryAllowed olmadan otomatikleşmez', async () => {
  const connector = {
    id: 'registry-adapter', province: 'Deneme', district: 'Örnek',
    title: 'Kurum Adaptörü', url: 'https://api.deneme.gov.tr/imar',
    kind: 'municipality-geodata', accessMode: 'automatic-adapter', machineReadableCandidate: true
  };
  const noNetwork = async () => { throw new Error('Ağ çağrısı beklenmiyordu.'); };
  const blocked = await discoverMunicipalityProvider({
    query: { province: 'Deneme', district: 'Örnek' }, fetchImpl: noNetwork,
    env: { ...baseProviderEnv, MUNICIPALITY_OFFICIAL_SERVICES_JSON: JSON.stringify([{ ...connector, authorized: false, automatedQueryAllowed: true }]) }
  });
  const blockedAction = blocked.actions.find((item) => item.id === connector.id);
  assert.equal(blockedAction?.sourceClass, 'public-manual');
  assert.equal(blockedAction?.automatedQueryAllowed, false);
  assert.equal(blockedAction?.dataClaim, 'not-read');

  const allowed = await discoverMunicipalityProvider({
    query: { province: 'Deneme', district: 'Örnek' }, fetchImpl: noNetwork,
    env: { ...baseProviderEnv, MUNICIPALITY_OFFICIAL_SERVICES_JSON: JSON.stringify([{ ...connector, authorized: true, automatedQueryAllowed: true }]) }
  });
  const allowedAction = allowed.actions.find((item) => item.id === connector.id);
  assert.equal(allowedAction?.sourceClass, 'authorized-adapter');
  assert.equal(allowedAction?.automatedQueryAllowed, true);
  assert.equal(allowedAction?.dataClaim, 'eligible-after-parcel-match');
});

test('v3.7 yetkilendirilmemiş public portal hiç indirilmez ve veri okunmuş sayılmaz', async () => {
  const portalUrl = 'https://imar.deneme.gov.tr/portal';
  const called = [];
  const result = await discoverOpenOfficialZoning({
    parcel: parcel(), query: parcel().properties,
    providerDiscovery: { actions: [{
      id: 'manual-public', title: 'Deneme İmar Portalı', provider: 'Deneme Belediyesi',
      url: portalUrl, kind: 'municipality-portal', accessMode: 'public-portal',
      machineReadableCandidate: true, authorized: false, automatedQueryAllowed: false
    }] },
    env: {
      OPEN_OFFICIAL_SOURCE_CACHE_DISABLED: 'true', OPEN_OFFICIAL_SOURCE_MAX_CANDIDATES: 1,
      OPEN_OFFICIAL_SOURCE_TOTAL_BUDGET_MS: 3000, OPEN_OFFICIAL_SOURCE_TIMEOUT_MS: 1000, OPEN_OFFICIAL_SOURCE_CONCURRENCY: 1
    },
    fetchImpl: async (url) => { called.push(String(url)); return response('', 404); }
  });
  assert.equal(called.includes(portalUrl), false);
  assert.equal(result.status, 'manual-only');
  assert.equal(result.records.length, 0);
  assert.equal(result.sources[0]?.dataClaim, 'not-read');
  assert.equal(result.sources[0]?.freshness?.dataStatus, 'unknown');
});

test('v3.7 salt-okunur exact parsel sonucu kaynak ve güncellik iddiasını birlikte taşır', async () => {
  const sourceUrl = 'https://imar.deneme.gov.tr/result?ada=101&parsel=22';
  const result = await discoverOpenOfficialZoning({
    parcel: parcel(), query: parcel().properties,
    providerDiscovery: { actions: [{
      id: 'read-only-result', title: 'Açık Resmî Sonuç', provider: 'Deneme Belediyesi',
      url: sourceUrl, kind: 'municipality-portal', accessMode: 'read-only-result', readOnlyResult: true,
      machineReadableCandidate: true, documentDate: '2026-08-24', verifiedAt: '2026-08-25'
    }] },
    env: {
      OPEN_OFFICIAL_SOURCE_CACHE_DISABLED: 'true', OPEN_OFFICIAL_SOURCE_MAX_CANDIDATES: 1,
      OPEN_OFFICIAL_SOURCE_TOTAL_BUDGET_MS: 3000, OPEN_OFFICIAL_SOURCE_TIMEOUT_MS: 1000, OPEN_OFFICIAL_SOURCE_CONCURRENCY: 1
    },
    fetchImpl: async () => response('<div>Ada: 101</div><div>Parsel: 22</div><div>TAKS: 0,30</div>', 200, { 'content-type': 'text/html' })
  });
  const source = result.records[0]?.source;
  assert.equal(result.status, 'available');
  assert.equal(source?.sourceClass, 'open-machine-readable');
  assert.equal(source?.dataClaim, 'read-and-parcel-matched');
  assert.equal(source?.freshness?.basis, 'document-date');
  assert.equal(source?.freshness?.dataStatus, 'current');
  assert.ok(source?.retrievedAt);
});

test('v3.7 Plan AI yetkisiz portalı okumaz ve izinli kanıt yönlendirmesinde özel ağı engeller', async () => {
  const manualUrl = 'https://imar.deneme.gov.tr/portal';
  let manualCalls = 0;
  const manual = await enhanceZoningWithPlanAI({
    parcel: parcel(), query: parcel().properties,
    providerDiscovery: { actions: [{
      id: 'manual', title: 'Manuel İmar Portalı', provider: 'Deneme Belediyesi',
      url: manualUrl, kind: 'municipality-portal', accessMode: 'public-portal',
      machineReadableCandidate: true
    }] },
    env: { NVIDIA_API_KEY: 'test-key', PLAN_AI_CACHE_DISABLED: 'true' },
    fetchImpl: async () => { manualCalls += 1; return response('ok'); }
  });
  assert.equal(manualCalls, 0);
  assert.equal(manual.status, 'unavailable');

  const readOnlyUrl = 'https://imar.deneme.gov.tr/result?ada=101&parsel=22';
  const calls = [];
  const redirected = await enhanceZoningWithPlanAI({
    parcel: parcel(), query: parcel().properties,
    providerDiscovery: { actions: [{
      id: 'read-only', title: 'Salt Okunur Sonuç', provider: 'Deneme Belediyesi',
      url: readOnlyUrl, kind: 'municipality-portal', accessMode: 'read-only-result',
      readOnlyResult: true, machineReadableCandidate: true
    }] },
    env: {
      NVIDIA_API_KEY: 'test-key', PLAN_AI_CACHE_DISABLED: 'true',
      PLAN_AI_SOURCE_TIMEOUT_MS: 1000, PLAN_AI_EVIDENCE_TOTAL_BUDGET_MS: 3000
    },
    fetchImpl: async (url) => {
      calls.push(String(url));
      return response('', 302, { location: 'https://127.0.0.1/private' });
    }
  });
  assert.deepEqual(calls, [readOnlyUrl]);
  assert.equal(redirected.status, 'unavailable');
  assert.equal(redirected.evidenceCount, 0);
  assert.match(redirected.attempts[0]?.message || '', /yerel|özel|sayısal/i);
});

test('v3.7 resmî kaynak manifesti ağ ve güncellik politikalarını istemci kopyasıyla aynı yayımlar', async () => {
  const primary = JSON.parse(await readFile(new URL('../official-source-routing.json', import.meta.url), 'utf8'));
  const published = JSON.parse(await readFile(new URL('../dist/data/official-source-routing.json', import.meta.url), 'utf8'));
  assert.deepEqual(published, primary);
  assert.equal(primary.releaseVersion, '3.8.0');
  assert.equal(primary.networkGuards.redirectMode, 'manual-same-origin');
  assert.equal(primary.networkGuards.maxSafeRetries, 1);
  assert.equal(primary.networkGuards.postRetries, 0);
  assert.match(primary.policies.provenance.join(' '), /Erişim tarihi verinin güncel olduğu iddiasına dönüştürülmez/i);
});
