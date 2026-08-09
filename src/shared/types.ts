/**
 * アプリ全体で共有する型定義。
 * 1つのテストは複数の対象(Web/デスクトップアプリ)を持ち、記録した各ステップは
 * どの対象に対する操作かを targetId で識別する。
 */

export type TargetKind = 'web' | 'desktop'

export interface TestTarget {
  id: string
  kind: TargetKind
  /** タブ表示用のラベル */
  label: string
  /** web: 対象URL */
  url?: string
  /** desktop: 実行ファイルパス */
  exePath?: string
  /** desktop: 実行ファイルの起動引数 */
  exeArgs?: string
}

export type StepType = 'click' | 'dblclick' | 'input' | 'navigate' | 'keypress' | 'wait' | 'scroll'

export interface RecordedStep {
  id: string
  /** このステップがどの対象(TestTarget.id)に対する操作か */
  targetId: string
  type: StepType
  timestamp: number
  /** 前ステップからの待機時間(ms)。再生時のタイミング再現に使用 */
  delayMs: number

  // --- web 対象用 ---
  /** CSSセレクタ */
  selector?: string
  /** input系ステップの入力値 */
  value?: string
  /** navigate系ステップの遷移先URL */
  url?: string
  /** クリック位置のページ内相対座標(デバッグ・フォールバック用) */
  pageX?: number
  pageY?: number

  // --- desktop 対象用 ---
  /** 対象ウィンドウ左上を基準とした相対座標 */
  winX?: number
  winY?: number
  /** キー入力 (keypress時) */
  key?: string

  /** UI表示用の説明ラベル */
  label?: string
}

export interface TestCase {
  id: string
  name: string
  targets: TestTarget[]
  steps: RecordedStep[]
  createdAt: string
  updatedAt: string
}

export type StepStatus = 'pending' | 'running' | 'ok' | 'fail' | 'skipped'

export interface PlaybackProgress {
  stepIndex: number
  status: StepStatus
  message?: string
  /** このステップの実行時点でアクティブな対象 */
  targetId?: string
}

export interface PlaybackResult {
  success: boolean
  finishedAt: string
  log: PlaybackProgress[]
}

/** レンダラーのビューポート要素(埋め込み表示領域)の画面内での位置とサイズ */
export interface ViewportRect {
  x: number
  y: number
  width: number
  height: number
  /** window.devicePixelRatio。デスクトップ埋め込みの物理ピクセル変換に使用 */
  scaleFactor: number
}

/** 対象アダプタ(Web用/デスクトップ用)が共通で実装するインターフェース */
export interface TargetAdapter {
  /** 対象を起動し、ビューポート領域に埋め込む */
  init(viewport: ViewportRect): Promise<void>
  /** このターゲットを表示状態(アクティブ)にするかどうかを切り替える */
  setActive(active: boolean, viewport: ViewportRect): Promise<void>
  /** ビューポートのサイズ・位置が変わった際に呼ばれる */
  updateViewport(viewport: ViewportRect): Promise<void>
  /** 記録を開始する。アクティブな間に発生した操作を onStep に渡す */
  startRecording(onStep: (step: Omit<RecordedStep, 'id' | 'targetId' | 'timestamp' | 'delayMs'>) => void): Promise<void>
  /** 記録を停止する */
  stopRecording(): Promise<void>
  /** 1ステップを再生する。speedは再生速度倍率(1=等速、2=2倍速など) */
  execStep(step: RecordedStep, speed: number): Promise<void>
  /** 対象を破棄する(プロセス終了・ビュー削除など) */
  dispose(): Promise<void>
}

/** renderer <-> main の IPC チャンネル名 */
export const IPC = {
  listTests: 'tests:list',
  saveTest: 'tests:save',
  deleteTest: 'tests:delete',
  renameTest: 'tests:rename',

  pickExecutable: 'dialog:pickExecutable',

  viewportUpdate: 'viewport:update',

  recordingStart: 'recording:start',
  recordingStop: 'recording:stop',
  recordingSetActiveTarget: 'recording:setActiveTarget',
  recordingStep: 'recording:step', // main -> renderer push

  playbackRun: 'playback:run',
  playbackAbort: 'playback:abort',
  playbackProgress: 'playback:progress' // main -> renderer push
} as const
