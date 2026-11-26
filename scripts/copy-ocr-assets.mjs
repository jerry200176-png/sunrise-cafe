#!/usr/bin/env node
// Copy the OCR runtime (tesseract.js worker, wasm core, English/digits model) from node_modules
// into public/ocr so the admin payment-review page loads it from our own domain, not a CDN.
// Runs before `next build` / `next dev`. public/ocr is generated, not committed.
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

const require = createRequire(import.meta.url);
const pkgDir = (name) => dirname(require.resolve(`${name}/package.json`));
const out = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "ocr");
mkdirSync(out, { recursive: true });

copyFileSync(join(pkgDir("tesseract.js"), "dist", "worker.min.js"), join(out, "worker.min.js"));
// createWorker("eng") is LSTM-only; the worker picks one of these by the browser's SIMD support.
for (const variant of ["relaxedsimd-lstm", "simd-lstm", "lstm"]) {
  const file = `tesseract-core-${variant}.wasm.js`;
  copyFileSync(join(pkgDir("tesseract.js-core"), file), join(out, file));
}
// Served unzipped (ScreenshotReading passes gzip: false) so no host header can double-decode it.
writeFileSync(
  join(out, "eng.traineddata"),
  gunzipSync(readFileSync(join(pkgDir("@tesseract.js-data/eng"), "4.0.0_best_int", "eng.traineddata.gz")))
);
console.log(`OCR assets copied to ${out}`);
