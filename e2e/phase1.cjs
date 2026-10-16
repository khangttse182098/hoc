// Requires: a running app server (BASE, default http://localhost:5173/) and SAMPLE_PDF pointing at a PDF.
// See e2e/README.md.
const { chromium } = require('playwright');
const path = require('path');
const SAMPLE = process.env.SAMPLE_PDF || path.resolve(__dirname, 'samples/sample.pdf');
require('fs').mkdirSync(path.resolve(__dirname, 'out'), { recursive: true });
(async () => {
  const b = await chromium.launch({ channel: 'chrome', headless: true });
  const ctx = await b.newContext({ viewport: { width: 1400, height: 900 } });
  const p = await ctx.newPage();
  const errors = [];
  p.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`); });
  p.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
  const requests = new Set();
  p.on('request', (r) => requests.add(new URL(r.url()).host));

  await p.goto('http://localhost:5173/');
  await p.setInputFiles('input[accept="application/pdf,.pdf"]', SAMPLE);
  await p.waitForURL(/#\/author\//, { timeout: 20000 });
  await p.waitForSelector('.pdf-page canvas', { timeout: 20000 });
  await p.waitForFunction(() => !document.querySelector('.pdf-page-loading'), null, { timeout: 20000 });
  const info = await p.evaluate(() => ({
    pages: document.querySelectorAll('.pdf-page').length,
    canvases: document.querySelectorAll('.pdf-page canvas').length,
    firstPage: (() => { const el = document.querySelector('.pdf-page'); const c = el.querySelector('canvas'); return { w: el.clientWidth, h: el.clientHeight, cw: c.width, ch: c.height }; })(),
    status: document.querySelector('.topbar .status')?.textContent,
    title: document.querySelector('.topbar .title')?.textContent,
  }));
  console.log('after import:', JSON.stringify(info));
  await p.screenshot({ path: path.resolve(__dirname, 'out/shot-phase1-fitwidth.png') });

  // zoom in twice
  await p.click('button[title="Zoom in"]');
  await p.click('button[title="Zoom in"]');
  await p.waitForFunction(() => !document.querySelector('.pdf-page-loading'), null, { timeout: 20000 });
  const z = await p.evaluate(() => { const el = document.querySelector('.pdf-page'); return { w: el.clientWidth, h: el.clientHeight, sel: document.querySelector('.topbar select').value }; });
  console.log('after zoom:', JSON.stringify(z));

  // go to last page
  const pageCount = await p.evaluate(() => Number(document.querySelector('.pdf-page-number').textContent.split('/')[1]));
  await p.fill('input[type=number][min="1"]', String(pageCount));
  await p.waitForTimeout(800);
  await p.waitForFunction(() => !document.querySelector('.pdf-page-loading'), null, { timeout: 20000 });
  const last = await p.evaluate(() => ({
    canvases: document.querySelectorAll('.pdf-page canvas').length,
    pageInput: document.querySelector('input[type=number][min="1"]').value,
    scrollTop: document.querySelector('.pdf-viewer').scrollTop,
  }));
  console.log('last page:', JSON.stringify(last), 'pageCount', pageCount);
  await p.screenshot({ path: path.resolve(__dirname, 'out/shot-phase1-lastpage.png') });

  // Fit page
  await p.selectOption('.topbar select', 'fit-page');
  await p.waitForTimeout(500);
  console.log('fit-page:', await p.evaluate(() => { const el = document.querySelector('.pdf-page'); return { w: el.clientWidth, h: el.clientHeight }; }));

  console.log('hosts contacted:', [...requests]);
  console.log('console errors:', errors);
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
