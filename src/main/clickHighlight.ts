import { BrowserWindow, screen, type Display } from 'electron'
import { uIOhook, type UiohookMouseEvent } from 'uiohook-napi'
import { ensureGlobalHookStarted, stopGlobalHook } from './adapters/windowTargetBase'
import * as recordingFrame from './recordingFrame'

/**
 * 画面録画中、クリックした位置に一瞬リング状のエフェクトを表示する機能。
 * 動画だけでは第三者にどこをクリックしたか伝わりにくい、という声を踏まえたもの。
 * 録画中のグローバルクリックを監視し、録画枠のキャプチャ範囲内であれば、
 * クリックのあったディスプレイを覆う透明・クリックスルーのオーバーレイウィンドウに
 * エフェクトを描画する。このオーバーレイ自体も画面の一部としてデスクトップキャプチャに
 * 写り込むため、録画映像にそのままエフェクトが記録される。
 *
 * オーバーレイは全ディスプレイをまとめて1枚のウィンドウで覆おうとすると、Windows側で
 * 実際のサイズにクランプされてしまい正しく描画されないことを確認したため、
 * ディスプレイ1枚につき1つのオーバーレイウィンドウを(必要になった時点で)作る方式にしている
 */

const overlays = new Map<number, BrowserWindow>()
const overlayReady = new Map<number, boolean>()
let clickHandler: ((e: UiohookMouseEvent) => void) | null = null

function buildHtml(): string {
  return `<!doctype html>
<html><head><meta charset="utf-8"><style>
  html, body { margin:0; padding:0; background:transparent; overflow:hidden; }
  .ripple {
    position:absolute; width:36px; height:36px; margin-left:-18px; margin-top:-18px;
    border:3px solid #ff4d4f; border-radius:50%; pointer-events:none;
    box-shadow:0 0 6px rgba(255,77,79,0.6);
    animation: dittoRipple 0.45s ease-out forwards;
  }
  @keyframes dittoRipple {
    0% { transform:scale(0.35); opacity:0.95; }
    100% { transform:scale(2); opacity:0; }
  }
</style></head>
<body>
  <script>
    const { ipcRenderer } = require('electron')
    ipcRenderer.on('click-highlight:ripple', (_e, x, y) => {
      const el = document.createElement('div')
      el.className = 'ripple'
      el.style.left = x + 'px'
      el.style.top = y + 'px'
      document.body.appendChild(el)
      setTimeout(() => el.remove(), 500)
    })
  </script>
</body></html>`
}

function ensureOverlayForDisplay(display: Display): BrowserWindow {
  const existing = overlays.get(display.id)
  if (existing && !existing.isDestroyed()) return existing

  overlayReady.set(display.id, false)
  const w = new BrowserWindow({
    x: display.bounds.x,
    y: display.bounds.y,
    width: display.bounds.width,
    height: display.bounds.height,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    movable: false,
    skipTaskbar: true,
    hasShadow: false,
    focusable: false,
    show: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  })
  w.setAlwaysOnTop(true, 'screen-saver')
  w.setIgnoreMouseEvents(true)
  w.webContents.once('did-finish-load', () => {
    overlayReady.set(display.id, true)
  })
  w.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(buildHtml())}`)
  w.showInactive()
  w.on('closed', () => {
    if (overlays.get(display.id) === w) overlays.delete(display.id)
    overlayReady.delete(display.id)
  })
  overlays.set(display.id, w)
  return w
}

/** 画面録画開始時に呼ぶ。録画枠のキャプチャ範囲内でのクリックを監視し始める */
export function start(): void {
  if (clickHandler) return
  ensureGlobalHookStarted()
  // クリックが来る前にオーバーレイのHTML読み込みを済ませておく(最初のクリックの
  // タイミングでは読み込みが間に合わず、エフェクトが表示されないことがあるため)。
  // 録画枠が今あるディスプレイ分だけ先に用意しておけば十分実用的
  const frameBounds = recordingFrame.getBounds()
  ensureOverlayForDisplay(
    screen.getDisplayNearestPoint({
      x: frameBounds.x + frameBounds.width / 2,
      y: frameBounds.y + frameBounds.height / 2
    })
  )

  const handler = (e: UiohookMouseEvent): void => {
    const bounds = recordingFrame.getBounds()
    if (e.x < bounds.x || e.x >= bounds.x + bounds.width || e.y < bounds.y || e.y >= bounds.y + bounds.height) return
    const display = screen.getDisplayNearestPoint({ x: e.x, y: e.y })
    if (!overlayReady.get(display.id)) return
    const win = ensureOverlayForDisplay(display)
    win.webContents.send('click-highlight:ripple', e.x - display.bounds.x, e.y - display.bounds.y)
  }
  clickHandler = handler
  uIOhook.on('click', handler)
}

/** 画面録画終了時に呼ぶ */
export function stop(): void {
  if (clickHandler) {
    uIOhook.removeListener('click', clickHandler)
    clickHandler = null
  }
  stopGlobalHook()
  for (const win of overlays.values()) {
    if (!win.isDestroyed()) win.destroy()
  }
  overlays.clear()
  overlayReady.clear()
}
