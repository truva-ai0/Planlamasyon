import test from 'node:test';
import assert from 'node:assert/strict';

import { buildParcelAnalysis } from '../netlify/functions/lib/analysis-core.mjs';
import { parseZoningDocumentText, ZONING_DOCUMENT_PARSER_VERSION } from '../netlify/functions/lib/zoning-document-parser.mjs';

const query = { province: 'İstanbul', district: 'Örnek', neighbourhood: 'Merkez', block: '101', parcel: '22' };

function parse(lines, metadata = {}) {
  return parseZoningDocumentText({
    text: ['T.C. ÖRNEK BELEDİYESİ', 'İMAR DURUMU BELGESİ', 'Ada: 101 Parsel: 22', ...lines].join('\n'),
    query,
    metadata
  });
}

function parcel(area = 1000) {
  return {
    type: 'Feature',
    geometry: { type: 'Polygon', coordinates: [] },
    properties: { area, province: 'İstanbul', district: 'Örnek', neighbourhood: 'Merkez', block: '101', parcel: '22' }
  };
}

test('v3.6 birleşik oran, Z+kat, kompakt nizam ve net alan etiketlerini kayıpsız okur', () => {
  const parsed = parse([
    'İmar uygulaması sonrası net parsel alanı: 875,50 m²',
    'TAKS / KAKS: %25 / 1,50',
    'Yençok: Z+4 Kat',
    'Hmax (metre): 15,50 m',
    'Yapı nizamı: A-5',
    'Plan fonksiyonu: Konut Alanı',
    'Ön bahçe mesafesi: 5 m',
    'Yan bahçe mesafesi: 3 m',
    'Arka bahçe mesafesi: 4 m'
  ]);

  assert.equal(ZONING_DOCUMENT_PARSER_VERSION, '3.6.0');
  assert.equal(parsed.fields.netParcelArea, 875.5);
  assert.equal(parsed.fields.taks, 0.25);
  assert.equal(parsed.fields.emsal, 1.5);
  assert.equal(parsed.fields.floors, 5);
  assert.equal(parsed.fields.hmax, 15.5);
  assert.equal(parsed.fields.buildingOrder, 'Ayrık');
  assert.equal(parsed.fieldEvidence.floors.method, 'floor-zemin-plus-label');
  assert.match(parsed.fieldEvidence.floors.excerpt, /Z\+4/i);
});

test('v3.6 OCR ile ayrı satıra düşen net alan ve oran değerlerini yalnız sıkı etiketle okur', () => {
  const parsed = parse([
    'Net İmar Parseli Alanı:',
    '900,25 m2',
    'TAKS:',
    '0,30',
    'KAKS:',
    '1,80'
  ]);
  assert.equal(parsed.fields.netParcelArea, 900.25);
  assert.equal(parsed.fields.taks, 0.3);
  assert.equal(parsed.fields.emsal, 1.8);

  const generic = parse(['Parsel yüzölçümü:', '900,25 m2', 'TAKS:', '0,30']);
  assert.equal(generic.fields.netParcelArea, undefined, 'kadastro yüzölçümü net imar alanına çevrilmemeli');
});

test('v3.6 yol genişliğine ve cepheye bağlı çekmeleri ayrı koşullar olarak korur', () => {
  const parsed = parse([
    "Ön bahçe mesafesi: 12 m ve üzeri yollarda 5 m, 12 m'den dar yollarda 7 m",
    'Yan bahçe mesafesi: Sağ 3 m, Sol 4 m',
    'Arka bahçe mesafesi: en az 4 m'
  ]);

  assert.equal(parsed.fields.frontSetback, undefined);
  assert.equal(parsed.fields.sideSetback, undefined);
  assert.equal(parsed.fields.rearSetback, 4);
  assert.deepEqual(parsed.fields.setbackConditions.map(({ type, qualifier, value }) => ({ type, qualifier, value })), [
    { type: 'front', qualifier: '12 M Ve Üzeri Yollarda', value: 5 },
    { type: 'front', qualifier: "12 M'den Dar Yollarda", value: 7 },
    { type: 'side', qualifier: 'Sağ', value: 3 },
    { type: 'side', qualifier: 'Sol', value: 4 },
    { type: 'rear', qualifier: null, value: 4 }
  ]);
  assert.ok(parsed.fields.setbackConditions.every((item) => item.excerpt && item.confidence === 'high' && item.method));
});

