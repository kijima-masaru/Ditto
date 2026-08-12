import { app, BrowserWindow, ipcMain, screen } from 'electron'
import fs from 'fs'
import path from 'path'
import type { CaptureInfo, RecordingFrameBounds } from '../shared/types'

/**
 * 画面上に表示する録画範囲の枠。
 * ウィンドウ自体は枠の外側にPAD分だけ大きく、透明な余白部分にリサイズ用ハンドルを置く。
 * 録画としてキャプチャする実際の範囲(bounds)は、この余白の内側(枠線に一切かからない部分)になる。
 */
const PAD = 14
const MIN_W = 160
const MIN_H = 120
const DEFAULT_BOUNDS: RecordingFrameBounds = { x: 120, y: 120, width: 480, height: 320 }

let win: BrowserWindow | null = null
let bounds: RecordingFrameBounds = loadBounds()
/** trueの間はドラッグ移動・リサイズが可能。録画中はfalseにしてクリックを対象アプリへ完全に通過させる */
let interactive = true
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
    height: Math.round(bounds.height + PAD * 2)
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
  html, body { margin:0; padding:0; background:transparent; overflow:hidden; }
  * { box-sizing: border-box; }
  .frame { position:absolute; left:${PAD}px; top:${PAD}px; right:${PAD}px; bottom:${PAD}px; outline:3px solid #ff4d4f; outline-offset:0; pointer-events:none; }
  .drag { position:absolute; left:${PAD}px; top:${PAD}px; right:${PAD}px; bottom:${PAD}px; -webkit-app-region:drag; }
  .handle { position:absolute; width:16px; height:16px; background:#ff4d4f; border-radius:3px; -webkit-app-region:no-drag; transition:opacity .15s; }
  .handle.locked { opacity:0.25; pointer-events:none; }
  .nw { left:0; top:0; cursor:nwse-resize; }
  .ne { right:0; top:0; cursor:nesw-resize; }
  .sw { left:0; bottom:0; cursor:nesw-resize; }
  .se { right:0; bottom:0; cursor:nwse-resize; }
</style></head>
<body>
  <div class="drag"></div>
  <div class="frame"></div>
  <div class="handle nw" id="nw"></div>
  <div class="handle ne" id="ne"></div>
  <div class="handle sw" id="sw"></div>
  <div class="handle se" id="se"></div>
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
    ipcRenderer.on('set-interactive', (_e, v) => {
      document.querySelectorAll('.handle').forEach((h) => h.classList.toggle('locked', !v))
    })
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

ipcMain.on('recording-frame:resize-begin', onResizeBegin)
ipcMain.on('recording-frame:resize-move', onResizeMove)
ipcMain.on('recording-frame:resize-end', onResizeEnd)

export function show(): void {
  if (!win) win = createWindow()
  win.setBounds(outerRect())
  win.showInactive()
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

export function getCaptureInfo(): CaptureInfo {
  const rect = { x: Math.round(bounds.x), y: Math.round(bounds.y), width: Math.round(bounds.width), height: Math.round(bounds.height) }
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
