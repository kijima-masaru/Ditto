import { useEffect, useState } from 'react'
import type { PlaybackProgress, TestCase } from '../../../shared/types'
import type { ScreenRecorderApi } from '../hooks/useScreenRecording'
import TargetTabs from './TargetTabs'

interface Props {
  testCase: TestCase
  onDone: () => void
  recorder: ScreenRecorderApi
}

export default function Playback({ testCase, onDone, recorder }: Props): React.JSX.Element {
  const [phase, setPhase] = useState<'idle' | 'running' | 'done'>('idle')
  const [progress, setProgress] = useState<PlaybackProgress[]>([])
  const [activeTargetId, setActiveTargetId] = useState<string>(testCase.targets[0]?.id ?? '')
  const [success, setSuccess] = useState<boolean | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [widthInput, setWidthInput] = useState(String(recorder.frameSize.width))
  const [heightInput, setHeightInput] = useState(String(recorder.frameSize.height))

  useEffect(() => {
    setWidthInput(String(recorder.frameSize.width))
    setHeightInput(String(recorder.frameSize.height))
  }, [recorder.frameSize.width, recorder.frameSize.height])

  const handleSizeApply = (): void => {
    const w = Number(widthInput)
    const h = Number(heightInput)
    if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
      recorder.applyFrameSize(w, h)
    }
  }

  const handleStart = async (): Promise<void> => {
    setPhase('running')
    setProgress([])
    setError(null)

    if (recorder.frameVisible && recorder.recordingState === 'idle') {
      await recorder.start(testCase.name)
    }

    const unsubscribe = window.api.onPlaybackProgress((p) => {
      setProgress((prev) => {
        const next = [...prev]
        next[p.stepIndex] = p
        return next
      })
      if (p.targetId) setActiveTargetId(p.targetId)
    })

    try {
      const result = await window.api.runPlayback(testCase)
      setSuccess(result.success)
    } catch (e) {
      setError((e as Error).message)
      setSuccess(false)
    } finally {
      setPhase('done')
      unsubscribe()
    }
  }

  const labelFor = (id?: string): string => testCase.targets.find((t) => t.id === id)?.label ?? ''

  return (
    <div className="workspace">
      <div className="workspace-header">
        <TargetTabs targets={testCase.targets} activeId={activeTargetId} onSelect={() => {}} disabled />
        <div className="row">
          {(phase === 'idle' || phase === 'done') && (
            <button className="primary" onClick={handleStart}>
              {phase === 'done' ? 'もう一度実行' : '再生を開始'}
            </button>
          )}
          {phase === 'running' && <span className="status-line">実行中...</span>}
          {phase === 'done' && (
            <span className="status-line">
              {success ? '完了しました' : `失敗しました${error ? ` (${error})` : ''}`}
            </span>
          )}
        </div>
      </div>

      <div className="recording-frame-panel">
        <button onClick={recorder.toggleFrame} disabled={recorder.recordingState !== 'idle'}>
          {recorder.frameVisible ? '録画枠を非表示' : '録画枠を表示'}
        </button>
        {recorder.frameVisible && (
          <div className="field--inline recording-frame-size">
            <label>幅</label>
            <input
              type="number"
              min={160}
              value={widthInput}
              disabled={recorder.recordingState !== 'idle'}
              onChange={(e) => setWidthInput(e.target.value)}
              onBlur={handleSizeApply}
            />
            <label>高さ</label>
            <input
              type="number"
              min={120}
              value={heightInput}
              disabled={recorder.recordingState !== 'idle'}
              onChange={(e) => setHeightInput(e.target.value)}
              onBlur={handleSizeApply}
            />
          </div>
        )}
        <p className="hint">
          {recorder.frameVisible
            ? '画面上に表示された赤枠の四隅をドラッグして位置とサイズを調整できます。再生を開始すると同時に枠内の録画が始まります(録画の停止・一時停止は再生とは別に操作できます)。'
            : '有効にすると画面上に録画範囲の赤枠が表示されます。再生開始と同時にその範囲の録画が始まります。'}
        </p>
      </div>

      <div className="notice-panel">
        <p>
          アクティブなタブの対象がOS上で最前面に表示され、そのウィンドウに対して操作を再生します。
          各操作の間隔は記録時に実際に空いていた時間をそのまま再現します。
        </p>
      </div>

      <div className="workspace-footer">
        <ol className="step-list">
          {testCase.steps.map((s, i) => {
            const p = progress[i]
            return (
              <li key={s.id} className={p ? `status-${p.status}` : ''}>
                <span className="step-type">{s.type}</span>
                <span className="step-detail">
                  {labelFor(s.targetId)}: {s.key ?? `(${s.winX},${s.winY})`}
                </span>
                {p?.message && <span className="step-message">{p.message}</span>}
              </li>
            )
          })}
        </ol>

        <button className="primary" onClick={onDone}>
          テスト一覧に戻る
        </button>
      </div>
    </div>
  )
}
