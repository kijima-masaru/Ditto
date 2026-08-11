import { uIOhook, UiohookKey, type UiohookKeyboardEvent, type UiohookMouseEvent } from 'uiohook-napi'
import { mouse, keyboard, Point, Key as NutKey } from '@nut-tree-fork/nut-js'
import activeWin from 'active-win'
import * as win32 from '../win32'
import type { RecordedStep, TargetAdapter } from '../../shared/types'

/**
 * デスクトップアプリ対象・WEBアプリ対象(ユーザーの既定ブラウザ)に共通する、
 * 「OS上の1つのウィンドウ」を対象とした記録・再生の基底クラス。
 * 記録はグローバルフック(uiohook-napi)で対象ウィンドウ内のクリック/キー入力を捕捉し、
 * 再生は座標クリック/キー入力のシミュレーション(nut-js)で行う。
 * タブがアクティブになったら最前面表示、非アクティブになったら最小化する。
 *
 * サブクラスは対象ウィンドウの起動方法(init)と後始末(dispose)のみを実装する。
 */

export interface WindowBounds {
  x: number
  y: number
  width: number
  height: number
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function isInsideBounds(x: number, y: number, bounds: WindowBounds): boolean {
  return x >= bounds.x && x < bounds.x + bounds.width && y >= bounds.y && y < bounds.y + bounds.height
}

export async function currentBounds(windowId: number): Promise<WindowBounds | null> {
  const windows = await activeWin.getOpenWindows()
  const match = windows.find((w) => w.id === windowId)
  return match ? { ...match.bounds } : null
}

const KEYCODE_TO_NAME: Record<number, string> = (() => {
  const map: Record<number, string> = {}
  for (const [name, code] of Object.entries(UiohookKey) as Array<[string, number]>) {
    if (!(code in map)) map[code] = name
  }
  return map
})()

const SPECIAL_KEY_MAP: Partial<Record<string, NutKey>> = {
  Backspace: NutKey.Backspace,
  Tab: NutKey.Tab,
  Enter: NutKey.Enter,
  NumpadEnter: NutKey.Enter,
  CapsLock: NutKey.CapsLock,
  Escape: NutKey.Escape,
  Space: NutKey.Space,
  PageUp: NutKey.PageUp,
  PageDown: NutKey.PageDown,
  End: NutKey.End,
  Home: NutKey.Home,
  ArrowLeft: NutKey.Left,
  ArrowUp: NutKey.Up,
  ArrowRight: NutKey.Right,
  ArrowDown: NutKey.Down,
  Insert: NutKey.Insert,
  Delete: NutKey.Delete,
  Semicolon: NutKey.Semicolon,
  Equal: NutKey.Equal,
  Comma: NutKey.Comma,
  Minus: NutKey.Minus,
  Period: NutKey.Period,
  Slash: NutKey.Slash,
  Backquote: NutKey.Grave,
  BracketLeft: NutKey.LeftBracket,
  Backslash: NutKey.Backslash,
  BracketRight: NutKey.RightBracket,
  Quote: NutKey.Quote,
  Ctrl: NutKey.LeftControl,
  Alt: NutKey.LeftAlt,
  Shift: NutKey.LeftShift,
  Meta: NutKey.LeftSuper
}
for (let i = 1; i <= 24; i++) {
  const k = NutKey[`F${i}` as keyof typeof NutKey]
  if (k !== undefined) SPECIAL_KEY_MAP[`F${i}`] = k
}

export async function pressKey(name: string): Promise<void> {
  const special = SPECIAL_KEY_MAP[name]
  if (special !== undefined) {
    await keyboard.type(special)
    return
  }
  await keyboard.type(name)
}

// uiohookのstart/stopはプロセス内で1回のみ行う(複数アダプタが同時にstart/stopを呼んでも安全にする)
let hookStarted = false
function ensureGlobalHookStarted(): void {
  if (!hookStarted) {
    uIOhook.start()
    hookStarted = true
  }
}

/** 全対象の記録が終わったタイミングでTargetManagerから呼ばれる */
export function stopGlobalHook(): void {
  if (hookStarted) {
    uIOhook.stop()
    hookStarted = false
  }
}

export abstract class WindowTargetAdapterBase implements TargetAdapter {
  protected windowId: number | null = null
  protected hwnd: win32.NativeHandle | null = null
  protected active = false

  private recording = false
  private onStepCb: ((step: Omit<RecordedStep, 'id' | 'targetId' | 'timestamp' | 'delayMs'>) => void) | null = null

  abstract init(): Promise<void>
  abstract dispose(): Promise<void>

  async setActive(active: boolean): Promise<void> {
    this.active = active
    if (!this.hwnd) return
    if (active) {
      win32.activateWindow(this.hwnd)
    } else {
      win32.minimizeWindow(this.hwnd)
    }
  }

  private handleClick = async (e: UiohookMouseEvent): Promise<void> => {
    if (!this.recording || !this.active || this.windowId === null) return
    const bounds = await currentBounds(this.windowId)
    if (!bounds) return
    if (!isInsideBounds(e.x, e.y, bounds)) return
    this.emit({
      type: e.clicks >= 2 ? 'dblclick' : 'click',
      winX: e.x - bounds.x,
      winY: e.y - bounds.y
    })
  }

  private handleKeydown = (e: UiohookKeyboardEvent): void => {
    if (!this.recording || !this.active) return
    const key = KEYCODE_TO_NAME[e.keycode] ?? `Keycode${e.keycode}`
    this.emit({ type: 'keypress', key })
  }

  private emit(partial: Omit<RecordedStep, 'id' | 'targetId' | 'timestamp' | 'delayMs'>): void {
    this.onStepCb?.(partial)
  }

  async startRecording(
    onStep: (step: Omit<RecordedStep, 'id' | 'targetId' | 'timestamp' | 'delayMs'>) => void
  ): Promise<void> {
    this.onStepCb = onStep
    ensureGlobalHookStarted()
    uIOhook.on('click', this.handleClick)
    uIOhook.on('keydown', this.handleKeydown)
    this.recording = true
  }

  async stopRecording(): Promise<void> {
    this.recording = false
    uIOhook.removeListener('click', this.handleClick)
    uIOhook.removeListener('keydown', this.handleKeydown)
    this.onStepCb = null
  }

  async execStep(step: RecordedStep, speed: number): Promise<void> {
    if (this.windowId === null) throw new Error('対象ウィンドウがありません')
    switch (step.type) {
      case 'click':
      case 'dblclick': {
        if (step.winX === undefined || step.winY === undefined) throw new Error('座標情報がありません')
        const bounds = await currentBounds(this.windowId)
        if (!bounds) throw new Error('対象ウィンドウが見つかりません')
        await mouse.setPosition(new Point(bounds.x + step.winX, bounds.y + step.winY))
        await mouse.leftClick()
        if (step.type === 'dblclick') await mouse.leftClick()
        return
      }
      case 'keypress': {
        if (!step.key) throw new Error('キー情報がありません')
        await pressKey(step.key)
        return
      }
      case 'wait': {
        await sleep(Math.min(step.delayMs, 3000) / speed)
        return
      }
      default:
        return
    }
  }
}
