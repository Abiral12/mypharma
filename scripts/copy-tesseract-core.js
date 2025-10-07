#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

async function copyIfExists(src, dest) {
  try {
    await fs.promises.access(src);
  } catch (e) {
    return false;
  }
  await fs.promises.mkdir(path.dirname(dest), { recursive: true });
  await fs.promises.copyFile(src, dest);
  console.log(`copied ${src} -> ${dest}`);
  return true;
}

(async () => {
  try {
    const base = path.join(process.cwd(), 'node_modules', 'tesseract.js-core');
    const publicDir = path.join(process.cwd(), 'public');
    const files = [
      'tesseract-core-simd.wasm',
      'tesseract-core.wasm',
      'tesseract-core-simd.js',
      'tesseract-core.js'
    ];
    let any = false;
    for (const f of files) {
      const src = path.join(base, f);
      const dest = path.join(publicDir, f);
      const ok = await copyIfExists(src, dest);
      any = any || ok;
    }
    if (!any) console.warn('No tesseract core files copied (check if tesseract.js-core is installed)');
  } catch (err) {
    console.warn('copy-tesseract-core failed (non-fatal):', err && err.message ? err.message : err);
  }
})();
