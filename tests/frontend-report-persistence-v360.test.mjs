import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [index, app, styles] = await Promise.all([
  readFile(new URL('../dist/index.html', import.meta.url), 'utf8'),
  readFile(new URL('../dist/app.js', import.meta.url), 'utf8'),
  readFile(new URL('../dist/styles.css', import.meta.url), 'utf8')
]);

test('sonuç ekranı erişilebilir PDF, paylaşım ve favori işlemlerini sunuyor', () => {
  assert.match(index, /id="printReportButton"[^>]+aria-label="Yazdırılabilir parsel raporunu hazırla"/);
  assert.match(index, /class="result-actions" role="group" aria-label="Parsel sonucu işlemleri"/);
  assert.match(index, /id="favoriteButton"[^>]+aria-pressed="false"/);
  assert.match(index, /class="verification-status-row" role="list"[^>]+aria-live="polite"/);
  assert.match(app, /window\.print\(\)/);
  assert.match(app, /PDF olarak kaydet/);
  assert.match(styles, /@media print/);
  assert.match(styles, /body> :not\(#printReport\)/);
});

test('yazdırılabilir rapor doğrulanmayan alanları, kaynakları ve tarihleri açıkça gösteriyor', () => {
  for (const label of ['TAKS', 'KAKS / Emsal', 'Ön bahçe çekme mesafesi', 'Yan bahçe çekme mesafesi', 'Arka bahçe çekme mesafesi']) {
    assert.match(app, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.match(app, /Doğrulanmadı — güncel resmî belge gerekli/);
  assert.match(app, /Kaynaklar ve tarihler/);
  assert.match(app, /documentDate \|\| source\.retrievedAt \|\| source\.extractedAt/);
  assert.match(app, /Kaynağı bulunmayan alanlar doğrulanmış kabul edilmez/);
  assert.match(app, /report\.sources\.slice\(0, 3\)/);
});

test('geçmiş ve favoriler sürümlü, sınırlı ve doğrulanan localStorage zarflarında tutuluyor', () => {
  assert.match(app, /planlamasyon-works-v3-6/);
  assert.match(app, /planlamasyon-favorites-v3-6/);
  assert.match(app, /STORAGE_SCHEMA_VERSION = 1/);
  assert.match(app, /STORE_LIMITS = Object\.freeze\(\{ works: 60, favorites: 80, requests: 80 \}\)/);
  assert.match(app, /STORE_MAX_SERIALIZED_CHARS = 480_000/);
  assert.match(app, /schemaVersion: STORAGE_SCHEMA_VERSION, collection:/);
  assert.match(app, /sanitizeStoredCollection/);
  assert.match(app, /sanitizeStoredItem/);
  assert.match(app, /url\.protocol === 'https:'/);
  assert.match(app, /replace\(\/\[\\u0000-\\u001F\\u007F\]\//);
  assert.match(app, /migrateLocalCollections\(\)/);
});

test('profil menüsü kayıt sayılarını ve sade geçmiş panellerini içeriyor', () => {
  assert.match(index, /id="worksCount">0<\/span>/);
  assert.match(index, /id="favoritesCount">0<\/span>/);
  assert.match(index, /Geçmiş Sorgularım/);
  assert.match(app, /En fazla \$\{maxItems\} kayıt güvenli biçimde bu cihazda tutulur/);
  assert.match(app, /Tümünü Temizle/);
  assert.match(app, /\$\$\('\[data-open-index\]'/);
  assert.match(styles, /\.profile-count/);
  assert.match(styles, /\.saved-list-header/);
});

test('mobil sonuç işlemleri iki sütun ve tam genişlik rapor düğmesiyle dokunulabilir kalıyor', () => {
  assert.match(styles, /\.result-actions\{display:grid;grid-template-columns:1fr 1fr;gap:8px\}/);
  assert.match(styles, /\.result-actions \.report-button\{grid-column:1\/-1\}/);
  assert.match(styles, /\.verification-chip\{min-height:38px/);
});
