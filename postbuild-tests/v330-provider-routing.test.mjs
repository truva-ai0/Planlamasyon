import test from 'node:test';
import assert from 'node:assert/strict';

import { discoverMunicipalityProvider } from '../netlify/functions/lib/municipality-provider.mjs';

const TURKEY_PROVINCES = [
  'Adana', 'Adıyaman', 'Afyonkarahisar', 'Ağrı', 'Amasya', 'Ankara', 'Antalya',
  'Artvin', 'Aydın', 'Balıkesir', 'Bilecik', 'Bingöl', 'Bitlis', 'Bolu', 'Burdur',
  'Bursa', 'Çanakkale', 'Çankırı', 'Çorum', 'Denizli', 'Diyarbakır', 'Edirne',
  'Elazığ', 'Erzincan', 'Erzurum', 'Eskişehir', 'Gaziantep', 'Giresun', 'Gümüşhane',
  'Hakkâri', 'Hatay', 'Isparta', 'Mersin', 'İstanbul', 'İzmir', 'Kars', 'Kastamonu',
  'Kayseri', 'Kırklareli', 'Kırşehir', 'Kocaeli', 'Konya', 'Kütahya', 'Malatya',
  'Manisa', 'Kahramanmaraş', 'Mardin', 'Muğla', 'Muş', 'Nevşehir', 'Niğde',
  'Ordu', 'Rize', 'Sakarya', 'Samsun', 'Siirt', 'Sinop', 'Sivas', 'Tekirdağ',
  'Tokat', 'Trabzon', 'Tunceli', 'Şanlıurfa', 'Uşak', 'Van', 'Yozgat', 'Zonguldak',
  'Aksaray', 'Bayburt', 'Karaman', 'Kırıkkale', 'Batman', 'Şırnak', 'Bartın',
  'Ardahan', 'Iğdır', 'Yalova', 'Karabük', 'Kilis', 'Osmaniye', 'Düzce'
];

function noNetwork() {
  throw new Error('Bu testte ağ çağrısı beklenmiyordu.');
}

function registryEnv(services, extra = {}) {
  return {
    MUNICIPALITY_OFFICIAL_SERVICES_JSON: JSON.stringify(services),
    MUNICIPALITY_EDEVLET_DISCOVERY_ENABLED: 'false',
    MUNICIPALITY_PROVIDER_CACHE_DISABLED: 'true',
    ...extra
  };
}

test('v3.3.0 81 ilin uydurma ilçesi için fallback veya il-geneli resmî yol üretir', async () => {
  assert.equal(TURKEY_PROVINCES.length, 81);

  for (const [index, province] of TURKEY_PROVINCES.entries()) {
    const district = `Planlamasyon Test İlçesi ${index + 1}`;
    const provider = await discoverMunicipalityProvider({
      query: { province, district },
      env: {
        MUNICIPALITY_EDEVLET_DISCOVERY_ENABLED: 'false',
        MUNICIPALITY_PROVIDER_CACHE_DISABLED: 'true'
      },
      fetchImpl: noNetwork
    });

    const fallback = provider.actions.find((action) => action.id === 'municipality-official-search');
    const provinceWideMatch = Number(provider.catalog?.provinceMatchCount || 0) > 0;
    assert.ok(
      fallback || provinceWideMatch,
      `${province} için uydurma ilçede fallback veya il-geneli resmî hizmet bulunmalı.`
    );
    assert.ok(
      provider.actions.some((action) => action.kind === 'national-portal'),
      `${province} için ulusal e-Plan yolu korunmalı.`
    );
    assert.ok(
      provider.actions.some((action) => action.kind === 'national-geodata'),
      `${province} için ulusal coğrafi veri yolu korunmalı.`
    );
  }
});

test('v3.3.0 doğrudan hizmet yoksa ilçe e-Devlet araması ulusal yedeklerden önce gelir', async () => {
  const provider = await discoverMunicipalityProvider({
    query: {
      province: 'Çanakkale', district: 'Bayramiç', neighbourhood: 'Muratlar',
      block: '341', parcel: '15'
    },
    env: {
      MUNICIPALITY_EDEVLET_DISCOVERY_ENABLED: 'false',
      MUNICIPALITY_PROVIDER_CACHE_DISABLED: 'true'
    },
    fetchImpl: noNetwork
  });

  assert.equal(provider.status, 'official-search-ready');
  assert.equal(provider.actions[0]?.id, 'municipality-official-search');
  assert.match(provider.actions[0]?.url || '', /Bayrami%C3%A7\+Belediyesi/);
  assert.ok(provider.actions.some((action) => action.id === 'official-domain-google-discovery'));
});

