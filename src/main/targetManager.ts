import { randomUUID } from 'crypto'
import type { BrowserWindow } from 'electron'
import type {
  PlaybackProgress,
  PlaybackResult,
  RecordedStep,
  TargetAdapter,
  TestCase,
  TestTarget,
  ViewportRect
} from '../shared/types'
import { createWebAdapter } from './adapters/webTargetAdapter'
import { createDesktopAdapter, DesktopTargetAdapter } from './adapters/desktopTargetAdapter'

function createAdapter(target: TestTarget, mainWindow: BrowserWindow): TargetAdapter {
  return target.kind === 'web' ? createWebAdapter(target, mainWindow) : createDesktopAdapter(target)
}

const DEFAULT_VIEWPORT: ViewportRect = { x: 0, y: 0, width: 0, height: 0, scaleFactor: 1 }

/**
 * 複数対象(Web/デスクトップアプリ)の記録・再生を統括する。
 * どの対象が「アクティブ」か(=ビューポートに表示され、操作を受け付けているか)を管理し、
 * 記録時は発生したイベントにアクティブな対象のidを付与、再生時はステップのtargetIdに応じて
 * アクティブ対象を自動的に切り替える。
 */
export class TargetManager {
  private readonly mainWindow: BrowserWindow
  private adapters = new Map<string, TargetAdapter>()
  private activeTargetId: string | null = null
  private viewport: ViewportRect = DEFAULT_VIEWPORT
  private recording = false
  private recordedSteps: RecordedStep[] = []
  private lastStepTime: number | null = null
  private onStepPush: ((step: RecordedStep) => void) | null = null
  private aborted = false

  constructor(mainWindow: BrowserWindow) {
    this.mainWindow = mainWindow
  }

  updateViewport(viewport: ViewportRect): void {
    this.viewport = viewport
    for (const adapter of this.adapters.values()) {
      adapter.updateViewport(viewport).catch(() => {})
    }
  }

  async startRecording(targets: TestTarget[], onStep: (step: RecordedStep) => void): Promise<void> {
    if (targets.length === 0) throw new Error('対象が指定されていません')
    await this.disposeAll()
    this.recordedSteps = []
    this.lastStepTime = null
    this.onStepPush = onStep

    try {
      for (const target of targets) {
        const adapter = createAdapter(target, this.mainWindow)
        await adapter.init(this.viewport)
        this.adapters.set(target.id, adapter)
        await adapter.startRecording((partial) => this.handleStep(target.id, partial))
      }
    } catch (err) {
      // 一部の対象だけ起動済みのまま残ると、埋め込んだウィンドウが孤立して
      // ユーザーが操作できなくなるため、失敗時は必ず全て破棄する
      await this.disposeAll()
      throw err
    }

    this.recording = true
    await this.setActiveTarget(targets[0].id)
  }

  private handleStep(targetId: string, partial: Omit<RecordedStep, 'id' | 'targetId' | 'timestamp' | 'delayMs'>): void {
    if (!this.recording) return
    const now = Date.now()
    const delayMs = this.lastStepTime === null ? 0 : now - this.lastStepTime
    this.lastStepTime = now
    const step: RecordedStep = { id: randomUUID(), targetId, timestamp: now, delayMs, ...partial }
    this.recordedSteps.push(step)
    this.onStepPush?.(step)
  }

  async setActiveTarget(targetId: string): Promise<void> {
    if (this.activeTargetId === targetId) return
    const prevId = this.activeTargetId
    this.activeTargetId = targetId
    if (prevId) {
      await this.adapters.get(prevId)?.setActive(false, this.viewport)
    }
    await this.adapters.get(targetId)?.setActive(true, this.viewport)
  }

  async stopRecording(): Promise<RecordedStep[]> {
    this.recording = false
    for (const adapter of this.adapters.values()) {
      await adapter.stopRecording().catch(() => {})
    }
    DesktopTargetAdapter.stopGlobalHook()
    const steps = this.recordedSteps
    this.recordedSteps = []
    this.onStepPush = null
    await this.disposeAll()
    return steps
  }

  async runPlayback(
    testCase: TestCase,
    speed: number,
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
        const adapter = createAdapter(target, this.mainWindow)
        await adapter.init(this.viewport)
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
      if (step.targetId !== this.activeTargetId) {
        await this.setActiveTarget(step.targetId)
      }
      push({ stepIndex: i, status: 'running', targetId: step.targetId })

      try {
        const adapter = this.adapters.get(step.targetId)
        if (!adapter) throw new Error('対象が見つかりません')
        await adapter.execStep(step, speed)
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
