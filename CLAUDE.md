# CLAUDE.md

Claude Code がこのリポジトリで作業する際の運用ルール。

## 作業完了の定義

**アプリのコードを改修したら、プッシュ・マージ・ビルド・リリースまで完了させて初めて「作業完了」とする。**
コードを書いてPRを出しただけ、マージしただけでは完了ではない。以下を最後まで実行すること。

1. 作業ブランチで実装し、`npm run typecheck` を通す
2. コミットして push
3. PR を作成し、main へマージする
4. `package.json` の version を上げる(パッチが基本。このリポジトリはコミットごとに
   バージョンを上げる運用)。version を上げるPRもマージする
5. リリースワークフローを起動する(下記)
6. ワークフローの成否を確認し、失敗していれば原因を修正して再実行する。
   リリースが公開され、アセット(`.exe` / `latest.yml` / `.blockmap`)が揃ったことを
   確認してから完了を報告する

ドキュメントやCI設定だけの変更など、アプリの動作に影響しない変更ではバージョンを上げず、
リリースも行わない(マージまでで完了)。

## リリースの実行方法

リリースは GitHub Actions (`.github/workflows/release.yml`) が行う。
Claude Code on the web のセッションからは GitHub API でのリリース作成とタグ push が
ポリシーで拒否される(403 `Creating, editing, or deleting releases is not permitted for
this session type.`)ため、**自分でリリースを作ろうとせず、必ずワークフローを起動する**。

- 起動: GitHub MCP の `actions_run_trigger` (`method: run_workflow`, `workflow_id: release.yml`,
  `ref: main`, `inputs: {release_type: release}`)。このセッション種別でも起動は許可されている
- 確認: `actions_list` (`list_workflow_runs` / `list_workflow_jobs`) と `get_job_logs`
- 成果物: Windows インストーラ・`latest.yml`・`.blockmap` が Release に添付される。
  `latest.yml` が自動アップデートの配信元になるため、これが揃っていることまで確認する

ローカル(手元のWindows)から出す場合の手順は README.md の「リリース手順」を参照。

## リリース周りの既知の落とし穴

過去に踏んで修正済み。同じ形に戻さないこと。

- **`-c.publish.xxx=` 形式のCLI上書きを Windows ランナーで使わない**。`-c` と
  `.publish.xxx=...` に分割され、後者が設定ファイルのパスとして解釈されて即失敗する
  (`ENOENT: .publish.releaseType=release`)。設定は `electron-builder.yml` 側に書く
- **ワークフローでは electron-builder に公開させない**(`--publish never` でビルドし、
  `gh release create` / `gh release upload --clobber` でアップロードする)。
  electron-builder のGitHubパブリッシャーは、リリースが未作成の状態で複数のアップロードが
  並行すると、それぞれが「リリースが存在しない」と判断して同時にリリースを作成しにいく。
  競合に負けた側のアップロードは失われ、しかもジョブは成功扱いになる
  (v1.27.40で `.blockmap` が欠けたまま公開された)。
  なお electron-builder に公開させる場合(ローカルからの `--publish always`)は、
  リリース作成時に `target_commitish` を送らないため、タグが無い状態で `draft: false` の
  リリースを作ろうとすると GitHub が 422 (`Published releases must have a valid tag`) を返す
- **アセットが揃ったことを必ず検証する**。ワークフローはアップロード後に
  `.exe` / `.blockmap` / `latest.yml` の3点が公開されているか確認し、欠けていれば失敗させる。
  `.blockmap` が無くても自動アップデート自体は動く(差分ダウンロードができず全体を
  ダウンロードする)ため、検証しないと欠落に気づけない
- **`EP_DRAFT` に空文字を渡さない**。electron-builder の `isEnvTrue` は `"true"` / `"1"` に
  加えて**空文字も true** として扱うため、意図せずドラフトになる。必ず true/false が
  入る式で渡す
- `npm ci` は使わない。`package-lock.json` の version が package.json と同期されていない
  運用のため、`npm install` を使う

## 開発時のメモ

- 型チェック: `npm run typecheck` (main と renderer の両方)
- ビルド: `npx electron-vite build`。Linux 環境でも `wine` を入れれば
  `npx electron-builder --win` で Windows インストーラのビルド自体は通る
- アイコンなど小さな図形は、塗りつぶしSVGではなく素のCSSボックスで描く
  (`src/renderer/src/components/icons.tsx` の冒頭コメント参照。この実行環境では
  SVGの塗りつぶしが指定したpx通りに描画されない問題がある)
