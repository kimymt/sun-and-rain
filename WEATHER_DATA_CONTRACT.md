# UV・降水確率 データ契約 v1

調査日: 2026-09-27（日本時間）

状態: 実装で採用する取得方針・時刻処理・欠損処理を固定。アプリ本体は未実装。

この契約は、公式資料・固定コミットの実装・公開APIのサンプルに基づくアプリ側の契約である。提供元のSLA、予報精度、稼働サーバーのソース版を保証するものではない。

## 1. 採用する構成

- UVと降水確率は、Forecast APIの `models=gfs_global` で一緒に取得する。
- 他の8項目は当初計画どおりBest Matchを第一候補とする。したがって全体では2リクエスト構成に変更する。
- UV・降水確率の取得失敗時に、Best MatchやCAMSへ自動切り替えしない。
- sourcePolicyId は `open-meteo-gfs-global-uv-pop-v1`。
- 初期リクエストは24時間、表示は現在から12時間。追加の補間・UV換算はアプリ側で行わない。

モデルを明示する理由は差分比較の出典を安定させるためであり、GFS/GEFSが日本で最も高精度だからではない。公開ソースのBest MatchにはIFS由来の確率も含まれ、全変数をJMA、あるいは降水確率を常にGEFSと呼ぶことはできない。

