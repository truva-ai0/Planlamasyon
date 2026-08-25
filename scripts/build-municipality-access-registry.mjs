import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const projectRoot = resolve(import.meta.dirname, '..');
const auditPath = resolve(projectRoot, '..', 'audit', 'municipality-audit-data.json');
const eDevletPath = resolve(projectRoot, '..', 'artifacts', 'edevlet_belediye_imar_hizmetleri_2026-08-25.json');
const jsonOutputPath = resolve(projectRoot, 'dist', 'data', 'municipality-access-registry.json');
const moduleOutputPath = resolve(projectRoot, 'netlify', 'functions', 'lib', 'municipality-access-registry.mjs');

const audit = JSON.parse(await readFile(auditPath, 'utf8'));
const eDevlet = JSON.parse(await readFile(eDevletPath, 'utf8'));
const serviceByUrl = new Map((eDevlet.records || []).map((record) => [canonicalUrl(record.service_url), record]));

const municipalities = (audit.rows || []).map((row) => {
  const services = [...new Set(row.eImarUrls || [])]
    .map((url, index) => buildService(row, url, serviceByUrl.get(canonicalUrl(url)), index))
    .filter(Boolean);
  return compact({
    id: row.municipalityId,
    institutionCode: row.institutionCode,
    province: row.province,
    district: row.district,
    municipalityName: row.municipalityName,
    authority: row.authority,
    municipalityType: row.municipalityType,
    officialSiteUrl: safeHttps(row.officialSiteUrl),
    officialSiteStatus: row.accessClass === 'A1 - Açık portal' ? 'verified-public-portal' : row.officialSiteUrl ? 'candidate-not-live-audited' : 'not-listed',
    accessClass: row.accessClass,
    accessClassKey: accessClassKey(row.accessClass),
    authRequired: row.authRequired,
    captcha: row.captcha,
    automationPermission: row.automationPermission,
    confidence: row.confidence,
    portalFamily: row.portalFamily,
    serviceCount: services.length,
    lastCheckedAt: row.lastCheckedAt,
    termsUrl: safeHttps(row.termsUrl),
    notes: row.notes,
    services
  });
});

if (municipalities.length !== 1407) throw new Error(`Beklenen 1.407 belediye yerine ${municipalities.length} kayıt üretildi.`);

const stats = Object.freeze({
  totalMunicipalities: municipalities.length,
  auditedAccessCount: Number(audit.counts?.withKnownService || 0),
  pendingAccessCount: Number(audit.counts?.byAccessClass?.BEKLIYOR || 0),
  openPortalCount: Number(audit.counts?.byAccessClass?.['A1 - Açık portal'] || 0),
  eDevletOrSsoCount: Number(audit.counts?.byAccessClass?.['A4 - e-Devlet/SSO'] || 0),
  eDevletServiceCount: Number(audit.counts?.eDevletServiceCount || 0),
  officialSiteCandidateCount: Number(audit.counts?.withOfficialSiteCandidate || 0),
  sourceInventoryDate: '2026-04-21',
  auditDate: audit.inventoryDate || '2026-08-25'
});

const output = {
  schemaVersion: '1.0',
  registryVersion: '2026-08-25-v3.8.0',
  generatedAt: new Date().toISOString(),
  scope: 'Türkiye resmî belediye envanteri ve güvenli imar hizmeti yönlendirme kayıtları',
  safetyNotice: 'Bağlantı bulunması otomatik veri çekme izni değildir. e-Devlet şifresi yalnız turkiye.gov.tr ekranında girilir; Planlamasyon kimlik bilgisi veya oturum verisi istemez ve saklamaz.',
  source: {
    authority: 'T.C. Çevre, Şehircilik ve İklim Değişikliği Bakanlığı / Yerel Yönetimler Genel Müdürlüğü',
    inventoryDate: '2026-04-21',
    inventoryUrl: 'https://yerelyonetimler.csb.gov.tr/2026-2028-butce-hazirlama-rehberi-113107',
    eDevletAuditDate: '2026-08-25',
    accessAuditStatus: '162 belediye sınıflandırıldı; 1.245 kayıt canlı erişim denetimi bekliyor'
  },
  stats,
  municipalities
};

