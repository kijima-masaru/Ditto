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
  /**
   * click/dblclick時、クリック位置を中心に記録した小さな画像(base64 PNG data URI)。
   * 再生時はこの画像を期待座標付近で画像認識マッチングし、UIのレイアウトが多少
   * ずれていてもクリック位置を補正する。マッチに失敗した場合はwinX/winYの座標に
   * フォールバックする
   */
  targetImage?: string

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

/** 録画枠フッターのボタン操作。'screenshot'は静止画1枚を撮影する(録画状態には遷移しない) */
export type RecordingFrameFooterAction = 'start' | 'pause' | 'resume' | 'stop' | 'screenshot'

export type ClipboardEntryType = 'text' | 'image'

/** クリップボード履歴の1件(PC上でコピーされたテキスト/画像を自動記録) */
export interface ClipboardHistoryEntry {
  id: string
  type: ClipboardEntryType
  /** type:'text'の場合のみ有効 */
  text: string
  /** type:'image'の場合のみ有効。data URL(PNG) */
  imageDataUrl?: string
  /**
   * type:'image'の場合、OCRで認識したテキスト(履歴検索用)。OCRは非同期で行うため、
   * コピー直後の一瞬は未設定のことがある
   */
  ocrText?: string
  copiedAt: string
}

/**
 * クリップボードにコピーされたテキストへ自動的に適用する整形・置換ルール。
 * enabledなもの全てが登録順(order昇順)に、上から順にコピーの都度自動適用される
 * (実際にコピーされた内容自体を書き換え、履歴にもその結果を保存する)
 */
export interface ClipboardFormatRule {
  id: string
  label?: string
  /** 検索文字列。isRegexがtrueの場合は正規表現として解釈する */
  find: string
  isRegex: boolean
  replace: string
  enabled: boolean
  /** 適用順(昇順)。ドラッグ&ドロップで並び替えた結果を保持する */
  order: number
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

/** ネストしたフォルダプレビューを別ウィンドウで開く際、どちらのデータを見せるか */
export type PreviewKind = 'test' | 'clipboard'

/**
 * ホットキー押下時にジャンプする遷移先。未設定(null)ならウィンドウ表示のみでジャンプしない。
 * kindが'test'/'clipboard'ならタブ+フォルダへのジャンプ、'recording-frame'なら録画枠オーバーレイの表示を意味する
 */
export type NavigationTarget = { kind: PreviewKind; folderId: string | null } | { kind: 'recording-frame' }

/**
 * 「ホットキー」+「押した時にジャンプする画面」の組み合わせ1件。設定画面でこれを
 * 複数登録でき(旧: 単一のウィンドウ表示ホットキー+単一のトップページ設定を一般化したもの)、
 * 押された時にウィンドウを表示した上でtargetへジャンプする(targetがnullならウィンドウ表示のみ)。
 */
export interface HotkeyBinding {
  id: string
  hotkey: HotkeyCombo
  target: NavigationTarget | null
}

/** 自動マスキング対象のPII種別。項目ごとに個別にON/OFFを切り替えられる */
export type AutoMaskCategory = 'phone' | 'postalCode' | 'email' | 'creditCard'

export type AutoMaskSettings = Record<AutoMaskCategory, boolean>

/**
 * スクリーンショット・失敗時エビデンス画像の保存前にOCRで文字を検出し、電話番号・郵便番号・
 * メールアドレス・クレジットカード番号らしき箇所を自動で黒塗りする機能の設定。
 * enabledは機能全体のON/OFF(OFFなら各カテゴリの選択状態を保ったまま処理自体を行わない)、
 * categoriesは項目ごとの検出対象の選択状態
 */
export interface ScreenshotMaskSettings {
  enabled: boolean
  categories: AutoMaskSettings
}

/**
 * クリップボード履歴に機密情報らしき内容が記録される前の保護動作。
 * mask: 該当箇所を*に置き換えて履歴に保存する(実際にコピーされた内容自体は変更しない)
 * delete: 履歴に保存しない(画像の場合はOCRで検出でき次第、既に追加された履歴からも削除する)
 */
export type ClipboardPiiProtectionMode = 'mask' | 'delete'

export interface ClipboardPiiProtectionSettings {
  enabled: boolean
  mode: ClipboardPiiProtectionMode
  categories: AutoMaskSettings
}

export interface AppSettings {
  /** 「ホットキー→遷移先画面」の組み合わせのリスト。mainプロセスがこの数だけグローバルホットキーを登録する */
  hotkeyBindings: HotkeyBinding[]
  theme: ThemeMode
  /** trueならウィンドウのリサイズ・最大化を禁止し、現在の大きさに固定する */
  windowSizeLocked: boolean
  /** trueならDittoのウィンドウを常に他のアプリより前面に表示する */
  alwaysOnTop: boolean
  /** スクリーンショット・失敗時エビデンス画像に対する機密情報の自動黒塗り設定 */
  autoMaskSensitiveInfo: ScreenshotMaskSettings
  /** クリップボード履歴に対する機密情報の自動マスキング・自動消去設定 */
  clipboardPiiProtection: ClipboardPiiProtectionSettings
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
  /** ステップ失敗時に自動保存されたエビデンス画像のファイルパス(取得できなければ未設定) */
  evidencePath?: string
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

