import { app, BrowserWindow, ipcMain, screen } from 'electron'
import fs from 'fs'
import path from 'path'
import { IPC, type CaptureInfo, type RecordingFrameBounds, type RecordingFrameFooterAction } from '../shared/types'

/**
 * 画面上に表示する録画範囲の枠。
 * ウィンドウは「タイトルバー(上)+キャプチャ範囲(中央、枠線のみ)+ツールバー(下)」の3段構成。
 * キャプチャ範囲の内側は常にクリックスルーで、タイトルバー・リサイズハンドル・ツールバー
 * (chrome要素)にマウスが乗っている間だけ一時的にクリックを受け付ける。
 * これにより、枠を画面上のWEB/アプリの上に置いても、枠の内側は常にそのまま操作できる。
 *
 * chrome要素の判定はElectronの`setIgnoreMouseEvents(true,{forward:true})`のmousemove転送に
 * 頼らず(環境によって転送が届かないことがあるため)、mainプロセス側でカーソル位置を
 * 一定間隔でポーリングし、あらかじめ計算しておいたchrome領域(タイトルバー/ツールバー/
 * リサイズハンドル)の矩形と比較する方式にしている。
 *
 * 録画としてキャプチャする実際の範囲(bounds)はキャプチャ範囲(枠線の内側)そのもの。
 */
const PAD = 8
const TITLEBAR_H = 30
const TOOLBAR_H = 44
const HANDLE_SIZE = 14
const MIN_W = 220
const MIN_H = 150
const DEFAULT_BOUNDS: RecordingFrameBounds = { x: 120, y: 150, width: 480, height: 320 }
/** カーソル位置がchrome領域内かどうかを確認する間隔(ms)。クリックのきっかけになる
 *  ホバーの検出なので、体感の遅延が出ない範囲でできるだけ短くしている */
const HOVER_POLL_MS = 50

export type FooterState = 'idle' | 'recording' | 'paused'

let win: BrowserWindow | null = null
let bounds: RecordingFrameBounds = loadBounds()
/** 録画中(true)はリサイズハンドル・サイズ入力欄を無効化する(録画中にキャプチャサイズが変わらないようにするため) */
let locked = false
let footerState: FooterState = 'idle'
let resizeStart: { corner: string; screenX: number; screenY: number; bounds: RecordingFrameBounds } | null = null
let saveTimer: NodeJS.Timeout | null = null
let hoverPollTimer: NodeJS.Timeout | null = null
let isChromeHot = false

function boundsFilePath(): string {
  return path.join(app.getPath('userData'), 'recording-frame.json')
}

function loadBounds(): RecordingFrameBounds {
  try {
    const raw = fs.readFileSync(boundsFilePath(), 'utf-8')
    const parsed = JSON.parse(raw) as Partial<RecordingFrameBounds>
    if (
      typeof parsed.x === 'number' &&
      typeof parsed.y === 'number' &&
      typeof parsed.width === 'number' &&
      typeof parsed.height === 'number'
    ) {
      return { x: parsed.x, y: parsed.y, width: parsed.width, height: parsed.height }
    }
  } catch {
    // 初回起動時などファイルが無い場合はデフォルト値を使う
  }
  return { ...DEFAULT_BOUNDS }
}

function scheduleSave(): void {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    try {
      fs.writeFileSync(boundsFilePath(), JSON.stringify(bounds))
    } catch {
      // 保存に失敗しても致命的ではないため無視する
    }
  }, 400)
}

function outerRect(): { x: number; y: number; width: number; height: number } {
  return {
    x: Math.round(bounds.x - PAD),
    y: Math.round(bounds.y - PAD - TITLEBAR_H),
    width: Math.round(bounds.width + PAD * 2),
    height: Math.round(bounds.height + PAD * 2 + TITLEBAR_H + TOOLBAR_H)
  }
}

function sendBoundsDisplay(): void {
  win?.webContents.send('set-size-display', bounds)
}

