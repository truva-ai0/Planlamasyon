import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.js');

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 1,
  isMobile: true,
  hasTouch: true
});

await page.goto('https://planlamasyon.truvaai0.workers.dev/?visual=v328', { waitUntil: 'domcontentloaded', timeout: 30_000 });
await page.waitForFunction(() => document.querySelector('#provinceSelect')?.options.length > 2, null, { timeout: 30_000 });
await page.selectOption('#provinceSelect', '56');
await page.waitForFunction(() => document.querySelector('#districtSelect')?.options.length > 2, null, { timeout: 30_000 });
await page.selectOption('#districtSelect', '531');
await page.waitForFunction(() => document.querySelector('#neighbourhoodSelect')?.options.length > 2, null, { timeout: 30_000 });
await page.selectOption('#neighbourhoodSelect', '147313');
await page.fill('#blockInput', '1946');
await page.fill('#parcelInput', '70');
await page.click('#parcelSubmit');
await page.waitForFunction(() => !document.querySelector('#resultSection')?.hidden, null, { timeout: 35_000 });
await page.waitForTimeout(1800);
await page.locator('.map-card').scrollIntoViewIfNeeded();
await page.screenshot({ path: 'mobile-map-v328.png', fullPage: false });
await page.waitForFunction(() => document.querySelector('#analysisProgress')?.hidden === true, null, { timeout: 75_000 });
await page.click('#planAiAskButton');
await page.waitForTimeout(500);
await page.screenshot({ path: 'mobile-ai-v328.png', fullPage: false });

const report = await page.evaluate(() => ({
  version: document.body.innerText.includes('v3.8.0'),
  mapSize: (() => { const r = document.querySelector('#parcelMap')?.getBoundingClientRect(); return r ? { width: r.width, height: r.height } : null; })(),
  visibleTiles: [...document.querySelectorAll('#parcelMap .leaflet-tile')].filter((item) => {
    const style = getComputedStyle(item);
    return style.display !== 'none' && Number(style.opacity || 1) > 0;
  }).length,
  parcelPaths: document.querySelectorAll('#parcelMap .leaflet-overlay-pane path').length,
  drawer: (() => { const r = document.querySelector('#sideDrawer')?.getBoundingClientRect(); return r ? { width: r.width, height: r.height, left: r.left, bottom: innerHeight - r.bottom } : null; })()
}));
console.log(JSON.stringify(report));
await browser.close();
