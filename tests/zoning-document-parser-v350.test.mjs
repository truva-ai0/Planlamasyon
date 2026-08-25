import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { parseZoningDocumentText } from '../netlify/functions/lib/zoning-document-parser.mjs';

const query = { province: 'Deneme', district: 'Merkez', neighbourhood: 'Örnek', block: '123', parcel: '45' };

function parse(lines) {
  return parseZoningDocumentText({
    text: ['Deneme Belediyesi İmar Durumu Belgesi', 'Ada: 123 Parsel: 45', ...lines].join('\n'),
    query
  });
}

test('Türkçe ondalık, yüzde TAKS, noktalı KAKS ve açık net imar parseli alanını okur', () => {
  const parsed = parse([
    'Net İmar Parseli Alanı: 1.234,56 m²',
    'T.A.K.S.: %30',
    'K.A.K.S. (Emsal) = 1,80',
    'H.MAX = 15,50',
    'Ön yapı yaklaşma mesafesi: 5,00 m',
    'Yan yapı yaklaşma mesafesi: 3,25 metre',
    'Arka çekme: 4 m'
  ]);

  assert.equal(parsed.fields.netParcelArea, 1234.56);
  assert.equal(parsed.fields.taks, 0.3);
  assert.equal(parsed.fields.emsal, 1.8);
  assert.equal(parsed.fields.hmax, 15.5);
  assert.equal(parsed.fields.frontSetback, 5);
  assert.equal(parsed.fields.sideSetback, 3.25);
  assert.equal(parsed.fields.rearSetback, 4);
  assert.equal(parsed.fieldEvidence.netParcelArea.method, 'net-parcel-area-label');
  assert.equal(parsed.evidence.netParcelArea, 1234.56);
});

test('E= kısaltmasını ve TAKS değerinden sonra yazılan yüzde işaretini destekler', () => {
  const parsed = parse(['TAKS: 35%', 'E=2.50', 'Yen Çok (kat): 6 kat']);
  assert.equal(parsed.fields.taks, 0.35);
  assert.equal(parsed.fields.emsal, 2.5);
  assert.equal(parsed.fields.floors, 6);
  assert.equal(parsed.fields.hmax, undefined);
});

test('üç basamaklı oran ondalığını binlik ayırıcı sanmaz', () => {
  const parsed = parse(['TAKS: 0.250', 'KAKS: 1.250']);
  assert.equal(parsed.fields.taks, 0.25);
  assert.equal(parsed.fields.emsal, 1.25);
});

test('yüzde işareti etiketten önce veya değerle birlikte önde yazılan TAKS biçimlerini okur', () => {
  assert.equal(parse(['% TAKS: 30']).fields.taks, 0.3);
  assert.equal(parse(['%30 TAKS']).fields.taks, 0.3);
});

test('Yençok kat ile Yençok/Hmax metre değerini birbirine karıştırmaz', () => {
  const floors = parse(['YENÇOK: 8 KAT']);
  assert.equal(floors.fields.floors, 8);
  assert.equal(floors.fields.hmax, undefined);

  const height = parse(['YEN ÇOK: 24,50 METRE']);
  assert.equal(height.fields.hmax, 24.5);
  assert.equal(height.fields.floors, undefined);

  const explicitHeightWithoutUnit = parse(['H.MAKS: 18.50']);
  assert.equal(explicitHeightWithoutUnit.fields.hmax, 18.5);
  assert.equal(explicitHeightWithoutUnit.fields.floors, undefined);
});

test('çok cepheli ve sağ/sol yan bahçe koşullarını ayrı saklar, tek değer uydurmaz', () => {
  const parsed = parse([
    'ÖN BAHÇE MESAFESİ: KUZEY CEPHESİ 5 m, DOĞU CEPHESİ 7 m',
    'YAN BAHÇE MESAFESİ: SAĞ 3 m, SOL 4 m',
    'ARKA BAHÇE MESAFESİ: 4 m'
  ]);

  assert.equal(parsed.fields.frontSetback, undefined);
  assert.equal(parsed.fields.sideSetback, undefined);
  assert.equal(parsed.fields.rearSetback, 4);
  assert.deepEqual(parsed.fields.setbackConditions.map(({ type, qualifier, value, unit }) => ({ type, qualifier, value, unit })), [
    { type: 'front', qualifier: 'Kuzey', value: 5, unit: 'm' },
    { type: 'front', qualifier: 'Doğu', value: 7, unit: 'm' },
    { type: 'side', qualifier: 'Sağ', value: 3, unit: 'm' },
    { type: 'side', qualifier: 'Sol', value: 4, unit: 'm' },
    { type: 'rear', qualifier: null, value: 4, unit: 'm' }
  ]);
  assert.deepEqual(parsed.evidence.setbackConditions, parsed.fields.setbackConditions);
  assert.match(parsed.warnings.join(' '), /tek bir çekme mesafesi seçilmedi/i);
});

test('aynı mesafeye sahip birden fazla cephe koşulunu korur ve ortak skaları güvenle doldurur', () => {
  const parsed = parse(['Ön bahçe mesafesi: Kuzey cephesi 5 m, Doğu cephesi 5 m']);
  assert.equal(parsed.fields.frontSetback, 5);
  assert.deepEqual(parsed.fields.setbackConditions.map((item) => item.qualifier), ['Kuzey', 'Doğu']);
  assert.doesNotMatch(parsed.warnings.join(' '), /tek bir çekme mesafesi seçilmedi/i);
});

test('bahçe çekme ve yapı yaklaşma etiketi varyantlarını okur', () => {
  const parsed = parse([
    'Ön bahçe çekme mesafesi = 5 m',
    'Yan yapı yaklaşma: 3,50 m',
    'Arka bahçe çekme mesafesi: 4 metre'
  ]);
  assert.equal(parsed.fields.frontSetback, 5);
  assert.equal(parsed.fields.sideSetback, 3.5);
  assert.equal(parsed.fields.rearSetback, 4);
});

test('sıradan kadastro/parsel alanını net imar parseli alanı olarak tahmin etmez', () => {
  const parsed = parse(['Parsel alanı: 987,65 m²', 'TAKS: 0,30']);
  assert.equal(parsed.fields.netParcelArea, undefined);
  assert.equal(parsed.evidence.netParcelArea, null);
});

test('Beşiktaş HTML algılayıcısındaki T.C. boşluk ifadesi gerçek whitespace deseni kullanır', async () => {
  const source = await readFile(new URL('../netlify/functions/parse-zoning-document.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /T\.C\.s\*Beşiktaş/);
  assert.match(source, /T\\\.\?\\s\*C/);
});
