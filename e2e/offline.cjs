// Requires: a running app server (BASE, default http://localhost:5173/) and SAMPLE_PDF pointing at a PDF.
// See e2e/README.md.
const { chromium } = require('playwright');
const path = require('path');
const BASE = process.env.BASE || 'http://localhost:4173/';
const SAMPLE = process.env.SAMPLE_PDF || path.resolve(__dirname, 'samples/sample.pdf');
require('fs').mkdirSync(path.resolve(__dirname, 'out'), { recursive: true });
const idle = (p) => p.waitForFunction(() => !document.querySelector('.pdf-page-loading'), null, { timeout: 20000 });
(async () => {
  const b = await chromium.launch({ channel: 'chrome', headless: true });
  const ctx = await b.newContext({ viewport: { width: 1400, height: 900 } });
  const blocked = [];
  const local = new Set();
  await ctx.route('**/*', (route) => {
    const u = new URL(route.request().url());
    if (u.hostname === 'localhost' || u.hostname === '127.0.0.1') { local.add(u.pathname); return route.continue(); }
    blocked.push(u.href);
    return route.abort();
  });
  const p = await ctx.newPage();
  const errors = [];
  p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  p.on('requestfailed', (r) => errors.push('[requestfailed] ' + r.url() + ' ' + (r.failure() && r.failure().errorText)));
  p.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
  await p.goto(BASE);
  await p.setInputFiles('input[accept="application/pdf,.pdf"]', SAMPLE);
  await p.waitForURL(/#\/author\//);
  await p.waitForSelector('.pdf-page canvas');
  await idle(p);
  const box = await p.locator('.pdf-page').first().boundingBox();
  await p.click('button:has-text("Multiple choice")');
  await p.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.3);
  await p.waitForSelector('.ov.author');
  await p.selectOption('select:near(:text("Correct answer"))', 'C');
  await p.waitForFunction(() => document.querySelector('.topbar .status')?.textContent === 'All changes saved');
  // Scroll through every page to force all fonts/cmaps to load
  const n = await p.evaluate(() => document.querySelectorAll('.pdf-page').length);
  for (let i = 0; i < n; i++) { await p.fill('input[type=number][min="1"]', String(i + 1)); await p.waitForTimeout(400); await idle(p); }
  // Now go fully offline (even localhost) and keep using the already-loaded app
  await ctx.setOffline(true);
  await p.click('button:has-text("Open as student")');
  await p.waitForURL(/#\/student\//);
  try { await p.waitForSelector(".ov button", { timeout: 15000 }); } catch (e) { console.log("STUDENT FAIL errors:", errors); await p.screenshot({ path: "shot-offline-fail.png" }); console.log(await p.evaluate(() => document.body.innerText.slice(0, 800))); throw e; }
  await idle(p);
  for (let i = 0; i < n; i++) { await p.fill('input[type=number][min="1"]', String(i + 1)); await p.waitForTimeout(300); await idle(p); }
  await p.click('button[aria-label="Question 1 option C"]');
  await p.click('button:has-text("Submit exam")');
  await p.click('.modal button.primary');
  await p.waitForSelector('.results-table');
  console.log('OFFLINE result:', await p.evaluate(() => document.querySelector('.score-box .big').textContent));
  await p.click('button:has-text("Show on document")');
  await p.waitForSelector('.ov-result-badge');
  await idle(p);
  console.log('offline on-document view rendered pages:', await p.evaluate(() => document.querySelectorAll('.pdf-page canvas').length));
  await ctx.setOffline(false);
  console.log('blocked external requests:', blocked);
  console.log('localhost assets fetched:', [...local].sort());
  console.log('console errors:', errors);
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
