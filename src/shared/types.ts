/**
 * アプリ全体で共有する型定義。
 * 1つのテストは複数の対象(WEBアプリ/デスクトップアプリ)を持ち、記録した各ステップは
 * どの対象に対する操作かを targetId で識別する。
 *
 * WEBアプリ対象もデスクトップアプリ対象も、実体は「OS上の1つのウィンドウ」として
 * 同じ方式(グローバルフックでの座標/キー記録、タブ切り替え時に最前面表示/最小化)で
 * 扱う。WEBアプリをこのアプリ内に埋め込んで表示する方式は、ログインページ等で
 * パスワードをこのアプリの管理下にあるページに入力させることになり適切でないため
 * 採用していない。URLはユーザー自身の既定ブラウザで開かれ、そのブラウザ上での
 * 操作をあくまで外部ウィンドウとして記録する。
 */

export type TargetKind = 'web' | 'desktop'

export interface TestTarget {
  id: string
  kind: TargetKind
  /** タブ表示用のラベル */
  label: string
  /** web: 対象URL(ユーザーの既定ブラウザで開く) */
  url?: string
  /** desktop: 実行ファイルパス */
  exePath?: string
  /** desktop: 実行ファイルの起動引数 */
  exeArgs?: string
}

export type StepType = 'click' | 'dblclick' | 'keypress'

export interface RecordedStep {
  id: string
  /** このステップがどの対象(TestTarget.id)に対する操作か */
  targetId: string
  type: StepType
  timestamp: number
  /** 前ステップからの実際の経過時間(ms)。再生時にそのまま同じ間隔を空けて再現する */
  delayMs: number

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
  /** 最後に実行(再生)した日時。一度も実行していなければ未設定 */
  lastRunAt?: string
  /** 所属フォルダ(TestFolder.id)。未設定/nullはルート直下 */
  folderId?: string | null
}

/** テスト一覧を整理するための階層フォルダ */
export interface TestFolder {
  id: string
  name: string
  /** 親フォルダのid。nullはルート直下 */
  parentId: string | null
}

/** 画面録画用の枠(画面上に表示する赤枠)の位置・サイズ。OSのスクリーン座標(DIP)基準 */
export interface RecordingFrameBounds {
  x: number
  y: number
  width: number
  height: number
}

/** 録画枠の位置情報から、実際の画面キャプチャに必要な情報を導出したもの */
export interface CaptureInfo {
  bounds: RecordingFrameBounds
  /** desktopCapturerのソースと突き合わせるための対象ディスプレイID */
  displayId: string
  /** HiDPI環境でのスケール係数。キャプチャした映像は物理ピクセル基準になるため座標変換に使う */
  scaleFactor: number
  displayBounds: { x: number; y: number; width: number; height: number }
}

/** クリップボード履歴の1件(PC上でコピーされたテキストを自動記録) */
export interface ClipboardHistoryEntry {
  id: string
  text: string
  copiedAt: string
}

/** ユーザーが登録した定型文 */
export interface ClipboardTemplate {
  id: string
  text: string
  label?: string
  createdAt: string
  /** 所属フォルダ(ClipboardTemplateFolder.id)。未設定/nullはルート直下 */
  folderId?: string | null
}

/** 定型文を整理するための階層フォルダ */
export interface ClipboardTemplateFolder {
  id: string
  name: string
  /** 親フォルダのid。nullはルート直下 */
  parentId: string | null
}

/**
 * 汎用のネイティブ右クリックメニュー記述。rendererが内容を組み立て、mainがElectronの
 * Menu.popup()で表示する。選択された項目のidを返し、何も選ばれなければnullを返す。
 */
