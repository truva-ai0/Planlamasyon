import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { buildParcelAnalysis } from '../netlify/functions/lib/analysis-core.mjs';
import { parseZoningDocumentText } from '../netlify/functions/lib/zoning-document-parser.mjs';
import { mergeComplementaryZoningRecords } from '../netlify/functions/lib/zoning-client.mjs';

const officialDocumentText = `
T.C. ÖRNEK BELEDİYESİ
İMAR DURUMU BELGESİ
Ada: 101 Parsel: 22
Plan adı: Merkez Uygulama İmar Planı
Plan ölçeği: 1/1000
Plan onay tarihi: 25.08.2026
Plan fonksiyonu: Konut Alanı
TAKS: 0,30
KAKS (Emsal): 1,80
Kat adedi: 5
Yençok: 15,50 m
Yapı nizamı: Ayrık
Ön bahçe mesafesi: 5,00 m
Yan bahçe mesafesi: 3 m
Arka bahçe mesafesi: 4 m
`;

function parcel(area = 1000) {
  return {
    type: 'Feature',
    geometry: { type: 'Polygon', coordinates: [] },
    properties: {
      area,
      province: 'İstanbul',
      district: 'Örnek',
      neighbourhood: 'Merkez',
      block: '101',
      parcel: '22'
    }
  };
}

test('v3.5 resmî imar belgesini alanlara ve doğrulanmış yapılaşma hesaplarına uçtan uca dönüştürür', () => {
  const parsed = parseZoningDocumentText({
    text: officialDocumentText,
    query: { block: '101', parcel: '22' },
    metadata: {
      sourceTitle: 'Örnek Belediyesi İmar Durumu',
      sourceUrl: 'https://example.bel.tr/imar/101-22',
      fileName: '101-22-imar-durumu.pdf'
    }
  });

  assert.equal(parsed.canApply, true);
  assert.equal(parsed.parcelMatch.status, 'exact');
  assert.equal(parsed.completeness.percentage, 100);
  assert.deepEqual({
    landUse: parsed.fields.landUse,
    taks: parsed.fields.taks,
    emsal: parsed.fields.emsal,
    floors: parsed.fields.floors,
    hmax: parsed.fields.hmax,
    buildingOrder: parsed.fields.buildingOrder,
    frontSetback: parsed.fields.frontSetback,
    sideSetback: parsed.fields.sideSetback,
    rearSetback: parsed.fields.rearSetback
  }, {
    landUse: 'Konut Alanı',
    taks: 0.3,
    emsal: 1.8,
    floors: 5,
    hmax: 15.5,
    buildingOrder: 'Ayrık',
    frontSetback: 5,
    sideSetback: 3,
    rearSetback: 4
  });

  for (const field of ['taks', 'emsal', 'floors', 'hmax', 'frontSetback', 'sideSetback', 'rearSetback']) {
    assert.equal(parsed.fieldEvidence[field].confidence, 'high', `${field} yüksek güvenli belge kanıtı taşımalı`);
    assert.ok(parsed.fieldEvidence[field].excerpt, `${field} kaynak alıntısı taşımalı`);
  }

  const analysis = buildParcelAnalysis({
    parcel: parcel(),
    zoning: {
      status: 'user-evidence',
      conflict: false,
      fields: parsed.evidence,
      sources: [{
        id: 'official-document',
        title: parsed.evidence.sourceTitle,
        provider: parsed.evidence.authority,
        trust: 'user-evidence',
        url: parsed.evidence.sourceUrl
      }]
    },
    environment: { status: 'unavailable', categories: [], items: [] }
  });

  assert.equal(analysis.status, 'complete');
  assert.equal(analysis.metrics.footprint.value, 300);
  assert.equal(analysis.metrics.construction.value, 1800);
  assert.equal(analysis.metrics.outside.value, 700);
  assert.match(analysis.explanation, /ön tarafta 5 m, yan tarafta 3 m, arka tarafta 4 m/);
});

