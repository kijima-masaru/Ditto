import { BrowserWindow, ipcMain, screen } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { uIOhook, UiohookKey, type UiohookKeyboardEvent } from 'uiohook-napi'
import activeWin from 'active-win'
import { ensureGlobalHookStarted, keepGlobalHookAlive } from './adapters/windowTargetBase'
import * as win32 from './win32'
import * as settingsStore from './settingsStore'
import { IPC, type HotkeyCombo } from '../shared/types'

/**
 * コマンドパレット。ホットキー(既定はCtrl+Shift+Space、設定画面のウィンドウ表示ホットキーと
 * 同じ形式で自由に変更できる)でどのアプリからでも呼び出せる、クリップボード履歴・定型文・
 * マクロを横断検索する小さなオーバーレイウィンドウ。
 * 検索対象データ自体は既存のlistClipboardHistory等をパレット側のrendererから直接
 * 呼び出して取得し、絞り込みもrenderer側で行う(このモジュールはウィンドウの表示制御と、
 * 選択項目の実行(元のウィンドウへの入力・マクロ再生画面を開く)のみを担当する)。
 */

const WIDTH = 480
const HEIGHT = 420

let win: BrowserWindow | null = null
let enabled = false
// パレットを開く直前にフォーカスされていたウィンドウ。定型文/履歴のテキストを
// 入力する際、パレット自身ではなくこの元のウィンドウへ戻してから入力する
let lastFocusedWindowId: number | null = null

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function positionAtCursor(w: BrowserWindow): void {
  const cursor = screen.getCursorScreenPoint()
  const { workArea } = screen.getDisplayNearestPoint(cursor)
  const [width, height] = w.getSize()
  const x = Math.min(Math.max(cursor.x - Math.round(width / 2), workArea.x), workArea.x + workArea.width - width)
  const y = Math.min(Math.max(cursor.y - Math.round(height / 2), workArea.y), workArea.y + workArea.height - height)
  w.setPosition(x, y)
}

function ensureWindow(): BrowserWindow {
  if (win && !win.isDestroyed()) return win

  win = new BrowserWindow({
    width: WIDTH,
    height: HEIGHT,
    frame: false,
    resizable: false,
    movable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })
  win.setAlwaysOnTop(true, 'screen-saver')
  win.on('blur', () => hide())
  win.on('closed', () => {
    win = null
  })

  const search = '?commandPalette=1'
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'] + '/' + search)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'), { search })
  }
  return win
}

function show(): void {
  lastFocusedWindowId = activeWin.sync()?.id ?? null
  const w = ensureWindow()
  positionAtCursor(w)
  const send = (): void => w.webContents.send(IPC.commandPaletteShown)
  if (w.webContents.isLoading()) {
    w.webContents.once('did-finish-load', send)
  } else {
    send()
  }
  w.show()
  w.focus()
}

function hide(): void {
  if (win && !win.isDestroyed() && win.isVisible()) win.hide()
}

function toggle(): void {
  if (win && !win.isDestroyed() && win.isVisible()) hide()
  else show()
}

// 1回のSendInputで送るUnicode文字数。長文を1回にまとめて送出すると、対象アプリの
// メッセージループが処理しきれず一部の文字が欠落・入れ替わることがあるため、
// 適度な塊に分けて少し間隔を空けながら送る(textExpansion.tsのexpand()と同じ対策)
const TYPE_CHUNK_SIZE = 15

/** パレットで選択した履歴/定型文のテキストを、パレットを開く前にフォーカスされていた
 *  ウィンドウへ直接入力する。文字化けを避けるためSendInput+KEYEVENTF_UNICODEで
 *  直接注入する(textExpansion.tsと同じ方式)。自プロセスのグローバルフックが自ら
 *  注入したイベントを拾ってしまう競合を避けるため、注入中はフックを一時停止する */
async function insertText(text: string): Promise<void> {
  hide()
  if (lastFocusedWindowId !== null) {
    try {
      win32.activateWindow(win32.idToHandle(lastFocusedWindowId))
    } catch {
      // 元のウィンドウが既に閉じられている等は無視し、フォーカスされている場所にそのまま入力する
    }
  }
  await wait(150)
  uIOhook.stop()
  try {
    for (let i = 0; i < text.length; i += TYPE_CHUNK_SIZE) {
      win32.typeUnicodeText(text.slice(i, i + TYPE_CHUNK_SIZE))
      await wait(20)
    }
    await wait(100)
  } finally {
    uIOhook.start()
  }
}

