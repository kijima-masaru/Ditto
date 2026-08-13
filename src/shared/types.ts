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

/** テスト作成時に選択したアプリ・URLの履歴(再選択用) */
export interface TargetHistoryEntry {
  id: string
  kind: TargetKind
  label: string
  url?: string
  exePath?: string
  exeArgs?: string
  lastUsedAt: string
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
  /** 同じフォルダ内での並び順(昇順)。ドラッグ&ドロップで並び替えた結果を保持する */
  order: number
}

/** テスト一覧を整理するための階層フォルダ */
export interface TestFolder {
  id: string
  name: string
  /** 親フォルダのid。nullはルート直下 */
  parentId: string | null
  /** 同じ階層内での並び順(昇順)。ドラッグ&ドロップで並び替えた結果を保持する */
  order: number
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
  /** 同じフォルダ内での並び順(昇順)。ドラッグ&ドロップで並び替えた結果を保持する */
  order: number
}

/** 定型文を整理するための階層フォルダ */
export interface ClipboardTemplateFolder {
  id: string
  name: string
  /** 親フォルダのid。nullはルート直下 */
  parentId: string | null
  /** 同じ階層内での並び順(昇順)。ドラッグ&ドロップで並び替えた結果を保持する */
  order: number
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

/**
 * ウィンドウ表示ホットキー。keycodeがnullの場合は修飾キー(ctrl/shift/alt/metaのいずれか1つ)
 * 単体を素早く2回押すことで発火し、keycodeがある場合は修飾キーを押しながらそのキーを
 * 1回押すことで即座に発火する(通常のショートカットキーと同じ)。
 */
export interface HotkeyCombo {
  ctrl: boolean
  shift: boolean
  alt: boolean
  meta: boolean
  keycode: number | null
  /** 表示用ラベル(例: "Ctrl+Alt+D", "Ctrl 2回") */
  label: string
}

export type ThemeMode = 'light' | 'dark'

export interface AppSettings {
  hotkey: HotkeyCombo
  theme: ThemeMode
  /** ウィンドウ表示ホットキーでDittoを表示した際に開く画面。未設定(null)なら従来通り */
  topPage: TopPage | null
}

/** ネストしたフォルダプレビューを別ウィンドウで開く際、どちらのデータを見せるか */
export type PreviewKind = 'test' | 'clipboard'

/** 設定画面の「トップページ」。ホットキー表示時にジャンプする対象(タブ+フォルダ) */
export interface TopPage {
  kind: PreviewKind
  folderId: string | null
}

/** 設定画面の「アップデートを確認」ボタンの状態表示に使う */
export type UpdateStatus =
  | { state: 'checking' }
  | { state: 'available'; version: string }
  | { state: 'not-available' }
  | { state: 'downloading'; percent: number }
  | { state: 'downloaded'; version: string }
  | { state: 'error'; message: string }

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
  reorderTests: 'tests:reorder',

  listFolders: 'folders:list',
  createFolder: 'folders:create',
  renameFolder: 'folders:rename',
  deleteFolder: 'folders:delete',
  reorderFolders: 'folders:reorder',

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
  reorderClipboardTemplates: 'clipboard:reorder-templates',
  copyToClipboard: 'clipboard:copy',
  showClipboardHistoryMenu: 'clipboard:show-history-menu',
  clipboardDataChanged: 'clipboard:data-changed', // main -> renderer push

  listClipboardTemplateFolders: 'clipboard:list-template-folders',
  createClipboardTemplateFolder: 'clipboard:create-template-folder',
  renameClipboardTemplateFolder: 'clipboard:rename-template-folder',
  deleteClipboardTemplateFolder: 'clipboard:delete-template-folder',
  reorderClipboardTemplateFolders: 'clipboard:reorder-template-folders',

  // 汎用の右クリックメニュー(テスト一覧・定型文のフォルダ操作/移動サブメニュー等に使う)
  showContextMenu: 'context-menu:show',

  // アプリ設定(ホットキー・テーマ等)
  getSettings: 'settings:get',
  setHotkey: 'settings:set-hotkey',
  setTheme: 'settings:set-theme',
  setTopPage: 'settings:set-top-page',
  startHotkeyCapture: 'hotkey-capture:start',
  cancelHotkeyCapture: 'hotkey-capture:cancel',
  hotkeyCapturePreview: 'hotkey-capture:preview', // main -> renderer push
  hotkeyCaptureResult: 'hotkey-capture:result', // main -> renderer push

  // テスト作成時に選択したアプリ・URLの履歴
  listTargetHistory: 'target-history:list',
  recordTargetHistory: 'target-history:record',

  // 録画枠のフッターボタン(枠のオーバーレイウィンドウ)とメインウィンドウの録画状態を橋渡しする
  recordingFrameFooterAction: 'recording-frame:footer-action', // overlay -> main -> メインウィンドウ
  setRecordingFrameFooterState: 'recording-frame:set-footer-state', // メインウィンドウ -> main -> overlay
  // 枠のタイトルバーの閉じる/最小化ボタンで枠が非表示になったことをメインウィンドウへ知らせる
  recordingFrameVisibilityChanged: 'recording-frame:visibility-changed', // main -> renderer push

  // 設定画面のデバッグログ確認機能
  readDebugLog: 'debug-log:read',
  openDebugLogFolder: 'debug-log:open-folder',

  // 設定画面のバージョン表示・アップデート確認機能
  getAppVersion: 'app:get-version',
  checkForUpdates: 'update:check',
  updateStatus: 'update:status', // main -> renderer push

  // ネストしたフォルダプレビュー(メインウィンドウの外に別ウィンドウとして連鎖表示する)
  openPreviewWindow: 'preview-window:open',
  scheduleClosePreviewWindow: 'preview-window:schedule-close',
  isCursorOverPreviewWindow: 'preview-window:is-cursor-over',
  navigateToFolder: 'preview-window:navigate', // preview window -> main
  navigateToFolderPush: 'preview-window:navigate-push', // main -> メインウィンドウ push
  showTopPage: 'window:show-top-page' // main -> メインウィンドウ push(ホットキー表示時)
} as const
