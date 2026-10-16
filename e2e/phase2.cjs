// Requires: a running app server (BASE, default http://localhost:5173/) and SAMPLE_PDF pointing at a PDF.
// See e2e/README.md.
const { chromium } = require('playwright');
const path = require('path');
const SAMPLE = process.env.SAMPLE_PDF || path.resolve(__dirname, 'samples/sample.pdf');
require('fs').mkdirSync(path.resolve(__dirname, 'out'), { recursive: true });
const idle = (p) => p.waitForFunction(() => !document.querySelector('.pdf-page-loading'), null, { timeout: 20000 });
(async () => {
  const b = await chromium.launch({ channel: 'chrome', headless: true });
  const ctx = await b.newContext({ viewport: { width: 1400, height: 900 } });
  const p = await ctx.newPage();
  const errors = [];
  p.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`); });
  p.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));

  await p.goto('http://localhost:5173/');
  // fresh DB
  await p.evaluate(() => new Promise((r) => { const q = indexedDB.deleteDatabase('pdf-exam-practice'); q.onsuccess = q.onerror = q.onblocked = () => r(); }));
  await p.reload();
  await p.setInputFiles('input[accept="application/pdf,.pdf"]', SAMPLE);
  await p.waitForURL(/#\/author\//);
  await p.waitForSelector('.pdf-page canvas');
  await idle(p);
  const examId = decodeURIComponent(p.url().split('/author/')[1]);
  console.log('fit-width page size:', await p.evaluate(() => { const el = document.querySelector('.pdf-page'); return [el.clientWidth, el.clientHeight]; }));

  // Place an MC field on page 1 at (40%, 30%)
  const page1 = p.locator('.pdf-page').first();
  const box = await page1.boundingBox();
  await p.click('button:has-text("Multiple choice")');
  await p.mouse.click(box.x + box.width * 0.4, box.y + box.height * 0.3);
  await p.waitForSelector('.ov.author');
  let q = await p.evaluate(() => { const o = document.querySelector('.ov.author'); return { left: o.offsetLeft, top: o.offsetTop, w: o.offsetWidth, h: o.offsetHeight }; });
  console.log('placed MC px:', JSON.stringify(q), 'expected center', [box.width * 0.4, box.height * 0.3].map(Math.round), 'actual center', [q.left + q.w / 2, q.top + q.h / 2].map(Math.round));
  // Set correct answer B, points 2
  await p.selectOption('select:near(:text("Correct answer"))', 'B');
  await p.fill('input[type=number][step="0.25"]', '2');

  // Short answer field at (50%, 60%)
  await p.click('button:has-text("Short answer")');
  await p.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.42);
  await p.waitForFunction(() => document.querySelectorAll('.ov.author').length === 2);
  await p.fill('textarea[placeholder*="went"]', 'went\nhad gone');
  await p.locator('textarea[placeholder*="went"]').blur();

  // Manual field at (50%, 80%)
  await p.click('button:has-text("Manual grading")');
  await p.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5);
  await p.waitForFunction(() => document.querySelectorAll('.ov.author').length === 3);
  await p.fill('input[type=number][step="0.25"]', '3');

  // Drag the first field by +100px, +50px
  const first = p.locator('.ov.author').first();
  const fb = await first.boundingBox();
  await p.mouse.move(fb.x + fb.width / 2, fb.y + fb.height / 2);
  await p.mouse.down();
  await p.mouse.move(fb.x + fb.width / 2 + 50, fb.y + fb.height / 2 + 25, { steps: 5 });
  await p.mouse.move(fb.x + fb.width / 2 + 100, fb.y + fb.height / 2 + 50, { steps: 5 });
  await p.mouse.up();
  const fb2 = await first.boundingBox();
  console.log('drag delta px:', [fb2.x - fb.x, fb2.y - fb.y].map(Math.round), '(expected 100, 50)');

  // Resize via SE handle by +60, +10
  await first.click();
  const se = await p.locator('.ov.author.selected .handle.se').boundingBox();
  await p.mouse.move(se.x + 5, se.y + 5); await p.mouse.down();
  await p.mouse.move(se.x + 35, se.y + 10, { steps: 4 }); await p.mouse.move(se.x + 65, se.y + 15, { steps: 4 }); await p.mouse.up();
  const fb3 = await first.boundingBox();
  console.log('resize delta px:', [fb3.width - fb2.width, fb3.height - fb2.height].map(Math.round), '(expected 60, 10)');

  // Record normalized rects from React state via the saved DB after autosave
  await p.waitForFunction(() => document.querySelector('.topbar .status')?.textContent === 'All changes saved', null, { timeout: 10000 });
  const readDb = () => p.evaluate((id) => new Promise((res) => {
    const r = indexedDB.open('pdf-exam-practice');
    r.onsuccess = () => { const tx = r.result.transaction('exams'); const g = tx.objectStore('exams').get(id); g.onsuccess = () => res(g.result.manifest); };
  }), examId);
  const m1 = await readDb();
  console.log('saved questions:', m1.questions.map((x) => `${x.number}:${x.type}:${x.points}pt:${JSON.stringify(x.rect)}`).join('\n  '));
  const relBefore = await p.evaluate(() => { const el = document.querySelector('.pdf-page'); return [...document.querySelectorAll('.ov.author')].map((o) => [o.offsetLeft / el.clientWidth, o.offsetTop / el.clientHeight, o.offsetWidth / el.clientWidth, o.offsetHeight / el.clientHeight]); });

  // Zoom to 200% and compare relative positions
  await p.selectOption('.topbar select', '2');
  await idle(p);
  const relAfter = await p.evaluate(() => { const el = document.querySelector('.pdf-page'); return [...document.querySelectorAll('.ov.author')].map((o) => [o.offsetLeft / el.clientWidth, o.offsetTop / el.clientHeight, o.offsetWidth / el.clientWidth, o.offsetHeight / el.clientHeight]); });
  const maxDiff = Math.max(...relBefore.flatMap((r, i) => r.map((v, j) => Math.abs(v - relAfter[i][j]))));
  console.log('max relative drift after zoom 200%:', maxDiff.toFixed(5));

  // Resize window and compare
  await p.setViewportSize({ width: 1000, height: 700 });
  await p.selectOption('.topbar select', 'fit-width');
  await idle(p);
  const relResize = await p.evaluate(() => { const el = document.querySelector('.pdf-page'); return [...document.querySelectorAll('.ov.author')].map((o) => [o.offsetLeft / el.clientWidth, o.offsetTop / el.clientHeight, o.offsetWidth / el.clientWidth, o.offsetHeight / el.clientHeight]); });
  console.log('max relative drift after window resize:', Math.max(...relBefore.flatMap((r, i) => r.map((v, j) => Math.abs(v - relResize[i][j])))).toFixed(5), 'page width now', await p.evaluate(() => document.querySelector('.pdf-page').clientWidth));
  await p.setViewportSize({ width: 1400, height: 900 });

  // Keyboard: select Q1 in list, nudge right 10px with Shift+ArrowRight, duplicate with Meta+D, then delete the duplicate
  await p.click('.qlist li >> nth=0');
  await p.keyboard.press('Shift+ArrowRight');
  await p.keyboard.press('Meta+d');
  await p.waitForFunction(() => document.querySelectorAll('.ov.author').length === 4);
  await p.keyboard.press('Delete');
  await p.click('.modal button.danger');
  await p.waitForFunction(() => document.querySelectorAll('.ov.author').length === 3);
  console.log('question list:', await p.evaluate(() => [...document.querySelectorAll('.qlist li')].map((li) => li.textContent)));

  // Reload and check persistence
  await p.waitForFunction(() => document.querySelector('.topbar .status')?.textContent === 'All changes saved');
  await p.reload();
  await p.waitForSelector('.ov.author');
  await idle(p);
  const m2 = await readDb();
  console.log('after reload: questions', await p.evaluate(() => document.querySelectorAll('.ov.author').length), 'rects equal:', JSON.stringify(m1.questions.map(x=>x.rect)) !== JSON.stringify(m2.questions.map(x=>x.rect)) ? 'changed (nudge expected)' : 'same');
  await p.screenshot({ path: path.resolve(__dirname, 'out/shot-phase2-author.png') });

  // ---------- Student flow ----------
  await p.click('button:has-text("Open as student")');
  await p.waitForURL(/#\/student\//);
  await p.waitForSelector('.ov button');
  await idle(p);
  // Check no key is present in the DOM/markup
  const html = await p.content();
  console.log('student DOM contains key text "had gone":', html.includes('had gone'));
  await p.click('button[aria-label="Question 1 option A"]');
  await p.fill('input[aria-label="Question 2 answer"]', '  Had Gone ');
  await p.fill('textarea[aria-label="Question 3 answer"]', 'An essay.');
  await p.waitForTimeout(900);
  console.log('progress:', await p.evaluate(() => document.querySelector('.topbar .status').textContent));
  await p.screenshot({ path: path.resolve(__dirname, 'out/shot-phase3-student.png') });
  // Reload to confirm progress persisted
  await p.reload();
  await p.waitForSelector('.ov button');
  console.log('after reload responses:', await p.evaluate(() => ({ q1: document.querySelector('.ov-mc-option.chosen')?.textContent, q2: document.querySelector('input[aria-label="Question 2 answer"]').value, status: document.querySelector('.topbar .status').textContent })));
  await p.click('button:has-text("Review")');
  console.log('review list:', await p.evaluate(() => [...document.querySelectorAll('.qlist li')].map((li) => li.textContent)));
  await p.click('button:has-text("Submit exam")');
  console.log('confirm text:', await p.evaluate(() => document.querySelector('.modal p').textContent));
  await p.click('.modal button.primary');
  await p.waitForURL(/#\/results\//);
  await p.waitForSelector('.results-table');
  console.log('score box:', await p.evaluate(() => document.querySelector('.score-box').innerText.replace(/\n+/g, ' | ')));
  console.log('rows:', await p.evaluate(() => [...document.querySelectorAll('.results-table tbody tr')].map((tr) => tr.innerText.replace(/\t/g, ' | '))));
  // Examiner manual grading
  await p.click('button:has-text("Examiner")');
  await p.fill('.results-table input[type=number]', '2.5');
  await p.waitForTimeout(300);
  console.log('after manual grade:', await p.evaluate(() => document.querySelector('.score-box').innerText.replace(/\n+/g, ' | ')));
  await p.screenshot({ path: path.resolve(__dirname, 'out/shot-phase3-results.png') });
  await p.click('button:has-text("Show on document")');
  await p.waitForSelector('.ov-result-badge');
  await idle(p);
  await p.screenshot({ path: path.resolve(__dirname, 'out/shot-phase3-results-doc.png') });
  console.log('badges:', await p.evaluate(() => [...document.querySelectorAll('.ov-result-badge')].map((b) => b.textContent)));

  console.log('console errors:', errors);
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
