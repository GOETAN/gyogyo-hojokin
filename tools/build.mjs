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

// {{key}} を値で置き換える。値は必ずエスケープする。
// {{{key}}} はこのファイルで組み立てた HTML（中の値はエスケープ済み）をそのまま入れる。
// 知らないキーはビルドエラー。
function render(template, vars, raw = {}) {
  return template.replace(/\{\{\{(\w+)\}\}\}|\{\{(\w+)\}\}/g, (_, rawKey, key) => {
    if (rawKey) {
      if (!(rawKey in raw)) throw new Error(`テンプレートの {{{${rawKey}}}} に入れる値がありません`);
      return raw[rawKey];
    }
    if (!(key in vars)) throw new Error(`テンプレートの {{${key}}} に入れる値がありません`);
    return escapeHtml(vars[key]);
  });
}

// 質問 1 問 = 1 画面。id は q1, q2, ...。表示の切り替えは src/app.js が行う。
function renderQuestions(questions) {
  const total = questions.length;
  return questions.map((q, i) => {
    const n = i + 1;
    const choices = q.options.map((o) =>
      `        <button type="button" class="btn btn-choice" data-value="${escapeHtml(o.value)}">${escapeHtml(o.label)}</button>`,
    ).join('\n');
    return `    <section id="q${n}" class="screen stack" data-step="${n}" hidden aria-labelledby="q${n}-title">
      <p class="progress">しつもん ${n} / ${total}</p>
      <h1 id="q${n}-title" tabindex="-1">${escapeHtml(q.text)}</h1>
      <div class="stack" role="group" aria-labelledby="q${n}-title">
${choices}
      </div>
      <a class="btn btn-secondary" data-back href="#top">もどる</a>
    </section>`;
  }).join('\n\n');
}

export async function build({ dataDir = DATA_DIR, outDir = resolve(ROOT, 'dist') } = {}) {
  const { site, questions, errors } = await loadData(dataDir);
  if (errors.length) {
    const lines = errors.map((e) => `✗ ${e.file} ${e.path}: ${e.msg}`);
    throw new Error(`検証エラー ${errors.length} 件。サイトは作りません。\n${lines.join('\n')}`);
  }
  const html = render(readFileSync(join(SRC_DIR, 'index.html'), 'utf8'), {
    kumiai_name: site.kumiai_name,
    phone: site.phone,
    tel: site.phone.replace(/\D/g, ''),
    hours: site.hours,
    question_count: questions.length,
  }, {
    questions: renderQuestions(questions),
  });
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'index.html'), html);
  for (const f of ['style.css', 'app.js']) {
    writeFileSync(join(outDir, f), readFileSync(join(SRC_DIR, f)));
  }
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
