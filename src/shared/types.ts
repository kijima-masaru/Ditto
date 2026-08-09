/**
 * アプリ全体で共有する型定義。
 * Web用エンジン・デスクトップ用エンジンはどちらもこのインターフェースを実装する。
 */

export type TargetType = 'web' | 'desktop'

export type StepType =
  | 'click'
  | 'dblclick'
  | 'input'
  | 'navigate'
  | 'keypress'
  | 'wait'
  | 'scroll'

export interface RecordedStep {
  id: string
  type: StepType
  timestamp: number
  /** 前ステップからの待機時間(ms)。再生時のタイミング再現に使用 */
  delayMs: number

  // --- web 用 (targetType === 'web') ---
  /** CSSセレクタ (Playwrightのplaywright-generated selectorを想定) */
  selector?: string
  /** input系ステップの入力値 */
  value?: string
  /** navigate系ステップの遷移先URL */
  url?: string
  /** クリック位置のページ内相対座標(デバッグ・フォールバック用) */
  pageX?: number
  pageY?: number

  // --- desktop 用 (targetType === 'desktop') ---
  /** 対象ウィンドウ左上を基準とした相対座標 */
  winX?: number
  winY?: number
  /** キー入力 (keypress時) */
  key?: string
  /** 記録時の対象ウィンドウタイトル(参考情報) */
  windowTitle?: string

  /** 再生失敗時など、ステップの説明用ラベル(UI表示用) */
  label?: string
}

export interface TestCase {
  id: string
  name: string
  targetType: TargetType
  /** web: URL / desktop: 実行ファイルパスまたは既存ウィンドウ検索用のプロセス名 */
  target: string
  /** desktop用: 実行ファイルの引数 */
  targetArgs?: string
  steps: RecordedStep[]
  createdAt: string
  updatedAt: string
}

export type StepStatus = 'pending' | 'running' | 'ok' | 'fail' | 'skipped'

export interface PlaybackProgress {
  stepIndex: number
  status: StepStatus
  message?: string
}

export interface PlaybackResult {
  success: boolean
  finishedAt: string
  log: PlaybackProgress[]
}

export interface RecorderEngine {
  /** 記録対象を起動し、イベント監視を開始する */
  start(target: string, targetArgs: string | undefined, onStep: (step: RecordedStep) => void): Promise<void>
  /** 記録を停止し、対象を閉じる */
  stop(): Promise<void>
}

export interface PlayerEngine {
  /** 記録済みテストケースを再生する */
  run(testCase: TestCase, onProgress: (progress: PlaybackProgress) => void): Promise<PlaybackResult>
  /** 再生中であれば中断する */
  abort(): Promise<void>
}

/** renderer <-> main の IPC チャンネル名 */
export const IPC = {
  listTests: 'tests:list',
  saveTest: 'tests:save',
  deleteTest: 'tests:delete',
  renameTest: 'tests:rename',

  recordingStart: 'recording:start',
  recordingStop: 'recording:stop',
  recordingStep: 'recording:step', // main -> renderer push
  recordingError: 'recording:error', // main -> renderer push

  playbackRun: 'playback:run',
  playbackAbort: 'playback:abort',
  playbackProgress: 'playback:progress', // main -> renderer push

  pickExecutable: 'dialog:pickExecutable'
} as const
