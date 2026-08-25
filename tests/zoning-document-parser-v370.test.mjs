import test from 'node:test';
import assert from 'node:assert/strict';

import { buildParcelAnalysis } from '../netlify/functions/lib/analysis-core.mjs';
import { parseZoningDocumentText } from '../netlify/functions/lib/zoning-document-parser.mjs';
import { mergeComplementaryZoningRecords } from '../netlify/functions/lib/zoning-client.mjs';

const query = { province: 'İstanbul', district: 'Örnek', neighbourhood: 'Merkez', block: '101', parcel: '22' };

function parse(lines, metadata = {}) {
  return parseZoningDocumentText({
    text: ['T.C. ÖRNEK BELEDİYESİ', 'İMAR DURUMU BELGESİ', ...lines].join('\n'),
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

test('OCR bozulmuş etiketleri ve yalnızca sayısal bağlamdaki O/l karışıklıklarını güvenli okur', () => {
  const parsed = parse([
    'A D A  N O : l0l   P A R S E L  N O : 022',
    'N E T  İ M A R  P A R S E L İ  A L A N I',
    'l.250,50 m2',
    'T . A . K . 5',
    '% 3O',
    'K . A . K . 5',
    'l,8O',
    'Y E N Ç O K : Z + 4 K A T',
    'H . M A K 5 : l5,5O m',
    'Y A P I  N İ Z A M I : A-5',
    'Ö N  B A H Ç E : 5,OO mt',
    'Y A N  B A H Ç E : S A Ğ 3,OO m, S O L 4,OO m',
    'A R K A  B A H Ç E : 4,OO m'
  ]);

  assert.equal(parsed.parcelMatch.status, 'exact');
  assert.equal(parsed.fields.netParcelArea, 1250.5);
  assert.equal(parsed.fields.taks, 0.3);
  assert.equal(parsed.fields.emsal, 1.8);
  assert.equal(parsed.fields.floors, 5);
  assert.equal(parsed.fields.hmax, 15.5);
  assert.equal(parsed.fields.buildingOrder, 'Ayrık');
  assert.equal(parsed.fields.frontSetback, 5);
  assert.equal(parsed.fields.sideSetback, undefined);
  assert.equal(parsed.fields.rearSetback, 4);
  assert.deepEqual(parsed.fields.setbackConditions.filter((item) => item.type === 'side').map(({ qualifier, value }) => ({ qualifier, value })), [
    { qualifier: 'Sağ', value: 3 },
    { qualifier: 'Sol', value: 4 }
  ]);
  assert.equal(parsed.fieldEvidence.taks.confidence, 'medium', 'OCR onarımı yüksek güven diye sunulmamalı');
  assert.match(parsed.fieldEvidence.taks.method, /ocr/i);
});

test('TAKS/KAKS aralık ve koşullarını tek değere indirmez, kaynak kanıtıyla korur', () => {
  const metadata = {
    sourceTitle: 'Örnek Belediyesi Plan Notu',
    sourceUrl: 'https://example.bel.tr/plan-notu.pdf',
    documentDate: '25.08.2026',
    retrievedAt: '2026-08-25T09:00:00.000Z'
  };
  const parsed = parse([
    'Ada No: 101 Parsel No: 22',
    '15 m ve üzeri yollarda TAKS: 0,30; 15 m\'den dar yollarda TAKS: 0,25',
    'KAKS / EMSAL: 1,20 - 1,80',
    'Kat adedi: 5'
  ], metadata);

  assert.equal(parsed.fields.taks, undefined);
  assert.equal(parsed.fields.emsal, undefined);
  assert.deepEqual(parsed.conditionalFields.taks.map(({ value }) => value), [0.3, 0.25]);
  assert.deepEqual(parsed.conditionalFields.emsal.map(({ value }) => value), [1.2, 1.8]);
  for (const item of [...parsed.conditionalFields.taks, ...parsed.conditionalFields.emsal]) {
    assert.ok(item.excerpt);
    assert.equal(item.sourceTitle, metadata.sourceTitle);
    assert.equal(item.sourceUrl, metadata.sourceUrl);
    assert.equal(item.documentDate, '2026-08-25');
    assert.equal(item.retrievedAt, metadata.retrievedAt);
    assert.equal(item.parcelMatchStatus, 'exact');
  }
  assert.match(parsed.warnings.join(' '), /tek bir.*değer.*uygulanmadı/i);
});

test('parantez sonundaki yol koşullarını ve ortak birimli sağ/sol çekmeleri kaybetmez', () => {
  const parsed = parse([
    'Ada: 101 Parsel: 22',
    "Ön bahçe mesafesi: 5 m (20 m ve üzeri yol), 7 m (20 m'den dar yol)",
    'Yan bahçe mesafesi: sağ 3 / sol 4 m',
    'Arka bahçe mesafesi: 4,50 mt.'
  ]);

  assert.equal(parsed.fields.frontSetback, undefined);
  assert.equal(parsed.fields.sideSetback, undefined);
  assert.equal(parsed.fields.rearSetback, 4.5);
  assert.deepEqual(parsed.fields.setbackConditions.filter((item) => item.type === 'front').map(({ qualifier, value }) => ({ qualifier, value })), [
    { qualifier: '20 M Ve Üzeri Yol', value: 5 },
    { qualifier: "20 M'den Dar Yol", value: 7 }
  ]);
  assert.deepEqual(parsed.fields.setbackConditions.filter((item) => item.type === 'side').map(({ qualifier, value }) => ({ qualifier, value })), [
    { qualifier: 'Sağ', value: 3 },
    { qualifier: 'Sol', value: 4 }
  ]);
});

test('iptal edilmiş, eski veya taslak yapılaşma değerlerini güncel hak gibi kullanmaz', () => {
  const parsed = parse([
    'Ada: 101 Parsel: 22',
    'Eski TAKS: 0,40 değeri iptal edilmiştir.',
    'Öneri KAKS: 2,00 (taslak çalışma)',
    'Yürürlükten kaldırılan kat adedi: 8 kat',
    'Parsel alanı: 900 m2',
    'Ölçek: 1/1000'
  ]);

  assert.equal(parsed.fields.taks, undefined);
  assert.equal(parsed.fields.emsal, undefined);
  assert.equal(parsed.fields.floors, undefined);
  assert.equal(parsed.fields.netParcelArea, undefined);
  assert.ok(parsed.ignoredCandidates.length >= 3);
  assert.match(parsed.warnings.join(' '), /iptal|taslak|eski/i);
});

test('net alan etiketi olmadan kadastro alanını ve plan ölçeğini imar hesabına karıştırmaz', () => {
  const parsed = parse([
    'Ada No 101 / Parsel No 22',
    'Parsel yüzölçümü 1.250,50 m2',
    'Uygulama imar planı ölçeği 1/1000',
    'Plan açıklamasında 10 katlı bina fotoğrafı bulunmaktadır.'
  ]);
  assert.equal(parsed.fields.netParcelArea, undefined);
  assert.equal(parsed.fields.taks, undefined);
  assert.equal(parsed.fields.emsal, undefined);
  assert.equal(parsed.fields.floors, undefined);
});

test('hesap motoru düşük güvenli veya parseli uyuşmayan alanı hesaplamaz fakat kanıtlı alanı korur', () => {
  const analysis = buildParcelAnalysis({
    parcel: parcel(1000),
    zoning: {
      status: 'user-evidence',
      conflict: false,
      fields: { netParcelArea: 800, taks: 0.3, emsal: 1.5, floors: 5 },
      fieldSources: {
        netParcelArea: { confidence: 'high', parcelMatchStatus: 'exact' },
        taks: { confidence: 'low', parcelMatchStatus: 'exact' },
        emsal: { confidence: 'high', parcelMatchStatus: 'exact' },
        floors: { confidence: 'high', parcelMatchStatus: 'mismatch' }
      }
    },
    environment: { status: 'available', items: [], categories: [] }
  });

  assert.equal(analysis.metrics.footprint.value, null);
  assert.equal(analysis.metrics.construction.value, 1200);
  assert.equal(analysis.metrics.floors.value, null);
  assert.deepEqual(analysis.calculationBasis.excludedFields.sort(), ['floors', 'taks']);
  assert.ok(analysis.zoning.missing.includes('taks'));
  assert.ok(analysis.zoning.missing.includes('floors'));
  assert.match(analysis.warnings.map((item) => item.text).join(' '), /düşük okuma güveni|parsel eşleşmesi/i);
});

test('koşullu TAKS/KAKS aktarılsa bile hesap motoru hangi koşulun geçerli olduğunu varsaymaz', () => {
  const analysis = buildParcelAnalysis({
    parcel: parcel(1000),
    zoning: {
      status: 'user-evidence',
      conflict: false,
      fields: {
        conditionalFields: {
          taks: [{ qualifier: '15 m yol', value: 0.3 }, { qualifier: 'dar yol', value: 0.25 }],
          emsal: [{ qualifier: 'A bölgesi', value: 1.5 }, { qualifier: 'B bölgesi', value: 1.2 }]
        }
      }
    },
    environment: { status: 'available', items: [], categories: [] }
  });

  assert.equal(analysis.metrics.footprint.value, null);
  assert.equal(analysis.metrics.construction.value, null);
  assert.equal(analysis.zoning.fields.conditionalFields.taks.length, 2);
  assert.match(analysis.warnings.map((item) => item.text).join(' '), /koşullu.*tek bir değer/i);
});

test('yalnız belgede açıkça m² olarak yazılan bahçe alanlarını okur ve analiz/merge yolunda kanıtıyla korur', () => {
  const parsed = parse([
    'Ada: 101 Parsel: 22',
    'Ön bahçe alanı: 120,50 m²',
    'Yan bahçe alanı: 45 m2',
    'Arka bahçe alanı:',
    '80,25 metrekare',
    'Ön bahçe mesafesi: 5 m',
    'Yan bahçe mesafesi: 3 m',
    'Arka bahçe mesafesi: 4 m'
  ], { sourceTitle: 'Örnek Belediyesi İmar Durumu', sourceUrl: 'https://example.bel.tr/imar.pdf' });

  assert.equal(parsed.fields.frontGardenArea, 120.5);
  assert.equal(parsed.fields.sideGardenArea, 45);
  assert.equal(parsed.fields.rearGardenArea, 80.25);
  assert.equal(parsed.fields.frontSetback, 5, 'alan değeri çekme mesafesine karışmamalı');
  for (const field of ['frontGardenArea', 'sideGardenArea', 'rearGardenArea']) {
    assert.ok(parsed.fieldEvidence[field].excerpt);
    assert.equal(parsed.fieldEvidence[field].sourceTitle, 'Örnek Belediyesi İmar Durumu');
    assert.match(parsed.fieldEvidence[field].method, /garden-area-explicit-label/);
  }

  const source = {
    id: 'garden-area-document', title: 'Örnek Belediyesi İmar Durumu', trust: 'user-evidence',
    fieldEvidence: parsed.fieldEvidence, parcelMatchStatus: 'exact'
  };
  const merged = mergeComplementaryZoningRecords([{ fields: parsed.fields, source }]);
  assert.equal(merged.fields.frontGardenArea, 120.5);
  assert.equal(merged.fields.sideGardenArea, 45);
  assert.equal(merged.fields.rearGardenArea, 80.25);
  assert.equal(merged.fieldSources.frontGardenArea.id, source.id);

  const analysis = buildParcelAnalysis({
    parcel: parcel(1000),
    zoning: { status: 'user-evidence', conflict: false, fields: merged.fields, fieldSources: merged.fieldSources },
    environment: { status: 'available', items: [], categories: [] }
  });
  assert.equal(analysis.zoning.fields.frontGardenArea, 120.5);
  assert.equal(analysis.zoning.fields.sideGardenArea, 45);
  assert.equal(analysis.zoning.fields.rearGardenArea, 80.25);

  const distanceOnly = parse(['Ada: 101 Parsel: 22', 'Ön bahçe mesafesi: 5 m', 'Yan bahçe mesafesi: 3 m', 'Arka bahçe mesafesi: 4 m']);
  assert.equal(distanceOnly.fields.frontGardenArea, undefined);
  assert.equal(distanceOnly.fields.sideGardenArea, undefined);
  assert.equal(distanceOnly.fields.rearGardenArea, undefined);
});
