import { access, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const APP_VERSION = '3.8.1';
const SOURCE_DIRECTORIES = ['dist', 'netlify/functions', 'functions', 'src', 'scripts'];
const TEST_DIRECTORIES = ['tests', 'postbuild-tests'];

async function filesIn(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await filesIn(path));
    else files.push(path);
  }
  return files;
}

const required = [
  'dist/index.html',
  'dist/app.js',
  'dist/styles.css',
  'netlify/functions/analyze.mjs',
  'netlify/functions/lib/analysis-core.mjs',
  'netlify/functions/lib/plan-ai-client.mjs',
  'netlify/functions/lib/zoning-client.mjs',
  'netlify/functions/lib/open-official-zoning-records.mjs',
  'netlify/functions/lib/zoning-document-parser.mjs',
  'netlify/functions/lib/municipality-access-registry.mjs',
  'dist/data/municipality-access-registry.json',
  'src/worker.js'
];
for (const path of required) await access(path);

const packageData = JSON.parse(await readFile('package.json', 'utf8'));
if (packageData.version !== APP_VERSION) throw new Error(`Beklenmeyen paket sürümü: ${packageData.version}`);
const index = await readFile('dist/index.html', 'utf8');
for (const asset of [`styles.css?v=${APP_VERSION}`, `app.js?v=${APP_VERSION}`, `PLANLAMASYON · v${APP_VERSION}`]) {
  if (!index.includes(asset)) throw new Error(`Sürüm izi eksik: ${asset}`);
}
const municipalityRegistry = JSON.parse(await readFile('dist/data/municipality-access-registry.json', 'utf8'));
if (municipalityRegistry.registryVersion !== '2026-08-25-v3.8.0') throw new Error('Belediye erişim kaydı beklenen v3.8 temel envanteriyle eşleşmiyor.');
if (municipalityRegistry.municipalities?.length !== 1407) throw new Error(`Belediye erişim kaydı eksik: ${municipalityRegistry.municipalities?.length || 0}/1407`);

const sourceFiles = (await Promise.all(SOURCE_DIRECTORIES.map(filesIn)))
  .flat()
  .filter((path) => /\.(?:js|mjs)$/.test(path));
for (const path of sourceFiles) await execFileAsync(process.execPath, ['--check', path]);

const testFiles = (await Promise.all(TEST_DIRECTORIES.map(filesIn)))
  .flat()
  .filter((path) => path.endsWith('.test.mjs'))
  .sort();
if (!testFiles.length) throw new Error('Birim testi bulunamadı.');
await execFileAsync(process.execPath, ['--test', ...testFiles], { maxBuffer: 8_000_000 });

console.log(`Planlamasyon v${APP_VERSION} build tamamlandı: ${sourceFiles.length} kaynak ve ${testFiles.length} test paketi doğrulandı.`);
