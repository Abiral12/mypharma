// src/lib/scanner/tesseract-node.cjs
// const { createWorker } = require('tesseract.js');
import { createWorker } from 'tesseract.js';

async function ocrBuffer(buffer) {
  const worker = await createWorker({
    langPath: 'https://tessdata.projectnaptha.com/4.0.0',
  });
  await worker.loadLanguage('eng');
  await worker.initialize('eng');
  const { data } = await worker.recognize(buffer);
  await worker.terminate();
  return {
    text: data?.text ?? '',
    confidence: Number.isFinite(data?.confidence) ? data.confidence : 0,
  };
}

module.exports = { ocrBuffer };
