#!/usr/bin/env node
// data/ と src/ から静的サイトを dist/ に作る。
// 検証エラーが1件でもあれば何も書き出さずに終了コード 1。
// 使い方: node tools/build.mjs [-o 出力ディレクトリ]

import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadData, ROOT, DATA_DIR } from './lib/data.mjs';

const SRC_DIR = resolve(ROOT, 'src');

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));

// {{key}} を値で置き換える。値は必ずエスケープする。知らないキーはビルドエラー。
function render(template, vars) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    if (!(key in vars)) throw new Error(`テンプレートの {{${key}}} に入れる値がありません`);
    return escapeHtml(vars[key]);
  });
}

export async function build({ dataDir = DATA_DIR, outDir = resolve(ROOT, 'dist') } = {}) {
  const { site, errors } = await loadData(dataDir);
  if (errors.length) {
    const lines = errors.map((e) => `✗ ${e.file} ${e.path}: ${e.msg}`);
    throw new Error(`検証エラー ${errors.length} 件。サイトは作りません。\n${lines.join('\n')}`);
  }
  const html = render(readFileSync(join(SRC_DIR, 'index.html'), 'utf8'), {
    kumiai_name: site.kumiai_name,
    phone: site.phone,
    tel: site.phone.replace(/\D/g, ''),
    hours: site.hours,
  });
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'index.html'), html);
  writeFileSync(join(outDir, 'style.css'), readFileSync(join(SRC_DIR, 'style.css')));
  return { outDir };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf('-o');
  const outDir = i > -1 ? resolve(process.argv[i + 1]) : undefined;
  try {
    const r = await build({ outDir });
    console.log(`✓ ${r.outDir} に書き出しました`);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
