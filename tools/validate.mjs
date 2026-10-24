#!/usr/bin/env node
// data/ を検証する。エラーが1件でもあれば終了コード 1（CI とビルドを止める）。
// 使い方: node tools/validate.mjs [data ディレクトリ]

import { resolve } from 'node:path';
import { loadData, DATA_DIR } from './lib/data.mjs';

const dir = process.argv[2] ? resolve(process.argv[2]) : DATA_DIR;

let result;
try {
  result = await loadData(dir);
} catch (e) {
  console.error(`✗ ${e.message}`);
  process.exit(1);
}
const { subsidies, errors, warnings } = result;

for (const w of warnings) console.warn(`⚠ ${w.file} ${w.path}: ${w.msg}`);
for (const e of errors) console.error(`✗ ${e.file} ${e.path}: ${e.msg}`);

if (errors.length) {
  console.error(`\n検証エラー ${errors.length} 件。修正するまでサイトは作られません。`);
  process.exit(1);
}
console.log(`✓ 検証OK（補助金 ${subsidies.length} 件、警告 ${warnings.length} 件）`);
