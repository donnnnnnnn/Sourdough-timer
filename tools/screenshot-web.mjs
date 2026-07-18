/**
 * Screenshot the exported web build at phone size — visual evidence for
 * design work (see docs/design-modernization-plan.md, "Guardrails").
 *
 * Usage:
 *   npx expo export --platform web
 *   npx serve dist -l 8787 &
 *   npm i -D playwright   # once; or run where playwright is available
 *   node tools/screenshot-web.mjs
 *
 * Screenshots land in ./web-shots/. Note: on web the Skia scene falls back
 * (no CanvasKit), so the timer background won't match native — chrome,
 * layout, and the other screens are still representative.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'fs';

const BASE = process.env.BASE_URL ?? 'http://localhost:8787';
const OUT = process.env.OUT_DIR ?? './web-shots';
mkdirSync(OUT, { recursive: true });

const routes = [
  { path: '/', name: 'timer-idle', settle: 2500 },
  { path: '/log', name: 'log', settle: 1500 },
];

// PLAYWRIGHT_BROWSERS_PATH-installed chromium if present (cloud env), else default.
const executablePath = process.env.CHROMIUM_PATH ?? undefined;
const browser = await chromium.launch(executablePath ? { executablePath } : {});
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  colorScheme: 'dark',
});
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log(`[pageerror] ${e.message.slice(0, 200)}`));

for (const r of routes) {
  await page.goto(BASE + r.path, { waitUntil: 'networkidle' });
  await page.waitForTimeout(r.settle);
  await page.screenshot({ path: `${OUT}/${r.name}.png` });
  console.log('shot', r.name);
}

// Active-bulk state: tap Start Bulk and capture the running timer.
try {
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await page.getByText('Start Bulk', { exact: true }).first().click({ timeout: 4000 });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${OUT}/timer-active.png` });
  console.log('shot timer-active');
} catch (e) {
  console.log('active-state capture skipped:', e.message.slice(0, 120));
}

await browser.close();
