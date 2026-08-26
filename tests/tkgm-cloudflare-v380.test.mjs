import test from 'node:test';
import assert from 'node:assert/strict';

import { handleCloudflareTkgm } from '../src/tkgm-cloudflare.js';

const request = new Request('https://planlamasyon.truvaai0.workers.dev/api/tkgm?action=provinces');

test('v3.8 TKGM köprüsü izinli aynı kurum yönlendirmesini sınırlı izler', async () => {
  let calls = 0;
  const response = await handleCloudflareTkgm(request, {}, async (url, init) => {
    calls += 1;
    assert.equal(init.redirect, 'manual');
    if (calls === 1) {
      return new Response(null, { status: 302, headers: { location: 'https://cbsservis.tkgm.gov.tr/megsiswebapi.v3/api/idariYapi/ilListe' } });
    }
    assert.match(url, /^https:\/\/cbsservis\.tkgm\.gov\.tr\//);
    return new Response(JSON.stringify([{ id: 34, text: 'İstanbul' }]), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  assert.equal(response.status, 200);
  assert.equal(calls, 2);
  assert.equal((await response.json()).ok, true);
});

test('v3.8 TKGM köprüsü yönlendirme sonrası izinsiz hedefi çağırmaz', async () => {
  let calls = 0;
  const response = await handleCloudflareTkgm(request, {}, async () => {
    calls += 1;
    return new Response(null, { status: 302, headers: { location: 'https://169.254.169.254/latest/meta-data' } });
  });
  const body = await response.json();
  assert.equal(response.status, 502);
  assert.equal(body.code, 'TKGM_UNSAFE_REDIRECT');
  assert.equal(calls, 4, 'her TKGM başlangıç adayı güvenli hedefte bir kez denenir; özel hedef hiç çağrılmaz');
});

test('v3.8 TKGM köprüsü büyük yanıtı JSON parse etmeden reddeder', async () => {
  let calls = 0;
  const response = await handleCloudflareTkgm(request, {}, async () => {
    calls += 1;
    return new Response('[]', { status: 200, headers: { 'content-length': '2000001', 'content-type': 'application/json' } });
  });
  const body = await response.json();
  assert.equal(response.status, 502);
  assert.equal(body.code, 'TKGM_RESPONSE_TOO_LARGE');
  assert.equal(calls, 4);
});
