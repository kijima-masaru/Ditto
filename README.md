# 自動テストツール (auto-test-tool)

PC画面上で選択したWEBアプリ・Windowsデスクトップアプリの操作を記録し、あとから一覧から選んで自動再生できるテスト自動化ツールです。1つのテストに複数の対象（WEB+デスクトップアプリの組み合わせも可）を登録し、録画中にタブで切り替えながら操作を記録できます。

## 主な機能

- テスト対象の追加: WEBアプリ(URL)またはデスクトップアプリ(実行ファイル)を複数登録
- 対象の表示
  - WEBアプリ: このアプリの表示エリア内に埋め込んで表示（`WebContentsView`）
  - デスクトップアプリ: タブを選択すると最前面に表示、他タブに切り替えると自動的に最小化
- 手動操作の記録（クリック・ダブルクリック・入力・ページ遷移・キー入力）を対象ごとに記録
- 記録したテストの保存（ローカルJSON、`app.getPath('userData')/tests/`配下）
- 保存済みテスト一覧からの選択・名前変更・削除
- 再生速度の指定（0.25x〜4x）を選んでから自動再生

## 技術構成

- Electron + React + TypeScript ([electron-vite](https://electron-vite.org/) ベース)
- WEB対象エンジン: Electronの`WebContentsView`に記録用スクリプトを注入し、セレクタベースで記録/再生
- デスクトップ対象エンジン: [uiohook-napi](https://github.com/SnosMe/uiohook-napi)（グローバルフック） + [@nut-tree-fork/nut-js](https://github.com/nut-tree/nut.js)（操作シミュレーション） + [active-win](https://github.com/sindresorhus/active-win)（対象ウィンドウの検出・座標取得） + [koffi](https://koffi.dev/)（Win32 API呼び出し、最前面表示/最小化用）

アーキテクチャの詳細は [`src/shared/types.ts`](src/shared/types.ts) の `TargetAdapter` インターフェース、[`src/main/targetManager.ts`](src/main/targetManager.ts)（複数対象のアクティブ切り替え・記録/再生の統括）を参照してください。

## 開発

```bash
npm install
npm run dev                        # 開発モードで起動
npm run typecheck                  # 型チェック
npm run build                      # 本番ビルド (out/ に出力)
npm run build:win                  # Windows向けインストーラをビルド (electron-builder)
```

## 既知の制約

- デスクトップアプリはこのアプリの表示エリア内に正確に重ねて表示することができません（Windows上でSetParentによる埋め込みやMoveWindowでの座標合わせを検証したが、DPI仮想化やDWM/GPUコンポジタとの相性で信頼できる描画が得られなかったため）。タブ切り替え時に最前面表示・非アクティブ時は最小化する方式を採用しています。
- 記録・再生は**画面座標ベース**です。記録時と再生時でウィンドウの位置・サイズ・表示スケール(DPI)が異なると、クリック位置がずれて再生に失敗する場合があります。
- WEB記録はCSSセレクタベースで、`id` / `data-testid` / `name` / `aria-label` を優先し、無ければ祖先からの `nth-child` パスにフォールバックします。動的にIDが変わるページでは再生が不安定になる場合があります。