test('v3.3.0 eşdeğer resmî URLleri kanonikleştirip tek hizmete indirir', async () => {
  const provider = await discoverMunicipalityProvider({
    query: { province: 'Yönlendirme', district: 'Tekilleştirme' },
    env: registryEnv([
      {
        id: 'canonical-first', province: 'Yönlendirme', district: 'Tekilleştirme',
        title: 'İmar Durumu Birinci Kayıt', provider: 'Yönlendirme Belediyesi',
        url: 'https://IMAR.example.gov.tr/sorgu/?b=2&a=1#sonuc',
        accessMode: 'public-portal', kind: 'municipality-portal'
      },
      {
        id: 'canonical-second', province: 'Yönlendirme', district: 'Tekilleştirme',
        title: 'İmar Durumu İkinci Kayıt', provider: 'Yönlendirme Belediyesi',
        url: 'https://imar.example.gov.tr/sorgu?a=1&b=2',
        accessMode: 'public-portal', kind: 'municipality-portal'
      }
    ]),
    fetchImpl: noNetwork
  });

  assert.equal(provider.municipalServices.length, 1);
  assert.equal(
    provider.actions.filter((action) => action.kind === 'municipality-portal').length,
    1
  );
});

test('v3.3.0 açık public portal manual-only yönlendirmeden önce seçilir', async () => {
  const publicUrl = 'https://acik-imar.sisli.bel.tr/sorgu/';
  const provider = await discoverMunicipalityProvider({
    query: { province: 'İstanbul', district: 'Şişli', neighbourhood: 'Mecidiyeköy' },
    env: registryEnv([
      {
        id: 'sisli-public-result', province: 'İstanbul', district: 'Şişli',
        title: 'Şişli Açık İmar Sonuç Portalı', provider: 'Şişli Belediyesi',
        url: publicUrl, status: 'official-service-found',
        accessMode: 'public-portal', kind: 'municipality-portal',
        machineReadableCandidate: false
      }
    ]),
    fetchImpl: noNetwork
  });

  assert.equal(provider.municipalService?.url, publicUrl);
  assert.equal(provider.status, 'official-service-found');
  assert.notEqual(provider.resultCapability, 'manual-official-query');
});

test('v3.3.0 sağlayıcı cache anahtarı aynı kimlikte URL değişimini ayırt eder', async () => {
  const query = { province: 'Önbellek', district: 'Bağlantı' };
  const common = {
    id: 'same-registry-id', province: query.province, district: query.district,
    title: 'Önbellek İmar Hizmeti', provider: 'Önbellek Belediyesi',
    accessMode: 'public-portal', kind: 'municipality-portal'
  };
  const firstUrl = 'https://imar-cache.example.gov.tr/v1/';
  const secondUrl = 'https://imar-cache.example.gov.tr/v2/';

  const first = await discoverMunicipalityProvider({
    query,
    env: registryEnv([{ ...common, url: firstUrl }], {
      MUNICIPALITY_PROVIDER_CACHE_DISABLED: 'false'
    }),
    fetchImpl: noNetwork
  });
  const second = await discoverMunicipalityProvider({
    query,
    env: registryEnv([{ ...common, url: secondUrl }], {
      MUNICIPALITY_PROVIDER_CACHE_DISABLED: 'false'
    }),
    fetchImpl: noNetwork
  });

  assert.equal(first.municipalService?.url, firstUrl);
  assert.equal(second.municipalService?.url, secondUrl);
});

test('v3.3.0 localhost ve kullanıcı bilgisi içeren HTTPS kaynakları reddeder', async () => {
  const query = { province: 'Güvenlik', district: 'Kaynak' };
  const provider = await discoverMunicipalityProvider({
    query,
    env: registryEnv([
      {
        id: 'localhost-source', province: query.province, district: query.district,
        title: 'Yerel Kaynak', provider: 'Test', url: 'https://localhost/imar',
        accessMode: 'public-portal', kind: 'municipality-portal'
      },
      {
        id: 'userinfo-source', province: query.province, district: query.district,
        title: 'Kimlik Bilgili Kaynak', provider: 'Test',
        url: 'https://kullanici:sifre@imar-secure.example.gov.tr/sorgu',
        accessMode: 'public-portal', kind: 'municipality-portal'
      },
      {
        id: 'safe-source', province: query.province, district: query.district,
        title: 'Güvenli Kaynak', provider: 'Test',
        url: 'https://imar-secure.example.gov.tr/sorgu',
        accessMode: 'public-portal', kind: 'municipality-portal'
      }
    ]),
    fetchImpl: noNetwork
  });

  assert.deepEqual(
    provider.municipalServices.map((service) => service.id),
    ['safe-source']
  );
  assert.ok(provider.actions.every((action) => !String(action.url || '').includes('localhost')));
  assert.ok(provider.actions.every((action) => !String(action.url || '').includes('@')));
});
