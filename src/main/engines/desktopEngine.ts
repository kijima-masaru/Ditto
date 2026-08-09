import { randomUUID } from 'crypto'
import { spawn, type ChildProcess } from 'child_process'
import path from 'path'
import { uIOhook, UiohookKey, type UiohookKeyboardEvent, type UiohookMouseEvent } from 'uiohook-napi'
import { mouse, keyboard, Point, Key as NutKey } from '@nut-tree-fork/nut-js'
import activeWin from 'active-win'
import type {
  PlayerEngine,
  RecorderEngine,
  RecordedStep,
  TestCase,
  PlaybackProgress,
  PlaybackResult
} from '../../shared/types'

/**
 * 汎用デスクトップアプリ対象の録画・再生エンジン。
 * グローバルマウス/キーボードフックで対象ウィンドウ相対座標の操作を記録し、
 * 再生時は対象ウィンドウを探してフォーカスした上で座標ベースに操作を再現する。
 *
 * 座標ベースの自動化のため、記録時と再生時でウィンドウ位置・サイズ・DPIスケーリングが
 * 異なると壊れやすい。これは既知の制約としてUI側で警告表示済みのため、本実装では
 * 「壊れないこと」より「素直で分かりやすいこと」を優先する。
 *
 * ライブラリ選定:
 * - グローバルフック(記録): uiohook-napi (N-API・Windows向けprebuildあり)
 * - 操作シミュレーション(再生): @nut-tree-fork/nut-js (robotjsの代替、Windows向けprebuildあり)
 * - ウィンドウ検索/座標取得: active-win
 *   node-window-manager はこの環境に Visual Studio Build Tools が無く node-gyp ビルドが
 *   失敗したため採用を見送り、代替として仕様に明記されている active-win を採用した。
 *   active-win は napi prebuild をGitHub Releasesから取得するため追加のビルド工程は不要。
 *   uiohook-napi / nut-js / active-win はいずれもElectron本体プロセスから
 *   require() できることを確認済み(要 REPORT 参照)。ABI不一致による @electron/rebuild は不要だった。
 */

interface WindowBounds {
  x: number
  y: number
  width: number
  height: number
}

