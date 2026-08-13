import log from 'electron-log/main'
import path from 'path'

/**
 * アプリ全体で共有するロガー。設定画面の「デバッグログ」から確認できるほか、
 * 自動アップデートのログにも使う。起動直後に一度だけ初期化し、mainプロセスの
 * 未捕捉例外もここに記録することで、Dittoが落ちた際に原因を追えるようにする
 * (既定の保存先: %APPDATA%/auto-test-tool/logs/main-YYYY-MM-DD.log)。
 *
 * 日付ごとにファイルを分けているのは、古いログを日単位で安全に削除できるようにするため
 * (debugLog.tsのpruneOldLogsが起動時に3日より古いファイルを削除する)。
 */
export const LOG_FILE_PREFIX = 'main-'
export const LOG_FILE_PATTERN = /^main-(\d{4})-(\d{2})-(\d{2})(?:\.old)?\.log$/

function todayLogFileName(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${LOG_FILE_PREFIX}${y}-${m}-${day}.log`
}

log.initialize()
log.transports.file.level = 'info'
log.transports.file.resolvePathFn = (vars) => path.join(vars.libraryDefaultDir, todayLogFileName())
log.errorHandler.startCatching({ showDialog: false })

export default log
