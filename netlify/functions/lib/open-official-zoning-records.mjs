import { normalizeZoningFields } from './analysis-core.mjs';
import { describeSourceFreshness, isOfficialTurkishHost, safePublicHttpsUrl } from './official-source-security.mjs';

export const OPEN_OFFICIAL_ZONING_RECORD_VERSION = '2026-08-27-v3.8.1';

/**
 * Ada/parseli açıkça yazan, kamuya açık resmî kayıtlar için gömülü kanıt dizini.
 * Bu kayıtlar tek bir parsele özel kod yolu oluşturmaz; aynı şema yeni resmî
 * kayıtlar ve OPEN_OFFICIAL_ZONING_RECORDS_JSON girdileri için de kullanılır.
 */
export const EMBEDDED_OPEN_OFFICIAL_ZONING_RECORDS = Object.freeze([
  Object.freeze({
    id: 'ilan-gov-tr-2182931-istanbul-arnavutkoy-tasoluk-6597-2',
    province: 'İstanbul',
    district: 'Arnavutköy',
    neighbourhood: 'Taşoluk',
    block: '6597',
    parcel: '2',
    expectedParcelArea: 111,
    authority: 'Arnavutköy Belediyesi',
    sourceTitle: 'Gaziosmanpaşa İcra Dairesi 2025/1947 Talimat Dosyası',
    sourceProvider: 'ilan.gov.tr / Gaziosmanpaşa İcra Dairesi',
    sourceUrl: 'https://www.ilan.gov.tr/ilan/2182931/uyap-e-satis-satilik-tasinmazlar-gaziosmanpasa-icra-dairesi-2025-1947-talimat-dosyasi',
    verifiedAt: '2026-08-27',
    currentness: 'unclear',
    fields: Object.freeze({
      landUse: 'Konut Alanı',
      emsal: 0.95,
      floors: 3,
      authority: 'Arnavutköy Belediyesi',
      constraints: Object.freeze([
        'Kaynak açık resmî ilan kaydıdır; yürürlükteki plan ve güncel imar durumu ruhsat veya proje işleminden önce Arnavutköy Belediyesinden teyit edilmelidir.'
      ])
    }),
    fieldEvidence: Object.freeze({
      landUse: Object.freeze({
        value: 'Konut Alanı',
        confidence: 'high',
        method: 'exact-official-record',
        excerpt: 'Konut alanında kalmakta.'
      }),
      emsal: Object.freeze({
        value: 0.95,
        confidence: 'high',
        method: 'exact-official-record',
        excerpt: 'Emsal: 0.95'
      }),
      floors: Object.freeze({
        value: 3,
        confidence: 'high',
        method: 'exact-official-record',
        excerpt: 'Hmaks: 3 kat'
      })
    }),
    note: 'Açık resmî ilan metninde ada/parsel, konut alanı, Emsal 0.95 ve en fazla 3 kat bilgileri birlikte yer alır. Belge tarihi açıkça doğrulanamadığı için güncellik ayrıca teyit edilmelidir.'
  })
]);

export function matchOpenOfficialZoningRecords({ parcel, query = {}, configuredRecords = null } = {}) {
  const location = parcelIdentity(parcel, query);
  if (!location.block || !location.parcel) return [];
  const configured = parseConfiguredRecords(configuredRecords);
  return [...EMBEDDED_OPEN_OFFICIAL_ZONING_RECORDS, ...configured]
    .filter((record) => recordMatches(record, location))
    .map((record) => normalizeRecord(record, location))
    .filter(Boolean);
}

function parseConfiguredRecords(value) {
  if (!value) return [];
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    return Array.isArray(parsed) ? parsed : Array.isArray(parsed?.records) ? parsed.records : [];
  } catch {
    return [];
  }
}

function normalizeRecord(record, location) {
  const url = safePublicHttpsUrl(record?.sourceUrl || record?.url);
  if (!url || !isOfficialTurkishHost(new URL(url).hostname)) return null;
  const fields = normalizeZoningFields(record.fields || record.zoning || {});
  const fieldEvidence = normalizeFieldEvidence(record.fieldEvidence, fields);
  for (const field of ['landUse', 'taks', 'emsal', 'floors', 'hmax', 'buildingOrder', 'frontSetback', 'sideSetback', 'rearSetback']) {
    if (fields[field] != null && fields[field] !== '' && !fieldEvidence[field]) fields[field] = null;
  }
  if (!hasActionableField(fields)) return null;
  const retrievedAt = new Date().toISOString();
  const source = {
    id: clean(record.id, 160) || `open-official-record-${location.block}-${location.parcel}`,
    title: clean(record.sourceTitle || record.title, 320) || 'Açık resmî ada/parsel kaydı',
    provider: clean(record.sourceProvider || record.provider || record.authority, 260) || 'Resmî kamu kurumu',
    url,
    kind: 'zoning',
    trust: 'verified',
    sourceClass: 'open-official-record',
    accessMode: 'open-public-record',
    automationPolicy: 'exact-parcel-read-only',
    dataClaim: 'read-and-exact-parcel-matched',
    retrievalMode: 'embedded-verified-official-record',
    evidenceOrigin: 'official-public-record',
    sourceVerification: 'exact-parcel-and-official-host',
    parcelMatchStatus: 'exact',
    extractionConfidence: 'high',
    currentness: enumValue(record.currentness, ['current', 'applicable', 'historical', 'unclear']) || 'unclear',
    documentDate: isoDate(record.documentDate),
    verifiedAt: isoDate(record.verifiedAt),
    retrievedAt,
    scanVersion: '3.8.1',
    fieldEvidence,
    note: clean(record.note, 1200)
  };
  source.freshness = describeSourceFreshness(source);
  return {
    fields,
    source,
    message: clean(record.message, 600) || 'Ada/parsel ile birebir eşleşen açık resmî kayıttan yapılaşma koşulları otomatik alındı.'
  };
}