  // 枠内のスクリーンショット撮影(静止画1枚をキャプチャし、確認・注釈編集後に保存する)
  screenshotSave: 'screenshot:save',

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
  copyImageToClipboard: 'clipboard:copy-image',
  showClipboardHistoryMenu: 'clipboard:show-history-menu',
  showClipboardImageHistoryMenu: 'clipboard:show-image-history-menu',
  clipboardDataChanged: 'clipboard:data-changed', // main -> renderer push

  listClipboardTemplateFolders: 'clipboard:list-template-folders',
  createClipboardTemplateFolder: 'clipboard:create-template-folder',
  renameClipboardTemplateFolder: 'clipboard:rename-template-folder',
  deleteClipboardTemplateFolder: 'clipboard:delete-template-folder',
  reorderClipboardTemplateFolders: 'clipboard:reorder-template-folders',

  // コピー内容へ自動適用する整形・置換ルール
  listClipboardFormatRules: 'clipboard:list-format-rules',
  createClipboardFormatRule: 'clipboard:create-format-rule',
  updateClipboardFormatRule: 'clipboard:update-format-rule',
  setClipboardFormatRuleEnabled: 'clipboard:set-format-rule-enabled',
  deleteClipboardFormatRule: 'clipboard:delete-format-rule',
  reorderClipboardFormatRules: 'clipboard:reorder-format-rules',

  // 汎用の右クリックメニュー(テスト一覧・定型文のフォルダ操作/移動サブメニュー等に使う)
  showContextMenu: 'context-menu:show',

  // アプリ設定(ホットキー・テーマ等)
  getSettings: 'settings:get',
  setHotkeyBindings: 'settings:set-hotkey-bindings',
  setTheme: 'settings:set-theme',
  setWindowSizeLocked: 'settings:set-window-size-locked',
  setAlwaysOnTop: 'settings:set-always-on-top',
  setAutoMaskEnabled: 'settings:set-auto-mask-enabled',
  setAutoMaskSensitiveInfo: 'settings:set-auto-mask-sensitive-info',
  setClipboardPiiProtectionEnabled: 'settings:set-clipboard-pii-protection-enabled',
  setClipboardPiiProtectionCategory: 'settings:set-clipboard-pii-protection-category',
  setClipboardPiiProtectionMode: 'settings:set-clipboard-pii-protection-mode',
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
  navigateToHotkeyTarget: 'window:navigate-to-hotkey-target', // main -> メインウィンドウ push(ホットキー表示時)

  // スクリーンショット確認・注釈編集用の別ウィンドウ(PC画面いっぱいに最大化して表示する)
  openScreenshotEditor: 'screenshot-editor:open', // メインウィンドウ -> main
  screenshotEditorImage: 'screenshot-editor:image', // main -> 編集ウィンドウ push
  notifyScreenshotSaved: 'screenshot-editor:notify-saved', // 編集ウィンドウ -> main
  screenshotEditorSaved: 'screenshot-editor:saved-push' // main -> メインウィンドウ push
} as const
