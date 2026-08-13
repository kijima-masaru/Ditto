import log from 'electron-log/main'

/**
 * アプリ全体で共有するロガー。設定画面の「デバッグログ」から確認できるほか、
 * 自動アップデートのログにも使う。起動直後に一度だけ初期化し、mainプロセスの
 * 未捕捉例外もここに記録することで、Dittoが落ちた際に原因を追えるようにする
 * (既定の保存先: %APPDATA%/auto-test-tool/logs/main.log)。
 */
log.initialize()
log.transports.file.level = 'info'
log.errorHandler.startCatching({ showDialog: false })

export default log
