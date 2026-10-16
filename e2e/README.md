# Browser end-to-end checks

These scripts drive the real app in headless Chrome with Playwright. They are
**not** part of `npm test` and Playwright is **not** a dependency of the app;
install it here on demand so the app's own dependency tree stays small and
offline-friendly.

```sh
cd e2e
npm init -y && npm install playwright@^1.64        # once; uses your installed Chrome ("channel: 'chrome'")
mkdir -p samples out && cp /path/to/some-exam.pdf samples/sample.pdf

# in another terminal, from the repo root:
npm run dev                                         # serves http://localhost:5173/

node phase1.cjs      # PDF rendering: fit-width, lazy pages, zoom, page navigation
node phase2.cjs      # authoring (placement, drag, resize, zoom/resize drift, keyboard), student flow, grading, examiner
node copypaste.cjs   # copy a field with Cmd+C, paste copies under the mouse with Cmd+V / toolbar button
node anchors.cjs     # multiple choice: drag a box, click the printed letters, drag markers, Esc fallback, student markers, results
node growfield.cjs   # long answers in narrow boxes: font shrinks first, box widens only while focused, snaps back on blur
node truefalse.cjs   # True/False preset: toolbar tool, Not Given toggle keeps/clears the key, type conversion, student buttons, grading
node phase4.cjs      # export/import round trip, conflicts, corrupt packages, PIN gating
BASE=http://localhost:4173/ node offline.cjs        # against `npm run preview`: blocks every non-localhost request, then goes fully offline
```

Each script prints what it measured and exits non-zero on failure. Screenshots
and generated packages land in `e2e/out/`. Set `SAMPLE_PDF=/path/file.pdf` to
use a different PDF; the scripts assume it has at least 2 pages and is not
password-protected.
