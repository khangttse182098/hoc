// Requires: a running app server (BASE, default http://localhost:5173/) and SAMPLE_PDF pointing at a PDF.
// See e2e/README.md.
const { chromium } = require('playwright');
const path = require('path');
const BASE = process.env.BASE || 'http://localhost:5173/';
const SAMPLE = process.env.SAMPLE_PDF || path.resolve(__dirname, 'samples/sample.pdf');
require('fs').mkdirSync(path.resolve(__dirname, 'out'), { recursive: true });
const idle = (p) => p.waitForFunction(() => !document.querySelector('.pdf-page-loading'), null, { timeout: 20000 });
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
  const typeSel = p.locator('.sidebar-section select.select').first();
  const correctSel = p.locator('.field.row:has(label:text-is("Correct answer")) select');
  const ng = p.locator('label.check:has-text("Not Given") input');

  // Q1 from the toolbar: plain True/False, no anchoring started, tool released
  await p.click('button:has-text("True / False")');
  await p.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.3);
  await p.waitForSelector('.ov.author.selected');
  console.log('Q1 type shows True/False:', (await typeSel.inputValue()) === 'true-false');
  console.log('Q1 is T/F only, NG unchecked:', (await p.locator('.ov.author.selected').textContent()).includes('T  F') && !(await ng.isChecked()));
  console.log('no anchoring prompt, tool released:', !(await p.locator('.topbar .status.grow').textContent()).includes('click on choice') && !(await p.locator('button:has-text("True / False")').getAttribute('class')).includes('active'));
  console.log('list shows T/F:', (await p.locator('.qlist li').first().textContent()).includes('T/F'));
  await correctSel.selectOption('F');

  // enable Not Given → key kept, option appears, NG selectable as key
  await ng.check();
  console.log('NG added, key F kept:', (await p.locator('.ov.author.selected').textContent()).includes('NG') && (await correctSel.inputValue()) === 'F');
  const opts = await correctSel.locator('option').allTextContents();
  console.log('key dropdown spells the words:', opts.some((o) => o.includes('NG — Not Given')));
  await correctSel.selectOption('NG');
  await ng.uncheck();
  console.log('NG removed → key cleared:', (await correctSel.inputValue()) === '' && !(await p.locator('.ov.author.selected').textContent()).includes('NG'));
  await ng.check();
  await correctSel.selectOption('NG');

  // Q2 from the toolbar remembers the last Not Given choice; Q3 converts an MC via the Type dropdown
  await p.click('button:has-text("True / False")');
  await p.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.5);
  await p.waitForFunction(() => document.querySelectorAll('.ov.author').length === 2);
  console.log('Q2 remembers NG default:', await ng.isChecked());
  await correctSel.selectOption('T');
  await p.click('button:has-text("Multiple choice")');
  await p.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.7);
  await p.waitForFunction(() => document.querySelectorAll('.ov.author').length === 3);
  await p.keyboard.press('Escape'); // skip anchoring
  await typeSel.selectOption('true-false');
  console.log('Q3 converted from MC to T/F:', (await typeSel.inputValue()) === 'true-false' && (await p.locator('.ov.author.selected').textContent()).includes('T  F'));
  await typeSel.selectOption('multiple-choice');
  console.log('…and back to A/B/C/D:', (await p.locator('.ov.author.selected').textContent()).includes('A  B  C  D'));
  await typeSel.selectOption('true-false');
  await correctSel.selectOption('F');

  await p.waitForFunction(() => document.querySelector('.topbar .status')?.textContent === 'All changes saved');
  await p.screenshot({ path: path.resolve(__dirname, 'out/shot-truefalse-author.png') });
  await p.click('button:has-text("Open as student")');
  await p.waitForURL(/#\/student\//);
  await p.waitForSelector('.ov.mc:not(.author) button');
  await idle(p);
  const q1 = p.locator('.ov.mc').nth(0);
  console.log('student sees T / F / NG buttons with word tooltips:', (await q1.locator('button').allTextContents()).join(',') === 'T,F,NG' && (await q1.locator('button').nth(2).getAttribute('title')) === 'Not Given');
  console.log('key is not in the student DOM:', !(await p.content()).includes('"correct"'));
  await q1.locator('button:has-text("NG")').click();                     // Q1 correct (NG)
  await p.locator('.ov.mc').nth(1).locator('button', { hasText: /^F$/ }).click(); // Q2 wrong (key T)
  await p.locator('.ov.mc').nth(2).locator('button', { hasText: /^F$/ }).click(); // Q3 correct (F)
  console.log('answered 3/3:', (await p.locator('.topbar').first().textContent()).includes('Answered 3 / 3'));
  await p.click('button:has-text("Submit exam")');
  await p.click('.modal button.primary');
  await p.waitForSelector('.results-table');
  const text = await p.locator('.results-table').textContent();
  const score = await p.evaluate(() => document.querySelector('.score-box .big').textContent);
  console.log('results table marks T/F rows:', text.includes('T/F'));
  console.log('score 2 / 3:', score.replace(/\s+/g, '') === '2/3', '(' + score + ')');
  await p.screenshot({ path: path.resolve(__dirname, 'out/shot-truefalse-results.png') });
  console.log('page errors:', errors);
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