test('v3.5 eksik resmî değerlerden sayı, alan veya kullanım izni türetmez', () => {
  const analysis = buildParcelAnalysis({
    parcel: parcel(338),
    zoning: {
      status: 'user-evidence',
      conflict: false,
      fields: { landUse: null, taks: null, emsal: null, floors: null },
      sources: []
    },
    environment: { status: 'unavailable', categories: [], items: [] }
  });

  assert.equal(analysis.status, 'partial');
  assert.equal(analysis.metrics.floors.value, null);
  assert.equal(analysis.metrics.footprint.value, null);
  assert.equal(analysis.metrics.construction.value, null);
  assert.equal(analysis.metrics.outside.value, null);
  assert.ok(analysis.zoning.missing.includes('taks'));
  assert.ok(analysis.zoning.missing.includes('emsal'));
  assert.ok(analysis.possibilities.every((item) => item.status === 'unknown'));
  assert.doesNotMatch(JSON.stringify(analysis.metrics), /NaN|Infinity/);
});

test('v3.5 doğrulanmış net imar parseli alanını hesap temeli yapar ve kadastro alanından ayırır', () => {
  const parsed = parseZoningDocumentText({
    text: `${officialDocumentText}\nNet imar parseli alanı: 900 m²`,
    query: { block: '101', parcel: '22' },
    metadata: { sourceTitle: 'Örnek Belediyesi İmar Durumu' }
  });
  const analysis = buildParcelAnalysis({
    parcel: parcel(1000),
    zoning: {
      status: 'user-evidence',
      conflict: false,
      fields: parsed.evidence,
      sources: [{ id: 'official-document', trust: 'user-evidence', title: 'Örnek Belediyesi İmar Durumu' }]
    },
    environment: { status: 'unavailable', categories: [], items: [] }
  });

  assert.equal(parsed.fields.netParcelArea, 900);
  assert.equal(analysis.parcel.area, 1000, 'kadastro alanı ayrı korunmalı');
  assert.equal(analysis.zoning.fields.netParcelArea, 900, 'net imar alanı analiz yanıtında korunmalı');
  assert.equal(analysis.metrics.footprint.value, 270);
  assert.equal(analysis.metrics.construction.value, 1620);
  assert.equal(analysis.metrics.outside.value, 630);
  assert.match(String(analysis.metrics.footprint.basis), /net/i);
});

test('v3.5 cepheye bağlı birden fazla ön bahçe mesafesini tek sayıya indirmez', () => {
  const parsed = parseZoningDocumentText({
    text: `T.C. ÖRNEK BELEDİYESİ
İMAR DURUMU BELGESİ
Ada: 101 Parsel: 22
Plan fonksiyonu: Konut Alanı
TAKS: 0,30
KAKS (Emsal): 1,80
Kat adedi: 5
Ön bahçe mesafesi: Kuzey cephe 5 m, Güney cephe 3 m
Yan bahçe mesafesi: 3 m
Arka bahçe mesafesi: 4 m`,
    query: { block: '101', parcel: '22' }
  });
  const source = {
    id: 'conditional-setback-document',
    title: 'Örnek Belediyesi İmar Durumu',
    trust: 'user-evidence',
    fieldEvidence: parsed.fieldEvidence
  };
  const merged = mergeComplementaryZoningRecords([{ fields: parsed.fields, source }]);
  const frontConditions = merged.fields.setbackConditions.filter((item) => item.type === 'front');

  assert.equal(parsed.fields.frontSetback, undefined);
  assert.equal(merged.fields.frontSetback, null);
  assert.deepEqual(frontConditions.map(({ qualifier, value }) => ({ qualifier, value })), [
    { qualifier: 'Kuzey', value: 5 },
    { qualifier: 'Güney', value: 3 }
  ]);
  assert.equal(merged.fieldSources.setbackConditions.id, source.id);
});

