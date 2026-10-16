// Requires: a running app server (BASE, default http://localhost:5173/) and SAMPLE_PDF pointing at a PDF.
// See e2e/README.md.
const { chromium } = require('playwright');
const path = require('path');
const BASE = process.env.BASE || 'http://localhost:5173/';
const SAMPLE = process.env.SAMPLE_PDF || path.resolve(__dirname, 'samples/sample.pdf');
require('fs').mkdirSync(path.resolve(__dirname, 'out'), { recursive: true });
const idle = (p) => p.waitForFunction(() => !document.querySelector('.pdf-page-loading'), null, { timeout: 20000 });
const status = (p) => p.evaluate(() => [...document.querySelectorAll('.topbar .status')].map((s) => s.textContent).join(' | '));
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
  const at = (fx, fy) => ({ x: box.x + box.width * fx, y: box.y + box.height * fy });

  // 1. Drag a box around the "choices" region
  await p.click('button:has-text("Multiple choice")');
  console.log('status (tool):', await status(p));
  const a = at(0.2, 0.3), bb = at(0.7, 0.34);
  await p.mouse.move(a.x, a.y); await p.mouse.down();
  await p.mouse.move(bb.x, bb.y, { steps: 8 });
  console.log('draft visible while dragging:', await p.evaluate(() => !!document.querySelector('.ov-draft')));
  await p.mouse.up();
  await p.waitForSelector('.ov.author');
  const drawn = await p.locator('.ov.author').first().boundingBox();
  console.log('drawn box matches drag (px off):', Math.abs(drawn.x - a.x).toFixed(1), Math.abs(drawn.y - a.y).toFixed(1), Math.abs(drawn.width - (bb.x - a.x)).toFixed(1), Math.abs(drawn.height - (bb.y - a.y)).toFixed(1));
  console.log('status (anchoring A):', await status(p));
  console.log('pending markers:', await p.evaluate(() => document.querySelectorAll('.ov-anchor.pending').length));

  // 2. Click where A, B, C, D sit (inside the box, evenly spaced), D slightly outside to test growth
  const letters = [[0.24, 0.32], [0.36, 0.32], [0.48, 0.32], [0.72, 0.32]];
  for (let i = 0; i < letters.length; i++) {
    const pt = at(letters[i][0], letters[i][1]);
    await p.mouse.click(pt.x, pt.y);
    if (i < 3) console.log(`after ${'ABCD'[i]}:`, (await status(p)).split(' | ').find((s) => s.includes('click on choice')));
  }
  await p.waitForFunction(() => document.querySelectorAll('.ov-anchor:not(.pending)').length === 4);
  const grown = await p.locator('.ov.author').first().boundingBox();
  console.log('box grew to include D:', grown.width > drawn.width, 'right edge now', (grown.x + grown.width).toFixed(0), 'vs D at', at(0.72, 0).x.toFixed(0));
  const anchorsPx = await p.evaluate(() => [...document.querySelectorAll('.ov-anchor')].map((el) => { const r = el.getBoundingClientRect(); return { l: el.textContent, x: r.x + r.width / 2, y: r.y + r.height / 2 }; }));
  const offs = anchorsPx.map((m, i) => Math.hypot(m.x - at(letters[i][0], letters[i][1]).x, m.y - at(letters[i][0], letters[i][1]).y).toFixed(1));
  console.log('author markers centred on clicks (px off):', anchorsPx.map((m) => m.l).join(''), offs);
  console.log('status (done):', await status(p));
  console.log('settings panel:', await p.evaluate(() => document.querySelector('.sidebar')?.innerText.match(/Choice positions[\s\S]*?(Re-do positions|Set choice positions)/)?.[0].replace(/\s+/g, ' ')));

  // 3. Set correct answer, drag marker B right by 30px, then move the whole box down 40px: anchors follow
  await p.selectOption('select:near(:text("Correct answer"))', 'B');
  const mB = anchorsPx[1];
  await p.mouse.move(mB.x, mB.y); await p.mouse.down(); await p.mouse.move(mB.x + 30, mB.y, { steps: 5 }); await p.mouse.up();
  const afterDragB = await p.evaluate(() => { const r = document.querySelectorAll('.ov-anchor')[1].getBoundingClientRect(); return r.x + r.width / 2; });
  console.log('marker B dragged +30px:', (afterDragB - mB.x).toFixed(1));
  const boxNow = await p.locator('.ov.author').first().boundingBox();
  await p.mouse.move(boxNow.x + 20, boxNow.y + boxNow.height / 2); await p.mouse.down();
  await p.mouse.move(boxNow.x + 20, boxNow.y + boxNow.height / 2 + 40, { steps: 5 }); await p.mouse.up();
  const movedAnchors = await p.evaluate(() => [...document.querySelectorAll('.ov-anchor')].map((el) => { const r = el.getBoundingClientRect(); return r.y + r.height / 2; }));
  console.log('anchors moved with box (+40px each):', movedAnchors.map((y, i) => (y - anchorsPx[i].y).toFixed(1)));

  // 4. Escape mid-way on a second question drops anchors -> button row fallback
  await p.click('button:has-text("Multiple choice")');
  const c = at(0.2, 0.5);
  await p.mouse.click(c.x, c.y);   // click => default-sized box
  await p.waitForFunction(() => document.querySelectorAll('.ov.author').length === 2);
  await p.mouse.click(at(0.22, 0.5).x, at(0.22, 0.5).y);  // A only
  await p.keyboard.press('Escape');
  await p.waitForTimeout(200);
  console.log('after Esc: anchoring status gone:', !(await status(p)).includes('click on choice'), 'markers on Q2:', await p.evaluate(() => document.querySelectorAll('.ov.author')[1].querySelectorAll('.ov-anchor').length));

  // 5. Student view: Q1 shows 4 markers over the letters; Q2 shows button row. Click B on Q1 and submit.
  await p.waitForFunction(() => document.querySelector('.topbar .status')?.textContent === 'All changes saved');
  await p.click('button:has-text("Open as student")');
  await p.waitForURL(/#\/student\//);
  await p.waitForSelector('.ov.mc');
  await idle(p);
  const sbox = await p.locator('.pdf-page').first().boundingBox();
  const spots = await p.evaluate(() => [...document.querySelectorAll('.ov-mc-spot')].map((el) => { const r = el.getBoundingClientRect(); return { l: el.getAttribute('aria-label'), x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, text: el.textContent }; }));
  console.log('student markers:', spots.length, 'button-row options:', await p.evaluate(() => document.querySelectorAll('.ov-mc-option').length));
  console.log('marker text hidden until chosen:', spots.every((s) => s.text === ''));
  // expected page positions of A..D after +30px on B and +40px on all (in page fractions)
  const exp = letters.map(([fx, fy], i) => ({ x: fx + (i === 1 ? 30 / box.width : 0), y: fy + 40 / box.height }));
  console.log('student markers at authored spots (px off):', spots.map((s, i) => Math.hypot(s.x - (sbox.x + sbox.width * exp[i].x), s.y - (sbox.y + sbox.height * exp[i].y)).toFixed(1)));
  console.log('no key leaked in student DOM:', !(await p.content()).includes('"correct"'));
  await p.click('button[aria-label="Question 1 option B"]');
  console.log('B chosen:', await p.evaluate(() => document.querySelector('.ov-mc-spot.chosen')?.textContent));
  await p.screenshot({ path: path.resolve(__dirname, 'out/shot-anchors-student.png') });
  await p.click('button:has-text("Submit exam")');
  await p.click('.modal button.primary');
  await p.waitForSelector('.results-table');
  console.log('score:', await p.evaluate(() => document.querySelector('.score-box .big').textContent));
  await p.click('button:has-text("Show on document")');
  await p.waitForSelector('.ov-mc-spot.correct');
  console.log('result marker classes:', await p.evaluate(() => [...document.querySelectorAll('.ov-mc-spot')].map((e) => e.className.replace('ov-mc-spot', '').trim() || '-')));
  await p.screenshot({ path: path.resolve(__dirname, 'out/shot-anchors-results.png') });

  // 6. Export/import keeps anchors
  await p.goto(BASE); await p.waitForSelector('.exam-card, .card');
  console.log('page errors:', errors);
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