/** タイトルバー・ツールバー・(ロック中でなければ)リサイズハンドルの、画面座標での矩形一覧 */
function chromeRects(): Array<{ x: number; y: number; width: number; height: number }> {
  const outer = outerRect()
  const rects = [
    { x: outer.x, y: outer.y, width: outer.width, height: TITLEBAR_H },
    { x: outer.x, y: outer.y + outer.height - TOOLBAR_H, width: outer.width, height: TOOLBAR_H }
  ]
  if (!locked) {
    rects.push(
      { x: outer.x, y: outer.y, width: HANDLE_SIZE, height: HANDLE_SIZE },
      { x: outer.x + outer.width - HANDLE_SIZE, y: outer.y, width: HANDLE_SIZE, height: HANDLE_SIZE },
      { x: outer.x, y: outer.y + outer.height - HANDLE_SIZE, width: HANDLE_SIZE, height: HANDLE_SIZE },
      {
        x: outer.x + outer.width - HANDLE_SIZE,
        y: outer.y + outer.height - HANDLE_SIZE,
        width: HANDLE_SIZE,
        height: HANDLE_SIZE
      }
    )
  }
  return rects
}

function isPointInChrome(px: number, py: number): boolean {
  return chromeRects().some((r) => px >= r.x && px < r.x + r.width && py >= r.y && py < r.y + r.height)
}

function startHoverPolling(): void {
  if (hoverPollTimer) return
  hoverPollTimer = setInterval(() => {
    if (!win || !win.isVisible()) return
    // リサイズドラッグ中はカーソルがハンドルの外に出るため、判定をスキップして
    // クリック受付状態を維持する(そうしないとドラッグ中にクリックスルーへ戻ってしまう)
    const cursor = screen.getCursorScreenPoint()
    const hot = resizeStart ? true : isPointInChrome(cursor.x, cursor.y)
    if (hot !== isChromeHot) {
      isChromeHot = hot
      win.setIgnoreMouseEvents(!hot, { forward: true })
    }
  }, HOVER_POLL_MS)
}

function stopHoverPolling(): void {
  if (hoverPollTimer) {
    clearInterval(hoverPollTimer)
    hoverPollTimer = null
  }
  isChromeHot = false
}

function computeResizedBounds(
  corner: string,
  dx: number,
  dy: number,
  start: RecordingFrameBounds
): RecordingFrameBounds {
  let x = start.x
  let y = start.y
  let width = start.width
  let height = start.height

  if (corner.includes('e')) {
    width = Math.max(MIN_W, start.width + dx)
  }
  if (corner.includes('w')) {
    width = Math.max(MIN_W, start.width - dx)
    x = start.x + start.width - width
  }
  if (corner.includes('s')) {
    height = Math.max(MIN_H, start.height + dy)
  }
  if (corner.includes('n')) {
    height = Math.max(MIN_H, start.height - dy)
    y = start.y + start.height - height
  }

  return { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) }
}