interface FoundWindow {
  /** active-win が返すウィンドウハンドル値。再取得時の突合に使う */
  id: number
  title: string
  bounds: WindowBounds
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** "notepad.exe --foo \"bar baz\"" のような引数文字列を簡易パースする */
function parseArgs(argsStr?: string): string[] {
  if (!argsStr) return []
  const matches = argsStr.match(/(?:[^\s"]+|"[^"]*")+/g)
  if (!matches) return []
  return matches.map((s) => s.replace(/^"(.*)"$/, '$1'))
}

function isInsideBounds(screenX: number, screenY: number, bounds: WindowBounds): boolean {
  return (
    screenX >= bounds.x &&
    screenX < bounds.x + bounds.width &&
    screenY >= bounds.y &&
    screenY < bounds.y + bounds.height
  )
}

/**
 * 起動したプロセスのウィンドウを探す。
 * processId優先で突合し、見つからない場合は実行ファイル名で突合、
 * それでも見つからない場合は最前面のウィンドウをフォールバックとして採用する。
 */
async function findTargetWindow(
  pid: number | undefined,
  exePath: string,
  timeoutMs: number
): Promise<FoundWindow | null> {
  const deadline = Date.now() + timeoutMs
  const exeBase = path.basename(exePath).toLowerCase()
  let lastWindows: activeWin.Result[] = []

  while (Date.now() < deadline) {
    const windows = await activeWin.getOpenWindows()
    lastWindows = windows

    let match = pid !== undefined ? windows.find((w) => w.owner.processId === pid) : undefined
    if (!match) {
      match = windows.find((w) => w.owner.path && path.basename(w.owner.path).toLowerCase() === exeBase)
    }
    if (match) {
      return { id: match.id, title: match.title, bounds: { ...match.bounds } }
    }
    await sleep(250)
  }

  // 最終フォールバック: processId/パスで突合できなければ最前面のウィンドウを採用する
  if (lastWindows.length > 0) {
    const w = lastWindows[0]
    return { id: w.id, title: w.title, bounds: { ...w.bounds } }
  }
  return null
}

async function refreshWindowBounds(windowId: number): Promise<WindowBounds | null> {
  const windows = await activeWin.getOpenWindows()
  const match = windows.find((w) => w.id === windowId)
  return match ? { ...match.bounds } : null
}

function killChildQuietly(child: ChildProcess | null): void {
  if (!child) return
  try {
    child.kill()
  } catch {
    // 既に終了している場合などは無視する
  }
}

/** uiohook-napiのキーコード -> 読みやすいキー名 の逆引きマップ */
const KEYCODE_TO_NAME: Record<number, string> = (() => {
  const map: Record<number, string> = {}
  for (const [name, code] of Object.entries(UiohookKey) as Array<[string, number]>) {
    if (!(code in map)) {
      map[code] = name
    }
  }
  return map
})()

/** キー名(記録時に付けた名前) -> nut-js の Key enum。該当が無ければ文字として直接typeする */
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
  CtrlRight: NutKey.RightControl,
  Alt: NutKey.LeftAlt,
  AltRight: NutKey.RightAlt,
  Shift: NutKey.LeftShift,
  ShiftRight: NutKey.RightShift,
  Meta: NutKey.LeftSuper,
  MetaRight: NutKey.RightSuper,
  NumLock: NutKey.NumLock,
  ScrollLock: NutKey.ScrollLock,
  NumpadMultiply: NutKey.Multiply,
  NumpadAdd: NutKey.Add,
  NumpadSubtract: NutKey.Subtract,
  NumpadDecimal: NutKey.Decimal,
  NumpadDivide: NutKey.Divide
}
for (let i = 1; i <= 24; i++) {
  SPECIAL_KEY_MAP[`F${i}`] = NutKey[`F${i}` as keyof typeof NutKey]
}
for (let i = 0; i <= 9; i++) {
  SPECIAL_KEY_MAP[`Numpad${i}`] = NutKey[`NumPad${i}` as keyof typeof NutKey]
}

async function pressKey(name: string): Promise<void> {
  const special = SPECIAL_KEY_MAP[name]
  if (special !== undefined) {
    await keyboard.type(special)
    return
  }
  // 英数字・記号など単一文字はそのまま文字入力として送る(大文字はshift込みでnut-jsが処理する)
  await keyboard.type(name)
}

export class DesktopRecorderEngine implements RecorderEngine {
  private child: ChildProcess | null = null
  private windowId: number | null = null
  private windowTitle = ''
  private previousStepTime: number | null = null
  private onStepCb: ((step: RecordedStep) => void) | null = null
  private running = false

  private handleClick = async (e: UiohookMouseEvent): Promise<void> => {
    if (!this.running || this.windowId === null) return
    const bounds = await refreshWindowBounds(this.windowId)
    if (!bounds) return
    if (!isInsideBounds(e.x, e.y, bounds)) return

    this.emitStep({
      type: e.clicks >= 2 ? 'dblclick' : 'click',
      winX: e.x - bounds.x,
      winY: e.y - bounds.y,
      windowTitle: this.windowTitle
    })
  }

  private handleKeydown = (e: UiohookKeyboardEvent): void => {
    if (!this.running) return
    const key = KEYCODE_TO_NAME[e.keycode] ?? `Keycode${e.keycode}`
    this.emitStep({
      type: 'keypress',
      key,
      windowTitle: this.windowTitle
    })
  }

  private emitStep(partial: Omit<RecordedStep, 'id' | 'timestamp' | 'delayMs'>): void {
    const now = Date.now()
    const delayMs = this.previousStepTime !== null ? now - this.previousStepTime : 0
    this.previousStepTime = now
    const step: RecordedStep = {
      id: randomUUID(),
      timestamp: now,
      delayMs,
      ...partial
    }
    this.onStepCb?.(step)
  }

  async start(
    target: string,
    targetArgs: string | undefined,
    onStep: (step: RecordedStep) => void
  ): Promise<void> {
    if (this.running) {
      throw new Error('既に録画中です')
    }

    this.onStepCb = onStep
    this.previousStepTime = null

    this.child = spawn(target, parseArgs(targetArgs), { detached: true, stdio: 'ignore' })
    this.child.unref()

    const win = await findTargetWindow(this.child.pid, target, 5000)
    if (!win) {
      killChildQuietly(this.child)
      this.child = null
      throw new Error(`対象ウィンドウが見つかりませんでした: ${target}`)
    }

    this.windowId = win.id
    this.windowTitle = win.title

    uIOhook.on('click', this.handleClick)
    uIOhook.on('keydown', this.handleKeydown)
    uIOhook.start()
    this.running = true
    console.log(`[desktopEngine] recording started: "${win.title}"`)
  }

  async stop(): Promise<void> {
    if (!this.running) return
    uIOhook.removeListener('click', this.handleClick)
    uIOhook.removeListener('keydown', this.handleKeydown)
    uIOhook.stop()
    this.running = false
    this.onStepCb = null
    this.windowId = null
    // 記録対象アプリは起動したままにする(ユーザーが操作を続けられるように)
    this.child = null
    console.log('[desktopEngine] recording stopped')
  }
}

export class DesktopPlayerEngine implements PlayerEngine {
  private aborted = false
  private child: ChildProcess | null = null

  async run(testCase: TestCase, onProgress: (progress: PlaybackProgress) => void): Promise<PlaybackResult> {
    this.aborted = false
    const log: PlaybackProgress[] = []
    const emit = (p: PlaybackProgress): void => {
      log.push(p)
      onProgress(p)
    }

    let windowId: number
    try {
      this.child = spawn(testCase.target, parseArgs(testCase.targetArgs), {
        detached: true,
        stdio: 'ignore'
      })
      this.child.unref()

      const win = await findTargetWindow(this.child.pid, testCase.target, 5000)
      if (!win) {
        throw new Error(`対象ウィンドウが見つかりませんでした: ${testCase.target}`)
      }
      windowId = win.id
      console.log(`[desktopEngine] playback started: "${win.title}"`)
    } catch (err) {
      killChildQuietly(this.child)
      this.child = null
      const message = err instanceof Error ? err.message : String(err)
      emit({ stepIndex: 0, status: 'fail', message })
      return { success: false, finishedAt: new Date().toISOString(), log }
    }

    let success = true
    for (let i = 0; i < testCase.steps.length; i++) {
      if (this.aborted) {
        emit({ stepIndex: i, status: 'skipped', message: '中断されました' })
        success = false
        break
      }

      const step = testCase.steps[i]
      emit({ stepIndex: i, status: 'running' })

      try {
        await this.executeStep(step, windowId)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        emit({ stepIndex: i, status: 'fail', message })
        success = false
        break
      }

      if (this.aborted) {
        emit({ stepIndex: i, status: 'skipped', message: '中断されました' })
        success = false
        break
      }
      emit({ stepIndex: i, status: 'ok' })
    }

    console.log(`[desktopEngine] playback finished: success=${success}`)
    return { success, finishedAt: new Date().toISOString(), log }
  }

  private async executeStep(step: RecordedStep, windowId: number): Promise<void> {
    switch (step.type) {
      case 'click':
      case 'dblclick': {
        if (step.winX === undefined || step.winY === undefined) {
          throw new Error('座標情報がありません')
        }
        const bounds = await refreshWindowBounds(windowId)
        if (!bounds) {
          throw new Error('対象ウィンドウが見つかりません(閉じられた可能性があります)')
        }
        await mouse.setPosition(new Point(bounds.x + step.winX, bounds.y + step.winY))
        await mouse.leftClick()
        if (step.type === 'dblclick') {
          await mouse.leftClick()
        }
        break
      }
      case 'keypress': {
        if (!step.key) {
          throw new Error('キー情報がありません')
        }
        await pressKey(step.key)
        break
      }
      case 'wait': {
        await sleep(Math.min(step.delayMs, 3000))
        break
      }
      default:
        // input/navigate/scroll はweb用のステップ種別のため、desktopでは無視する
        break
    }
  }

  async abort(): Promise<void> {
    this.aborted = true
  }
}
