# 自動テストツール (auto-test-tool)

PC画面上で選択したWEB画面・デスクトップアプリの操作を記録し、あとから一覧から選んで自動再生できるテスト自動化ツールです。

## 主な機能

- テスト対象の選択
  - WEB画面: URLを指定し、Playwright制御のブラウザで操作を記録
  - デスクトップアプリ: 実行ファイル(.exe)を指定し、グローバルマウス/キーボードフックで操作を記録
- 手動操作の記録（クリック・ダブルクリック・入力・ページ遷移・キー入力）
- 記録したテストの保存（ローカルJSON、`app.getPath('userData')/tests/`配下）
- 保存済みテスト一覧からの選択・自動再生・名前変更・削除

## 技術構成

- Electron + React + TypeScript ([electron-vite](https://electron-vite.org/) ベース)
- Web用エンジン: [Playwright](https://playwright.dev/) (Chromium)
- デスクトップ用エンジン: [uiohook-napi](https://github.com/SnosMe/uiohook-napi)（グローバルフック） + [@nut-tree-fork/nut-js](https://github.com/nut-tree/nut.js)（操作シミュレーション） + [active-win](https://github.com/sindresorhus/active-win)（対象ウィンドウの検出・座標取得）

アーキテクチャの詳細は [`src/shared/types.ts`](src/shared/types.ts) の `RecorderEngine`/`PlayerEngine` インターフェースを参照してください。Web用・デスクトップ用エンジンはどちらもこの共通契約を実装しています。

## 開発

```bash
npm install
npx playwright install chromium   # 初回のみ。Web記録/再生用のブラウザバイナリを取得
npm run dev                        # 開発モードで起動
npm run typecheck                  # 型チェック
npm run build                      # 本番ビルド (out/ に出力)
npm run build:win                  # Windows向けインストーラをビルド (electron-builder)
```

## 既知の制約

- デスクトップアプリの記録・再生は**画面座標ベース**です。記録時と再生時でウィンドウの位置・サイズ・表示スケール(DPI)が異なると、クリック位置がずれて再生に失敗する場合があります。
- Web記録はCSSセレクタベースで、`id` / `data-testid` / `name` / `aria-label` を優先し、無ければ祖先からの `nth-child` パスにフォールバックします。動的にIDが変わるようなページでは再生が不安定になる場合があります。
- 現時点では単一ウィンドウ・単一対象の記録/再生のみ対応です。