// --- ホットキー検知(設定画面のウィンドウ表示ホットキーと同じHotkeyCombo形式で1つだけ保持する) ---

const DOUBLE_PRESS_WINDOW_MS = 400

const MODIFIER_ONLY_KEYCODES: Record<'ctrl' | 'shift' | 'alt' | 'meta', number[]> = {
  ctrl: [UiohookKey.Ctrl, UiohookKey.CtrlRight],
  shift: [UiohookKey.Shift, UiohookKey.ShiftRight],
  alt: [UiohookKey.Alt, UiohookKey.AltRight],
  meta: [UiohookKey.Meta, UiohookKey.MetaRight]
}

function watchedKeycodesForModifierOnly(combo: HotkeyCombo): number[] {
  if (combo.ctrl) return MODIFIER_ONLY_KEYCODES.ctrl
  if (combo.shift) return MODIFIER_ONLY_KEYCODES.shift
  if (combo.alt) return MODIFIER_ONLY_KEYCODES.alt
  if (combo.meta) return MODIFIER_ONLY_KEYCODES.meta
  return []
}

function matchesModifiers(e: UiohookKeyboardEvent, combo: HotkeyCombo): boolean {
  return e.ctrlKey === combo.ctrl && e.shiftKey === combo.shift && e.altKey === combo.alt && e.metaKey === combo.meta
}

let hotkey: HotkeyCombo = {
  ctrl: true,
  shift: true,
  alt: false,
  meta: false,
  keycode: UiohookKey.Space,
  label: 'Ctrl+Shift+Space'
}
let lastModifierPressAt = 0
// OSのキーリピート(長押し中に連続して届くkeydown)を素早い2回押しと誤検知しないための
// 押下中キー集合。ホットキー検知(hotkey.ts)と同じ考え方
const heldKeycodes = new Set<number>()

function handleKeydown(e: UiohookKeyboardEvent): void {
  const isRepeat = heldKeycodes.has(e.keycode)
  heldKeycodes.add(e.keycode)
  if (isRepeat || !enabled) return

  if (hotkey.keycode === null) {
    const watched = watchedKeycodesForModifierOnly(hotkey)
    if (watched.length === 0) return
    if (watched.includes(e.keycode)) {
      const now = Date.now()
      if (now - lastModifierPressAt <= DOUBLE_PRESS_WINDOW_MS) {
        lastModifierPressAt = 0
        toggle()
      } else {
        lastModifierPressAt = now
      }
    } else {
      lastModifierPressAt = 0
    }
  } else if (e.keycode === hotkey.keycode && matchesModifiers(e, hotkey)) {
    toggle()
  }
}

function handleKeyup(e: UiohookKeyboardEvent): void {
  heldKeycodes.delete(e.keycode)
}

export function setEnabled(value: boolean): void {
  enabled = value
  if (!enabled) hide()
}

export function setHotkey(combo: HotkeyCombo): void {
  hotkey = combo
  lastModifierPressAt = 0
}

export function initCommandPalette(openMacroForPlayback: (macroId: string) => void): void {
  ensureGlobalHookStarted()
  keepGlobalHookAlive()
  uIOhook.on('keydown', handleKeydown)
  uIOhook.on('keyup', handleKeyup)

  ipcMain.on(IPC.hideCommandPalette, () => hide())

  ipcMain.handle(IPC.commandPaletteInsertText, async (_e, text: string) => {
    await insertText(text)
  })

  ipcMain.handle(IPC.commandPaletteOpenMacro, (_e, macroId: string) => {
    hide()
    openMacroForPlayback(macroId)
  })

  ipcMain.handle(IPC.setCommandPaletteEnabled, async (_e, value: boolean) => {
    const settings = await settingsStore.setCommandPaletteEnabled(value)
    setEnabled(value)
    return settings
  })

  ipcMain.handle(IPC.setCommandPaletteHotkey, async (_e, combo: HotkeyCombo) => {
    const settings = await settingsStore.setCommandPaletteHotkey(combo)
    setHotkey(combo)
    return settings
  })
}
