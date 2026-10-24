#!/usr/bin/env node
// data/ と src/ から静的サイトを dist/index.html の 1 ファイルに作る。
// CSS と JS も HTML に埋め込むので、index.html をスマホやパソコンで直接開いても動く。
// 検証エラーが1件でもあれば何も書き出さずに終了コード 1。
// 使い方: node tools/build.mjs [-o 出力ディレクトリ] [--demo]
//   --demo: tests/fixtures/demo の架空データで、「見本」の帯つきの確認用ページを作る（公開しないこと）

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, rmSync, mkdtempSync, copyFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadData, todayJST, ROOT, DATA_DIR } from './lib/data.mjs';
import { isListed } from '../src/match.js';

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

// 質問 1 問 = 1 画面。id は screen-q1, screen-q2, ...（ハッシュ #q1 と同じ id にしないこと。
// 同じだとブラウザがその要素まで自動でスクロールし、画面上の電話リンクが隠れる）。表示の切り替えは src/app.js が行う。
function renderQuestions(questions) {
  const total = questions.length;
  return questions.map((q, i) => {
    const n = i + 1;
    const choices = q.options.map((o) =>
      `        <button type="button" class="btn btn-choice" data-value="${escapeHtml(o.value)}">${escapeHtml(o.label)}</button>`,
    ).join('\n');
    return `    <section id="screen-q${n}" class="screen stack" data-step="${n}" data-key="${escapeHtml(q.key)}" hidden aria-labelledby="q${n}-title">
      <p class="progress">しつもん ${n} / ${total}</p>
      <h1 id="q${n}-title" tabindex="-1">${escapeHtml(q.text)}</h1>
      <div class="stack" role="group" aria-labelledby="q${n}-title">
${choices}
      </div>
      <a class="btn btn-secondary" data-back href="#top">もどる</a>
    </section>`;
  }).join('\n\n');
}

// 画面に渡す補助金データ。ビルド日の時点で一覧に出せないもの（closed・締切切れ）は含めない。
// 締切はブラウザ側でも閲覧日で判定し直す（再ビルドまでの間に締切を過ぎるため）。
// checked_by は画面に出さないので含めない。
function subsidiesJson(subsidies, today) {
  const out = subsidies.filter((s) => isListed(s, today)).map(({ checked_by, ...rest }) => rest);
  // <script> の中に置くので、</script> で閉じられないよう < をエスケープする。
  return JSON.stringify(out).replace(/</g, '\\u003c');
}

// src/match.js（ES モジュール）と src/app.js を、HTML に埋め込める 1 本のスクリプトにする。
// ファイルとして直接開いたとき（file://）はモジュールの読み込みがブラウザに止められるため。
function bundleScript() {
  const match = readFileSync(join(SRC_DIR, 'match.js'), 'utf8').replace(/^export\s+/gm, '');
  const app = readFileSync(join(SRC_DIR, 'app.js'), 'utf8').replace(/^import\s.*from\s+'\.\/match\.js';\s*$/m, '');
  const out = `(() => {\n${match}\n${app}\n})();\n`;
  if (/^\s*(import|export)\b/m.test(out)) throw new Error('埋め込みスクリプトに import/export が残っています');
  return out;
}

// CSP で、埋め込んだ <style> と <script> だけを許可するためのハッシュ。
const cspHash = (text) => `'sha256-${createHash('sha256').update(text, 'utf8').digest('base64')}'`;

// <style>/<script> の中身が途中で閉じられないことを確かめる。
function assertEmbeddable(text, tag) {
  if (new RegExp(`</${tag}`, 'i').test(text)) throw new Error(`埋め込む ${tag} の中に </${tag} があります`);
  return text;
}

// 見本用の data ディレクトリ: 本物の site.yaml・questions.yaml と、tests/fixtures/demo の架空の補助金。
function demoDataDir() {
  const dir = mkdtempSync(join(tmpdir(), 'hojokin-demo-'));
  mkdirSync(join(dir, 'subsidies'));
  for (const f of ['site.yaml', 'questions.yaml']) copyFileSync(join(DATA_DIR, f), join(dir, f));
  const src = resolve(ROOT, 'tests/fixtures/demo/subsidies');
  for (const f of readdirSync(src)) copyFileSync(join(src, f), join(dir, 'subsidies', f));
  return dir;
}

const DEMO_BANNER = '<p class="demo-banner" role="note">これは 確認用の 見本です。補助金の 内容は すべて 架空です。</p>';

export async function build({ dataDir = DATA_DIR, outDir = resolve(ROOT, 'dist'), today = todayJST(), demo = false } = {}) {
  const { site, questions, subsidies, errors } = await loadData(dataDir, { today });
  if (errors.length) {
    const lines = errors.map((e) => `✗ ${e.file} ${e.path}: ${e.msg}`);
    throw new Error(`検証エラー ${errors.length} 件。サイトは作りません。\n${lines.join('\n')}`);
  }
  const style = assertEmbeddable(readFileSync(join(SRC_DIR, 'style.css'), 'utf8'), 'style');
  const script = assertEmbeddable(bundleScript(), 'script');
  const html = render(readFileSync(join(SRC_DIR, 'index.html'), 'utf8'), {
    kumiai_name: site.kumiai_name,
    phone: site.phone,
    tel: site.phone.replace(/\D/g, ''),
    hours: site.hours,
    question_count: questions.length,
  }, {
    questions: renderQuestions(questions),
    subsidies_json: subsidiesJson(subsidies, today),
    style,
    script,
    style_hash: cspHash(style),
    script_hash: cspHash(script),
    demo_banner: demo ? DEMO_BANNER : '',
  });
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'index.html'), html);
  return { outDir, file: join(outDir, 'index.html') };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf('-o');
  const demo = process.argv.includes('--demo');
  const outDir = i > -1 ? resolve(process.argv[i + 1]) : resolve(ROOT, demo ? 'dist-demo' : 'dist');
  try {
    const r = await build({ outDir, demo, ...(demo && { dataDir: demoDataDir() }) });
    console.log(`✓ ${r.file} に書き出しました`);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
