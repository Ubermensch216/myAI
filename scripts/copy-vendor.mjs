#!/usr/bin/env node
/**
 * Copies vendored frontend assets from node_modules into public/vendor/.
 * Run after `npm install` if vendor files are missing or out of date.
 *
 * Usage: node scripts/copy-vendor.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const targets = [
  {
    from: "node_modules/cytoscape/dist/cytoscape.min.js",
    to: "public/vendor/cytoscape.min.js"
  },
  // 문서보안(safeDoc) 모듈 의존성. 모두 self-contained ESM이라 번들 없이
  // public/modules/safeDoc/vendor/*.js 어댑터에서 동적 import()로 지연 로드한다.
  {
    from: "node_modules/pdfjs-dist/legacy/build/pdf.min.mjs",
    to: "public/vendor/pdfjs/pdf.min.mjs"
  },
  {
    from: "node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs",
    to: "public/vendor/pdfjs/pdf.worker.min.mjs"
  },
  {
    from: "node_modules/fflate/esm/browser.js",
    to: "public/vendor/fflate/fflate.esm.js"
  },
  {
    // ES 빌드(fontkit.es.min.js)는 `import from "pako"` bare specifier가 남아 있어
    // 브라우저에서 직접 로드할 수 없다. UMD 빌드는 pako를 인라인 번들하므로
    // 이쪽을 쓰고, 어댑터가 <script> 주입으로 지연 로드해 window.fontkit을 얻는다.
    from: "node_modules/@pdf-lib/fontkit/dist/fontkit.umd.min.js",
    to: "public/vendor/fontkit/fontkit.umd.min.js"
  }
];

const dstDir = path.join(rootDir, "public", "vendor");
fs.mkdirSync(dstDir, { recursive: true });

let copied = 0;
for (const t of targets) {
  const src = path.join(rootDir, t.from);
  const dst = path.join(rootDir, t.to);
  if (!fs.existsSync(src)) {
    console.error(`[copy-vendor] missing source: ${t.from} (run npm install first)`);
    process.exitCode = 1;
    continue;
  }
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
  const size = (fs.statSync(dst).size / 1024).toFixed(0);
  console.log(`[copy-vendor] ${t.from} -> ${t.to} (${size} KB)`);
  copied++;
}
console.log(`[copy-vendor] done (${copied}/${targets.length})`);
