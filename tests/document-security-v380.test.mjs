import test from 'node:test';
import assert from 'node:assert/strict';

import { handler as parseDocumentHandler } from '../netlify/functions/parse-zoning-document.mjs';
import { parseZoningDocumentText } from '../netlify/functions/lib/zoning-document-parser.mjs';
import { bindUserEvidenceToExtraction } from '../netlify/functions/lib/zoning-client.mjs';

const officialText = [
  'T.C. ÖRNEK BELEDİYESİ',
  'İMAR DURUMU BELGESİ',
  'Ada: 101 Parsel: 22',
  'Plan fonksiyonu: Konut Alanı',
  'TAKS: 0,30',
  'KAKS / Emsal: 1,50',
  'Kat adedi: 5',
  'Yençok: 15,50 m',
  'Yapı nizamı: Ayrık',
  'Ön bahçe: 5 m',
  'Yan bahçe: 3 m',
  'Arka bahçe: 4 m'
].join('\n');

let ipIndex = 10;
function event(body, headers = {}) {
  ipIndex += 1;
  return {
    httpMethod: 'POST',
    headers: {
      'content-type': 'application/json',
      'cf-connecting-ip': `203.0.113.${ipIndex}`,
      ...headers
    },
    body: JSON.stringify(body),
    isBase64Encoded: false
  };
}

async function responseJson(result) {
  return { status: result.statusCode, body: JSON.parse(result.body) };
}

test('v3.8 alan kanıtı çıkarılan normalize değeri ve metin özeti bağını taşır', () => {
  const parsed = parseZoningDocumentText({
    text: officialText,
    query: { block: '101', parcel: '22' },
    metadata: {
      sourceTitle: 'Örnek Belediyesi İmar Durumu',
      sourceUrl: 'https://imar.ornek.bel.tr/101-22',
      lastModified: 'Tue, 25 Aug 2026 08:00:00 GMT',
      retrievedAt: '2026-08-25T09:00:00.000Z',
      sourceVerification: 'official-host-retrieved'
    }
  });

  assert.equal(parsed.fieldEvidence.taks.value, 0.3);
  assert.equal(parsed.fieldEvidence.emsal.value, 1.5);
  assert.equal(parsed.fieldEvidence.frontSetback.unit, 'm');
  assert.equal(parsed.fieldEvidence.taks.documentHash, parsed.documentHash);
  assert.equal(parsed.evidence.documentHashKind, 'extracted-text-sha256');
  assert.equal(parsed.evidence.documentDate, null, 'HTTP Last-Modified belge tarihi sayılmamalı');
  assert.equal(parsed.evidence.sourceLastModified, '2026-08-25T08:00:00.000Z');
});

test('v3.8 formda değiştirilmiş değer eski yüksek güven kanıtıyla uygulanmaz', () => {
  const parsed = parseZoningDocumentText({ text: officialText, query: { block: '101', parcel: '22' } });
  const edited = { ...parsed.evidence, confirmed: true, emsal: 9 };
  const bounded = bindUserEvidenceToExtraction(edited);

  assert.deepEqual(bounded.mismatchedFields, ['emsal']);
  assert.equal(bounded.evidence.emsal, null);
  assert.equal(bounded.evidence.taks, 0.3);
  assert.equal(bounded.evidence.fieldEvidence.emsal.bindingStatus, 'mismatch');
  assert.equal(bounded.evidence.fieldEvidence.emsal.confidence, 'low');
  assert.equal(bounded.evidence.evidenceBinding.status, 'mismatch');
});

test('v3.8 belge URL yolu özel ağ, kimlik bilgisi, özel port, izinsiz host ve oturum parametresini çağırmadan reddeder', async () => {
  const urls = [
    ['https://127.0.0.1/document.pdf', 'BLOCKED_NETWORK_TARGET'],
    ['https://user:pass@imar.ornek.bel.tr/document.pdf', 'UNSAFE_SOURCE_URL'],
    ['https://imar.ornek.bel.tr:8443/document.pdf', 'UNSAFE_SOURCE_URL'],
    ['https://documents.vendor.example/document.pdf', 'SOURCE_HOST_NOT_ALLOWED'],
    ['https://imar.ornek.bel.tr/document.pdf?access_token=secret', 'DOCUMENT_URL_SENSITIVE_QUERY'],
    ['https://imar.ornek.bel.tr/document.pdf?api_key=secret', 'DOCUMENT_URL_SENSITIVE_QUERY'],
    ['https://imar.ornek.bel.tr/document.pdf?tckn=10000000146', 'DOCUMENT_URL_SENSITIVE_QUERY'],
    ['https://imar.ornek.bel.tr/document.pdf?X-Amz-Date=20260825T080000Z', 'DOCUMENT_URL_SENSITIVE_QUERY'],
    ['https://www.turkiye.gov.tr/ornek-belediyesi-e-imar', 'EDEVLET_AUTOMATIC_READ_FORBIDDEN'],
    ['https://os.besiktas.bel.tr/', 'BESIKTAS_AUTOMATIC_READ_FORBIDDEN'],
    ['https://keos.besiktas.bel.tr/imardurumu/', 'BESIKTAS_AUTOMATIC_READ_FORBIDDEN'],
    ['https://kentrehberi.sisli.bel.tr/imardurum/', 'SISLI_AUTOMATIC_READ_FORBIDDEN']
  ];
  let calls = 0;
  for (const [sourceUrl, code] of urls) {
    const result = await responseJson(await parseDocumentHandler(
      event({ mode: 'url', sourceUrl, query: { block: '101', parcel: '22' } }),
      { cloudflareEnv: {}, fetchImpl: async () => { calls += 1; throw new Error('çağrılmamalı'); } }
    ));
    assert.equal(result.body.code, code, sourceUrl);
    assert.ok(result.status >= 400 && result.status < 500, sourceUrl);
    assert.doesNotMatch(JSON.stringify(result.body), /secret|10000000146|20260825T080000Z/i, sourceUrl);
  }
  assert.equal(calls, 0);
});

