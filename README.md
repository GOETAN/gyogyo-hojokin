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
tools/lib/data.mjs        # 読み込みと検証。validate とビルドが共有する
tools/validate.mjs        # 検証 CLI。エラーがあれば終了コード 1
tests/                    # 検証ロジックのテスト（架空データのみ）
```

## 検証

```sh
npm ci
npm test           # 検証ロジックのテスト
npm run validate   # data/ の検証
```

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

## 判定ルール（画面側。今後実装）

- 質問どうしは AND、1 問の中の選択肢は OR。「わからない」はその質問を条件にしない
- 締切（日本時間）を過ぎたもの・status が closed のものは一覧に出さない。締切当日は出す
- checked_date から 90 日を超えたものは「情報が古い可能性があります」と表示
- 0 件のときは漁協への電話と、締切内の全件を表示
