# 自動テストツール (auto-test-tool)

PC画面上で選択したWindowsデスクトップアプリの操作を記録し、あとから一覧から選んで自動再生できるテスト自動化ツールです。

## 主な機能

- テスト対象の選択: 実行ファイル(.exe)を指定して起動
- 手動操作の記録（クリック・ダブルクリック・キー入力）をグローバルマウス/キーボードフックで記録
- 記録したテストの保存（ローカルJSON、`app.getPath('userData')/tests/`配下）
- 保存済みテスト一覧からの選択・自動再生・名前変更・削除

## 技術構成

- Electron + React + TypeScript ([electron-vite](https://electron-vite.org/) ベース)
- 記録・再生エンジン: [uiohook-napi](https://github.com/SnosMe/uiohook-napi)（グローバルフック） + [@nut-tree-fork/nut-js](https://github.com/nut-tree/nut.js)（操作シミュレーション） + [active-win](https://github.com/sindresorhus/active-win)（対象ウィンドウの検出・座標取得）

アーキテクチャの詳細は [`src/shared/types.ts`](src/shared/types.ts) の `RecorderEngine`/`PlayerEngine` インターフェースを参照してください。

## 開発

```bash
npm install
npm run dev                        # 開発モードで起動
npm run typecheck                  # 型チェック
npm run build                      # 本番ビルド (out/ に出力)
npm run build:win                  # Windows向けインストーラをビルド (electron-builder)
```

## 既知の制約

- 記録・再生は**画面座標ベース**です。記録時と再生時でウィンドウの位置・サイズ・表示スケール(DPI)が異なると、クリック位置がずれて再生に失敗する場合があります。
- 現時点では単一ウィンドウ・単一対象の記録/再生のみ対応です。
