# GitHub / Cloudflare Pagesへの移行確認

2026-09-27。公開先: https://sun-and-rain.pages.dev/
リポジトリ: https://github.com/kimymt/sun-and-rain

- PagesはGitHubネイティブ連携。mainへのpushで自動ビルド。
- コミット5e00c3ef02669d1700b4d986ad4d69d0ab9747f8のgithub:pushからデプロイ72f866d1-182c-404b-8f96-09315a37b2a6が成功。
- Chromium 390×844で公開ファイルのハッシュ、ヘッダー、非公開パス404、フッターGitHubリンク、実Open-Meteo接続、端末保存、オフライン再読込を確認。GPS座標のみ東京の模擬値。production-results.jsonと画像を参照。
- ユーザーの削除指示に基づき旧Worker sun-and-rainを削除。WranglerはSuccessfully deletedを返した。
- 削除後HTTP確認: 旧sun-and-rain.kei1127miyamoto.workers.devは404、新PagesとGitHubは200。
- 旧オリジンの端末保存データは新オリジンに自動移行しない。旧PWAの端末内キャッシュ自体はサーバー削除では消えない。

## 変更範囲レビュー

開始コミット5e00c3e、開始時作業ツリーはclean。依頼に対応して旧Workerの削除、wrangler.workers.jsoncの削除、READMEの配信案内更新のみ。追加ファイルは移行検証のJSONと画像。本体app/、Pages設定、依存、テスト条件に変更なし。範囲外の変更なし。

## 検証記録

verify-changesの最初のtokenで公開ブラウザ試験を実行し終了コード0。その後の変更はREADMEと旧Worker設定の削除のみでapp/とPages設定は不変のため、このブラウザ結果を再利用する。削除後のURL確認はcurlで実行し404/200/200を観測。iPhone実機・ホーム画面追加は今回の検証対象外。検証範囲内で成功。
