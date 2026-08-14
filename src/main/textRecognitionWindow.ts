import { BrowserWindow, ipcMain, nativeImage } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { IPC } from '../shared/types'
import { runOcrOnImage } from './ocr'
import * as clipboardStore from './clipboardStore'
import log from './logger'

/**
 * 録画枠の「テキスト認識」モードで撮影した範囲をOCRし、確認・編集できる別ウィンドウ。
 * スクリーンショット確認画面(screenshotEditorWindow.ts)と同じ構成で、
 * メインウィンドウと同じrenderer bundleを`?textRecognitionEditor=1`付きで読み込む。
 * ウィンドウを開いた直後はOCR結果がまだ無いため、認識中はnullをpushし、
 * OCR完了後にテキストをpushする(編集画面側は認識中の間ローディング表示にする)。
 */
let win: BrowserWindow | null = null

async function recognizeAndSend(dataUrl: string): Promise<void> {
  try {
    const image = nativeImage.createFromDataURL(dataUrl)
    const lines = await runOcrOnImage(image)
    const text = lines
      .map((l) => l.text)
      .join('\n')
      .trim()
    win?.webContents.send(IPC.textRecognitionEditorText, text)
  } catch (err) {
    log.warn('text recognition failed', err)
    win?.webContents.send(IPC.textRecognitionEditorText, '')
  }
}

export function open(dataUrl: string): void {
  if (win && !win.isDestroyed()) {
    win.webContents.send(IPC.textRecognitionEditorText, null)
    win.show()
    win.focus()
    win.moveTop()
    void recognizeAndSend(dataUrl)
    return
  }

  win = new BrowserWindow({
    show: false,
    width: 480,
    height: 620,
    title: 'テキスト認識結果を確認',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })
  // 録画枠(常に最前面'screen-saver'レベル)より手前に出したいため、同じレベルで最前面固定にする
  win.setAlwaysOnTop(true, 'screen-saver')
  win.once('ready-to-show', () => {
    win?.show()
    win?.moveTop()
  })
  win.webContents.once('did-finish-load', () => {
    void recognizeAndSend(dataUrl)
  })
  win.on('closed', () => {
    win = null
  })

  const search = '?textRecognitionEditor=1'
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'] + '/' + search)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'), { search })
  }
}

export function initTextRecognitionWindow(getMainWindow: () => BrowserWindow | null): void {
  ipcMain.handle(IPC.openTextRecognitionEditor, async (_e, dataUrl: string) => {
    open(dataUrl)
  })

  ipcMain.handle(IPC.saveTextRecognitionEntry, async (_e, text: string) => {
    const trimmed = text.trim()
    if (!trimmed) return
    const entry = await clipboardStore.appendHistory(trimmed)
    getMainWindow()?.webContents.send(IPC.clipboardDataChanged, entry)
  })
}
