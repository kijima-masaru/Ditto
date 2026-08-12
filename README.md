# 自動テストツール (auto-test-tool)

PC画面上で選択したWEBアプリ・Windowsデスクトップアプリの操作を記録し、あとから一覧から選んで自動再生できるテスト自動化ツールです。1つのテストに複数の対象（WEB+デスクトップアプリの組み合わせも可）を登録し、録画中にタブで切り替えながら操作を記録できます。

## 主な機能

- テスト対象の追加: WEBアプリ(URL)またはデスクトップアプリ(実行ファイル)を複数登録
- 対象の表示: タブを選択するとその対象(ブラウザまたはアプリのウィンドウ)がOS上で最前面に表示され、他のタブに切り替えると自動的に最小化される
- 手動操作の記録（クリック・ダブルクリック・キー入力）を対象ごとに記録
- 記録中の一時停止/再開（ログインなど記録に残したくない操作を挟める）
- 記録したテストの保存（ローカルJSON、`app.getPath('userData')/tests/`配下）
- 保存済みテスト一覧からの選択・名前変更・削除
- 自動再生。各操作の間隔は記録時に実際に空いていた時間をそのまま再現する
- 自動アップデート（常時表示のUIは無く、起動時にバックグラウンドで自動確認・ダウンロードし、新バージョンの準備ができた時だけ再起動確認ダイアログを表示）

## WEBアプリの扱いについて

WEB対象はこのアプリの中に埋め込んで表示するのではなく、`shell.openExternal`でユーザーの**既定ブラウザ**を開いて操作します。ログインページ等でパスワードを入力する場面を考慮し、このアプリがページの内容やフォームの値を読み取れる状態を避けるためです。記録・再生はデスクトップアプリと同じ「対象ウィンドウ内の座標クリック/キー入力」方式で行われ、このアプリはページの中身に一切アクセスしません。ログインはいつも通りご自身のブラウザ(保存済みパスワードやセッション)で行えます。

## 技術構成

- Electron + React + TypeScript ([electron-vite](https://electron-vite.org/) ベース)
- 記録・再生エンジン(WEB/デスクトップ共通): [uiohook-napi](https://github.com/SnosMe/uiohook-napi)（グローバルフック） + [@nut-tree-fork/nut-js](https://github.com/nut-tree/nut.js)（操作シミュレーション） + [active-win](https://github.com/sindresorhus/active-win)（対象ウィンドウの検出・座標取得） + [koffi](https://koffi.dev/)（Win32 API呼び出し、最前面表示/最小化用）
- 自動アップデート: [electron-updater](https://www.electron.build/auto-update)（GitHub Releasesを配信元に使用。リポジトリが公開である必要がある）

## リリース手順

```bash
npm version patch|minor|major   # package.jsonのバージョンを更新
GH_TOKEN=<repo権限のあるトークン> npm run build:win -- --publish always
```

`--publish always` により、Windows向けインストーラのビルドとGitHub Releaseへのアップロード（`latest.yml`込み）が一度に行われる。既存ユーザーのアプリは次回起動時に自動で新バージョンを検知・ダウンロードし、準備ができると再起動確認ダイアログが表示される。

アーキテクチャの詳細は [`src/shared/types.ts`](src/shared/types.ts) の `TargetAdapter` インターフェース、[`src/main/adapters/windowTargetBase.ts`](src/main/adapters/windowTargetBase.ts)（WEB/デスクトップ共通の記録・再生ロジック）、[`src/main/targetManager.ts`](src/main/targetManager.ts)（複数対象のアクティブ切り替え・記録/再生の統括）を参照してください。

## 開発

```bash
npm install
npm run dev                        # 開発モードで起動
npm run typecheck                  # 型チェック
npm run build                      # 本番ビルド (out/ に出力)
npm run build:win                  # Windows向けインストーラをビルド (electron-builder)
```

## 既知の制約

- 対象(WEBアプリ・デスクトップアプリいずれも)はこのアプリの表示エリア内に正確に重ねて表示することができません（Windows上でSetParentによる埋め込みやMoveWindowでの座標合わせを検証したが、DPI仮想化やDWM/GPUコンポジタとの相性で信頼できる描画が得られなかったため）。タブ切り替え時に最前面表示・非アクティブ時は最小化する方式を採用しています。
- 記録・再生は**画面座標ベース**です。記録時と再生時でウィンドウの位置・サイズ・表示スケール(DPI)が異なると、クリック位置がずれて再生に失敗する場合があります。
- 記録は「タブがアクティブかつ一時停止していない間のクリック/キー入力」をそのまま記録します。パスワード等を含む操作を記録したくない場合は、必ず一時停止してから入力してください。
