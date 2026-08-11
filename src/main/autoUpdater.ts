import { autoUpdater } from 'electron-updater'
import type { BrowserWindow } from 'electron'
import { IPC, type UpdateStatus } from '../shared/types'

/**
 * GitHub Releases(electron-builder.ymlのpublish設定)を配信元とした自動アップデート。
 * 新しいバージョンが見つかったら自動でダウンロードし、ダウンロード完了後に
 * ユーザーが任意のタイミングで再起動してインストールできるようにする
 * (autoInstallOnAppQuitによりアプリを閉じたタイミングでも自動的に適用される)。
 */
export function setupAutoUpdater(getWindow: () => BrowserWindow | null): void {
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  const send = (status: UpdateStatus): void => {
    getWindow()?.webContents.send(IPC.updateStatus, status)
  }

  autoUpdater.on('checking-for-update', () => send({ state: 'checking' }))
  autoUpdater.on('update-available', (info) => send({ state: 'available', version: info.version }))
  autoUpdater.on('update-not-available', () => send({ state: 'not-available' }))
  autoUpdater.on('download-progress', (progress) => {
    send({ state: 'downloading', percent: Math.round(progress.percent) })
  })
  autoUpdater.on('update-downloaded', (info) => send({ state: 'downloaded', version: info.version }))
  autoUpdater.on('error', (err) => {
    send({ state: 'error', message: err.message })
  })
}

export function checkForUpdates(): void {
  autoUpdater.checkForUpdates().catch(() => {
    // 開発時(未パッケージ)やネットワーク不通時は静かに無視する。エラーはerrorイベント側でも通知される
  })
}

export function installUpdateNow(): void {
  autoUpdater.quitAndInstall()
}
