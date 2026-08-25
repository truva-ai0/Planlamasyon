import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [index, app, styles] = await Promise.all([
  readFile(new URL('../dist/index.html', import.meta.url), 'utf8'),
  readFile(new URL('../dist/app.js', import.meta.url), 'utf8'),
  readFile(new URL('../dist/styles.css', import.meta.url), 'utf8')
]);

test('yerel profil çevrim içi hesap veya giriş gibi sunulmuyor', () => {
  assert.match(index, /Yerel kayıt/);
  assert.match(index, /Çevrim içi hesap değildir/);
  assert.match(index, /data-panel="data">Yedekle \/ Geri Yükle/);
  assert.match(app, /Bu bir çevrim içi hesap veya giriş değildir/);
  assert.match(app, /E-posta, şifre ve kimlik bilgisi saklanmaz/);
  assert.match(app, /Yalnız bu cihazda · giriş yapılmadı/);
  assert.doesNotMatch(app, /\.netlify\/identity/);
  assert.doesNotMatch(app, /\/api\/user-data/);
});

test('geçmiş, favori ve talepler doğrulanan yedekle dışa ve içe aktarılıyor', () => {
  assert.match(app, /BACKUP_FORMAT = 'planlamasyon-local-backup'/);
  assert.match(app, /BACKUP_MAX_FILE_BYTES = 2_000_000/);
  assert.match(app, /function buildLocalBackup\(\)/);
  assert.match(app, /works: readArrayStore\(STORE_KEYS\.works\)/);
  assert.match(app, /favorites: readArrayStore\(STORE_KEYS\.favorites\)/);
  assert.match(app, /requests: readArrayStore\(STORE_KEYS\.requests\)/);
  assert.match(app, /function normalizeLocalBackup\(payload\)/);
  assert.match(app, /payload\.format !== BACKUP_FORMAT/);
  assert.match(app, /sanitizeStoredCollection\(STORE_KEYS\.works/);
  assert.match(app, /mode === 'replace'/);
  assert.match(app, /mergeCollections\(previous\[kind\], imported\)/);
  assert.match(app, /writeArrayStore\(key, previous\[kind\]\)/);
  assert.match(app, /new Blob\(\[JSON\.stringify\(value, null, 2\)\]/);
});

test('bozuk tarayıcı kayıtları sessizce kaybolmak yerine sınırlı kurtarma arşivine ayrılıyor', () => {
  assert.match(app, /planlamasyon-recovery-v3-7/);
  assert.match(app, /RECOVERY_MAX_ITEMS = 6/);
  assert.match(app, /RECOVERY_MAX_RAW_CHARS = 120_000/);
  assert.match(app, /quarantineCorruptStore\(key, raw, 'JSON verisi okunamadı'\)/);
  assert.match(app, /resetCorruptCollection\(key\)/);
  assert.match(app, /Kurtarma Arşivini İndir/);
  assert.match(app, /Önce indirmeniz önerilir/);
});

test('yan panel klavye odağını hapseder, kapanınca önceki odağa döner ve mobil dokunma hedefleri yeterlidir', () => {
  assert.match(index, /role="dialog" aria-modal="true" aria-labelledby="drawerTitle" tabindex="-1"/);
  assert.match(index, /aria-controls="profileMenu"/);
  assert.match(app, /function trapDrawerFocus\(event\)/);
  assert.match(app, /state\.drawerReturnFocus/);
  assert.match(app, /setDrawerBackgroundInert\(true\)/);
  assert.match(styles, /:where\(button,a\[href\],input,select,textarea,summary,\[tabindex\]\):focus-visible/);
  assert.match(styles, /\.profile-menu button\{min-height:48px\}/);
  assert.match(styles, /@media\(prefers-reduced-motion:reduce\)/);
});

test('emailSent false olan analiz talebi ekibe gönderilmiş veya uzakta kaydedilmiş gibi gösterilmiyor', () => {
  assert.match(app, /result\.emailSent \? 'Ekibe gönderildi' : 'Yalnız bu cihazda'/);
  assert.match(app, /result\.emailSent \? 'Ekibe gönderildi' : 'E-posta gönderilmedi'/);
  assert.match(app, /Talep ekibe gönderilmedi\. Yalnız bu cihazdaki Taleplerim listesine eklendi\./);
  assert.doesNotMatch(app, /Analiz talebi kaydedildi\. E-posta servisi/);
});

test('bahçe alanları yalnız kaynak iziyle m² gösteriliyor ve çekme mesafesinden tahmin edilmiyor', () => {
  for (const [field, label] of [
    ['frontGardenArea', 'Ön bahçe alanı'],
    ['sideGardenArea', 'Yan bahçe alanı'],
    ['rearGardenArea', 'Arka bahçe alanı']
  ]) {
    assert.match(app, new RegExp(`reportFieldRow\\('${label}', sourcedAreaValue\\(fields, fieldSources, '${field}'\\), fieldSources\\.${field}\\)`));
    assert.match(app, new RegExp(`label: '${label}', value: sourcedAreaValue\\(fields, fieldSources, '${field}'\\)`));
  }
  const helper = app.match(/function sourcedAreaValue\([\s\S]*?\n\}/)?.[0] || '';
  assert.match(helper, /!hasSourceTrace\(source\)/);
  assert.match(helper, /m²/);
  assert.doesNotMatch(helper, /Setback|setback|frontSetback|sideSetback|rearSetback/);
  assert.match(app, /const names\s*=\s*\[[^\]]*'frontGardenArea'[^\]]*'sideGardenArea'[^\]]*'rearGardenArea'/s);
  assert.match(app, /frontGardenArea:\s*number\('frontGardenArea'\)/);
  assert.match(app, /sideGardenArea:\s*number\('sideGardenArea'\)/);
  assert.match(app, /rearGardenArea:\s*number\('rearGardenArea'\)/);
});

test('rapor kadastro, imar alanı ve hesap kapsamını birbirinden ayırıyor', () => {
  assert.match(app, /\$\{report\.verifiedFieldCount\}\/\$\{report\.totalFieldCount\}/);
  assert.match(app, /\$\{report\.calculatedMetricCount\}\/\$\{report\.totalMetricCount\}/);
  assert.match(app, /Kadastro kaydı bulundu; yapı hakkı ve imar koşulları doğrulanmadı/);
  assert.match(app, /Bu rapor imar durumu veya ruhsat belgesi değildir/);
  assert.match(app, /report-state-label/);
  assert.match(styles, /\.report-state-label\.is-partial/);
});