function buildHtml(): string {
  return `<!doctype html>
<html><head><meta charset="utf-8"><style>
  html, body { margin:0; padding:0; background:transparent; overflow:hidden; user-select:none; }
  * { box-sizing: border-box; font-family:'Segoe UI',sans-serif; }
  .frame { position:absolute; left:${PAD}px; top:${PAD + TITLEBAR_H}px; right:${PAD}px; bottom:${PAD + TOOLBAR_H}px; outline:2px solid #ff4d4f; outline-offset:0; pointer-events:none; }

  .titlebar { position:absolute; left:0; top:0; right:0; height:${TITLEBAR_H}px; background:rgba(18,20,26,0.96); border-radius:6px 6px 0 0; display:flex; align-items:center; padding:0 6px 0 10px; -webkit-app-region:drag; z-index:1; }
  .titlebar-icon { color:#ff4d4f; font-size:11px; margin-right:6px; }
  .titlebar-title { color:#e8e8ea; font-size:12px; flex:1; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .titlebar-btns { display:flex; gap:2px; -webkit-app-region:no-drag; }
  .titlebar-btn { width:24px; height:22px; border:none; border-radius:3px; background:transparent; color:#cfd2d8; font-size:13px; line-height:1; cursor:pointer; display:flex; align-items:center; justify-content:center; }
  .titlebar-btn:hover { background:rgba(255,255,255,0.14); }
  #btn-close:hover { background:#e0453f; color:#fff; }

  .handle { position:absolute; width:14px; height:14px; background:transparent; z-index:2; }
  .handle.locked { pointer-events:none; }
  .nw { left:0; top:0; cursor:nwse-resize; }
  .ne { right:0; top:0; cursor:nesw-resize; }
  .sw { left:0; bottom:0; cursor:nesw-resize; }
  .se { right:0; bottom:0; cursor:nwse-resize; }

  .toolbar { position:absolute; left:0; right:0; bottom:0; height:${TOOLBAR_H}px; background:rgba(18,20,26,0.96); border-radius:0 0 6px 6px; display:flex; align-items:center; justify-content:space-between; padding:0 10px; gap:8px; z-index:1; }
  .size-fields { display:flex; align-items:center; gap:4px; color:#aeb2ba; font-size:11px; }
  .size-fields input { width:52px; background:#262a33; color:#e8e8ea; border:1px solid #454b57; border-radius:4px; padding:4px 5px; font-size:11px; }
  .size-fields input:disabled { color:#6b6f78; cursor:not-allowed; }
  .toolbar-right { display:flex; align-items:center; gap:14px; }
  .mode-toggle-wrap { display:flex; align-items:center; gap:6px; min-width:0; }
  .mode-toggle-wrap[data-locked="true"] { pointer-events:none; opacity:0.4; }
  .mode-switch { position:relative; display:inline-block; flex-shrink:0; width:32px; height:18px; cursor:pointer; }
  .mode-switch input { position:absolute; opacity:0; width:100%; height:100%; margin:0; cursor:pointer; }
  .mode-switch-slider { position:absolute; inset:0; background:#3a3f4b; border-radius:999px; transition:background-color .15s ease; }
  .mode-switch-slider::before { content:''; position:absolute; top:2px; left:2px; width:14px; height:14px; background:#fff; border-radius:50%; transition:transform .15s ease; }
  .mode-switch input:checked + .mode-switch-slider { background:#ff4d4f; }
  .mode-switch input:checked + .mode-switch-slider::before { transform:translateX(14px); }
  .mode-label { color:#cfd2d8; font-size:11px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }

  .toolbar-actions { display:flex; align-items:center; gap:6px; }
  .toolbar-actions button { display:none; border:none; cursor:pointer; color:#fff; align-items:center; justify-content:center; }
  .rec-btn { width:22px; height:22px; border-radius:50%; background:#ff4d4f; border:2px solid #fff; }
  .tool-btn { width:26px; height:26px; border-radius:50%; background:#3a3f4b; font-size:11px; }
  .tool-btn.stop { background:#e0453f; }
  .capture-btn { width:22px; height:22px; border-radius:50%; background:#ff4d4f; border:2px solid #fff; }
  .toolbar-actions[data-state="idle"] #btn-start { display:flex; }
  .toolbar-actions[data-state="recording"] #btn-pause,
  .toolbar-actions[data-state="recording"] #btn-stop { display:flex; }
  .toolbar-actions[data-state="paused"] #btn-resume,
  .toolbar-actions[data-state="paused"] #btn-stop { display:flex; }
  .toolbar-actions[data-state="idle"][data-mode="photo"] #btn-capture { display:flex; }
  .toolbar-actions[data-mode="photo"] #btn-start,
  .toolbar-actions[data-mode="photo"] #btn-pause,
  .toolbar-actions[data-mode="photo"] #btn-resume,
  .toolbar-actions[data-mode="photo"] #btn-stop { display:none; }
  .toolbar-actions[data-mode="video"] #btn-capture { display:none; }
</style></head>
<body>
  <div class="titlebar">
    <span class="titlebar-icon">⏺</span>
    <span class="titlebar-title">Ditto 録画</span>
    <div class="titlebar-btns">
      <button class="titlebar-btn" id="btn-min" title="非表示">─</button>
      <button class="titlebar-btn" id="btn-close" title="閉じる">×</button>
    </div>
  </div>
  <div class="frame"></div>
  <div class="handle nw" id="nw"></div>
  <div class="handle ne" id="ne"></div>
  <div class="handle sw" id="sw"></div>
  <div class="handle se" id="se"></div>
  <div class="toolbar">
    <div class="size-fields">
      <input type="number" id="w-input" min="${MIN_W}" />
      <span>×</span>
      <input type="number" id="h-input" min="${MIN_H}" />
      <span>px</span>
    </div>
    <div class="toolbar-right">
      <div class="mode-toggle-wrap" id="mode-toggle-wrap" data-locked="false">
        <label class="mode-switch">
          <input type="checkbox" id="mode-switch-input" />
          <span class="mode-switch-slider"></span>
        </label>
        <span class="mode-label" id="mode-label">画面録画</span>
      </div>
      <div class="toolbar-actions" id="actions" data-state="idle" data-mode="video">
        <button class="rec-btn" id="btn-start" title="録画開始"></button>
        <button class="tool-btn" id="btn-pause" title="一時停止">⏸</button>
        <button class="tool-btn" id="btn-resume" title="再開">▶</button>
        <button class="tool-btn stop" id="btn-stop" title="停止">■</button>
        <button class="capture-btn" id="btn-capture" title="撮影"></button>
      </div>
    </div>
  </div>
  <script>
    const { ipcRenderer } = require('electron')
    function startResize(corner, e) {
      e.preventDefault()
      ipcRenderer.send('recording-frame:resize-begin', { corner, screenX: e.screenX, screenY: e.screenY })
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
    }
    function onMove(e) {
      ipcRenderer.send('recording-frame:resize-move', { screenX: e.screenX, screenY: e.screenY })
    }
    function onUp() {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      ipcRenderer.send('recording-frame:resize-end')
    }
    ;['nw', 'ne', 'sw', 'se'].forEach((c) => {
      document.getElementById(c).addEventListener('mousedown', (e) => startResize(c, e))
    })

    document.getElementById('btn-min').addEventListener('click', () =>
      ipcRenderer.send('recording-frame:chrome-action', 'minimize')
    )
    document.getElementById('btn-close').addEventListener('click', () =>
      ipcRenderer.send('recording-frame:chrome-action', 'close')
    )

    const wInput = document.getElementById('w-input')
    const hInput = document.getElementById('h-input')
    function commitSize() {
      const w = parseInt(wInput.value, 10)
      const h = parseInt(hInput.value, 10)
      if (!isNaN(w) && !isNaN(h)) {
        ipcRenderer.invoke('${IPC.recordingFrameSetSize}', w, h).then((b) => {
          wInput.value = Math.round(b.width)
          hInput.value = Math.round(b.height)
        })
      }
    }
    wInput.addEventListener('change', commitSize)
    hInput.addEventListener('change', commitSize)
    ;[wInput, hInput].forEach((el) => {
      el.addEventListener('keydown', (e) => { if (e.key === 'Enter') el.blur() })
    })

    ipcRenderer.on('set-size-display', (_e, b) => {
      if (document.activeElement !== wInput) wInput.value = Math.round(b.width)
      if (document.activeElement !== hInput) hInput.value = Math.round(b.height)
    })

    let locked = false
    ipcRenderer.on('set-locked', (_e, v) => {
      locked = v
      document.querySelectorAll('.handle').forEach((h) => h.classList.toggle('locked', v))
      wInput.disabled = v
      hInput.disabled = v
    })
    const modeToggleWrap = document.getElementById('mode-toggle-wrap')
    const modeSwitchInput = document.getElementById('mode-switch-input')
    const modeLabel = document.getElementById('mode-label')
    function setMode(mode) {
      document.getElementById('actions').dataset.mode = mode
      modeSwitchInput.checked = mode === 'photo'
      modeLabel.textContent = mode === 'photo' ? 'スクリーンショット' : '画面録画'
    }
    modeSwitchInput.addEventListener('change', () => setMode(modeSwitchInput.checked ? 'photo' : 'video'))

    ipcRenderer.on('set-footer-state', (_e, state) => {
      document.getElementById('actions').dataset.state = state
      // 動画録画/一時停止中はモード切替できないようにする(静止画には録画中の概念が無いため対象外)
      modeToggleWrap.dataset.locked = state !== 'idle' ? 'true' : 'false'
    })

    document.getElementById('btn-start').addEventListener('click', () => ipcRenderer.send('recording-frame:footer-action', 'start'))
    document.getElementById('btn-pause').addEventListener('click', () => ipcRenderer.send('recording-frame:footer-action', 'pause'))
    document.getElementById('btn-resume').addEventListener('click', () => ipcRenderer.send('recording-frame:footer-action', 'resume'))
    document.getElementById('btn-stop').addEventListener('click', () => ipcRenderer.send('recording-frame:footer-action', 'stop'))
    document.getElementById('btn-capture').addEventListener('click', () => ipcRenderer.send('recording-frame:footer-action', 'screenshot'))
  </script>
</body></html>`
}