function normalizeFieldEvidence(value, fields) {
  const input = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const output = {};
  for (const field of ['landUse', 'taks', 'emsal', 'floors', 'hmax', 'buildingOrder', 'frontSetback', 'sideSetback', 'rearSetback']) {
    if (fields[field] == null || fields[field] === '') continue;
    const proof = input[field] && typeof input[field] === 'object' ? input[field] : {};
    if (!Object.prototype.hasOwnProperty.call(proof, 'value') || !sameValue(fields[field], proof.value)) continue;
    output[field] = {
      value: fields[field],
      confidence: enumValue(proof.confidence, ['high', 'medium', 'low']) || 'high',
      method: clean(proof.method, 100) || 'exact-official-record',
      excerpt: clean(proof.excerpt || proof.quote, 520)
    };
  }
  return output;
}

function recordMatches(record, location) {
  if (!record || normalize(record.province || record.il) !== location.provinceKey) return false;
  if (normalize(record.district || record.ilce) !== location.districtKey) return false;
  if (canonicalNumber(record.block ?? record.ada) !== location.block) return false;
  if (canonicalNumber(record.parcel ?? record.parsel) !== location.parcel) return false;
  const neighbourhood = normalize(record.neighbourhood || record.mahalle);
  if (neighbourhood && location.neighbourhoodKey && !samePlace(neighbourhood, location.neighbourhoodKey)) return false;
  const expectedArea = finitePositive(record.expectedParcelArea);
  if (expectedArea != null && location.area != null) {
    const tolerance = Math.max(0.5, expectedArea * 0.015);
    if (Math.abs(expectedArea - location.area) > tolerance) return false;
  }
  return true;
}

function parcelIdentity(parcel, query) {
  const p = parcel?.properties || {};
  const province = clean(p.province || query.province, 120);
  const district = clean(p.district || query.district, 120);
  const neighbourhood = clean(p.neighbourhood || query.neighbourhood, 160);
  return {
    provinceKey: normalize(province),
    districtKey: normalize(district),
    neighbourhoodKey: normalize(neighbourhood),
    block: canonicalNumber(p.block ?? query.block),
    parcel: canonicalNumber(p.parcel ?? query.parcel),
    area: finitePositive(p.area)
  };
}

function hasActionableField(fields) {
  return ['landUse', 'taks', 'emsal', 'floors', 'hmax', 'buildingOrder', 'frontSetback', 'sideSetback', 'rearSetback']
    .some((field) => fields?.[field] != null && fields[field] !== '');
}

function samePlace(a, b) { return a === b || a.includes(b) || b.includes(a); }
function sameValue(a, b) {
  const left = Number(String(a).replace(',', '.'));
  const right = Number(String(b).replace(',', '.'));
  if (Number.isFinite(left) && Number.isFinite(right)) return Math.abs(left - right) <= 1e-9;
  return normalize(a) === normalize(b);
}
function canonicalNumber(value) { return String(value ?? '').trim().replace(/^0+(?=\d)/, ''); }
function finitePositive(value) { const number = Number(value); return Number.isFinite(number) && number > 0 ? number : null; }
function isoDate(value) { if (!value) return null; const date = new Date(value); return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10); }
function enumValue(value, allowed) { const text = String(value || '').trim(); return allowed.includes(text) ? text : null; }
function normalize(value) { return String(value || '').toLocaleLowerCase('tr-TR').replace(/ç/g,'c').replace(/ğ/g,'g').replace(/ı/g,'i').replace(/ö/g,'o').replace(/ş/g,'s').replace(/ü/g,'u').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, ''); }
function clean(value, max = 500) { if (value == null) return null; const text = String(value).replace(/[\u0000-\u001f<>]/g, ' ').replace(/\s+/g, ' ').trim(); return text ? text.slice(0, max) : null; }
