// 画面の切り替え。状態は URL のハッシュだけに持つ（保存しない）。
//   #top                     トップ
//   #q2/equipment            2問目。1問目の答えが equipment
//   #result/a/b/c            結果。3問の答え
// ハッシュに持つので、スマホの「戻る」で前の質問に戻れ、再読み込みしても答えが消えない。
// Cookie・localStorage は使わない。

(() => {
  const screens = [...document.querySelectorAll('main > .screen')];
  const questions = screens.filter((s) => s.dataset.step);
  const total = questions.length;
  const restart = document.querySelector('[data-restart]');
  const baseTitle = document.title;

  // 各質問で選べる値。ハッシュを書き換えられても、知らない値は受け付けない。
  const allowed = questions.map((q) =>
    new Set([...q.querySelectorAll('[data-value]')].map((b) => b.dataset.value)));

  const hashFor = (screen, answers) => '#' + [screen, ...answers].join('/');

  // ハッシュを読んで { id, answers } にする。おかしなハッシュはトップ扱い。
  function parse(hash) {
    const [id = '', ...answers] = decodeURIComponent(hash.replace(/^#/, '')).split('/');
    const step = id === 'result' ? total + 1 : /^q\d+$/.test(id) ? Number(id.slice(1)) : 0;
    const valid = step >= 1 && step <= total + 1
      && answers.length === step - 1
      && answers.every((a, i) => allowed[i].has(a));
    return valid ? { id, step, answers } : { id: 'top', step: 0, answers: [] };
  }

  function show() {
    const { id, step, answers } = parse(location.hash);
    if (id === 'top' && location.hash && location.hash !== '#top') {
      history.replaceState(null, '', '#top');
    }
    for (const s of screens) s.hidden = s.id !== id;
    const current = document.getElementById(id);

    // もどる: 1つ前の画面へ。直接このURLを開いた人でもサイトの外に出ないよう、history.back() は使わない。
    const back = current.querySelector('[data-back]');
    if (back) {
      back.href = step <= 1 ? '#top' : hashFor(`q${step - 1}`, answers.slice(0, step - 2));
    }
    if (restart) restart.hidden = id === 'top';

    const heading = current.querySelector('h1');
    document.title = id === 'top' ? baseTitle : `${heading.textContent.trim()}｜${baseTitle}`;
    window.scrollTo(0, 0);
    // 読み上げソフトが新しい画面の見出しから読むように、見出しへフォーカスを移す（初回表示は除く）。
    if (shown) heading.focus({ preventScroll: true });
    shown = true;
    shownAt = performance.now();
  }
  let shown = false;
  let shownAt = 0;

  // 画面が切り替わった直後のタップは無視する。2度押しすると、次の画面の同じ位置の
  // 選択肢まで押してしまうため（指が震える・反応が遅いと感じて押し直す、を想定）。
  const TAP_GUARD_MS = 500;

  // 選択肢: 選んだらすぐ次の画面へ（確認ボタンを挟まない。5タップ以内の条件のため）。
  for (const q of questions) {
    q.addEventListener('click', (e) => {
      const button = e.target.closest('[data-value]');
      if (!button || performance.now() - shownAt < TAP_GUARD_MS) return;
      const { answers } = parse(location.hash);
      const step = Number(q.dataset.step);
      const next = [...answers.slice(0, step - 1), button.dataset.value];
      location.hash = step < total ? hashFor(`q${step + 1}`, next) : hashFor('result', next);
    });
  }

  window.addEventListener('hashchange', show);
  show();
})();
