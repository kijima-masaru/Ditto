# このスキルの出どころ

外部リポジトリから取り込んだスキル。Ditto が書いたものではない。

- 取得元: https://github.com/nextlevelbuilder/ui-ux-pro-max-skill
- 取得したコミット: `d279284fb12d40f27e72393d51e0bbb785cf80a1` (plugin version 2.13.0)
- 取り込んだ場所: 上記リポジトリの `.claude/skills/ui-ux-pro-max/`
- ライセンス: MIT (`LICENSE.txt`)

## 取り込む際に変えたところ

元は Claude Code の「プラグイン」として配布されており、スクリプトのパスを
`${CLAUDE_PLUGIN_ROOT}` という環境変数で組み立てていた。このリポジトリでは
プラグインではなくリポジトリ内のスキルとして置いているためその変数は設定されない。
そこで `SKILL.md` のコマンド例を、リポジトリのルートからの相対パスへ書き換えている。

```
${CLAUDE_PLUGIN_ROOT}/.claude/skills/ui-ux-pro-max/scripts/search.py
  → .claude/skills/ui-ux-pro-max/scripts/search.py
```

あわせて、スキル自身のデータを検証するテスト (`scripts/tests/`, 約300KB) は
このリポジトリでは動かさないため取り込んでいない。データ・参照ドキュメント・
検索スクリプトの本体はそのまま。

## 更新する場合

上記リポジトリを取得し直して `.claude/skills/ui-ux-pro-max/` を丸ごと入れ替えたうえで、
上の2点(パスの書き換え・テストの除外)を同じように当て直す。このファイルの
コミットハッシュも更新する。

## 動作条件

Python 3.x のみ。外部パッケージは不要。**リポジトリのルートをカレントディレクトリにして**
実行する。

```bash
python3 .claude/skills/ui-ux-pro-max/scripts/search.py "keyboard focus modal" --domain ux
```

Windows で `python3` が無い場合は `python` または `py -3` を使う。
