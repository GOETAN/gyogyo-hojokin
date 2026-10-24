# 漁業者向け 補助金あんないサイト（仮称）

漁業者本人が、自分に関係しそうな補助金に「気づき」、協力漁協の窓口に「相談する」ところまでを導く静的サイト。
申請の判断・書類作成はこのサイトの役割ではない。

## 絶対に守ること

1. 申請書の作成・代行・下書き機能を作らない
2. 「対象です」と断定しない。結果は「当てはまるかもしれません。漁協に相談してください」に統一
3. 出典URLと確認日がない補助金データは表示しない（検証で弾く）
4. 個人情報を入力させない・保存しない。ログイン機能を作らない
5. MVP では生成AI（LLM API）を使わない
6. 補助金の内容をコード作成者が推測で書かない。`data/` の人が確認した内容のみを使う

## 構成

```
data/schema.json          # データ定義の唯一の正（JSON Schema 2020-12）
data/site.yaml            # 協力漁協の名前・電話・受付時間（未記入だと検証が通らない）
data/questions.yaml       # 質問と選択肢。value は schema.json と一致させる
data/subsidies/*.yaml     # 補助金 1 件 1 ファイル。ファイル名 = id
src/index.html            # 画面のひな形。{{key}} はビルド時に site.yaml の値（エスケープ済み）で置き換える
src/style.css             # 見た目。寸法は rem（端末の文字サイズ設定に追従する）
src/app.js                # 画面の切り替えと結果の表示。状態は URL のハッシュだけに持つ（#q2/equipment など）
src/match.js              # 絞り込み・締切・古さの判定。ブラウザ・ビルド・テストが共有する
tools/lib/data.mjs        # 読み込みと検証。validate とビルドが共有する
tools/validate.mjs        # 検証 CLI。エラーがあれば終了コード 1
tools/build.mjs           # dist/ に静的サイトを作る。検証エラーがあれば何も書き出さない
tests/*.test.mjs          # 検証・ビルドのテスト（架空データのみ）
tests/ui/                 # 360px 幅での画面チェック（Playwright + axe-core）。結果画面は架空データで検査
```

## 検証

```sh
npm ci
npm test           # 検証・ビルドのテスト
npm run validate   # data/ の検証
npm run build      # dist/ に書き出す
npm run test:ui    # 画面チェック（初回は npx playwright install chromium が必要）
```

`test:ui` が見るのは、360px 幅での横スクロール・文字の大きさ・タップ領域とその間隔・
WCAG 2.1 A/AA（axe-core。コントラストを含む）・外部通信と Cookie がないこと。
実機（高齢者のスマホ）での確認の代わりにはならない。

## 補助金データの書き方

```yaml
id: example-id                 # ファイル名（拡張子なし）と同じ。英小文字・数字・ハイフン
name: （正式名称。原文どおり）
plain_name: （やさしい呼び名）
level: national                # national | prefecture | city
provider: （実施機関）
summary_plain: （何に使えるかを2〜3文で）
match:
  purposes: [equipment]        # どれでもよいときは [any]（any は単独で）
  fishery_types: [any]
  applicant: [any]
amount_note: 要確認            # 補助率・上限。原文どおり。不明なら 要確認
deadline: 2026-12-01           # YYYY-MM-DD。随時／未定は null
contact_note: （どこに相談するか）
source_url: https://...        # https のみ
checked_date: 2026-10-24       # 人が出典を確認した日。未来日は不可
checked_by: （役割名・イニシャル等。公開されるので個人のフルネームは避ける）
status: open                   # open | upcoming | closed
```

選択肢の値は `data/schema.json` の `$defs.purpose` / `fishery_type` / `applicant` を参照。

## 画面の動き

- 1 画面 1 問。選ぶとすぐ次へ進む（確認ボタンなし）。トップから結果まで 4 タップ
- 答えは URL のハッシュに持つ。スマホの「戻る」で前の質問に戻れ、再読み込みしても消えない。Cookie・localStorage は使わない
- 画面が切り替わった直後 0.5 秒のタップは無視する（2 度押しで次の質問まで答えてしまうのを防ぐ）
- 知らない値が入った URL はトップに戻す
- 結果のカードの「くわしく みる」で詳細へ（`#detail/<id>/<こたえ>`）。詳細の URL にもこたえを持つので、「けっかに もどる」・スマホの「戻る」で同じ結果に戻る
- 詳細: やさしい説明・締切・補助の割合と上限（原文どおり）・相談先・正式名称・実施機関・確認日・出典リンク（新しいタブ、https のみ）。電話ボタンはスクロールせずに見える位置
- 知らない id や、閲覧日に締切を過ぎた補助金の詳細 URL は結果画面に戻す
- 各画面の上に控えめな電話リンク、下に大きな電話ボタン。上のリンクはスクロールしなくても見える
- 文の改行は半角スペースの位置でだけ起きる（`word-break: keep-all`）。画面に出す文は語の区切りに半角スペースを入れる

## 判定ルール（src/match.js）

- 質問どうしは AND、1 問の中の選択肢は OR。「わからない」はその質問を条件にしない
- 締切（日本時間）を過ぎたもの・status が closed のものは一覧に出さない。締切当日は出す
- checked_date から 90 日を超えたものは「情報が古い可能性があります」と表示
- 0 件のときは漁協への電話と、締切内の全件を表示。データ自体が 0 件なら「じゅんびして います」と電話
- 締切の近い順。締切なし（随時・未定）は最後
- ビルド時点で出せないもの（closed・締切切れ）は公開ファイルに含めない。締切と古さはブラウザでも閲覧日（日本時間）で判定し直す
- `checked_by` は公開ファイルに含めない
