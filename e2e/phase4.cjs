// Requires: a running app server (BASE, default http://localhost:5173/) and SAMPLE_PDF pointing at a PDF.
// See e2e/README.md.
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const JSZip = require('/Users/ciscotran246/HomeCode/hoc/node_modules/jszip');
const OUT = path.resolve(__dirname, 'out/downloads');
fs.mkdirSync(OUT, { recursive: true });
const idle = (p) => p.waitForFunction(() => !document.querySelector('.pdf-page-loading'), null, { timeout: 20000 });
(async () => {
  const b = await chromium.launch({ channel: 'chrome', headless: true });
  const ctx = await b.newContext({ viewport: { width: 1400, height: 900 }, acceptDownloads: true });
  const p = await ctx.newPage();
  const errors = [];
  p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  p.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
  await p.goto('http://localhost:5173/');
  // Setup: create an exam with three fields.
  await p.setInputFiles('input[accept="application/pdf,.pdf"]', process.env.SAMPLE_PDF || path.resolve(__dirname, 'samples/sample.pdf'));
  await p.waitForURL(/#\/author\//);
  await p.waitForSelector('.pdf-page canvas');
  const box = await p.locator('.pdf-page').first().boundingBox();
  for (const [tool, y] of [['Multiple choice', 0.3], ['Short answer', 0.4], ['Manual grading', 0.5]]) {
    await p.click(`button:has-text("${tool}")`);
    await p.mouse.click(box.x + box.width * 0.5, box.y + box.height * y);
  }
  await p.waitForFunction(() => document.querySelectorAll('.ov.author').length === 3);
  await p.waitForFunction(() => document.querySelector('.topbar .status')?.textContent === 'All changes saved');
  await p.click('button:has-text("← Home")');
  await p.waitForSelector('.card');
  console.log('home cards:', await p.evaluate(() => [...document.querySelectorAll('.card .meta')].map((m) => m.textContent.trim())));

  // Export
  const [download] = await Promise.all([p.waitForEvent('download'), p.click('.card button:has-text("Export")')]);
  const file = path.join(OUT, download.suggestedFilename());
  await download.saveAs(file);
  const zip = await JSZip.loadAsync(fs.readFileSync(file));
  const manifest = JSON.parse(await zip.file('manifest.json').async('string'));
  console.log('exported:', download.suggestedFilename(), Object.keys(zip.files), 'questions', manifest.questions.length, 'pdf bytes', (await zip.file('exam.pdf').async('uint8array')).length);

  // Delete the exam
  await p.click('.card button:has-text("Delete")');
  await p.click('.modal button.danger');
  await p.waitForSelector('.empty');
  console.log('after delete: empty list =', await p.isVisible('.empty'));

  // Import the package
  await p.setInputFiles('input[accept=".zip,application/zip"]', file);
  await p.waitForSelector('.card');
  console.log('after import:', await p.evaluate(() => [...document.querySelectorAll('.card .meta')].map((m) => m.textContent.trim())), await p.textContent('.toast'));

  // Import again -> conflict -> keep both
  await p.setInputFiles('input[accept=".zip,application/zip"]', file);
  await p.waitForSelector('.modal');
  console.log('conflict modal:', await p.textContent('.modal h2'));
  await p.click('.modal button:has-text("Keep both")');
  await p.waitForFunction(() => document.querySelectorAll('.card').length === 2);
  console.log('after keep both titles:', await p.evaluate(() => [...document.querySelectorAll('.card .grow > div:first-child')].map((d) => d.textContent.trim())));

  // Open the imported exam in author mode and check overlays + rendering
  await p.click('.card >> nth=0 >> button:has-text("Edit")');
  await p.waitForSelector('.ov.author');
  await idle(p);
  console.log('imported exam fields:', await p.evaluate(() => [...document.querySelectorAll('.ov.author')].map((o) => o.title)));
  await p.screenshot({ path: path.resolve(__dirname, 'out/shot-phase4-imported.png') });
  await p.goto('http://localhost:5173/#/');

  // Bad packages
  const badZipPath = path.join(OUT, 'bad.exam.zip');
  fs.writeFileSync(badZipPath, 'this is not a zip');
  await p.setInputFiles('input[accept=".zip,application/zip"]', badZipPath);
  await p.waitForSelector('.modal');
  console.log('bad zip modal:', await p.textContent('.modal h2'), '|', await p.textContent('.modal p'));
  await p.click('.modal button.primary');

  const newer = new JSZip();
  newer.file('manifest.json', JSON.stringify({ ...manifest, formatVersion: 99 }));
  newer.file('exam.pdf', await zip.file('exam.pdf').async('uint8array'));
  const newerPath = path.join(OUT, 'newer.exam.zip');
  fs.writeFileSync(newerPath, Buffer.from(await newer.generateAsync({ type: 'uint8array' })));
  await p.setInputFiles('input[accept=".zip,application/zip"]', newerPath);
  await p.waitForSelector('.modal');
  console.log('newer version modal:', await p.evaluate(() => [...document.querySelectorAll('.modal p')].map((x) => x.textContent)));
  await p.click('.modal button.primary');

  // Corrupted / non-PDF file as a new exam
  const notPdf = path.join(OUT, 'broken.pdf');
  fs.writeFileSync(notPdf, 'garbage garbage');
  await p.setInputFiles('input[accept="application/pdf,.pdf"]', notPdf);
  await p.waitForSelector('.modal');
  console.log('broken pdf modal:', await p.textContent('.modal h2'), '|', await p.textContent('.modal p'));
  await p.click('.modal button.primary');

  // PIN protection: set PIN on first exam, then Edit requires PIN
  await p.click('.card >> nth=0 >> button:has-text("Edit")');
  await p.waitForSelector('.ov.author');
  await p.fill('input[placeholder="none"]', '4321');
  await p.waitForFunction(() => document.querySelector('.topbar .status')?.textContent === 'All changes saved');
  await p.click('button:has-text("← Home")');
  await p.waitForSelector('.card');
  // Student can open without PIN
  await p.click('.card >> nth=0 >> button:has-text("Practice")');
  await p.waitForSelector('.ov button');
  console.log('student opened without PIN:', p.url().includes('#/student/'));
  await p.goto('http://localhost:5173/#/');
  await p.waitForSelector('.card');
  // New session storage: open a new page to drop sessionStorage
  const p2 = await ctx.newPage();
  await p2.goto('http://localhost:5173/#/');
  await p2.waitForSelector('.card');
  await p2.click('.card >> nth=0 >> button:has-text("Edit")');
  await p2.waitForSelector('.modal');
  console.log('edit prompts for PIN:', await p2.textContent('.modal h2'));
  await p2.fill('.modal input[type=password]', '0000');
  await p2.click('.modal button.primary');
  console.log('wrong pin shows error:', await p2.textContent('.modal .error'));
  await p2.fill('.modal input[type=password]', '4321');
  await p2.click('.modal button.primary');
  await p2.waitForURL(/#\/author\//);
  console.log('correct pin opens author:', true);

  console.log('console errors:', errors);
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
