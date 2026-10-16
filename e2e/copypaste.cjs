// Requires: a running app server (BASE, default http://localhost:5173/) and SAMPLE_PDF pointing at a PDF.
// See e2e/README.md.
const { chromium } = require('playwright');
const path = require('path');
const BASE = process.env.BASE || 'http://localhost:5173/';
const SAMPLE = process.env.SAMPLE_PDF || path.resolve(__dirname, 'samples/sample.pdf');
const idle = (p) => p.waitForFunction(() => !document.querySelector('.pdf-page-loading'), null, { timeout: 20000 });
const fields = (p) => p.evaluate(() => [...document.querySelectorAll('.ov.author')].map((o) => ({ label: o.textContent.trim().slice(0, 12), x: o.offsetLeft, y: o.offsetTop, w: o.offsetWidth, h: o.offsetHeight })));
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
  await p.click('button:has-text("Multiple choice")');
  await p.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.2);
  await p.waitForSelector('.ov.author');
  // customise it so we can check settings are retained
  await p.fill('input[type=number][step]', '2');            // points
  await p.selectOption('select:near(:text("Correct answer"))', 'C');
  // resize: drag the bottom-right handle 60px right
  const f0 = (await fields(p))[0];
  const ov = await p.locator('.ov.author').first().boundingBox();
  await p.mouse.move(ov.x + ov.width - 3, ov.y + ov.height - 3);
  await p.mouse.down(); await p.mouse.move(ov.x + ov.width + 57, ov.y + ov.height - 3, { steps: 5 }); await p.mouse.up();
  const src = (await fields(p))[0];
  console.log('source field:', src, 'resized by', src.w - f0.w);

  // Copy with the keyboard, paste under the mouse at two different spots
  await p.keyboard.press('Meta+c');
  await p.waitForSelector('button:has-text("Paste copy of Q1")');
  await p.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.5);
  await p.keyboard.press('Meta+v');
  await p.waitForFunction(() => document.querySelectorAll('.ov.author').length === 2);
  await p.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.7);
  await p.keyboard.press('Control+v');
  await p.waitForFunction(() => document.querySelectorAll('.ov.author').length === 3);
  const all = await fields(p);
  console.log('after 2 pastes:', all);
  const centre = (f) => [f.x + f.w / 2, f.y + f.h / 2];
  const exp1 = [box.width * 0.6, box.height * 0.5], exp2 = [box.width * 0.6, box.height * 0.7];
  const c1 = centre(all[1]), c2 = centre(all[2]);
  console.log('paste centred under mouse (px off):', Math.hypot(c1[0] - exp1[0], c1[1] - exp1[1]).toFixed(1), Math.hypot(c2[0] - exp2[0], c2[1] - exp2[1]).toFixed(1));
  console.log('sizes equal:', all.every((f) => f.w === src.w && f.h === src.h));
  const list = await p.evaluate(() => [...document.querySelectorAll('.qlist li')].map((li) => li.textContent.replace(/\s+/g, ' ').trim()));
  console.log('question list:', list);
  // Selected (last pasted) retains points and correct answer
  console.log('pasted settings:', await p.evaluate(() => ({ points: document.querySelector('input[type=number][step]').value, correct: document.querySelector('select:has(option[value="C"])') ? [...document.querySelectorAll('select')].map((s) => s.value) : null })));
  // Paste button in toolbar also works, with the mouse away from the page -> lands below original
  await p.mouse.move(5, 5);
  await p.click('button:has-text("Paste copy of Q1")');
  await p.waitForFunction(() => document.querySelectorAll('.ov.author').length === 4);
  const f4 = (await fields(p))[3];
  console.log('toolbar paste below original:', f4.y > src.y && f4.x === src.x, f4);
  // Cmd+V inside a text input must not paste a field
  await p.click('.qlist li >> nth=0');
  await p.click('input.input >> nth=0');
  await p.keyboard.press('Meta+v');
  await p.waitForTimeout(300);
  console.log('no paste while typing:', (await fields(p)).length === 4);
  // Persistence after reload
  await p.waitForFunction(() => document.querySelector('.topbar .status')?.textContent === 'All changes saved');
  await p.reload();
  await p.waitForSelector('.ov.author');
  await idle(p);
  console.log('after reload fields:', (await fields(p)).length);
  await p.screenshot({ path: path.resolve(__dirname, 'out/shot-copypaste.png') });
  console.log('page errors:', errors);
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
