import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  discoverMunicipalityProvider,
  matchMunicipalityAccessRegistry,
  municipalityAccessRegistryStats
} from '../netlify/functions/lib/municipality-provider.mjs';
import { MUNICIPALITY_ACCESS_REGISTRY } from '../netlify/functions/lib/municipality-access-registry.mjs';

const env = {
  MUNICIPALITY_PROVIDER_CACHE_DISABLED: 'true',
  MUNICIPALITY_EDEVLET_DISCOVERY_ENABLED: 'false'
};

test('v3.8 resmî belediye envanteri 1.407 kurum ve 81 il içerir', () => {
  const stats = municipalityAccessRegistryStats();
  assert.equal(stats.totalMunicipalities, 1407);
  assert.equal(MUNICIPALITY_ACCESS_REGISTRY.length, 1407);
  assert.equal(new Set(MUNICIPALITY_ACCESS_REGISTRY.map((record) => record.institutionCode)).size, 1407);
  assert.equal(new Set(MUNICIPALITY_ACCESS_REGISTRY.map((record) => record.province)).size, 81);
  assert.equal(stats.openPortalCount, 2);
  assert.equal(stats.eDevletOrSsoCount, 160);
  assert.equal(stats.pendingAccessCount, 1245);
});

test('v3.8 gömülü hizmet bağlantıları yalnız HTTPS ve otomatik sorgu izinsizdir', () => {
  const services = MUNICIPALITY_ACCESS_REGISTRY.flatMap((record) => record.services || []);
  assert.ok(services.length >= 193);
  for (const service of services) {
    assert.match(service.url, /^https:\/\//);
    assert.equal(service.automatedQueryAllowed, false);
    assert.equal(service.dataClaim, 'not-read');
  }
});

test('Beşiktaş 816/35 ve Şişli 1946/70 açık ama manuel portal olarak kalır', async () => {
  for (const query of [
    { province: 'İstanbul', district: 'Beşiktaş', neighbourhood: 'Muradiye', block: '816', parcel: '35' },
    { province: 'İstanbul', district: 'Şişli', neighbourhood: 'Mecidiyeköy', block: '1946', parcel: '70' }
  ]) {
    const result = await discoverMunicipalityProvider({ query, env, fetchImpl: () => { throw new Error('Ağ çağrısı yapılmamalı'); } });
    assert.equal(result.status, 'manual-only');
    assert.equal(result.municipalityRegistry.selectedAuthority.accessClassKey, 'A1');
    assert.ok(result.municipalServices.some((service) => service.accessMode === 'manual-only'));
    assert.ok(result.municipalServices.every((service) => service.automatedQueryAllowed === false));
  }
});

test('Bayramiç 341/15 denetim bekliyor, e-Devlet-only Çukurova ise doğrudan güvenli hizmete yönelir', async () => {
  const bayramic = await discoverMunicipalityProvider({
    query: { province: 'Çanakkale', district: 'Bayramiç', neighbourhood: 'Muratlar', block: '341', parcel: '15' }, env, fetchImpl: null
  });
  assert.equal(bayramic.municipalityRegistry.selectedAuthority.authority, 'Bayramiç Belediyesi');
  assert.equal(bayramic.municipalityRegistry.selectedAuthority.accessClassKey, 'PENDING');
  assert.equal(bayramic.status, 'official-search-ready');
  assert.equal(bayramic.municipalService.accessMode, 'official-search');

  const cukurova = await discoverMunicipalityProvider({ query: { province: 'Adana', district: 'Çukurova' }, env, fetchImpl: null });
  assert.equal(cukurova.municipalityRegistry.selectedAuthority.accessClassKey, 'A4');
  assert.equal(cukurova.municipalService.accessMode, 'official-login-service');
  assert.match(cukurova.municipalService.url, /^https:\/\/www\.turkiye\.gov\.tr\//);
  assert.equal(cukurova.municipalService.dataClaim, 'not-read');
  assert.equal(cukurova.municipalService.userActionRequired, true);
});

test('mahalle bir belde adıyla eşleşirse belde yetkili idaresi önceliklenir', () => {
  const matches = matchMunicipalityAccessRegistry({ province: 'Adıyaman', district: 'Besni', neighbourhood: 'Şambayat' });
  assert.equal(matches[0].authority, 'Şambayat Belediyesi');
});

test('v3.8 istemci akışı şifre toplamaz, sorgu bağlamını korur ve belgeyi cihazda işler', async () => {
  const [html, app] = await Promise.all([
    readFile(new URL('../dist/index.html', import.meta.url), 'utf8'),
    readFile(new URL('../dist/app.js', import.meta.url), 'utf8')
  ]);
  assert.doesNotMatch(html, /type=["']password["']/i);
  assert.doesNotMatch(html, /<iframe\b/i);
  assert.match(html, /copyParcelReferenceButton/);
  assert.match(html, /queryRestoreBanner/);
  assert.match(html, /target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer"/);
  assert.match(app, /planlamasyon-query-context-v3-8/);
  assert.match(app, /Sorgu forma geri getirildi; çalıştırmak için mavi düğmeye dokunun/);
  assert.match(app, /Planlamasyon şifre veya oturum bilgisi saklamaz/);
  assert.match(app, /Belge dosyanız sunucuya yüklenmez; yalnızca çıkarılan metin analiz edilir/);
  assert.match(app, /validateOfficialDocumentFile/);
  assert.match(app, /12 \* 1024 \* 1024/);
});

test('yayınlanan şeffaf katalog JSONu v3.8 kaydıyla eşleşir', async () => {
  const json = JSON.parse(await readFile(new URL('../dist/data/municipality-access-registry.json', import.meta.url), 'utf8'));
  assert.equal(json.registryVersion, '2026-08-25-v3.8.0');
  assert.equal(json.municipalities.length, 1407);
  assert.match(json.safetyNotice, /Planlamasyon kimlik bilgisi veya oturum verisi istemez/);
});