export interface ContextMenuItem {
  id: string
  label?: string
  type?: 'separator'
  enabled?: boolean
  submenu?: ContextMenuItem[]
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

/** 対象アダプタ(WEBアプリ用/デスクトップアプリ用)が共通で実装するインターフェース */
export interface TargetAdapter {
  /** 対象を起動する(デスクトップ: プロセス起動 / web: 既定ブラウザでURLを開く) */
  init(): Promise<void>
  /** このターゲットを表示状態(アクティブ)にするかどうかを切り替える(最前面表示/最小化) */
  setActive(active: boolean): Promise<void>
  /** 記録を開始する。アクティブな間に発生した操作を onStep に渡す */
  startRecording(onStep: (step: Omit<RecordedStep, 'id' | 'targetId' | 'timestamp' | 'delayMs'>) => void): Promise<void>
  /** 記録を停止する */
  stopRecording(): Promise<void>
  /** 1ステップの操作(クリック/キー入力)を再生する。ステップ間の待機はTargetManager側で行う */
  execStep(step: RecordedStep): Promise<void>
  /** 対象を破棄する(デスクトップ: プロセス終了。web: ユーザーのブラウザなので何もしない) */
  dispose(): Promise<void>
}

/** renderer <-> main の IPC チャンネル名 */
export const IPC = {
  listTests: 'tests:list',
  saveTest: 'tests:save',
  deleteTest: 'tests:delete',
  renameTest: 'tests:rename',
  moveTest: 'tests:move',

  listFolders: 'folders:list',
  createFolder: 'folders:create',
  renameFolder: 'folders:rename',
  deleteFolder: 'folders:delete',

  pickExecutable: 'dialog:pickExecutable',

  recordingStart: 'recording:start',
  recordingStop: 'recording:stop',
  recordingSetActiveTarget: 'recording:setActiveTarget',
  recordingSetPaused: 'recording:setPaused',
  recordingStep: 'recording:step', // main -> renderer push

  playbackRun: 'playback:run',
  playbackAbort: 'playback:abort',
  playbackProgress: 'playback:progress', // main -> renderer push

  // 画面上に表示する録画範囲の枠(オーバーレイウィンドウ)
  recordingFrameShow: 'recording-frame:show',
  recordingFrameHide: 'recording-frame:hide',
  recordingFrameIsVisible: 'recording-frame:is-visible',
  recordingFrameGetBounds: 'recording-frame:get-bounds',
  recordingFrameSetSize: 'recording-frame:set-size',
  recordingFrameGetCaptureInfo: 'recording-frame:get-capture-info',

  // 枠内の画面録画(実際のキャプチャ・エンコードはrenderer側、ファイル書き出しはmain側)
  getDesktopSources: 'screen-recording:get-sources',
  screenRecordingStart: 'screen-recording:start',
  screenRecordingAppendChunk: 'screen-recording:append-chunk',
  screenRecordingFinish: 'screen-recording:finish',
  screenRecordingOpenFolder: 'screen-recording:open-folder',

  // クリップボード管理(履歴はバックグラウンドで自動記録、定型文はユーザーが登録)
  listClipboardHistory: 'clipboard:list-history',
  deleteClipboardHistoryEntry: 'clipboard:delete-history-entry',
  clearClipboardHistory: 'clipboard:clear-history',
  listClipboardTemplates: 'clipboard:list-templates',
  createClipboardTemplate: 'clipboard:create-template',
  updateClipboardTemplate: 'clipboard:update-template',
  deleteClipboardTemplate: 'clipboard:delete-template',
  moveClipboardTemplate: 'clipboard:move-template',
  copyToClipboard: 'clipboard:copy',
  showClipboardHistoryMenu: 'clipboard:show-history-menu',
  clipboardDataChanged: 'clipboard:data-changed', // main -> renderer push

  listClipboardTemplateFolders: 'clipboard:list-template-folders',
  createClipboardTemplateFolder: 'clipboard:create-template-folder',
  renameClipboardTemplateFolder: 'clipboard:rename-template-folder',
  deleteClipboardTemplateFolder: 'clipboard:delete-template-folder',

  // 汎用の右クリックメニュー(テスト一覧・定型文のフォルダ操作/移動サブメニュー等に使う)
  showContextMenu: 'context-menu:show'
} as const
