import { autoUpdater } from 'electron-updater'
import log from 'electron-log/main'
import { dialog, type BrowserWindow } from 'electron'

/**
 * GitHub Releases(electron-builder.ymlのpublish設定)を配信元とした自動アップデート。
 * 常時表示のUIは持たず、アプリ起動時にバックグラウンドで確認・ダウンロードし、
 * 新しいバージョンの準備ができた時だけネイティブの確認ダイアログを表示する。
 *
 * チェック自体が失敗しても画面には何も表示されないため、原因調査ができるよう
 * ログファイルに記録しておく(既定の保存先: %APPDATA%/auto-test-tool/logs/main.log)。
 */
export function setupAutoUpdater(getWindow: () => BrowserWindow | null): void {
  log.initialize()
  log.transports.file.level = 'info'
  autoUpdater.logger = log

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('update-downloaded', (info) => {
    const win = getWindow()
    const options = {
      type: 'info' as const,
      title: 'アップデートの確認',
      message: `新しいバージョン v${info.version} の準備ができました。今すぐ再起動してインストールしますか?`,
      buttons: ['今すぐ再起動', '後で'],
      defaultId: 0,
      cancelId: 1
    }
    const promise = win ? dialog.showMessageBox(win, options) : dialog.showMessageBox(options)
    promise.then((result) => {
      if (result.response === 0) {
        autoUpdater.quitAndInstall()
      }
    })
  })

  autoUpdater.on('error', (err) => {
    // 開発時やネットワーク不通時にも発火しうるため、ユーザーには通知せずログのみ残す
    log.error('[autoUpdater] error:', err)
  })
}

export function checkForUpdates(): void {
  autoUpdater.checkForUpdates().catch(() => {
    // 開発時(未パッケージ)やネットワーク不通時は静かに無視する
  })
}
