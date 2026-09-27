# 説明文と更新ボタン表記

2026-09-27。公開先: https://sun-and-rain.kei1127miyamoto.workers.dev/

- 承認済みの降水量説明を段落として反映。1㎡あたり1リットルの説明を含む。spanの強制改行と専用CSSを削除。
- ボタン下の更新可能時刻とaria-describedbyを削除。取得中は「取得中…」、手動更新後の60分待機中は「更新は1回/h」。制限解除後は通常表示。
- 320/390pxの既存ブラウザ試験で文言・要素削除・更新制限・再読込・別タブ・境界時刻を確認。[結果](local-results.json)。
- 公開14ファイルのハッシュ一致、説明文、削除要素、実API、オフライン再表示を確認。[結果](production-results.json)。
- 配信版 `c9d23af4-5950-4b01-bdf4-bd9e3d504536`、SW版 `7361520f941417f7`。

Git管理外のため自動差分検出は対象外。iPhone実機での今回の表示確認は未実施。

説明の参照: https://www.jma.go.jp/jma/kishou/know/faq/faq1.html （前の文言検討時に到達・定義を確認済み）。
