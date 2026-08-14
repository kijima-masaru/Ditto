import { useCallback, useEffect, useState } from 'react'
import type { TestCase, TestTarget, ThemeMode } from '../../shared/types'
import TargetSelect from './components/TargetSelect'
import Recording from './components/Recording'
import TestList from './components/TestList'
import Playback from './components/Playback'
import ClipboardPanel from './components/ClipboardPanel'
import SettingsPanel from './components/SettingsPanel'
import PreviewWindowRoot from './components/PreviewWindowRoot'
import ScreenshotEditorWindowRoot from './components/ScreenshotEditorWindowRoot'
import { useScreenRecording } from './hooks/useScreenRecording'
import { useScreenshot } from './hooks/useScreenshot'

// ネストしたフォルダプレビュー用の別ウィンドウは、同じrenderer bundleを
// ?preview=1付きで読み込んで判別する(previewWindow.ts参照)
const isPreviewWindow = new URLSearchParams(window.location.search).get('preview') === '1'
// スクリーンショット確認・注釈編集用の別ウィンドウも同様に?screenshotEditor=1で判別する
// (screenshotEditorWindow.ts参照)
const isScreenshotEditorWindow = new URLSearchParams(window.location.search).get('screenshotEditor') === '1'

type View =
  | { name: 'target-select'; folderId: string | null }
  | { name: 'recording'; targets: TestTarget[]; folderId: string | null }
  | { name: 'test-list' }
  | { name: 'playback'; testCase: TestCase }
  | { name: 'clipboard' }
  | { name: 'settings' }

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
  return <MainApp />
}

function MainApp(): React.JSX.Element {
  const [view, setView] = useState<View>({ name: 'clipboard' })
  const [refreshKey, setRefreshKey] = useState(0)
  const [theme, setTheme] = useState<ThemeMode>('light')
  // 設定画面で登録したホットキーの遷移先(タブ+フォルダ)へジャンプするための状態。
  // topPageNonceが変わるたびにClipboardPanel/TestListをkey経由で強制的に作り直し、
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
    return window.api.onNavigateToHotkeyTarget(({ kind, folderId }) => {
      setTopPageFolderId(folderId)
      setTopPageNonce((n) => n + 1)
      if (kind === 'clipboard') setView({ name: 'clipboard' })
      else setView({ name: 'test-list' })
    })
  }, [])

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  // 録画枠(オーバーレイウィンドウ)のフッターボタンは、実際のキャプチャ処理を持つ
  // このウィンドウのuseScreenRecordingに操作を中継する形で動く(テスト機能とは独立)
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

  const goHome = useCallback(() => {
    setRefreshKey((k) => k + 1)
    setView({ name: 'test-list' })
  }, [])

  const isWorkspace = view.name === 'recording' || view.name === 'playback'

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
          <button className={view.name === 'test-list' ? 'active' : ''} onClick={() => setView({ name: 'test-list' })}>
            テスト
          </button>
        </nav>
        <button
          className={`record-icon-btn${recorder.frameVisible ? ' active' : ''}`}
          onClick={recorder.toggleFrame}
          title="録画枠を表示/非表示"
        >
          ◎
        </button>
        <button
          className={`settings-icon-btn${view.name === 'settings' ? ' active' : ''}`}
          onClick={() => setView({ name: 'settings' })}
          title="設定"
        >
          ⚙
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

      <main className={`app-main${isWorkspace ? ' app-main--workspace' : ''}`}>
        {view.name === 'target-select' && (
          <TargetSelect onStart={(targets) => setView({ name: 'recording', targets, folderId: view.folderId })} />
        )}

        {view.name === 'recording' && (
          <Recording targets={view.targets} folderId={view.folderId} onDone={goHome} onCancel={goHome} />
        )}

        {view.name === 'test-list' && (
          <TestList
            key={`${refreshKey}-${topPageNonce}`}
            initialFolderId={topPageFolderId}
            onRun={(testCase) => setView({ name: 'playback', testCase })}
            onCreateTest={(folderId) => setView({ name: 'target-select', folderId })}
          />
        )}

        {view.name === 'playback' && <Playback testCase={view.testCase} onDone={goHome} />}

        {view.name === 'clipboard' && (
          <ClipboardPanel
            key={topPageNonce}
            initialFolderId={topPageFolderId}
            initialSubTab={topPageNonce > 0 ? 'templates' : undefined}
          />
        )}

        {view.name === 'settings' && <SettingsPanel theme={theme} onThemeChange={setTheme} />}
      </main>
    </div>
  )
}