参照: [Forecast API](https://open-meteo.com/en/docs)、[GFS API](https://open-meteo.com/en/docs/gfs-api)。

## 2. 取得パラメーター

エンドポイント: `https://api.open-meteo.com/v1/forecast`

| パラメーター | 値 |
|---|---|
| latitude / longitude | 登録地点の座標 |
| models | gfs_global |
| hourly | uv_index,precipitation_probability |
| forecast_hours | 24 |
| timeformat | unixtime |
| timezone | Asia/Tokyo |

この正確な組み合わせを6地点で実測済み。`gfs_seamless`や`ncep_gefs025`を同じ契約の別名として扱わない。

保存する時刻はUTC epoch秒。`utc_offset_seconds`をepochへ加算しない。画面だけAsia/Tokyoで整形する。レスポンス最上位の座標は選択グリッドであり、全指標の同一グリッドを証明するものではない。

## 3. UV契約

| 項目 | 採用仕様 |
|---|---|
| 変数 | uv_index。uv_index_clear_skyは採用しない |
| 元データ | GFS surface DUVB。晴天仮定のCDUVBとは別 |
| 単位 | APIは空文字、内部は無次元index |
| 空間解像度 | GFS013の約13 km。地点固有の影や個人曝露ではない |
| 近未来の出力間隔 | 1時間 |
| 更新周期 | 通常6時間。配信完了時刻とは異なる |
| 時間の意味 | APIの時刻Tで終わる直前1時間の平均として扱う |
| 正規化 | `[T-3600, T)`、aggregation=mean。半開区間はアプリの境界規約 |
| UI | 「UV（1時間平均）」。「16時の瞬間のUV」と呼ばない |
| 値 | 有限かつ0以上。恣意的な上限で切り捨てない |
| 欠損 | nullを保つ。夜間だからという理由で欠損を0にしない |

### 時間平均と判断した証拠

1. NOAAの2026-09-27 00Z、予報12時間先の索引に、DUVB/CDUVBの `6-12 hour ave fcst` を確認した。元の平均期間を、そのまま最終APIの6時間平均と解釈しない。
2. Open-MeteoのGfsDownloadはGRIBのstepType/stepRangeをdeaveragerへ渡す。
3. deaveragerは、平均期間の積分相当量の差から隣接出力区間の平均を復元する。GFSの近未来出力は1時間刻み。
4. GfsVariableのUV補間方式は `solar_backwards_averaged`。
5. VariableHourlyのraw変数経路はUVを直接返す。UVを瞬時値へ変換する処理はこの経路にない。

これは公開実装と元データに基づく結論。稼働中APIのコミット番号は応答されないため一致は未確認。通常応答だけからも平均か瞬時値かは立証できない。

出典（固定コミット `cc3f4e5e956b39a56ab182faeccfd3d936ae6b4c`）:

- [UVの変数メタデータ](https://raw.githubusercontent.com/open-meteo/open-meteo/cc3f4e5e956b39a56ab182faeccfd3d936ae6b4c/Sources/App/Gfs/GfsVariable.swift): 177行付近。
- [平均期間の復元](https://raw.githubusercontent.com/open-meteo/open-meteo/cc3f4e5e956b39a56ab182faeccfd3d936ae6b4c/Sources/App/Helper/Writer/GenericVariableHandle.swift): 493–530行。
- [APIへの変数マッピング](https://raw.githubusercontent.com/open-meteo/open-meteo/cc3f4e5e956b39a56ab182faeccfd3d936ae6b4c/Sources/App/Controllers/VariableHourly.swift): 1052–1065行。
- NOAAの元索引は調査資料 `responses/noaa-gfs-f012.idx` に保存。配信URLは短期保持のため、再現には保存コピーも使用する。

## 4. 降水確率契約

| 項目 | 採用仕様 |
|---|---|
| 変数 | precipitation_probability |
| 取得モデル指定 | gfs_global |
| 元データ | GEFS。GFSの単一の降水量計算とは異なる |
| グリッド | 0.25度を優先、提供元内部には0.5度への補完経路あり |
| 元の時間間隔 | 近未来は3時間 |
| 更新周期 | 通常6時間 |
| メンバー | 構成は30摂動＋1制御の31。実計算の分母は利用できた降水データ数 |
| 元の判定 | 区間降水量 >= 0.1 × 区間時間数。3時間なら0.3 mm以上 |
| hourlyへの変換 | 公開実装では0〜100に制限したHermite補間 |
| APIの公称時間定義 | 直前1時間の降水確率 |
| アプリの扱い | 直前1時間の表示枠へ配置する、3時間元データから補間された参考確率 |
| 比較単位 | 同じAPI対象epochの値。増減はパーセントポイント |
| 禁止 | hourly値を独立事象とみなす、確率を合計する、雨の開始を確率だけから断定する |

### 公開資料と実装の差

- 一般資料は「0.1 mmを超える」と記載するが、実装の比較演算子は `>=`。
- 一般資料の「30シミュレーション」に対し、GEFSドメイン構成は31メンバー。
- 実際の分母は `handles.count` で、31を固定定数として使っていない。応答から各時刻の実メンバー数は取得できない。
- 3時間区間の量に閾値を適用して得た確率を補間しているため、補間後の値を「独立に計算された正確な1時間事象の確率」と解釈しない。

アプリは確率を再計算しない。ユーザー向け詳細説明は次の文とする。

> 3時間の元予報を1時間間隔に補間した参考値です。雨の開始時刻を1時間単位で確定する値ではありません。

出典:

- [確率計算・補間定義](https://raw.githubusercontent.com/open-meteo/open-meteo/cc3f4e5e956b39a56ab182faeccfd3d936ae6b4c/Sources/App/Gfs/PrecipitationProbability.swift): 18–19、40–46、88–115行。
- [GEFSの時間間隔・メンバー構成](https://raw.githubusercontent.com/open-meteo/open-meteo/cc3f4e5e956b39a56ab182faeccfd3d936ae6b4c/Sources/App/Gfs/GfsDomain.swift): 112–140、181–207行。
- [モデル選択](https://raw.githubusercontent.com/open-meteo/open-meteo/cc3f4e5e956b39a56ab182faeccfd3d936ae6b4c/Sources/App/Controllers/ForecastapiController.swift): 1277–1284行。

## 5. CAMSを今回採用しない理由

Air Quality公式資料はUVをInstantと記載する。一方、固定コミットのCAMS側も `solar_backwards_averaged` を指定している。元データuvbedには40倍の換算があるが、これだけでは資料とhourly補間処理の時間意味が整合すると断定できない。

したがって、前回答の「CAMSに替えれば瞬時値として確定できる」という含意は撤回する。CAMSは東京の取得・CORS疎通のみ確認済みで、今回の代替取得先にはしない。利用する場合は元のuvbedと補間処理の関係について別途照合する。

出典: [Air Quality公式資料](https://open-meteo.com/en/docs/air-quality-api)、[CAMSメタデータ](https://raw.githubusercontent.com/open-meteo/open-meteo/cc3f4e5e956b39a56ab182faeccfd3d936ae6b4c/Sources/App/Cams/CamsDomain.swift)。

## 6. 比較・欠損・保存

- key: 地点ID、座標改訂番号、sourcePolicyId、metric、API対象epoch。
- 前回実際に表示した12時間との重なりだけ比較。取得済みだが未表示の未来は基準にしない。
- 進行中・過去の時間区間は強調対象から除外。
- null、NaN、Infinity、負のUV、0〜100外の確率は欠損/不正として扱い、正常値へ丸めない。
- 欠損→数値は「データ取得」であり「天候変化」ではない。
- 日付、単位、配列長、時刻の重複・間隔を入力境界で検証する。
- ソース方針を変えると比較元をリセットする。
- 値の丸めは表示時のみ。比較は元値で行う。
- UV閾値は第1案の差2以上、または区分3/6/8/11をまたいで差1以上。平均UVに対するアプリ上の強調ルールであり、区間内の最大値を保証しない。
- 降水確率の強調閾値は第1案の20ポイント以上かつ一方が40%以上、または40/60%をまたぎ10ポイント以上。
- UIで「UV 2→4」と示す際にも、対象が1時間平均であることを詳細に残す。
- 取得時刻・表示時刻・予報対象時刻を別保存。モデル初期化時刻は分からなければnull。
- 自動更新は前面で30分間隔。6時間周期は取得間隔ではない。

元モデルの更新直後は配信サーバー間で差がある。取得時刻が新しくてもモデルが新しいとは限らず、予報内容だけでモデル版の前後関係を判定しない。[モデル更新資料](https://open-meteo.com/en/docs/model-updates)

## 7. 検証結果

| 対象 | 結果 |
|---|---|
| gfs_global: 東京・札幌・那覇・父島・松本・上高地 | 6地点すべてHTTP 200、各24時刻×2項目、欠損なし |
| Best Match: 上記のうち上高地を除く5地点 | 5地点すべてHTTP 200、各24時刻×2項目 |
| CAMS Global: 東京 | HTTP 200、UV24時刻 |
| 応答検証 | 単位、有限値、範囲、3600秒刻み、JST日付越えを確認 |
| ブラウザーCORS | Chromium 153、localhostからGFSとCAMSへ各1回。200/type=cors |
| ソース保全 | 20ファイル（LICENSEを含む）を固定コミットのアーカイブと照合、SHA-256を保存 |
| 比較ケース | 12ケースの期待結果を文書化。比較エンジンは未実装・未実行 |

5地点のBest Matchとの時刻一致比較では、UVは各24時刻とも一致した。降水確率は東京24、札幌15、那覇23、父島22、松本24時刻で異なった。取得は約2分ずれており、数値一致/不一致だけではモデル同一性を立証しない。採用判断はソースの選択経路に基づく。

## 8. 完了範囲と残る検証

今回確定したもの:

- 取得するAPI・モデル指定・フィールド・単位。
- 公開実装に基づく時間区間と補間の扱い。
- 欠損、不正値、ソース変更時の比較停止。
- UIで許される説明と、避けるべき精度表現。
- 保存済み応答・ソース・再実行可能な検証手順。

未確認:

- 稼働APIのソースSHA。提供元が返していないため固定コミットとの一致は保証できない。
- 異なるモデル更新サイクルをまたぐ継続検証。今回の複数取得を6時間周期の検証とは数えない。
- 実際の降雨・紫外線に対する予報精度、季節をまたぐ欠損率。
- 本番オリジンとiPhone SafariのCORS・ライフサイクル。今回のChromiumはその代替証拠ではない。
- 変更閾値と「平均UV」のユーザー理解。UIプロトタイプで検証する。

上記は取得仕様を選ぶための情報と、実機受入・気象精度評価を分けて管理する。モデル指定でもプロバイダー内部の更新・補完は完全には固定できない。将来の意味変更が確認されたら契約版を更新して差分基準を破棄する。

## 9. 調査資料と再検証

- `research/weather-contract-20260927/contract.json`: 機械可読の契約。
- `responses/`: HTTP本文、ヘッダー、NOAA索引。
- `source/` と `source-manifest.json`: 固定ソース・ライセンス・ハッシュ。
- `browser-results.json`: ブラウザー内fetchの記録。
- `comparison-cases.json`: 比較エンジン実装時の12ケース仕様。
- `validation-results.json`: 保存済み応答の検証結果。

オフラインの再検証:

```sh
python3 research/weather-contract-20260927/validate.py
```

ブラウザー疎通の再検証（既存Playwrightを指定。新規依存は未導入）:

```sh
node research/weather-contract-20260927/browser-probe.cjs /Users/likemike/Documents/gyro-maze/node_modules/playwright
```

検証スクリプトは調査専用。アプリのUI、取得アダプター、差分ロジック、Service Workerは作成していない。