function createWindow(): BrowserWindow {
  const rect = outerRect()
  const w = new BrowserWindow({
    ...rect,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    movable: true,
    skipTaskbar: true,
    hasShadow: false,
    focusable: true,
    show: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  })
  w.setAlwaysOnTop(true, 'screen-saver')
  w.setIgnoreMouseEvents(true, { forward: true })
  w.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(buildHtml())}`)
  w.webContents.once('did-finish-load', () => {
    w.webContents.send('set-footer-state', footerState)
    w.webContents.send('set-locked', locked)
    w.webContents.send('set-size-display', bounds)
  })
  w.on('move', () => {
    if (!w.isDestroyed()) {
      const b = w.getBounds()
      bounds = { x: b.x + PAD, y: b.y + PAD + TITLEBAR_H, width: bounds.width, height: bounds.height }
      scheduleSave()
    }
  })
  w.on('closed', () => {
    if (win === w) win = null
  })
  return w
}

function onResizeBegin(_e: unknown, payload: { corner: string; screenX: number; screenY: number }): void {
  resizeStart = { ...payload, bounds: { ...bounds } }
}

function onResizeMove(_e: unknown, payload: { screenX: number; screenY: number }): void {
  if (!resizeStart || !win) return
  const dx = payload.screenX - resizeStart.screenX
  const dy = payload.screenY - resizeStart.screenY
  bounds = computeResizedBounds(resizeStart.corner, dx, dy, resizeStart.bounds)
  win.setBounds(outerRect())
  sendBoundsDisplay()
}

function onResizeEnd(): void {
  resizeStart = null
  scheduleSave()
}

function onChromeAction(_e: unknown, action: 'minimize' | 'close'): void {
  // このオーバーレイはタスクバー項目を持たないため、最小化も閉じるも「枠を非表示にする」
  // 動作に統一する(メインウィンドウのヘッダーにある録画マークから再表示できる)
  if (action === 'minimize' || action === 'close') {
    hide()
    visibilityListeners.forEach((listener) => listener(false))
  }
}

ipcMain.on('recording-frame:resize-begin', onResizeBegin)
ipcMain.on('recording-frame:resize-move', onResizeMove)
ipcMain.on('recording-frame:resize-end', onResizeEnd)
ipcMain.on('recording-frame:chrome-action', onChromeAction)
ipcMain.on(IPC.recordingFrameFooterAction, (_e, action: RecordingFrameFooterAction) => {
  footerActionListeners.forEach((listener) => listener(action))
})

const footerActionListeners: Array<(action: RecordingFrameFooterAction) => void> = []
export function onFooterAction(listener: (action: RecordingFrameFooterAction) => void): void {
  footerActionListeners.push(listener)
}

const visibilityListeners: Array<(visible: boolean) => void> = []
export function onVisibilityChange(listener: (visible: boolean) => void): void {
  visibilityListeners.push(listener)
}

export function show(): void {
  if (!win) win = createWindow()
  win.setBounds(outerRect())
  win.setIgnoreMouseEvents(true, { forward: true })
  win.showInactive()
  win.webContents.send('set-footer-state', footerState)
  win.webContents.send('set-locked', locked)
  win.webContents.send('set-size-display', bounds)
  startHoverPolling()
}

export function hide(): void {
  win?.hide()
  stopHoverPolling()
}

export function isVisible(): boolean {
  return !!win && win.isVisible()
}

export function getBounds(): RecordingFrameBounds {
  return { ...bounds }
}

export function setSize(width: number, height: number): RecordingFrameBounds {
  bounds = {
    ...bounds,
    width: Math.max(MIN_W, Math.round(width)),
    height: Math.max(MIN_H, Math.round(height))
  }
  scheduleSave()
  if (win && win.isVisible()) win.setBounds(outerRect())
  sendBoundsDisplay()
  return { ...bounds }
}

/** 録画中はリサイズハンドル・サイズ入力欄を無効化する(録画中にキャプチャサイズが変わらないようにするため) */
export function setInteractive(v: boolean): void {
  locked = !v
  win?.webContents.send('set-locked', locked)
}

export function setFooterState(state: FooterState): void {
  footerState = state
  win?.webContents.send('set-footer-state', state)
}

export function getCaptureInfo(): CaptureInfo {
  const rect = {
    x: Math.round(bounds.x),
    y: Math.round(bounds.y),
    width: Math.round(bounds.width),
    height: Math.round(bounds.height)
  }
  const display = screen.getDisplayMatching(rect)
  return {
    bounds: { ...bounds },
    displayId: String(display.id),
    scaleFactor: display.scaleFactor,
    displayBounds: { ...display.bounds }
  }
}

export function destroy(): void {
  stopHoverPolling()
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
    try {
      fs.writeFileSync(boundsFilePath(), JSON.stringify(bounds))
    } catch {
      // 終了時の保存失敗は無視する
    }
  }
  win?.destroy()
  win = null
}
