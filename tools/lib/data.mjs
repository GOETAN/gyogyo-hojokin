// data/ の読み込みと検証。validate.mjs と（今後の）build.mjs が共有する。
// 検証をここ1箇所に置くことで、ビルドとCIが別々の判定をしないようにする。

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join, basename, relative } from 'node:path';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const DATA_DIR = resolve(ROOT, 'data');
const SCHEMA_PATH = resolve(DATA_DIR, 'schema.json');

const MATCH_KEYS = { purposes: 'purpose', fishery_types: 'fishery_type', applicant: 'applicant' };
const UNKNOWN = 'unknown';
const ANY = 'any';

let deps;
async function loadDeps() {
  if (deps) return deps;
  try {
    const [{ default: YAML }, { default: Ajv }, { default: addFormats }] = await Promise.all([
      import('yaml'), import('ajv/dist/2020.js'), import('ajv-formats'),
    ]);
    const schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8'));
    const ajv = new Ajv({ allErrors: true, strict: false, verbose: true });
    addFormats(ajv);
    ajv.addSchema(schema);
    const get = (name) => ajv.getSchema(`${schema.$id}#/$defs/${name}`);
    deps = {
      YAML, schema,
      validateSubsidy: get('subsidy'), validateSite: get('site'), validateQuestions: get('questions'),
    };
    return deps;
  } catch (e) {
    if (e?.code === 'ERR_MODULE_NOT_FOUND') {
      throw new Error('依存が入っていません。先に `npm install` を実行してください。');
    }
    throw e;
  }
}

// 日本時間の今日を YYYY-MM-DD で返す。締切・確認日の判定は常に日本時間で行う。
export function todayJST(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
}

// ajv のエラーを人が読める日本語にする。
function describeAjvError(e) {
  const at = e.instancePath || '(全体)';
  const desc = e.parentSchema?.description ? `（${e.parentSchema.description}）` : '';
  switch (e.keyword) {
    case 'required': return { path: at, msg: `必須項目 ${e.params.missingProperty} がありません` };
    case 'additionalProperties':
      return { path: at, msg: `知らない項目 ${e.params.additionalProperty} があります（綴り違いの可能性）` };
    case 'type':
      return e.data === null
        ? { path: at, msg: `未記入です${desc}` }
        : { path: at, msg: `型が違います（${e.params.type} にしてください）${desc}` };
    case 'enum':
      return { path: at, msg: `値 ${JSON.stringify(e.data)} は使えません。使える値: ${e.params.allowedValues.join(', ')}` };
    case 'format':
      return { path: at, msg: `形式が正しくありません: ${JSON.stringify(e.data)}${desc}` };
    case 'pattern':
      return { path: at, msg: `形式が正しくありません: ${JSON.stringify(e.data)}${desc}` };
    case 'minLength': return { path: at, msg: `空です${desc}` };
    case 'minItems': return { path: at, msg: `少なくとも ${e.params.limit} 個必要です` };
    case 'uniqueItems': return { path: at, msg: '同じ値が重複しています' };
    case 'oneOf': return { path: at, msg: `形式が正しくありません: ${JSON.stringify(e.data)}${desc}` };
    default: return { path: at, msg: `${e.keyword}: ${e.message}` };
  }
}

// oneOf の内側のエラーは同じ場所の oneOf エラー1件にまとめる（deadline などで重複表示しない）。
function ajvErrors(validate) {
  const raw = validate.errors ?? [];
  const oneOfPaths = new Set(raw.filter((e) => e.keyword === 'oneOf').map((e) => e.instancePath));
  return raw
    .filter((e) => e.keyword === 'oneOf' || !oneOfPaths.has(e.instancePath))
    .map(describeAjvError);
}

function readYaml(YAML, file, errors) {
  try {
    const doc = YAML.parse(readFileSync(file, 'utf8'));
    return doc;
  } catch (e) {
    errors.push({ file, path: '(全体)', msg: `YAML として読めません: ${e.message.split('\n')[0]}` });
    return undefined;
  }
}

