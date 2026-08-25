import { useCallback, useEffect, useRef, useState } from 'react'
import type { MacroCase, MacroTarget, ThemeMode } from '../../shared/types'
import TargetSelect from './components/TargetSelect'
import Recording from './components/Recording'
import MacroList from './components/MacroList'
import Playback from './components/Playback'
import ClipboardPanel from './components/ClipboardPanel'
import SettingsPanel from './components/SettingsPanel'
import PreviewWindowRoot from './components/PreviewWindowRoot'
import ScreenshotEditorWindowRoot from './components/ScreenshotEditorWindowRoot'
import CommandPaletteRoot from './components/CommandPaletteRoot'
import MacroPlaybackWindowRoot from './components/MacroPlaybackWindowRoot'
import { GearIcon } from './components/icons'
import { useScreenRecording } from './hooks/useScreenRecording'
import { useScreenshot } from './hooks/useScreenshot'

// ネストしたフォルダプレビュー用の別ウィンドウは、同じrenderer bundleを
// ?preview=1付きで読み込んで判別する(previewWindow.ts参照)
const isPreviewWindow = new URLSearchParams(window.location.search).get('preview') === '1'
// スクリーンショット確認・注釈編集用の別ウィンドウも同様に?screenshotEditor=1で判別する
// (screenshotEditorWindow.ts参照)
const isScreenshotEditorWindow = new URLSearchParams(window.location.search).get('screenshotEditor') === '1'
// コマンドパレット用の別ウィンドウも同様に?commandPalette=1で判別する(commandPalette.ts参照)
const isCommandPaletteWindow = new URLSearchParams(window.location.search).get('commandPalette') === '1'
// コマンドパレットで選んだマクロの再生専用の別ウィンドウも同様に?macroPlayback=1で判別する
// (macroPlaybackWindow.ts参照)
const isMacroPlaybackWindow = new URLSearchParams(window.location.search).get('macroPlayback') === '1'

type View = { name: 'macro-list' } | { name: 'clipboard' } | { name: 'settings' }

// マクロ作成(対象選択→記録)・再生は、それぞれ独立した画面ではなくマクロ一覧の上に
// 重ねるモーダルとして表示する(一覧を表示し続けたまま行える)。作成の2ステップは
// 同じモーダル内で内容を差し替えて進む(モーダルの開閉なしに遷移する)
type MacroModal =
  | { kind: 'select'; folderId: string | null }
  | { kind: 'recording'; targets: MacroTarget[]; folderId: string | null }
  | { kind: 'playback'; macroCase: MacroCase }
  | null

function formatElapsed(ms: number): string {
  const total = Math.floor(ms / 1000)
  const m = String(Math.floor(total / 60)).padStart(2, '0')
  const s = String(total % 60).padStart(2, '0')
  return `${m}:${s}`
}

export default function App(): React.JSX.Element {
  // ネストしたフォルダプレビュー用の別ウィンドウでは、通常のタブUIではなく
  // PreviewWindowRootだけを描画する(以降のフックは通常のメインウィンドウ専用)
  if (isPreviewWindow) return <PreviewWindowRoot />
  if (isScreenshotEditorWindow) return <ScreenshotEditorWindowRoot />
  if (isCommandPaletteWindow) return <CommandPaletteRoot />
  if (isMacroPlaybackWindow) return <MacroPlaybackWindowRoot />
  return <MainApp />
}

