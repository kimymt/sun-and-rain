# Sun & Rain

日本国内で使う個人・非商用の天気PWA。画面名は「雨と日差しの予報」。地名検索・現在地周辺の候補選択、実データ表示、端末保存、前回表示した予報との差分に対応しています。

## 実データ版を開く

プロジェクトのディレクトリで実行します。追加パッケージは不要です。

```sh
node scripts/serve.mjs
```

表示されたローカルURLをブラウザで開きます。終了はCtrl+C。サーバーはこの端末のループバックだけで待ち受け、外部公開はしません。ES Modulesを使用するため、実データ版はHTMLファイルの直接起動ではなくHTTPで開いてください。

## 実装済み

- 現在から12時間の降水確率・降水量・日照・UV・気温。時間選択で天気・湿度・風速も表示。
- Open-Meteoへ2リクエスト。Best Matchの8項目と、GFS指定のUV・降水確率を分けて取得。
- 時刻・単位・配列の検証と、UTC epochによる結合。期間末の時刻で返る1時間値を正しい表示区間に配置。
- 手動更新は60分に1回。初回・地点変更・前面表示中30分間隔の自動取得は別扱い。バックグラウンドから戻った際も経過時間を確認。
- 欠損、不正応答、通信断、アクセス上限、タイムアウト、再試行。
- 取得元ごとの取得時刻。失敗時は同じページ内に残る以前の取得値を、その時刻と失敗表示を付けて維持。
- IndexedDBへ地点・直近2回の表示予報を保存。再読込後は保存値を復元してから最新予報を取得。
- 前回実際に表示した12時間との重なりだけを比較。降水確率・降水量・日照・UV・気温の変化を強調。
- 降水量による降り始めの見込みの移動。欠損、進行中の時間帯、取得失敗した指標は強調しない。

## 次の段階

公開URL: https://sun-and-rain.kei1127miyamoto.workers.dev/

HTTPSでの実API接続・保存・オフライン再読込をChromiumで確認済み。次はiPhone実機でホーム画面追加・再起動・更新・5秒での読み取りを検証する。

初期地点は東京です。「地点を変更」から日本の地名を検索して1地点を登録できます。住所検索・地図指定・複数地点一覧は未対応です。保存データは同じオリジンで復元できます。ブラウザによるデータ削除や保存拒否はあり得るため、保存失敗時は画面内の保持へ切り替えて知らせます。予報は48時間を超えた取得値を復元せず、直近2回を超える履歴は保存しません。通知は未実装です。オフライン起動の準備が完了した後は通信断でも保存予報を開けます。初回起動には通信が必要です。

## 構成

- `app/`: 実データ版。ブラウザ標準のES ModulesとDOM/SVGを使用。
- `prototype/`: 保存してある架空データのUI試作品。
- `tests/`: Node標準テストとブラウザでの障害・復旧検証。
- `research/`: 契約調査時の応答・公式ソース・検証資料。
- [データ契約](WEATHER_DATA_CONTRACT.md)
- [今回の実装・検証記録](docs/verification/data-integration-20260927/README.md)
- [保存・予報差分の仕様と検証](docs/verification/persistence-comparison-20260927/README.md)

## テスト

```sh
node --test tests/weather.test.mjs tests/comparison.test.mjs tests/location.test.mjs
node tests/browser.mjs /absolute/path/to/playwright
node tests/persistence-browser.mjs /absolute/path/to/playwright
node tests/location-browser.mjs /absolute/path/to/playwright
node tests/pwa-browser.mjs /absolute/path/to/playwright
node tests/browser.mjs /absolute/path/to/playwright --live
```

ブラウザ検証だけは既存のPlaywrightが必要です。通常のブラウザテストはAPI応答を模擬します。`--live` は公開APIを実際に2回呼びます。

データ提供: [Open-Meteo](https://open-meteo.com/)。[仕様](https://open-meteo.com/en/docs)、[非商用APIの条件](https://open-meteo.com/en/terms)、[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)（2026-09-27到達確認）。日照を秒から分へ変換し、表示値を丸めています。

[地点設定の仕様・検証](docs/verification/location-20260927/README.md)

## PWAとアプリ更新

ホーム画面追加の案内は画面下部にあります。iPhone実機での確認は未実施です。

`node scripts/serve.mjs` は起動時にService Workerを生成します。配信前は次を実行し、`app/`の全ファイルを同じ版として専用HTTPSオリジンのルートへ配信してください。

```sh
node scripts/build-sw.mjs
node scripts/build-sw.mjs --check
```

新しい版は全ファイルを取得・照合してから待機します。開いている全タブ・ホーム画面アプリを閉じて開き直すと更新されます。予報・地点のIndexedDBは削除しません。開発中も旧版が表示される場合は、アプリの全タブを閉じて開き直してください。

[PWAの仕様と検証結果](docs/verification/pwa-20260927/README.md)

## HTTPS配信

Cloudflare Workers Static Assetsで`app/`のみを配信。Workerの独自処理・DB・APIキーは不要です。既存のWranglerログインを利用します。

```sh
node scripts/build-sw.mjs
node scripts/build-sw.mjs --check
wrangler deploy --dry-run
wrangler deploy
```

Service Workerはトップページを`/`から取得し、`index.html`本文と照合します。CloudflareのHTML URL正規化に対応しています。設定は`wrangler.jsonc`、HTTPヘッダーは`app/_headers`です。

[配信・セキュリティ・費用の検証記録とiPhone確認手順](docs/verification/deployment-20260927/README.md)

[画面圧縮・1時間更新制限・GPS周辺候補の仕様と検証](docs/verification/ui-gps-20260927/README.md)
