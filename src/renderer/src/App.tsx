import { useCallback, useState } from 'react'
import type { TestCase, TestTarget } from '../../shared/types'
import TargetSelect from './components/TargetSelect'
import Recording from './components/Recording'
import TestList from './components/TestList'
import Playback from './components/Playback'
import ClipboardPanel from './components/ClipboardPanel'
import { useScreenRecording } from './hooks/useScreenRecording'

type View =
  | { name: 'target-select' }
  | { name: 'recording'; targets: TestTarget[] }
  | { name: 'test-list' }
  | { name: 'playback'; testCase: TestCase }
  | { name: 'clipboard' }

function formatElapsed(ms: number): string {
  const total = Math.floor(ms / 1000)
  const m = String(Math.floor(total / 60)).padStart(2, '0')
  const s = String(total % 60).padStart(2, '0')
  return `${m}:${s}`
}

export default function App(): React.JSX.Element {
  const [view, setView] = useState<View>({ name: 'test-list' })
  const [refreshKey, setRefreshKey] = useState(0)
  const recorder = useScreenRecording()

  const goHome = useCallback(() => {
    setRefreshKey((k) => k + 1)
    setView({ name: 'test-list' })
  }, [])

  const isWorkspace = view.name === 'recording' || view.name === 'playback'

  return (
    <div className="app">
      <video ref={recorder.videoRef} className="offscreen-media" muted playsInline />
      <canvas ref={recorder.canvasRef} className="offscreen-media" />

      <header className="app-header">
        <nav>
          <button
            className={view.name === 'test-list' ? 'active' : ''}
            onClick={() => setView({ name: 'test-list' })}
          >
            テスト一覧
          </button>
          <button
            className={view.name === 'target-select' ? 'active' : ''}
            onClick={() => setView({ name: 'target-select' })}
          >
            新規録画
          </button>
          <button
            className={view.name === 'clipboard' ? 'active' : ''}
            onClick={() => setView({ name: 'clipboard' })}
          >
            クリップボード
          </button>
        </nav>
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

      <main className={`app-main${isWorkspace ? ' app-main--workspace' : ''}`}>
        {view.name === 'target-select' && (
          <TargetSelect onStart={(targets) => setView({ name: 'recording', targets })} />
        )}

        {view.name === 'recording' && <Recording targets={view.targets} onDone={goHome} onCancel={goHome} />}

        {view.name === 'test-list' && (
          <TestList key={refreshKey} onRun={(testCase) => setView({ name: 'playback', testCase })} />
        )}

        {view.name === 'playback' && <Playback testCase={view.testCase} onDone={goHome} recorder={recorder} />}

        {view.name === 'clipboard' && <ClipboardPanel />}
      </main>
    </div>
  )
}