function MainApp(): React.JSX.Element {
  const [view, setView] = useState<View>({ name: 'clipboard' })
  const [macroModal, setMacroModal] = useState<MacroModal>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const [theme, setTheme] = useState<ThemeMode>('light')
  // 設定画面で登録したホットキーの遷移先(タブ+フォルダ)へジャンプするための状態。
  // topPageNonceが変わるたびにClipboardPanel/MacroListをkey経由で強制的に作り直し、
  // その時点のtopPageFolderIdを初期フォルダとして渡す(通常のタブ切替では変化しないため
  // 手動ナビゲーション中の状態を壊さない)
  const [topPageFolderId, setTopPageFolderId] = useState<string | null>(null)
  const [topPageNonce, setTopPageNonce] = useState(0)
  const recorder = useScreenRecording()
  const screenshot = useScreenshot()
  const [screenshotSavedPath, setScreenshotSavedPath] = useState<string | null>(null)

  useEffect(() => {
    window.api.getSettings().then((s) => setTheme(s.theme))
  }, [])

  useEffect(() => {
    return window.api.onNavigateToHotkeyTarget((target) => {
      if (target.kind === 'recording-frame') {
        void recorder.showFrame()
        return
      }
      setTopPageFolderId(target.folderId)
      setTopPageNonce((n) => n + 1)
      if (target.kind === 'clipboard') setView({ name: 'clipboard' })
      else setView({ name: 'macro-list' })
    })
  }, [recorder.showFrame])

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  // 録画枠(オーバーレイウィンドウ)のフッターボタンは、実際のキャプチャ処理を持つ
  // このウィンドウのuseScreenRecordingに操作を中継する形で動く(マクロ機能とは独立)
  useEffect(() => {
    return window.api.onRecordingFrameFooterAction((action) => {
      if (action === 'start') recorder.start('画面録画')
      else if (action === 'pause') recorder.pause()
      else if (action === 'resume') recorder.resume()
      else if (action === 'stop') recorder.stop()
      else if (action === 'screenshot') screenshot.capture()
    })
  }, [recorder.start, recorder.pause, recorder.resume, recorder.stop, screenshot.capture])

  useEffect(() => {
    window.api.setRecordingFrameFooterState(recorder.recordingState)
  }, [recorder.recordingState])

  useEffect(() => {
    return window.api.onScreenshotEditorSaved((path) => setScreenshotSavedPath(path))
  }, [])

  // マクロ作成モーダルを閉じるだけ(一覧はモーダルの下に表示され続けているので画面遷移は不要)
  const closeMacroModal = useCallback(() => {
    setMacroModal(null)
  }, [])

  // 保存完了時は一覧を作り直した上でモーダルを閉じる
  const closeMacroModalAndRefresh = useCallback(() => {
    setRefreshKey((k) => k + 1)
    setMacroModal(null)
  }, [])

  // モーダルはヘッダー・フォルダ階層と被らないようにするため、overlay自体は
  // それらの上には描画されない(macro-modal-overlayのtop offset参照)。そのため
  // クリックを閉じる判定はoverlayのonClickだけでは不十分で、モーダル本体の外側を
  // クリックした場合は document 側で拾って閉じる(ヘッダー・フォルダ階層クリックも含む)
  const macroModalRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!macroModal) return
    const handlePointerDown = (e: MouseEvent): void => {
      if (macroModalRef.current && !macroModalRef.current.contains(e.target as Node)) {
        closeMacroModal()
      }
    }
    document.addEventListener('mousedown', handlePointerDown)
    return () => document.removeEventListener('mousedown', handlePointerDown)
  }, [macroModal, closeMacroModal])

  return (
    <div className="app">
      <video ref={recorder.videoRef} className="offscreen-media" muted playsInline />
      <canvas ref={recorder.canvasRef} className="offscreen-media" />
      <video ref={screenshot.videoRef} className="offscreen-media" muted playsInline />
      <canvas ref={screenshot.canvasRef} className="offscreen-media" />

      <header className="app-header">
        <nav>
          <button className={view.name === 'clipboard' ? 'active' : ''} onClick={() => setView({ name: 'clipboard' })}>
            クリップボード
          </button>
          <button className={view.name === 'macro-list' ? 'active' : ''} onClick={() => setView({ name: 'macro-list' })}>
            マクロ
          </button>
        </nav>
        <button
          className={`record-icon-btn${recorder.frameVisible ? ' active' : ''}`}
          onClick={recorder.toggleFrame}
          title="録画枠を表示/非表示"
        >
          <span className="record-icon-glyph">◎</span>
        </button>
        <button
          className={`settings-icon-btn${view.name === 'settings' ? ' active' : ''}`}
          onClick={() => setView({ name: 'settings' })}
          title="設定"
        >
          <GearIcon />
        </button>
      </header>

      {recorder.recordingState !== 'idle' && (
        <div className="recording-bar">
          <span className="recording-dot" />
          <span>{recorder.recordingState === 'paused' ? '一時停止中' : '画面録画中'}</span>
          <span className="recording-time">{formatElapsed(recorder.elapsedMs)}</span>
          <div className="recording-bar-actions">
            {recorder.recordingState === 'recording' && <button onClick={recorder.pause}>一時停止</button>}
            {recorder.recordingState === 'paused' && <button onClick={recorder.resume}>再開</button>}
            <button className="danger" onClick={recorder.stop}>
              録画停止
            </button>
          </div>
        </div>
      )}

      {recorder.savedPath && recorder.recordingState === 'idle' && (
        <div className="recording-saved">
          <span>保存しました: {recorder.savedPath.split(/[\\/]/).pop()}</span>
          <button onClick={() => window.api.openRecordingFolder(recorder.savedPath as string)}>
            フォルダを開く
          </button>
          <button onClick={recorder.dismissSaved}>閉じる</button>
        </div>
      )}

      {recorder.errorMessage && (
        <div className="error recording-error">
          録画エラー: {recorder.errorMessage}
          <button onClick={recorder.dismissSaved}>閉じる</button>
        </div>
      )}

      {screenshotSavedPath && (
        <div className="recording-saved">
          <span>スクリーンショットを保存しました: {screenshotSavedPath.split(/[\\/]/).pop()}</span>
          <button onClick={() => window.api.openRecordingFolder(screenshotSavedPath)}>フォルダを開く</button>
          <button onClick={() => setScreenshotSavedPath(null)}>閉じる</button>
        </div>
      )}

      {screenshot.errorMessage && (
        <div className="error recording-error">
          スクリーンショットエラー: {screenshot.errorMessage}
          <button onClick={screenshot.dismissError}>閉じる</button>
        </div>
      )}

      <main className="app-main">
        {view.name === 'macro-list' && (
          <MacroList
            key={`${refreshKey}-${topPageNonce}`}
            initialFolderId={topPageFolderId}
            onRun={(macroCase) => setMacroModal({ kind: 'playback', macroCase })}
            onCreateMacro={(folderId) => setMacroModal({ kind: 'select', folderId })}
          />
        )}

        {view.name === 'clipboard' && (
          <ClipboardPanel
            key={topPageNonce}
            initialFolderId={topPageFolderId}
            initialSubTab={topPageNonce > 0 ? 'templates' : undefined}
          />
        )}

        {view.name === 'settings' && <SettingsPanel theme={theme} onThemeChange={setTheme} />}
      </main>

      {macroModal && (
        <div className="macro-modal-overlay">
          <div className="macro-modal" ref={macroModalRef}>
            {macroModal.kind === 'select' && (
              <TargetSelect
                onStart={(targets) => setMacroModal({ kind: 'recording', targets, folderId: macroModal.folderId })}
              />
            )}
            {macroModal.kind === 'recording' && (
              <Recording
                targets={macroModal.targets}
                folderId={macroModal.folderId}
                onDone={closeMacroModalAndRefresh}
                onCancel={closeMacroModal}
              />
            )}
            {macroModal.kind === 'playback' && <Playback macroCase={macroModal.macroCase} />}
          </div>
        </div>
      )}
    </div>
  )
}
