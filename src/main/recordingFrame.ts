import { app, BrowserWindow, ipcMain, screen } from 'electron'
import fs from 'fs'
import path from 'path'
import { IPC, type CaptureInfo, type RecordingFrameBounds } from '../shared/types'

/**
 * 画面上に表示する録画範囲の枠。
 * ウィンドウ自体は枠の外側にPAD分だけ大きく、透明な余白部分にリサイズ用ハンドルを置く。
 * 下部にはさらにFOOTER_HEIGHT分の操作フッター(開始/一時停止/再開/停止)を持つ。
 * 録画としてキャプチャする実際の範囲(bounds)は、この余白・フッターの内側(枠線に一切かからない部分)になる。
 */
const PAD = 14
const FOOTER_HEIGHT = 34
const MIN_W = 160
const MIN_H = 120
const DEFAULT_BOUNDS: RecordingFrameBounds = { x: 120, y: 120, width: 480, height: 320 }

export type FooterState = 'idle' | 'recording' | 'paused'

let win: BrowserWindow | null = null
let bounds: RecordingFrameBounds = loadBounds()
/** trueの間はドラッグ移動・リサイズ・フッター操作が常に可能。falseの間は録画中とみなし、
 *  フッター以外はクリックスルーにして対象アプリを操作できるようにする */
let interactive = true
let footerState: FooterState = 'idle'
let resizeStart: { corner: string; screenX: number; screenY: number; bounds: RecordingFrameBounds } | null = null
let saveTimer: NodeJS.Timeout | null = null

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
    y: Math.round(bounds.y - PAD),
    width: Math.round(bounds.width + PAD * 2),
    height: Math.round(bounds.height + PAD * 2 + FOOTER_HEIGHT)
  }
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
  * { box-sizing: border-box; }
  .frame { position:absolute; left:${PAD}px; top:${PAD}px; right:${PAD}px; bottom:${PAD + FOOTER_HEIGHT}px; outline:3px solid #ff4d4f; outline-offset:0; pointer-events:none; }
  .drag { position:absolute; left:${PAD}px; top:${PAD}px; right:${PAD}px; bottom:${PAD + FOOTER_HEIGHT}px; -webkit-app-region:drag; }
  .handle { position:absolute; width:16px; height:16px; background:#ff4d4f; border-radius:3px; -webkit-app-region:no-drag; transition:opacity .15s; }
  .handle.locked { opacity:0.25; pointer-events:none; }
  .nw { left:0; top:0; cursor:nwse-resize; }
  .ne { right:0; top:0; cursor:nesw-resize; }
  .sw { left:0; bottom:${FOOTER_HEIGHT}px; cursor:nesw-resize; }
  .se { right:0; bottom:${FOOTER_HEIGHT}px; cursor:nwse-resize; }
  .footer { position:absolute; left:${PAD}px; right:${PAD}px; bottom:0; height:${FOOTER_HEIGHT}px; background:rgba(31,41,51,0.94); border-radius:0 0 6px 6px; display:flex; align-items:center; justify-content:center; gap:6px; -webkit-app-region:no-drag; }
  .footer-btn { display:none; font-size:11px; padding:5px 10px; border-radius:4px; border:none; cursor:pointer; background:#2f80ed; color:white; font-family:'Segoe UI',sans-serif; }
  .footer-btn.danger { background:#e0453f; }
  .footer[data-state="idle"] #btn-start { display:inline-block; }
  .footer[data-state="recording"] #btn-pause,
  .footer[data-state="recording"] #btn-stop { display:inline-block; }
  .footer[data-state="paused"] #btn-resume,
  .footer[data-state="paused"] #btn-stop { display:inline-block; }
</style></head>
<body>
  <div class="drag"></div>
  <div class="frame"></div>
  <div class="handle nw" id="nw"></div>
  <div class="handle ne" id="ne"></div>
  <div class="handle sw" id="sw"></div>
  <div class="handle se" id="se"></div>
  <div class="footer" id="footer" data-state="idle">
    <button class="footer-btn" id="btn-start">● 録画開始</button>
    <button class="footer-btn" id="btn-pause">⏸ 一時停止</button>
    <button class="footer-btn" id="btn-resume">▶ 再開</button>
    <button class="footer-btn danger" id="btn-stop">■ 停止</button>
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

    let locked = false
    ipcRenderer.on('set-interactive', (_e, v) => {
      locked = !v
      document.querySelectorAll('.handle').forEach((h) => h.classList.toggle('locked', !v))
    })
    ipcRenderer.on('set-footer-state', (_e, state) => {
      document.getElementById('footer').dataset.state = state
    })

    // 録画中(locked)はフッター以外クリックスルーにするため、フッター上をホバーしている間だけ
    // 一時的にクリックを受け取れるようにする(Electronの「クリックスルー中も一部だけ操作可能にする」定番手法)
    let overFooter = false
    document.addEventListener('mousemove', (e) => {
      const now = !!e.target.closest('.footer')
      if (now !== overFooter) {
        overFooter = now
        if (locked) ipcRenderer.send('recording-frame:set-passthrough', overFooter)
      }
    })

    document.getElementById('btn-start').addEventListener('click', () => ipcRenderer.send('recording-frame:footer-action', 'start'))
    document.getElementById('btn-pause').addEventListener('click', () => ipcRenderer.send('recording-frame:footer-action', 'pause'))
    document.getElementById('btn-resume').addEventListener('click', () => ipcRenderer.send('recording-frame:footer-action', 'resume'))
    document.getElementById('btn-stop').addEventListener('click', () => ipcRenderer.send('recording-frame:footer-action', 'stop'))
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
  w.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(buildHtml())}`)
  w.webContents.once('did-finish-load', () => {
    w.webContents.send('set-footer-state', footerState)
  })
  w.on('move', () => {
    if (!w.isDestroyed()) {
      const b = w.getBounds()
      bounds = { x: b.x + PAD, y: b.y + PAD, width: bounds.width, height: bounds.height }
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
}

function onResizeEnd(): void {
  resizeStart = null
  scheduleSave()
}

function onSetPassthrough(_e: unknown, wantInteractive: boolean): void {
  // 録画中(locked)の間だけ、フッターホバー時に一時的にクリックを受け取れるようにする
  if (interactive || !win) return
  win.setIgnoreMouseEvents(!wantInteractive, { forward: true })
}

ipcMain.on('recording-frame:resize-begin', onResizeBegin)
ipcMain.on('recording-frame:resize-move', onResizeMove)
ipcMain.on('recording-frame:resize-end', onResizeEnd)
ipcMain.on('recording-frame:set-passthrough', onSetPassthrough)
ipcMain.on(IPC.recordingFrameFooterAction, (_e, action: 'start' | 'pause' | 'resume' | 'stop') => {
  footerActionListeners.forEach((listener) => listener(action))
})

const footerActionListeners: Array<(action: 'start' | 'pause' | 'resume' | 'stop') => void> = []
export function onFooterAction(listener: (action: 'start' | 'pause' | 'resume' | 'stop') => void): void {
  footerActionListeners.push(listener)
}

export function show(): void {
  if (!win) win = createWindow()
  win.setBounds(outerRect())
  win.showInactive()
  win.webContents.send('set-footer-state', footerState)
  setInteractive(interactive)
}

export function hide(): void {
  win?.hide()
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
  return { ...bounds }
}

export function setInteractive(v: boolean): void {
  interactive = v
  if (win) {
    win.setIgnoreMouseEvents(!v, { forward: true })
    win.webContents.send('set-interactive', v)
  }
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
