import { randomUUID } from 'crypto'
import type {
  PlaybackProgress,
  PlaybackResult,
  RecordedStep,
  TargetAdapter,
  TestCase,
  TestTarget
} from '../shared/types'
import { createBrowserAdapter } from './adapters/browserTargetAdapter'
import { createDesktopAdapter } from './adapters/desktopTargetAdapter'
import { sleep, stopGlobalHook } from './adapters/windowTargetBase'

/** abortされたら即座に抜けられるよう、短い間隔に分けて待機する */
async function interruptibleSleep(ms: number, isAborted: () => boolean): Promise<void> {
  const chunk = 200
  let remaining = ms
  while (remaining > 0 && !isAborted()) {
    const wait = Math.min(chunk, remaining)
    await sleep(wait)
    remaining -= wait
  }
}

function createAdapter(target: TestTarget): TargetAdapter {
  return target.kind === 'web' ? createBrowserAdapter(target) : createDesktopAdapter(target)
}

/**
 * 複数対象(WEBアプリ/デスクトップアプリ)の記録・再生を統括する。
 * どの対象が「アクティブ」か(=最前面表示され、操作を受け付けているか)を管理し、
 * 記録時は発生したイベントにアクティブな対象のidを付与、再生時はステップのtargetIdに応じて
 * アクティブ対象を自動的に切り替える。一時停止中は発生したイベントを記録に含めない
 * (ログイン操作等、記録に残したくない操作を挟めるようにするため)。
 */
export class TargetManager {
  private adapters = new Map<string, TargetAdapter>()
  private activeTargetId: string | null = null
  private recording = false
  private paused = false
  private recordedSteps: RecordedStep[] = []
  private lastStepTime: number | null = null
  private onStepPush: ((step: RecordedStep) => void) | null = null
  private aborted = false

  async startRecording(targets: TestTarget[], onStep: (step: RecordedStep) => void): Promise<void> {
    if (targets.length === 0) throw new Error('対象が指定されていません')
    await this.disposeAll()
    this.recordedSteps = []
    this.lastStepTime = null
    this.paused = false
    this.onStepPush = onStep

    try {
      for (const target of targets) {
        const adapter = createAdapter(target)
        await adapter.init()
        this.adapters.set(target.id, adapter)
        await adapter.startRecording((partial) => this.handleStep(target.id, partial))
      }
    } catch (err) {
      // 一部の対象だけ起動済みのまま残ると、最小化されたウィンドウが孤立して
      // ユーザーが操作できなくなるため、失敗時は必ず全て破棄する
      await this.disposeAll()
      throw err
    }

    this.recording = true
    await this.setActiveTarget(targets[0].id)
  }

  private handleStep(targetId: string, partial: Omit<RecordedStep, 'id' | 'targetId' | 'timestamp' | 'delayMs'>): void {
    if (!this.recording || this.paused) return
    const now = Date.now()
    const delayMs = this.lastStepTime === null ? 0 : now - this.lastStepTime
    this.lastStepTime = now
    const step: RecordedStep = { id: randomUUID(), targetId, timestamp: now, delayMs, ...partial }
    this.recordedSteps.push(step)
    this.onStepPush?.(step)
  }

  setPaused(paused: boolean): void {
    this.paused = paused
    // 再開時に不自然な長い待機時間が記録されないよう、直前時刻をリセットする
    if (!paused) this.lastStepTime = null
  }

  async setActiveTarget(targetId: string): Promise<void> {
    if (this.activeTargetId === targetId) return
    const prevId = this.activeTargetId
    this.activeTargetId = targetId
    if (prevId) {
      await this.adapters.get(prevId)?.setActive(false)
    }
    await this.adapters.get(targetId)?.setActive(true)
  }

  async stopRecording(): Promise<RecordedStep[]> {
    this.recording = false
    this.paused = false
    for (const adapter of this.adapters.values()) {
      await adapter.stopRecording().catch(() => {})
    }
    stopGlobalHook()
    const steps = this.recordedSteps
    this.recordedSteps = []
    this.onStepPush = null
    await this.disposeAll()
    return steps
  }

  async runPlayback(
    testCase: TestCase,
    onProgress: (progress: PlaybackProgress) => void
  ): Promise<PlaybackResult> {
    await this.disposeAll()
    this.aborted = false
    const log: PlaybackProgress[] = []
    const push = (p: PlaybackProgress): void => {
      log.push(p)
      onProgress(p)
    }

    try {
      for (const target of testCase.targets) {
        const adapter = createAdapter(target)
        await adapter.init()
        this.adapters.set(target.id, adapter)
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      push({ stepIndex: 0, status: 'fail', message })
      await this.disposeAll()
      return { success: false, finishedAt: new Date().toISOString(), log }
    }

    if (testCase.targets.length > 0) {
      await this.setActiveTarget(testCase.targets[0].id)
    }

    let success = true
    for (let i = 0; i < testCase.steps.length; i++) {
      if (this.aborted) {
        push({ stepIndex: i, status: 'skipped', message: '中断されました' })
        success = false
        break
      }

      const step = testCase.steps[i]

      // 記録時に実際に空いていた時間だけ待ってから次の操作を行い、間隔を再現する
      if (step.delayMs > 0) {
        await interruptibleSleep(step.delayMs, () => this.aborted)
      }
      if (this.aborted) {
        push({ stepIndex: i, status: 'skipped', message: '中断されました' })
        success = false
        break
      }

      if (step.targetId !== this.activeTargetId) {
        await this.setActiveTarget(step.targetId)
      }
      push({ stepIndex: i, status: 'running', targetId: step.targetId })

      try {
        const adapter = this.adapters.get(step.targetId)
        if (!adapter) throw new Error('対象が見つかりません')
        await adapter.execStep(step)
        push({ stepIndex: i, status: 'ok', targetId: step.targetId })
      } catch (err) {
        success = false
        push({
          stepIndex: i,
          status: 'fail',
          message: err instanceof Error ? err.message : String(err),
          targetId: step.targetId
        })
        break
      }
    }

    await this.disposeAll()
    return { success, finishedAt: new Date().toISOString(), log }
  }

  abort(): void {
    this.aborted = true
  }

  private async disposeAll(): Promise<void> {
    for (const adapter of this.adapters.values()) {
      await adapter.dispose().catch(() => {})
    }
    this.adapters.clear()
    this.activeTargetId = null
  }
}
