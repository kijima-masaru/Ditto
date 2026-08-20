import { randomUUID } from 'crypto'
import type {
  PlaybackProgress,
  PlaybackResult,
  RecordedStep,
  TargetAdapter,
  MacroCase,
  MacroTarget
} from '../shared/types'
import { createBrowserAdapter } from './adapters/browserTargetAdapter'
import { createDesktopAdapter } from './adapters/desktopTargetAdapter'
import { sleep, stopGlobalHook } from './adapters/windowTargetBase'
import { captureFailureEvidence } from './failureEvidence'
import { startBlockingRealMouseInput, stopBlockingRealMouseInput } from './mouseBlock'

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

/** 再生の一時停止中は、次のステップに進む前でここに留まる */
async function waitWhilePaused(isPaused: () => boolean, isAborted: () => boolean): Promise<void> {
  while (isPaused() && !isAborted()) {
    await sleep(100)
  }
}

function createAdapter(target: MacroTarget): TargetAdapter {
  return target.kind === 'web' ? createBrowserAdapter(target) : createDesktopAdapter(target)
}

/** UI操作(録画/再生)とリモート(Ditto Remote)からの再生要求が同時に走ると、
 *  disposeAll()経由で片方のセッションが無警告に破棄されてしまうため、
 *  この状態を見て早期にErrorを投げ、二重実行を防ぐ */
export type TargetManagerStatus = 'idle' | 'recording' | 'playing'

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
  private status: TargetManagerStatus = 'idle'
  private speed = 1

  getStatus(): TargetManagerStatus {
    return this.status
  }

  async startRecording(targets: MacroTarget[], onStep: (step: RecordedStep) => void): Promise<void> {
    if (targets.length === 0) throw new Error('対象が指定されていません')
    if (this.status === 'playing') throw new Error('マクロ再生中は録画を開始できません')
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
      this.status = 'idle'
      throw err
    }

    this.recording = true
    this.status = 'recording'
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

  /** 再生速度の倍率(1=等速、2=2倍速、0.5=半分の速さ)。次のステップ間隔から即座に反映される */
  setSpeed(speed: number): void {
    this.speed = Math.min(10, Math.max(0.1, speed))
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
    this.status = 'idle'
    return steps
  }

  async runPlayback(
    macroCase: MacroCase,
    onProgress: (progress: PlaybackProgress) => void
  ): Promise<PlaybackResult> {
    if (this.status !== 'idle') throw new Error('録画または再生中です')
    this.status = 'playing'
    try {
      return await this.runPlaybackInner(macroCase, onProgress)
    } finally {
      this.status = 'idle'
    }
  }

  private async runPlaybackInner(
    macroCase: MacroCase,
    onProgress: (progress: PlaybackProgress) => void
  ): Promise<PlaybackResult> {
    await this.disposeAll()
    this.aborted = false
    this.paused = false
    const log: PlaybackProgress[] = []
    const push = (p: PlaybackProgress): void => {
      log.push(p)
      onProgress(p)
    }

    try {
      for (const target of macroCase.targets) {
        const adapter = createAdapter(target)
        await adapter.init()
        this.adapters.set(target.id, adapter)
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const evidencePath = (await captureFailureEvidence(macroCase.name, 0)) ?? undefined
      push({ stepIndex: 0, status: 'fail', message, evidencePath })
      await this.disposeAll()
      return { success: false, finishedAt: new Date().toISOString(), log }
    }

    if (macroCase.targets.length > 0) {
      await this.setActiveTarget(macroCase.targets[0].id)
    }

    let success = true
    // 再生中は実際のユーザーのマウス操作だけを遮断し、マクロ自身の操作はそのまま通す
    // (手動でカーソルを動かして再生中のクリック位置とズレてしまうのを防ぐ)。
    // どのように抜けても必ず解除されるようtry/finallyで囲む
    startBlockingRealMouseInput()
    try {
      for (let i = 0; i < macroCase.steps.length; i++) {
        await waitWhilePaused(() => this.paused, () => this.aborted)
        if (this.aborted) {
          push({ stepIndex: i, status: 'skipped', message: '中断されました' })
          success = false
          break
        }

        const step = macroCase.steps[i]

        // 記録時に実際に空いていた時間だけ待ってから次の操作を行い、間隔を再現する
        // (再生速度が変更されていれば、その倍率で待機時間を短縮/延長する)
        const adjustedDelay = step.delayMs / this.speed
        if (adjustedDelay > 0) {
          await interruptibleSleep(adjustedDelay, () => this.aborted)
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
          const evidencePath = (await captureFailureEvidence(macroCase.name, i)) ?? undefined
          push({
            stepIndex: i,
            status: 'fail',
            message: err instanceof Error ? err.message : String(err),
            targetId: step.targetId,
            evidencePath
          })
          break
        }
      }
    } finally {
      stopBlockingRealMouseInput()
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
