import { BrowserWindow, clipboard, globalShortcut, ipcMain, screen } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { uIOhook, UiohookKey, type UiohookKeyboardEvent, type UiohookMouseEvent } from 'uiohook-napi'
import activeWin from 'active-win'
import { ensureGlobalHookStarted, keepGlobalHookAlive } from './adapters/windowTargetBase'
import * as win32 from './win32'
import * as settingsStore from './settingsStore'
import { resolveTemplateText } from './templateVariables'
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
 *  注入したイベントを拾ってしまう競合を避けるため、注入中はフックを一時停止する。
 *  入力に加えてクリップボードにも同じ内容をコピーしておき、他の画面でも
 *  Ctrl+Vで貼り付けられるようにする */
async function insertText(text: string): Promise<void> {
  clipboard.writeText(text)
  hide()
  if (lastFocusedWindowId !== null) {
    try {
      // activateWindow(常にSW_RESTOREする版)だと、最大化されていた対象ウィンドウの
      // 最大化状態まで解除されてしまい、ウィンドウサイズが勝手に変わって見えるため、
      // 最小化されている場合のみ復元するactivateWindowKeepStateを使う
      win32.activateWindowKeepState(win32.idToHandle(lastFocusedWindowId))
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

/** パレットで選択した定型文を入力する。{{date}}/{{seq}}/{{clipboard}}等の動的変数を
 *  先に解決してからinsertTextに渡す({{clipboard}}はinsertTextがクリップボードを
 *  書き換える前の内容を指すため、解決を先に完了させる必要がある) */
async function insertTemplate(templateId: string): Promise<void> {
  const resolved = await resolveTemplateText(templateId)
  await insertText(resolved)
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

// --- ホットキーのOSレベル横取り(globalShortcut)。詳細はcomboToAccelerator()のコメント参照 ---

// UiohookKeyの名前のうちElectronのAcceleratorキー名と表記が異なるもの
const SPECIAL_ACCELERATOR_NAMES: Record<string, string> = {
  Enter: 'Return',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right'
}

// キーコード(uiohook) -> Acceleratorキー名。文字/数字/F1〜F24/主要な編集・移動キーのみ対応する
// (テンキー専用キーや記号キーはElectronの表記との対応関係が複雑なため対象外とし、
// その場合は従来通りuiohookでの検知にフォールバックする)
const ACCELERATOR_KEY_NAMES: Record<number, string> = {}
for (const [name, code] of Object.entries(UiohookKey) as Array<[string, number]>) {
  if (/^[A-Z0-9]$/.test(name) || /^F([1-9]|1[0-9]|2[0-4])$/.test(name)) {
    ACCELERATOR_KEY_NAMES[code] = name
  } else if (name in SPECIAL_ACCELERATOR_NAMES) {
    ACCELERATOR_KEY_NAMES[code] = SPECIAL_ACCELERATOR_NAMES[name]
  } else if (['Space', 'Tab', 'Escape', 'Backspace', 'Delete', 'Insert', 'Home', 'End', 'PageUp', 'PageDown'].includes(name)) {
    ACCELERATOR_KEY_NAMES[code] = name
  }
}

/**
 * HotkeyComboをElectronのglobalShortcut用Accelerator文字列に変換する。
 *
 * uiohookは受動的な監視のみでキー入力を消費(横取り)できないため、コマンドパレットの
 * ホットキーに割り当てた最後のキー(既定のSpace等、文字として入力され得るキー)の
 * 物理的なキー入力が、パレットにフォーカスが移る前後どちらのウィンドウであっても
 * そのまま文字として入力されてしまう不具合があった。globalShortcutはOSのショートカット
 * 登録機構(Windowsでは RegisterHotKey)を使うため、登録したキーの入力は他のどのウィンドウ
 * にも渡らずОSレベルで横取りできる。
 *
 * ダブルタップ(修飾キー単体を2回押す)モードや、対応表にない特殊キーはAccelerator化できない
 * ため、その場合はnullを返し、呼び出し側で従来のuiohookベースの検知にフォールバックする。
 * また修飾キーが1つも設定されていない単独キーは、システム全体でそのキーを常に横取りして
 * しまい影響が大きすぎるため対象外とする。
 */
function comboToAccelerator(combo: HotkeyCombo): string | null {
  if (combo.keycode === null) return null
  const keyName = ACCELERATOR_KEY_NAMES[combo.keycode]
  if (!keyName) return null
  const modifiers: string[] = []
  if (combo.ctrl) modifiers.push('Control')
  if (combo.shift) modifiers.push('Shift')
  if (combo.alt) modifiers.push('Alt')
  if (combo.meta) modifiers.push('Super')
  if (modifiers.length === 0) return null
  return [...modifiers, keyName].join('+')
}

// globalShortcutでの登録に成功した現在のAccelerator文字列。nullなら未登録(uiohookで検知する)
let registeredAccelerator: string | null = null

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
  if (isRepeat) return

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
  } else if (!registeredAccelerator && e.keycode === hotkey.keycode && matchesModifiers(e, hotkey)) {
    // registeredAcceleratorがある場合はglobalShortcut側で既に処理されるため、
    // ここで二重に発火させない
    toggle()
  }
}

function handleKeyup(e: UiohookKeyboardEvent): void {
  heldKeycodes.delete(e.keycode)
}

/**
 * パレット表示中にパレットの外側をクリックしたら非表示にする。
 *
 * パレットウィンドウ自身のblurイベントでも大半のケースは検知できるが、パレットが
 * 'screen-saver'レベルのalwaysOnTopで最前面に表示されているため、パレットと重なる
 * 画面位置をクリックした場合はそのクリックがパレットに吸収されてしまい、狙った
 * 別ウィンドウにフォーカスが移らず(=blurが発火せず)パレットが閉じないことがある。
 * そのためグローバルなマウス押下を監視し、パレットの矩形の外側でのクリックであれば
 * 確実に非表示にする
 */
function handleGlobalMousedown(e: UiohookMouseEvent): void {
  if (!win || win.isDestroyed() || !win.isVisible()) return
  const bounds = win.getBounds()
  const insideBounds =
    e.x >= bounds.x && e.x < bounds.x + bounds.width && e.y >= bounds.y && e.y < bounds.y + bounds.height
  if (!insideBounds) hide()
}

export function setHotkey(combo: HotkeyCombo): void {
  if (registeredAccelerator) {
    globalShortcut.unregister(registeredAccelerator)
    registeredAccelerator = null
  }

  hotkey = combo
  lastModifierPressAt = 0

  const accelerator = comboToAccelerator(combo)
  if (accelerator) {
    // 他アプリが同じ組み合わせを既に横取りしている等で登録に失敗することがあるため、
    // その場合はregisteredAcceleratorをnullのままにし、従来のuiohookでの検知にフォールバックする
    const ok = globalShortcut.register(accelerator, () => toggle())
    if (ok) registeredAccelerator = accelerator
  }

  // 未設定(修飾キーなし・keycode null)に変更された場合はパレットを閉じておく
  if (!combo.ctrl && !combo.shift && !combo.alt && !combo.meta && combo.keycode === null) hide()
}

export function initCommandPalette(openMacroForPlayback: (macroId: string) => void): void {
  ensureGlobalHookStarted()
  keepGlobalHookAlive()
  uIOhook.on('keydown', handleKeydown)
  uIOhook.on('keyup', handleKeyup)
  uIOhook.on('mousedown', handleGlobalMousedown)

  ipcMain.on(IPC.hideCommandPalette, () => hide())

  ipcMain.handle(IPC.commandPaletteInsertText, async (_e, text: string) => {
    await insertText(text)
  })

  ipcMain.handle(IPC.commandPaletteInsertTemplate, async (_e, templateId: string) => {
    await insertTemplate(templateId)
  })

  ipcMain.handle(IPC.commandPaletteOpenMacro, (_e, macroId: string) => {
    hide()
    openMacroForPlayback(macroId)
  })

  ipcMain.handle(IPC.setCommandPaletteHotkey, async (_e, combo: HotkeyCombo) => {
    const settings = await settingsStore.setCommandPaletteHotkey(combo)
    setHotkey(combo)
    return settings
  })
}
