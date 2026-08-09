import { spawn, type ChildProcess } from 'child_process'
import path from 'path'
import { uIOhook, UiohookKey, type UiohookKeyboardEvent, type UiohookMouseEvent } from 'uiohook-napi'
import { mouse, keyboard, Point, Key as NutKey } from '@nut-tree-fork/nut-js'
import activeWin from 'active-win'
import * as win32 from '../win32'
import type { RecordedStep, TargetAdapter, TestTarget, ViewportRect } from '../../shared/types'

/**
 * デスクトップアプリ対象のアダプタ。
 * 対象アプリを起動し、アプリ自身のビューポート領域に座標を合わせて重ねて表示する
 * (SetParentによる真の埋め込みはDWM/GPUコンポジタとの相性で内容が描画されない
 * 問題があり採用していない。win32.tsのコメント参照)。
 * 記録はグローバルフック(uiohook-napi)、再生は座標クリック/キー入力のシミュレーション(nut-js)で行う。
 */

interface WindowBounds {
  x: number
  y: number
  width: number
  height: number
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function parseArgs(argsStr?: string): string[] {
  if (!argsStr) return []
  const matches = argsStr.match(/(?:[^\s"]+|"[^"]*")+/g)
  if (!matches) return []
  return matches.map((s) => s.replace(/^"(.*)"$/, '$1'))
}

function isInsideBounds(x: number, y: number, bounds: WindowBounds): boolean {
  return x >= bounds.x && x < bounds.x + bounds.width && y >= bounds.y && y < bounds.y + bounds.height
}

/**
 * 起動したプロセスのウィンドウを探す。processId優先、見つからなければ実行ファイル名で突合する。
 * タイムアウトしても無関係なウィンドウにフォールバックはしない(誤って他のウィンドウを
 * 埋め込み対象にしてしまう事故を避けるため)。見つからなければnullを返し、呼び出し元がエラーにする。
 */
async function findWindowByPid(pid: number | undefined, exePath: string, timeoutMs: number): Promise<number | null> {
  const deadline = Date.now() + timeoutMs
  const exeBase = path.basename(exePath).toLowerCase()

  while (Date.now() < deadline) {
    const windows = await activeWin.getOpenWindows()
    let match = pid !== undefined ? windows.find((w) => w.owner.processId === pid) : undefined
    if (!match) {
      match = windows.find((w) => w.owner.path && path.basename(w.owner.path).toLowerCase() === exeBase)
    }
    if (match) return match.id
    await sleep(300)
  }
  return null
}

async function currentBounds(windowId: number): Promise<WindowBounds | null> {
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

async function pressKey(name: string): Promise<void> {
  const special = SPECIAL_KEY_MAP[name]
  if (special !== undefined) {
    await keyboard.type(special)
    return
  }
  await keyboard.type(name)
}

export class DesktopTargetAdapter implements TargetAdapter {
  private readonly target: TestTarget

  private child: ChildProcess | null = null
  private windowId: number | null = null
  private hwnd: win32.NativeHandle | null = null
  private active = false

  private recording = false
  private onStepCb: ((step: Omit<RecordedStep, 'id' | 'targetId' | 'timestamp' | 'delayMs'>) => void) | null = null

  constructor(target: TestTarget) {
    this.target = target
  }

  async init(_viewport: ViewportRect): Promise<void> {
    if (!this.target.exePath) throw new Error('exePathが指定されていません')

    this.child = spawn(this.target.exePath, parseArgs(this.target.exeArgs), {
      detached: true,
      stdio: 'ignore'
    })
    this.child.unref()

    const windowId = await findWindowByPid(this.child.pid, this.target.exePath, 10000)
    if (windowId === null) {
      throw new Error(`対象ウィンドウが見つかりませんでした: ${this.target.exePath}`)
    }
    this.windowId = windowId
    this.hwnd = win32.idToHandle(windowId)

    win32.minimizeWindow(this.hwnd)
  }

  async setActive(active: boolean, _viewport: ViewportRect): Promise<void> {
    this.active = active
    if (!this.hwnd) return
    if (active) {
      win32.activateWindow(this.hwnd)
    } else {
      win32.minimizeWindow(this.hwnd)
    }
  }

  async updateViewport(_viewport: ViewportRect): Promise<void> {
    // このアダプタは対象ウィンドウをこのアプリの表示エリアに正確に重ねる方式を採らず、
    // アクティブなタブになったら最前面表示・非アクティブなら最小化するだけなので、
    // ビューポートのサイズ変更に追従する処理は不要。
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
    if (!DesktopTargetAdapter.hookStarted) {
      uIOhook.start()
      DesktopTargetAdapter.hookStarted = true
    }
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
        // input/navigate/scroll はweb対象用のためdesktopでは無視する
        return
    }
  }

  async dispose(): Promise<void> {
    await this.stopRecording()
    if (this.child) {
      try {
        this.child.kill()
      } catch {
        // 既に終了している場合は無視
      }
    }
    this.child = null
    this.hwnd = null
    this.windowId = null
  }

  // uiohookのstart/stopはプロセス内で1回のみ行う(複数アダプタが同時にstart/stopを呼んでも安全にする)
  private static hookStarted = false

  /** 全デスクトップ対象の記録が終わったタイミングでTargetManagerから呼ばれる */
  static stopGlobalHook(): void {
    if (DesktopTargetAdapter.hookStarted) {
      uIOhook.stop()
      DesktopTargetAdapter.hookStarted = false
    }
  }
}

export function createDesktopAdapter(target: TestTarget): TargetAdapter {
  return new DesktopTargetAdapter(target)
}
