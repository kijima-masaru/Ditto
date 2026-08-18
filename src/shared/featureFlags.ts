/**
 * リリースに含めるが、まだ一般公開しない機能を一時的に隠すためのフラグ。
 * Ditto Remote(スマホ連携)はPC側の実装(このリポジトリ)は完成しているが、
 * ditto-remoteリポジトリ側のアプリがまだストア配布されていないため、
 * このフラグをtrueに戻すまで設定画面のUI・ローカルサーバーの起動を無効化する
 */
export const DITTO_REMOTE_ENABLED = false