// data ディレクトリを読み込んで検証する。
// 戻り値: { site, questions, subsidies, errors, warnings }。errors が1件でもあればビルドしてはいけない。
export async function loadData(dataDir = DATA_DIR, { today = todayJST() } = {}) {
  const { YAML, schema, validateSubsidy, validateSite, validateQuestions } = await loadDeps();
  const errors = [];
  const warnings = [];
  const rel = (f) => relative(process.cwd(), f) || f;
  const push = (list, file, items) => items.forEach((it) => list.push({ file: rel(file), ...it }));

  // --- site.yaml ---
  const siteFile = join(dataDir, 'site.yaml');
  let site;
  if (!existsSync(siteFile)) {
    push(errors, siteFile, [{ path: '(全体)', msg: 'ファイルがありません' }]);
  } else {
    site = readYaml(YAML, siteFile, errors);
    if (site !== undefined && !validateSite(site)) push(errors, siteFile, ajvErrors(validateSite));
  }

  // --- questions.yaml ---
  const qFile = join(dataDir, 'questions.yaml');
  let questions;
  if (!existsSync(qFile)) {
    push(errors, qFile, [{ path: '(全体)', msg: 'ファイルがありません' }]);
  } else {
    questions = readYaml(YAML, qFile, errors);
    if (questions !== undefined) {
      if (!validateQuestions(questions)) push(errors, qFile, ajvErrors(validateQuestions));
      else push(errors, qFile, checkQuestions(questions, schema));
    }
  }

  // --- subsidies/*.yaml ---
  const subDir = join(dataDir, 'subsidies');
  const files = existsSync(subDir)
    ? readdirSync(subDir).filter((f) => !f.startsWith('.')).sort()
    : [];
  const subsidies = [];
  const seenIds = new Map();
  for (const f of files) {
    const file = join(subDir, f);
    if (!/\.ya?ml$/.test(f)) {
      push(errors, file, [{ path: '(全体)', msg: '拡張子は .yaml にしてください' }]);
      continue;
    }
    const doc = readYaml(YAML, file, errors);
    if (doc === undefined) continue;
    if (!validateSubsidy(doc)) {
      push(errors, file, ajvErrors(validateSubsidy));
      continue;
    }
    const extra = checkSubsidy(doc, basename(f).replace(/\.ya?ml$/, ''), today);
    push(errors, file, extra.errors);
    push(warnings, file, extra.warnings);
    if (seenIds.has(doc.id)) {
      push(errors, file, [{ path: '/id', msg: `id "${doc.id}" が ${seenIds.get(doc.id)} と重複しています` }]);
      continue;
    }
    seenIds.set(doc.id, rel(file));
    if (extra.errors.length === 0) subsidies.push(doc);
  }

  return { site, questions, subsidies, errors, warnings };
}

// JSON Schema では表せない、1件の補助金データの検査。
export function checkSubsidy(doc, fileId, today) {
  const errors = [];
  const warnings = [];
  if (doc.id !== fileId) {
    errors.push({ path: '/id', msg: `id "${doc.id}" とファイル名 "${fileId}" が一致しません` });
  }
  for (const key of Object.keys(MATCH_KEYS)) {
    const vals = doc.match[key];
    if (vals.includes(ANY) && vals.length > 1) {
      errors.push({ path: `/match/${key}`, msg: `"any" は単独で使ってください（他の値と一緒に書くと意味が曖昧になります）` });
    }
  }
  // format: date は形だけを見るので、実在しない日付（2026-02-30 等）もここで弾く。
  for (const key of ['checked_date', 'deadline']) {
    if (doc[key] != null && !isRealDate(doc[key])) {
      errors.push({ path: `/${key}`, msg: `存在しない日付です: ${doc[key]}` });
    }
  }
  if (isRealDate(doc.checked_date) && doc.checked_date > today) {
    errors.push({ path: '/checked_date', msg: `確認日 ${doc.checked_date} が未来になっています（今日は ${today}）` });
  }
  if (doc.deadline && doc.deadline < today && doc.status !== 'closed') {
    warnings.push({ path: '/deadline', msg: `締切 ${doc.deadline} を過ぎています。一覧には出ません。status を closed にするか、データを更新してください` });
  }
  return { errors, warnings };
}

// questions.yaml の value が schema の選択肢と過不足なく対応しているか。
export function checkQuestions(questions, schema) {
  const errors = [];
  const seenKeys = new Set();
  questions.forEach((q, i) => {
    const at = `/${i}`;
    if (seenKeys.has(q.key)) errors.push({ path: `${at}/key`, msg: `質問 ${q.key} が重複しています` });
    seenKeys.add(q.key);
    const allowed = schema.$defs[MATCH_KEYS[q.key]].enum.filter((v) => v !== ANY);
    const values = q.options.map((o) => o.value);
    q.options.forEach((o, j) => {
      if (o.value === ANY) {
        errors.push({ path: `${at}/options/${j}/value`, msg: '"any" はデータ側専用です。「わからない」は "unknown" にしてください' });
      } else if (o.value !== UNKNOWN && !allowed.includes(o.value)) {
        errors.push({ path: `${at}/options/${j}/value`, msg: `値 "${o.value}" は schema.json にありません。使える値: ${allowed.join(', ')}, ${UNKNOWN}` });
      }
    });
    if (new Set(values).size !== values.length) errors.push({ path: `${at}/options`, msg: '同じ value が重複しています' });
    if (!values.includes(UNKNOWN)) errors.push({ path: `${at}/options`, msg: '「わからない」（value: unknown）の選択肢が必要です' });
    for (const v of allowed) {
      if (!values.includes(v)) errors.push({ path: `${at}/options`, msg: `schema.json の値 "${v}" に対応する選択肢がありません` });
    }
  });
  for (const key of Object.keys(MATCH_KEYS)) {
    if (!seenKeys.has(key)) errors.push({ path: '(全体)', msg: `質問 ${key} がありません` });
  }
  return errors;
}

function isRealDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}