test('v3.6 her belge alanında kaynak, belge tarihi, alınma tarihi, güven ve alıntıyı korur', () => {
  const metadata = {
    sourceTitle: 'Örnek Belediyesi 101/22 İmar Durumu',
    sourceUrl: 'https://example.bel.tr/imar/101-22.pdf',
    documentDate: '25.08.2026',
    retrievedAt: '2026-08-25T03:00:00.000Z'
  };
  const parsed = parse(['TAKS: 0,30', 'KAKS: 1,80', 'Ön bahçe: 5 m'], metadata);

  for (const field of ['taks', 'emsal', 'frontSetback']) {
    const evidence = parsed.fieldEvidence[field];
    assert.equal(evidence.sourceTitle, metadata.sourceTitle);
    assert.equal(evidence.sourceUrl, metadata.sourceUrl);
    assert.equal(evidence.documentDate, '2026-08-25');
    assert.equal(evidence.retrievedAt, metadata.retrievedAt);
    assert.equal(evidence.parserVersion, '3.6.0');
    assert.equal(evidence.parcelMatchStatus, 'exact');
    assert.ok(evidence.excerpt);
    assert.ok(['high', 'medium'].includes(evidence.confidence));
  }
  assert.equal(parsed.evidence.documentDate, '2026-08-25');
  assert.equal(parsed.evidence.retrievedAt, metadata.retrievedAt);
});

test('v3.6 doğrulanmış net alanla hesaplar; net alan yoksa kadastro fallbackini açıkça bildirir', () => {
  const netAnalysis = buildParcelAnalysis({
    parcel: parcel(1000),
    zoning: { status: 'user-evidence', conflict: false, fields: { netParcelArea: 800, taks: 0.25, emsal: 1.5 } },
    environment: { status: 'available', items: [], categories: [] }
  });
  assert.equal(netAnalysis.version, '3.6.0');
  assert.equal(netAnalysis.calculationBasis.kind, 'net-imar-parseli-alani');
  assert.equal(netAnalysis.metrics.footprint.value, 200);
  assert.equal(netAnalysis.metrics.construction.value, 1200);
  assert.equal(netAnalysis.metrics.outside.value, 600);

  const fallback = buildParcelAnalysis({
    parcel: parcel(1000),
    zoning: { status: 'verified', conflict: false, fields: { taks: 0.25, emsal: 1.5 } },
    environment: { status: 'available', items: [], categories: [] }
  });
  assert.equal(fallback.calculationBasis.kind, 'kadastro-parsel-alani');
  assert.equal(fallback.calculationBasis.fallbackUsed, true);
  assert.equal(fallback.metrics.footprint.value, 250);
  assert.equal(fallback.metrics.construction.value, 1500);
  assert.equal(fallback.metrics.outside.value, 750);
  assert.match(fallback.explanation, /net imar parseli alanı bulunmadığı için kadastro alanı/i);
  assert.match(fallback.warnings.map((item) => item.text).join(' '), /kadastro parsel alanı kullanıldı/i);
});

test('v3.6 kadastrodan belirgin büyük net alanı otomatik hesapta kullanmaz ve sayı uydurmaz', () => {
  const analysis = buildParcelAnalysis({
    parcel: parcel(1000),
    zoning: { status: 'verified', conflict: false, fields: { netParcelArea: 1400, taks: 0.25, emsal: 1.5 } },
    environment: { status: 'available', items: [], categories: [] }
  });
  assert.equal(analysis.calculationBasis.netParcelAreaRejected, true);
  assert.equal(analysis.calculationBasis.kind, 'kadastro-parsel-alani');
  assert.equal(analysis.metrics.footprint.value, 250);
  assert.equal(analysis.metrics.construction.value, 1500);
  assert.match(analysis.warnings.map((item) => item.text).join(' '), /otomatik hesapta kullanılmadı/i);

  const missing = buildParcelAnalysis({
    parcel: parcel(1000),
    zoning: { status: 'verified', conflict: false, fields: { netParcelArea: 800 } },
    environment: { status: 'available', items: [], categories: [] }
  });
  assert.equal(missing.metrics.footprint.value, null);
  assert.equal(missing.metrics.construction.value, null);
  assert.equal(missing.metrics.outside.value, null);
});
