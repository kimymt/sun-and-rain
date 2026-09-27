# HTTPS配信の検証

確認日: 2026-09-27。review-web-security、review-service-costsを使用。

公開先: https://sun-and-rain.kei1127miyamoto.workers.dev/

- Cloudflare Worker: `sun-and-rain`。作成前に同名Workerが存在しないことをAPIで確認。
- 配信Version ID: `ce56be33-ff9e-4a4c-b0fd-688b2b06ccc2`。
- Service Workerキャッシュ版: `2991061aa8904739`。
- 既存Wrangler 4.28.1、依存の追加なし。ローカルruntimeはcompatibility dateを2025-08-03へ補正する警告があるため、公開HTTPSでも検証した。
- 公開対象はapp/の13ファイル。_headersは配信規則として消費される。資料・テスト・設定ファイルは配信しない。

## 検証結果

[公開環境の記録](production-results.json)、[オンライン画面](production-online.png)、[オフライン画面](production-offline.png)。

- 公開13ファイルのHTTP 200とローカルSHA-256一致。
- README.md、wrangler.jsonc、.env、_headers、research/は404。
- CSP、nosniff、frame制限、referrer制限を実レスポンスで確認。390px幅のChromiumで画面の横はみ出しなし。
- Best Match、GFS、地名検索の実APIが200。予報表示とIndexedDB保存が完了。
- Service Workerの準備完了後、BrowserContext.setOffline(true)で通信遮断して再読込。保存予報を数値表示し、最新取得失敗とオフラインを表示。
- オンライン・オフライン双方でJavaScript例外とCSP違反なし。
- 57件のNodeテスト、PWAライフサイクル7件も成功。PWAの更新版・不完全配信はローカル模擬サーバーで検証し、本番で故障版は配信していない。

再実行:

```sh
node tests/deployment-browser.mjs /absolute/path/to/playwright https://sun-and-rain.kei1127miyamoto.workers.dev/
```

この試験は予報APIを2回、地名検索を1回利用する。証拠には初期地点の東京と検索用の札幌市だけを使用。

## 配信時に修正した点

Cloudflareの標準HTML処理は/index.htmlを/へリダイレクトする。SWがリダイレクト応答を拒否するため、HTML取得・キャッシュキーを/へ統一し、本文はindex.htmlのハッシュで照合する。

初期案のhtml_handling:noneでは/が404になり、/から/index.htmlへの書換え規則は使用中のWranglerにループとして拒否された。これらの設定は削除済み。最終版は標準HTML処理で公開・オフライン双方に成功。

## セキュリティ確認の範囲

ブラウザ内のアプリで、ログイン・共有DB・独自サーバーAPIはない。地点と予報は端末内IndexedDBへ保存し、座標と検索語はOpen-Meteoへ直接送る。

- 外部入力の地点名・候補はtextContentで表示。天気のHTML/SVG挿入は検証済み数値・固定ラベルを使用し、取得エラー文字列はescape処理を経由することをコードで確認。
- CSPは実行スクリプトを同一オリジン、通信を同一オリジンと2つのOpen-Meteo APIへ制限。既存グラフのstyle属性が必要なためstyle-srcのみunsafe-inlineを許可。
- app/と配信設定を対象に秘密鍵・代表的トークン・APIキー代入パターンを検索し、一致なし。限定的なパターン検査であり、あらゆる秘密の不存在を保証するものではない。
- アカウント所有者間認可・Cookie認証は存在せず対象外。
- 公開URLには認証を付けていない。端末内データを共有する機能はなく、検索エンジン向けnoindexを設定。noindexはアクセス制限ではない。

## 費用

独自Worker処理、KV、D1、R2、Cron、ログ製品は追加しない。静的アセットのリクエスト・保存には追加料金がない。アカウントの他サービスを含む請求総額・契約プランは未確認で、今回プラン変更はしていない。

気象APIの呼出頻度は変更なし。ブラウザから直接取得するため配信側のキャッシュではAPI回数は減らない。複数タブ・手動更新・地名検索が回数を増やす。APIの上限到達時は既存の取得失敗表示と保存予報へ戻る。

## iPhone実機で残る確認

以下は未実施。Chromiumの390px画面はiPhone実機の証拠ではない。

1. Safariで公開URLを開き、予報取得と「オフライン起動の準備ができました」を確認する。
2. 地点を変更し、端末保存の完了を確認する。
3. 共有メニューからホーム画面へ追加。起動して地点・文字サイズ・操作範囲を確認する。
4. 機内モードにし、Wi-Fiも切る。ホーム画面アプリを終了して再起動し、保存予報・取得時刻・オフライン表示を確認する。
5. 通信を戻して更新し、最新予報を取得できることを確認する。
6. 次回アプリ更新時、旧画面が途中で切り替わらず、全タブとアプリ終了後の起動で新版へ移行し、地点を保持することを確認する。
7. 5秒見て雨・日照・UV・気温の傾向を読み取れるか確認する。数値の意味を誤解した箇所を記録する。

実機のOS・機種、ホーム画面起動、VoiceOver、容量不足時の保存は未確認。

## 公式参照

以下は当日に本文を取得して到達確認。

- https://developers.cloudflare.com/workers/static-assets/
- https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/
- https://developers.cloudflare.com/workers/static-assets/headers/
- https://developers.cloudflare.com/workers/static-assets/routing/advanced/html-handling/
- https://developers.cloudflare.com/workers/platform/pricing/

Git管理外のためGit差分による検証はできない。公開ファイルは個別ハッシュ比較で検証した。
