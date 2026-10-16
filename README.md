# PDF Exam Practice

A local-first web app that turns PDF exam papers into interactive practice
exams. Built for Vietnamese Grade 9 English gifted-student papers ("đề thi học
sinh giỏi tiếng Anh lớp 9"), but it works with any PDF.

Everything runs in the browser. There is no backend, no account, no cloud
OCR/AI, no analytics and no telemetry. After `npm install`, the app never
makes a network request to anything but the machine it is served from.

## Running it

Requires Node.js 20 or newer.

```sh
npm install          # also copies PDF.js fonts/cmaps into public/pdfjs (postinstall)
npm run dev          # http://localhost:5173/
```

Production build:

```sh
npm run build        # typecheck + bundle into dist/
npm run preview      # serve dist/ at http://localhost:4173/
```

`dist/` is a plain static site; any static file server works (`npx serve dist`,
Python's `http.server`, nginx, ...). It cannot be opened directly from
`file://` because browsers refuse ES-module scripts and Web Workers on that
scheme. For a sister on another computer, the simplest option is to copy
`dist/` over and run a static server there, or run the dev server on your
machine and open it over the LAN.

Checks:

```sh
npm test             # unit tests (vitest): normalization, grading, coordinates, package validation
npm run typecheck
```

Browser end-to-end checks live in `e2e/` and need Playwright installed
separately; see `e2e/README.md`.

## Deploying (Vercel or any static host)

The build is a plain static site: no server code, no environment variables,
hash-based routing (no rewrite rules), and every request stays on the site's
own origin. `vercel.json` only pins the Vite preset and adds cache and
privacy headers.

1. Push this folder to a GitHub repository.
2. In the Vercel dashboard choose **Add New → Project**, import the
   repository and click **Deploy**. The Vite preset is detected automatically
   (`npm run build`, output `dist`); the `postinstall` script copies the
   PDF.js fonts/CMaps/WASM into `public/pdfjs` during the install step.
3. Every later push to `main` redeploys.

Hosting does not change where data lives: exams and attempts stay in the
browser that created them. To get an exam onto another device, export the
`.exam.zip` and import it there. Do not add Vercel Web Analytics or Speed
Insights if you want to keep the no-telemetry guarantee.

## How it works

**Home** lists saved exams. Create one from a PDF, or import an `.exam.zip`
package. Each exam card offers Practice, Edit, Export and Delete, plus the
list of past attempts.

**Author mode** shows the PDF with a toolbar of field types. Click a tool,
then click on the page to place a field (hold Shift to keep the tool). Fields
can be dragged, resized, nudged with the arrow keys (Shift for 10 px),
duplicated with Ctrl/Cmd+D and deleted with Delete/Backspace. For a paper
with many similar questions, select one field, press Ctrl/Cmd+C, then point
the mouse at the next spot and press Ctrl/Cmd+V: the copy keeps the same type,
size, points and options and gets the next question number. Paste as many
times as needed. The settings
panel on the right edits the selected field: label, points, correct option or
accepted answers, matching rules, model answer. Exam settings cover practice
mode, revealing correct answers after submission and an optional author PIN.
Changes autosave; Ctrl/Cmd+S saves immediately.

Field types:

- **Multiple choice**: A/B/C/D-style options with one correct option. Drag a
  box around the printed choices, then click each printed letter in turn
  (A, B, C, D). The student then clicks a small marker over the printed
  letter rather than a separate button. Markers can be dragged afterwards,
  and the positions move with the box. Press Esc while placing letters to
  skip them; the field then shows a plain row of buttons instead.
- **True / False / Not Given**: a multiple-choice question with the fixed
  options T and F, plus NG when "Include Not Given" is ticked for that
  question (the choice is remembered for the next field you add). Stored
  and graded exactly like multiple choice, so packages need no new format;
  the student sees T / F / NG buttons (full words on hover) and can click
  printed letters instead if you set choice positions.
- **Short answer**: free text checked against a list of accepted answers.
- **Manual**: free text (optionally multiline) that the examiner grades after
  submission; a model answer can be stored for them.

**Student mode** shows the same PDF with input fields over it. Answers are
saved locally as the student types, so a closed tab resumes where it left
off. A progress bar, a Review sidebar listing unanswered questions and a
confirmation dialog precede submission. In practice mode each auto-gradable
answer is marked right/wrong immediately; otherwise the key stays hidden
until submission. Single-line boxes (short answer, single-line manual) keep
their authored footprint so they never cover other text on the paper: an
answer that is too long for its gap first shrinks its font (down to 70% of
normal), and only while the student is typing in it does the box widen to
show the whole answer (growing to the right, sliding left at the page edge,
clamped to the page width). Once the field loses focus it snaps back to the
authored size with an ellipsis, and hovering shows the full answer. The
Review sidebar and results table always show complete answers. Grading is
unaffected.

**Results** show the provisional score (auto-graded questions only), the
final score once manual questions are graded, the percentage, counts of
correct/incorrect/pending items and a per-question table with the student's
answer and, if enabled, the correct answer. "Show on document" overlays the
verdicts on the PDF. Examiner mode (behind the author PIN, if set) lets you
assign points to manual questions; the final score updates as you go.

## Grading rules

Grading is deterministic and intentionally conservative.

- Empty responses are never correct.
- Multiple choice (including True/False/Not Given): the chosen option must
  equal the correct option.
- Short answer: the response matches if it equals **any** accepted answer
  after both are normalized with the question's matching rules. Defaults:
  case-insensitive, trim, collapse internal whitespace, ignore punctuation,
  keep accents. "Ignore accents" strips diacritics (including đ → d) for
  cases where the student may type without Vietnamese input.
- No fuzzy matching, no partial credit on auto-graded questions. If an answer
  has several valid spellings, add them all as accepted answers.
- Manual questions contribute 0 to the provisional score and whatever the
  examiner assigns (clamped to 0..points) to the final score.

See `src/grading/` and `test/grade.test.ts` / `test/normalize.test.ts`.

## Coordinates

Every field stores a rectangle in **normalized page coordinates**: `x, y, w, h`
as fractions (0..1) of the page's displayed box, which is the PDF.js viewport
at scale 1 with the page's own `/Rotate` applied. Multiple-choice letter
positions (`anchors`) are stored as fractions of the field's own rectangle,
so moving, resizing, duplicating or pasting a field carries them along. Pixel positions are derived
from that at render time, so fields stay put across zoom levels, window
sizes, device pixel ratios and the fit-width/fit-page modes. The conversion
helpers are in `src/pdf/coords.ts`, with tests in `test/coords.test.ts`.

## Storage and packages

Exams (manifest + original PDF bytes) and attempts are stored in IndexedDB
(database `pdf-exam-practice`). That is per browser profile and per origin:
clearing site data removes everything, and `localhost:5173` and
`localhost:4173` are different origins. Export packages for anything you want
to keep or move.

An exam package is a ZIP file named `<title>.exam.zip` containing:

| File            | Contents                                              |
| --------------- | ----------------------------------------------------- |
| `manifest.json` | the exam: title, settings, questions, answer key, PDF metadata |
| `exam.pdf`      | the original PDF, byte for byte                       |
| `README.txt`    | a short human-readable note (ignored on import)       |

The manifest carries `formatVersion` (currently 1) and the PDF's SHA-256,
byte length and page sizes. On import the app validates the manifest shape,
every question (types, option/correct consistency, rectangles inside the
page, point values), recomputes the PDF hash and refuses mismatches,
truncated archives, non-ZIP files and packages from a newer format version
with a specific error message. Older versions will be migrated in
`migrateManifest` as the format evolves. Importing an exam whose id already
exists offers Replace, Keep both (new id) or Cancel.

Attempts are not part of the package; they stay in the browser that made
them.

## Privacy and security notes

- Files never leave the machine. There are no network calls other than
  loading the app's own static files, and none at all once it is loaded.
  `e2e/offline.cjs` verifies this against the production build.
- The answer key is part of the exam, so it is in IndexedDB and in exported
  packages. In student mode the key is stripped from the data handed to the
  UI, so it does not appear in the page's DOM or React state, but anyone with
  browser devtools can read the database. The optional **author PIN** is a
  deterrent to stop a student from wandering into author mode or examiner
  mode, not a security boundary: it is stored in the manifest in plain text.
- Nothing is encrypted at rest. Treat exported packages like the answer-key
  PDF they contain.

## Design decisions and trade-offs

- **PDF.js renders to canvas** rather than extracting text. Scanned papers
  work, and layout is exact, at the cost of no text selection or search.
  Pages render lazily (only those near the viewport) into offscreen canvases
  capped at 24 megapixels, so a 200 % zoom on A4 stays sharp without
  exhausting memory.
- **One shared PDF.js worker** for the whole session instead of one per
  document. The worker script is fetched once, so opening a second exam still
  works if the local server has since gone away.
- **No OCR / automatic question detection.** Placement is manual by design;
  it is a few minutes of work per paper and never silently wrong.
- **IndexedDB is a cache, not a backup.** Export packages. The app keeps the
  original PDF bytes rather than a re-encoded copy so round trips are
  lossless.
- **Single-user, single-browser.** Multiple students on one machine share
  the attempt list; there are no profiles.
- **Vite + React + TypeScript**, no UI framework; styling is one hand-written
  stylesheet. Dependencies at runtime: `pdfjs-dist`, `jszip`, `idb`, React.

## Project layout

```
src/model      types, defaults, ids              (data model, formatVersion)
src/pdf        PDF.js wrapper, viewer, zoom, normalized coordinates
src/grading    answer normalization and grading
src/package    package format, validation, zip import/export, hashing
src/storage    IndexedDB access
src/ui         Home, author/, student/, results/, shared components, hash router
test/          vitest unit tests
e2e/           Playwright browser checks (optional)
scripts/       copies PDF.js font/cmap assets into public/pdfjs on install
```
