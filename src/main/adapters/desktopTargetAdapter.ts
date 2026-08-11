import { spawn, type ChildProcess } from 'child_process'
import path from 'path'
import activeWin from 'active-win'
import * as win32 from '../win32'
import type { TargetAdapter, TestTarget } from '../../shared/types'
import { WindowTargetAdapterBase, sleep } from './windowTargetBase'

/**
 * デスクトップアプリ対象のアダプタ。
 * 対象アプリのプロセスを起動し、そのウィンドウをタブ切り替えで最前面表示/最小化する
 * (詳細はwindowTargetBase.ts、方式選定の経緯はwin32.tsのコメント参照)。
 */

function parseArgs(argsStr?: string): string[] {
  if (!argsStr) return []
  const matches = argsStr.match(/(?:[^\s"]+|"[^"]*")+/g)
  if (!matches) return []
  return matches.map((s) => s.replace(/^"(.*)"$/, '$1'))
}

/**
 * 起動したプロセスのウィンドウを探す。processId優先、見つからなければ実行ファイル名で突合する。
 * タイムアウトしても無関係なウィンドウにフォールバックはしない(誤って他のウィンドウを
 * 対象にしてしまう事故を避けるため)。見つからなければnullを返し、呼び出し元がエラーにする。
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

export class DesktopTargetAdapter extends WindowTargetAdapterBase {
  private readonly target: TestTarget
  private child: ChildProcess | null = null

  constructor(target: TestTarget) {
    super()
    this.target = target
  }

  async init(): Promise<void> {
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
}

export function createDesktopAdapter(target: TestTarget): TargetAdapter {
  return new DesktopTargetAdapter(target)
}