test('v3.5 belge okuma sonucundaki net alan ve koşullu çekmeler formdan analiz isteğine kaybolmadan geçer', async () => {
  const app = await readFile(new URL('../dist/app.js', import.meta.url), 'utf8');

  assert.match(app, /const names\s*=\s*\[[^\]]*['"]netParcelArea['"]/s);
  assert.match(app, /const names\s*=\s*\[[^\]]*['"]setbackConditions['"]/s);
  assert.match(app, /netParcelArea\s*:\s*number\(['"]netParcelArea['"]\)/);
  assert.match(app, /setbackConditions\s*[:,]/);
});

test('v3.5 her imar alanının kaynak, tarih, belge kanıtı ve güven bilgisini korur', () => {
  const source = {
    id: 'official-document',
    title: 'Örnek Belediyesi İmar Durumu',
    provider: 'Örnek Belediyesi',
    trust: 'user-evidence',
    url: 'https://example.bel.tr/imar/101-22',
    documentDate: '2026-08-25',
    retrievedAt: '2026-08-25T01:00:00.000Z',
    extractionConfidence: 'high',
    fieldEvidence: {
      taks: { confidence: 'high', excerpt: 'TAKS: 0,30', method: 'taks-label' },
      emsal: { confidence: 'high', excerpt: 'KAKS (Emsal): 1,80', method: 'kaks-label' }
    }
  };
  const merged = mergeComplementaryZoningRecords([{ fields: { taks: 0.3, emsal: 1.8 }, source }]);

  for (const field of ['taks', 'emsal']) {
    assert.equal(merged.fieldSources[field].id, source.id);
    assert.equal(merged.fieldSources[field].documentDate, source.documentDate);
    assert.equal(merged.fieldSources[field].retrievedAt, source.retrievedAt);
    assert.equal(merged.fieldSources[field].confidence, 'high');
    assert.ok(merged.fieldSources[field].excerpt);
    assert.ok(merged.fieldSources[field].method);
  }
});

test('v3.5 manuel kaynakta yeniden tarama yerine resmî portal ve belge CTA akışını gösterir', async () => {
  const [app, html] = await Promise.all([
    readFile(new URL('../dist/app.js', import.meta.url), 'utf8'),
    readFile(new URL('../dist/index.html', import.meta.url), 'utf8')
  ]);

  assert.match(app, /onlyManualOnly/);
  assert.match(app, /canRetryRemaining\s*=\s*!onlyManualOnly/);
  assert.match(app, /retrySourceScanButton\.hidden\s*=\s*!canRetryRemaining/);
  assert.match(html, /id="primaryOfficialServiceLink"/);
  assert.match(html, /id="addEvidenceButton"/);
  assert.doesNotMatch(html, />Son Çare:\s*Resmî Belge Ekle</);
});

test('v3.5 Plan AI teknik hata kodlarını kullanıcıya yazdırmaz', async () => {
  const app = await readFile(new URL('../dist/app.js', import.meta.url), 'utf8');
  assert.doesNotMatch(app, /result\.notice\s*\|\|\s*result\.errorCode/);
  assert.doesNotMatch(app, /Sınırlı mod[^\n]*PLAN_AI_/);
});

test('v3.5 mobil hızlı özette kadastro, imar ve AI durumu ayrı işaretlenir', async () => {
  const [app, html, css] = await Promise.all([
    readFile(new URL('../dist/app.js', import.meta.url), 'utf8'),
    readFile(new URL('../dist/index.html', import.meta.url), 'utf8'),
    readFile(new URL('../dist/styles.css', import.meta.url), 'utf8')
  ]);

  assert.match(html, /id="mobileSummaryCadastre"/);
  assert.match(html, /id="mobileSummaryZoning"/);
  assert.match(html, /id="cadastreStatusChip"[^>]*>Kadastro doğrulandı</);
  assert.match(html, /id="zoningStatusChip"/);
  assert.match(html, /id="aiStatusChip"[^>]*>AI isteğe bağlı</);
  assert.match(app, /cadastreStatusChip/);
  assert.match(app, /zoningStatusChip/);
  assert.match(app, /aiStatusChip/);
  assert.match(css, /verification-chip/);
});
