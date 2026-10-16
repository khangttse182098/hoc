// Requires: a running app server (BASE, default http://localhost:5173/) and SAMPLE_PDF pointing at a PDF.
// See e2e/README.md.
const { chromium } = require('playwright');
const path = require('path');
const BASE = process.env.BASE || 'http://localhost:5173/';
const SAMPLE = process.env.SAMPLE_PDF || path.resolve(__dirname, 'samples/sample.pdf');
require('fs').mkdirSync(path.resolve(__dirname, 'out'), { recursive: true });
const idle = (p) => p.waitForFunction(() => !document.querySelector('.pdf-page-loading'), null, { timeout: 20000 });
const LONG = 'She had been living in London for three years before she moved';
(async () => {
  const b = await chromium.launch({ channel: 'chrome', headless: true });
  const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(BASE);
  await p.setInputFiles('input[accept="application/pdf,.pdf"]', SAMPLE);
  await p.waitForURL(/#\/author\//);
  await p.waitForSelector('.pdf-page canvas');
  await idle(p);
  const box = await p.locator('.pdf-page').first().boundingBox();
  // Q1: narrow short-answer box in the middle; Q2: narrow box hugging the right edge
  const place = async (fx, fy, shrinkTo) => {
    await p.click('button:has-text("Short answer")');
    await p.mouse.click(box.x + box.width * fx, box.y + box.height * fy);
    await p.waitForSelector('.ov.author.selected');
    const ov = await p.locator('.ov.author.selected').boundingBox();
    await p.mouse.move(ov.x + ov.width - 1, ov.y + ov.height / 2);   // 'e' handle
    await p.mouse.down(); await p.mouse.move(ov.x + shrinkTo, ov.y + ov.height / 2, { steps: 5 }); await p.mouse.up();
    await p.locator('.sidebar-section textarea.textarea').first().fill('x');
  };
  await place(0.3, 0.3, 70);
  await place(0.9, 0.5, 70);
  const authored = await p.evaluate(() => [...document.querySelectorAll('.ov.author')].map((o) => ({ l: o.offsetLeft, w: o.offsetWidth })));
  console.log('authored boxes (narrow):', authored);
  await p.waitForFunction(() => document.querySelector('.topbar .status')?.textContent === 'All changes saved');
  await p.click('button:has-text("Open as student")');
  await p.waitForURL(/#\/student\//);
  await p.waitForSelector('.ov.sa input');
  await idle(p);
  const pageW = await p.evaluate(() => document.querySelector('.pdf-overlay-layer').offsetWidth);
  const state = () => p.evaluate(() => [...document.querySelectorAll('.ov.sa')].map((o) => { const i = o.querySelector('input'); return { l: o.offsetLeft, w: o.offsetWidth, grown: o.classList.contains('grown'), clipped: o.classList.contains('clipped'), font: parseFloat(getComputedStyle(i).fontSize), overflow: i.scrollWidth > i.clientWidth, right: o.offsetLeft + o.offsetWidth, title: i.title, focused: document.activeElement === i }; }));
  const before = await state();
  console.log('before typing:', before);
  const same = (a, b) => a.l === b.l && a.w === b.w;
  // 1. medium text: shrinks the font, never grows the box
  await p.fill('[aria-label="Question 1 answer"]', 'had gone');
  let s = (await state())[0];
  console.log('medium text: font shrunk, box unchanged, no scroll:', s.focused && s.font < before[0].font && s.font >= before[0].font * 0.7 - 0.01 && same(s, before[0]) && !s.grown && !s.overflow);
  // 2. long text while focused: box grows (font at the floor)
  await p.fill('[aria-label="Question 1 answer"]', LONG);
  await p.fill('[aria-label="Question 2 answer"]', LONG);
  let a = await state();
  console.log('Q1 focused? no (Q2 is), so Q1 is clipped at authored size:', !a[0].grown && a[0].clipped && same(a[0], before[0]) && a[0].title === LONG);
  console.log('Q2 focused: grew leftwards, stays on page, no scroll:', a[1].focused && a[1].grown && !a[1].overflow && a[1].l < before[1].l && a[1].right <= pageW + 0.5);
  await p.focus('[aria-label="Question 1 answer"]');
  a = await state();
  console.log('focus Q1: Q1 grew rightwards, Q2 snapped back:', a[0].grown && !a[0].overflow && a[0].l === before[0].l && a[0].w > before[0].w && !a[1].grown && a[1].clipped && same(a[1], before[1]));
  // 3. blur: nothing is grown, both at authored size with the floor font and tooltip
  await p.keyboard.press('Tab'); await p.evaluate(() => document.activeElement.blur());
  a = await state();
  console.log('blurred: no box grown, authored footprint kept, font at floor, tooltip:', a.every((x, i) => !x.grown && x.clipped && same(x, before[i]) && Math.abs(x.font - before[i].font * 0.7) < 0.05 && x.title === LONG));
  await p.fill('[aria-label="Question 1 answer"]', 'short');
  await p.evaluate(() => document.activeElement.blur());
  s = (await state())[0];
  console.log('short text: normal font, no clipped/grown:', !s.grown && !s.clipped && s.font === before[0].font && s.title === '');
  await p.fill('[aria-label="Question 1 answer"]', LONG);
  await p.click('button[title="Zoom in"], button:has-text("+")');
  await idle(p);
  a = await state();
  console.log('zoom button took focus: nothing grown:', a.every((x) => !x.grown && x.clipped));
  await p.focus('[aria-label="Question 1 answer"]');
  a = await state();
  console.log('after zoom in: focused Q1 grown w/o scroll, Q2 clipped:', a[0].grown && !a[0].overflow && !a[1].grown && a[1].clipped);
  await p.screenshot({ path: path.resolve(__dirname, 'out/shot-growfield.png') });
  await p.click('button:has-text("Submit exam")');
  await p.click('.modal button.primary');
  await p.waitForSelector('.results-table');
  await p.click('button:has-text("Show on document")');
  await p.waitForSelector('.ov.sa input');
  a = await state();
  console.log('results view: authored footprint, tooltip with full answer:', a.every((x) => !x.grown && x.clipped && x.title === LONG));
  console.log('page errors:', errors);
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
