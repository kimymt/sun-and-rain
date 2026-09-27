# 自動テーマ・降水量説明・一覧削除

2026-09-27。公開先: https://sun-and-rain.kei1127miyamoto.workers.dev/
配信Version ID: `b7043463-1022-446d-9ce3-5c63f16c5d2d`。SW版: `99e2bcb610419b7b`。

## 変更

- prefers-color-schemeで端末設定に追従。背景・文字・ボタン・入力・ダイアログ・グラフ・夜間・欠損・変更表示をCSS変数で切り替える。手動切替と設定保存は追加していない。表示中の設定変更にも追従する。
- color-schemeとmedia付きtheme-colorでブラウザUIへの配色指定も追加。Manifestの起動背景色は従来のライト色を維持するため、OSの起動スプラッシュ画面までの自動切替を保証するものではない。
- 降水量の説明を「1時間に降る雨や雪の量」「1mmの意味」「雪は水に換算」「降水確率と別」の4行に整理。文字拡大時は自然に折り返す。
- 時間別の数値一覧のHTML・生成処理・専用CSSを削除。スライダーと前後ボタンで選択時間の数値を確認できる。

## 検証

- [テーマ検証](theme-results.json): Chromiumの320/390pxでライト→ダーク→ライトを再読込せず切替。背景・グラフの実際の色、時間選択、説明、ダイアログ操作、横はみ出しなし、JavaScript例外なしを確認。天気は模擬応答。
- [既存回帰試験](browser-results.json): 4画面幅・API障害復旧・文字拡大に成功。
- [公開テーマ検証](production-theme-results.json): 公開HTTPSでも同じ切替・操作を確認。テーマ試験の天気は模擬応答。
- [公開配信検証](production-results.json): ファイルハッシュ、CSP、実API・検索、保存予報のオフライン再読込を確認。
- [ダーク画面](dark-390.png)を目視確認。[ライト画面](light-390.png)も保存。

公開直後の最初のテーマ試験では旧一覧が2要素残り失敗した。その応答本文は保存していないため配信反映のタイミングが原因とは断定しない。その後の公開ファイル全件のハッシュ一致を確認してから同じ試験を再実行し、両画面幅で成功した。

iPhone実機のOS設定変更、SafariのブラウザUI、ホーム画面アプリの起動色は未確認。Git管理外のため自動差分検出は対象外。

参照（当日到達確認）:

- [MDN prefers-color-scheme](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@media/prefers-color-scheme)
- [気象庁 雨・雪について](https://www.jma.go.jp/jma/kishou/know/faq/faq1.html)