test('v3.8 her yönlendirmeyi yeniden doğrular ve hassas/özel hedefi ikinci kez çağırmaz', async () => {
  for (const [location, expectedCode] of [
    ['https://169.254.169.254/latest/meta-data', 'BLOCKED_NETWORK_TARGET'],
    ['/document.txt?session=secret', 'DOCUMENT_URL_SENSITIVE_QUERY']
  ]) {
    let calls = 0;
    const result = await responseJson(await parseDocumentHandler(
      event({ mode: 'url', sourceUrl: 'https://imar.ornek.bel.tr/start', query: { block: '101', parcel: '22' } }),
      {
        cloudflareEnv: {},
        fetchImpl: async () => {
          calls += 1;
          return new Response(null, { status: 302, headers: { location } });
        }
      }
    ));
    assert.equal(result.body.code, expectedCode);
    assert.equal(calls, 1);
  }
});

test('v3.8 resmî veya açık izinli hosttan metni alır; Last-Modified yalnız kaynak metadata olur', async () => {
  const lastModified = 'Tue, 25 Aug 2026 08:00:00 GMT';
  const result = await responseJson(await parseDocumentHandler(
    event({ mode: 'url', sourceUrl: 'https://documents.vendor.example/imar.txt', query: { block: '101', parcel: '22' } }),
    {
      cloudflareEnv: { OFFICIAL_DOCUMENT_ALLOWED_HOSTS: 'documents.vendor.example' },
      fetchImpl: async () => new Response(officialText, {
        status: 200,
        headers: { 'content-type': 'text/plain; charset=utf-8', 'last-modified': lastModified }
      })
    }
  ));

  assert.equal(result.status, 200);
  assert.equal(result.body.data.fields.taks, 0.3);
  assert.equal(result.body.data.evidence.documentDate, null);
  assert.equal(result.body.data.evidence.sourceLastModified, '2026-08-25T08:00:00.000Z');
  assert.equal(result.body.data.extraction.sourceVerification, 'official-host-retrieved');
  assert.equal(result.body.data.extraction.inputIntegrity, 'server-retrieved-bytes');
});

test('v3.8 uzak PDF beyanı dosya imzasıyla uyuşmazsa ve istek JSON değilse reddeder', async () => {
  const mismatch = await responseJson(await parseDocumentHandler(
    event({ mode: 'url', sourceUrl: 'https://imar.ornek.bel.tr/document.pdf', query: { block: '101', parcel: '22' } }),
    {
      cloudflareEnv: {},
      fetchImpl: async () => new Response(officialText, { status: 200, headers: { 'content-type': 'application/pdf' } })
    }
  ));
  assert.equal(mismatch.status, 415);
  assert.equal(mismatch.body.code, 'DOCUMENT_MIME_MISMATCH');

  const wrongType = await responseJson(await parseDocumentHandler(
    event({ mode: 'text', text: officialText }, { 'content-type': 'text/plain' }),
    { cloudflareEnv: {} }
  ));
  assert.equal(wrongType.status, 415);
  assert.equal(wrongType.body.code, 'UNSUPPORTED_MEDIA_TYPE');
});

test('v3.8 metin karakter sınırı API JSON bayt sınırıyla uyumludur', async () => {
  const text = `${officialText}\nBelge açıklaması: ${'ş'.repeat(300_000)}`;
  const request = event({
    mode: 'text',
    text,
    mimeType: 'text/plain',
    query: { block: '101', parcel: '22' }
  });
  assert.ok(Buffer.byteLength(request.body, 'utf8') > 600_000, 'eski 600 KB gövde sınırını aşan geçerli metin kullanılmalı');
  assert.ok(Buffer.byteLength(request.body, 'utf8') < 1_900_000);

  const result = await responseJson(await parseDocumentHandler(request, { cloudflareEnv: {} }));
  assert.equal(result.status, 200);
  assert.equal(result.body.data.fields.emsal, 1.5);
});
