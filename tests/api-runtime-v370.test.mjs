import test from 'node:test';
import assert from 'node:assert/strict';

import worker, { handleAnalysisRequest } from '../src/worker.js';
import { handler as healthHandler } from '../netlify/functions/health.mjs';

function analysisRequest(body, headers = {}) {
  return new Request('https://planlamasyon.truvaai0.workers.dev/api/request-analysis', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: 'https://planlamasyon.truvaai0.workers.dev',
      'cf-connecting-ip': `203.0.113.${Math.floor(Math.random() * 200) + 1}`,
      ...headers
    },
    body: JSON.stringify(body)
  });
}

const validBody = {
  email: 'musteri@example.com',
  parcel: { province: 'İstanbul', district: 'Beşiktaş', neighbourhood: 'Muradiye', block: '816', parcel: '35' }
};

test('v3.7 Cloudflare hesap eşitlemesini açıkmış gibi göstermez', async () => {
  const response = await worker.fetch(new Request('https://planlamasyon.truvaai0.workers.dev/api/user-data'), {});
  const body = await response.json();
  assert.equal(response.status, 503);
  assert.equal(body.code, 'ACCOUNT_SYNC_DISABLED');
  assert.equal(body.data.syncEnabled, false);
  assert.equal(body.data.storage, 'client-local-only');
});

test('v3.7 sağlık yanıtı gerçek çalışma ortamına göre hesap saklama modunu bildirir', async () => {
  const cloudflare = JSON.parse((await healthHandler({}, { cloudflareEnv: {} })).body);
  assert.equal(cloudflare.runtime, 'cloudflare-worker');
  assert.equal(cloudflare.modules.accounts, false);
  assert.equal(cloudflare.modules.accountStorageMode, 'client-local-only');

  const netlify = JSON.parse((await healthHandler({}, { cloudflareEnv: null })).body);
  assert.equal(netlify.modules.accounts, false, 'açık opt-in olmadan sunucu hesabı ilan edilmemeli');
});

test('v3.7 analiz talebi farklı origin, yanlış içerik türü ve büyük gövdeyi reddeder', async () => {
  const forbidden = await handleAnalysisRequest(analysisRequest(validBody, { origin: 'https://kotu.example' }), {});
  assert.equal(forbidden.status, 403);
  assert.equal((await forbidden.json()).code, 'ORIGIN_NOT_ALLOWED');
  assert.match(forbidden.headers.get('content-security-policy') || '', /default-src 'none'/);

  const wrongType = new Request('https://planlamasyon.truvaai0.workers.dev/api/request-analysis', {
    method: 'POST', headers: { 'content-type': 'text/plain', 'cf-connecting-ip': '203.0.113.210' }, body: '{}'
  });
  assert.equal((await handleAnalysisRequest(wrongType, {})).status, 415);

  const tooLarge = analysisRequest(validBody, { 'content-length': '70000', 'cf-connecting-ip': '203.0.113.211' });
  const largeResponse = await handleAnalysisRequest(tooLarge, {});
  assert.equal(largeResponse.status, 413);
  assert.equal((await largeResponse.json()).code, 'PAYLOAD_TOO_LARGE');
});

test('v3.7 bildirim yapılandırılmadığında talebi gönderilmiş veya sunucuda saklanmış saymaz', async () => {
  const response = await handleAnalysisRequest(analysisRequest(validBody), {});
  const body = await response.json();
  assert.equal(response.status, 202);
  assert.equal(body.ok, true);
  assert.equal(body.data.accepted, false);
  assert.equal(body.data.emailSent, false);
  assert.equal(body.data.serverStored, false);
  assert.equal(body.data.storage, 'client-local-only');
  assert.match(body.data.notice, /ekibe gönderilmedi/i);
});

test('v3.7 yalnız başarılı bildirim yanıtında talebi ekibe iletilmiş sayar', async () => {
  let calls = 0;
  const response = await handleAnalysisRequest(
    analysisRequest(validBody),
    { RESEND_API_KEY: 'secret', ANALYSIS_TEAM_EMAIL: 'ekip@example.com', FROM_EMAIL: 'Planlamasyon <noreply@example.com>' },
    async (_url, init) => {
      calls += 1;
      const payload = JSON.parse(init.body);
      assert.match(payload.subject, /816\/35/);
      return new Response('{}', { status: 200 });
    }
  );
  const body = await response.json();
  assert.equal(calls, 1);
  assert.equal(response.status, 201);
  assert.equal(body.data.accepted, true);
  assert.equal(body.data.emailSent, true);
  assert.equal(body.data.serverStored, false);
  assert.equal(body.data.storage, 'email-notification-only');
});
