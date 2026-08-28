# Ditto (auto-test-tool)

PC画面上で選択したWEBアプリ・Windowsデスクトップアプリの操作を記録し、あとから一覧から選んで自動再生できるテスト自動化ツールです。1つのテストに複数の対象（WEB+デスクトップアプリの組み合わせも可）を登録し、録画中にタブで切り替えながら操作を記録できます。

## 主な機能

- テスト対象の追加: WEBアプリ(URL)またはデスクトップアプリ(実行ファイル)を複数登録
- 対象の表示: タブを選択するとその対象(ブラウザまたはアプリのウィンドウ)がOS上で最前面に表示され、他のタブに切り替えると自動的に最小化される
- 手動操作の記録（クリック・ダブルクリック・キー入力）を対象ごとに記録
- 記録中の一時停止/再開（ログインなど記録に残したくない操作を挟める）
- 記録したテストの保存（ローカルJSON、`app.getPath('userData')/tests/`配下）
- 保存済みテスト一覧からの選択・名前変更・移動・削除。階層フォルダで整理可能
- 自動再生。各操作の間隔は記録時に実際に空いていた時間をそのまま再現する
- 再生画面に画面録画用の枠を表示可能(表示/非表示切替・サイズ調整)。再生開始と同時に枠内の録画が始まり、停止・一時停止は再生とは別に操作できる(`ビデオ/auto-test-tool/`配下にwebmで保存)
- クリップボード管理(履歴の自動記録＋定型文)。左クリックでコピー、右クリックで定型文への登録などができる
- メモ(自分で書いて育てるテキスト)。階層フォルダで整理でき、本文まで含めた検索ができる。編集は広い別ウィンドウで行い、入力が止まると自動保存される(`app.getPath('userData')/notes/`配下に、本文を`<id>.txt`のプレーンテキストで保存)
- メモの編集画面は、選んだ文字(選択が無ければ以降に入力する文字)だけに太字・文字色・文字サイズ・文字の背景色を掛けられる。装飾は本文とは別に`<id>.html`へ保存するため、本文はテキストのまま救出できる。行番号・現在行の強調・折り返しの切替、検索と置換(正規表現・選択範囲内)、選択範囲の整形/変換、編集履歴(版)からの復元にも対応
- Ctrlキー2回押しでウィンドウを表示するグローバルホットキー。ウィンドウを閉じてもトレイに常駐し続ける
- 自動アップデート（常時表示のUIは無く、起動時にバックグラウンドで自動確認・ダウンロードし、新バージョンの準備ができた時だけ再起動確認ダイアログを表示。動作ログは`app.getPath('userData')/logs/main.log`)

## WEBアプリの扱いについて

WEB対象はこのアプリの中に埋め込んで表示するのではなく、`shell.openExternal`でユーザーの**既定ブラウザ**を開いて操作します。ログインページ等でパスワードを入力する場面を考慮し、このアプリがページの内容やフォームの値を読み取れる状態を避けるためです。記録・再生はデスクトップアプリと同じ「対象ウィンドウ内の座標クリック/キー入力」方式で行われ、このアプリはページの中身に一切アクセスしません。ログインはいつも通りご自身のブラウザ(保存済みパスワードやセッション)で行えます。

## 技術構成

- Electron + React + TypeScript ([electron-vite](https://electron-vite.org/) ベース)
- 記録・再生エンジン(WEB/デスクトップ共通): [uiohook-napi](https://github.com/SnosMe/uiohook-napi)（グローバルフック） + [@nut-tree-fork/nut-js](https://github.com/nut-tree/nut.js)（操作シミュレーション） + [active-win](https://github.com/sindresorhus/active-win)（対象ウィンドウの検出・座標取得） + [koffi](https://koffi.dev/)（Win32 API呼び出し、最前面表示/最小化用）
- 自動アップデート: [electron-updater](https://www.electron.build/auto-update)（GitHub Releasesを配信元に使用。リポジトリが公開である必要がある）

## リリース手順

通常は GitHub Actions の Release ワークフロー（`.github/workflows/release.yml`）を
手動実行する。Windowsランナー上でビルドし、GitHub Releaseの作成とアップロードまで自動で行う
（`release_type` に `draft` を選ぶと下書きとして作成する）。

手元のWindowsから直接出す場合は以下。

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

## 実装上の注意

- このElectron環境では`window.prompt()`はダイアログが表示されず常に無反応、`window.confirm()`も信頼できないため、renderer側では使用しない。名前変更・削除確認等はすべてインライン編集UI(入力欄+保存/キャンセル、削除確認行など)で実装している。
- 表示名は"Ditto"だが、内部的なアプリ名(`app.setName()`、userDataの保存先フォルダ名)は"auto-test-tool"に固定している。旧バージョンからのアップデートでテストデータ・設定を引き継ぐため。