await writeFile(jsonOutputPath, `${JSON.stringify(output, null, 2)}\n`);
const moduleText = `// Otomatik üretilmiştir: scripts/build-municipality-access-registry.mjs\n`
  + `// Bağlantı bulunması otomatik sorgu izni veya imar hakkı doğrulaması değildir.\n\n`
  + `export const MUNICIPALITY_ACCESS_REGISTRY_VERSION = ${JSON.stringify(output.registryVersion)};\n`
  + `export const MUNICIPALITY_ACCESS_REGISTRY_STATS = Object.freeze(${JSON.stringify(stats)});\n`
  + `export const MUNICIPALITY_ACCESS_REGISTRY = Object.freeze(${JSON.stringify(municipalities)});\n`;
await writeFile(moduleOutputPath, moduleText);

console.log(`v3.8 belediye erişim kaydı üretildi: ${municipalities.length} belediye, ${municipalities.reduce((sum, item) => sum + item.services.length, 0)} hizmet bağlantısı.`);

function buildService(row, rawUrl, evidence = {}, index = 0) {
  const url = safeHttps(rawUrl);
  if (!url) return null;
  const isEDevlet = new URL(url).hostname.toLowerCase().endsWith('turkiye.gov.tr');
  const manualOnly = row.accessClass === 'A1 - Açık portal';
  const serviceName = evidence?.service_name || (isEDevlet ? 'e-Devlet imar hizmeti' : 'Resmî imar portalı');
  const authentication = authenticationText(evidence?.authentication_status, row.authRequired, isEDevlet);
  return compact({
    id: `${row.municipalityId}-service-${index + 1}`,
    title: serviceName,
    provider: isEDevlet ? `${row.authority} / e-Devlet Kapısı` : row.authority,
    url,
    kind: 'municipality-portal',
    status: manualOnly ? 'manual-only' : 'official-service-found',
    accessMode: manualOnly ? 'manual-only' : isEDevlet ? 'official-login-service' : 'official-service',
    authentication,
    authenticationStatus: evidence?.authentication_status,
    pageState: evidence?.page_state,
    availabilityStatus: evidence?.availability_status,
    verifiedAt: row.lastCheckedAt || evidence?.observed_at || '2026-08-25',
    termsUrl: safeHttps(row.termsUrl),
    note: manualOnly
      ? 'Resmî portal kullanıcı tarafından açılır. Kullanım koşulları ve izin durumu nedeniyle Planlamasyon otomatik form işlemi yapmaz.'
      : isEDevlet
        ? 'Resmî hizmet yeni sekmede açılır. Sonuç ekranı oturum isteyebilir; Planlamasyon e-Devlet şifresini, çerezini veya oturumunu istemez ve okumaz.'
        : 'Resmî bağlantı kullanıcı tarafından açılır; bağlantı bulunması otomatik veri aktarımı anlamına gelmez.',
    machineReadableCandidate: false,
    automatedQueryAllowed: false,
    dataClaim: 'not-read'
  });
}

function authenticationText(status, fallback, isEDevlet) {
  if (status === 'required') return 'e-Devlet girişi gerekli';
  if (status === 'anonymous_first_step_observed') return 'İlk adım girişsiz görüldü; sonuç oturumu belirsiz';
  if (status === 'required_inferred_from_url') return 'e-Devlet girişi bekleniyor';
  if (isEDevlet) return fallback || 'Hizmete göre';
  return fallback || 'Bilinmiyor';
}

function accessClassKey(value) {
  if (value === 'A1 - Açık portal') return 'A1';
  if (value === 'A4 - e-Devlet/SSO') return 'A4';
  return 'PENDING';
}

function safeHttps(value) {
  if (!value) return null;
  try {
    const url = new URL(String(value));
    return url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

function canonicalUrl(value) {
  const safe = safeHttps(value);
  if (!safe) return '';
  const url = new URL(safe);
  url.hash = '';
  return url.toString().replace(/\/$/, '');
}

function compact(object) {
  return Object.fromEntries(Object.entries(object).filter(([, value]) => value !== null && value !== undefined && value !== ''));
}
