import { useRef, useState } from 'react'
import type { PlaybackProgress, TestCase } from '../../../shared/types'
import { reportViewport, watchViewport } from '../viewport'
import TargetTabs from './TargetTabs'

interface Props {
  testCase: TestCase
  onDone: () => void
}

const SPEED_OPTIONS = [0.25, 0.5, 1, 1.5, 2, 4]

export default function Playback({ testCase, onDone }: Props): React.JSX.Element {
  const [phase, setPhase] = useState<'idle' | 'running' | 'done'>('idle')
  const [speed, setSpeed] = useState(1)
  const [progress, setProgress] = useState<PlaybackProgress[]>([])
  const [activeTargetId, setActiveTargetId] = useState<string>(testCase.targets[0]?.id ?? '')
  const [success, setSuccess] = useState<boolean | null>(null)
  const [error, setError] = useState<string | null>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const stopWatchRef = useRef<() => void>(() => {})

  const handleStart = async (): Promise<void> => {
    setPhase('running')
    setProgress([])
    setError(null)

    const unsubscribe = window.api.onPlaybackProgress((p) => {
      setProgress((prev) => {
        const next = [...prev]
        next[p.stepIndex] = p
        return next
      })
      if (p.targetId) setActiveTargetId(p.targetId)
    })

    const el = viewportRef.current
    if (el) {
      await reportViewport(el)
      stopWatchRef.current = watchViewport(el)
    }

    try {
      const result = await window.api.runPlayback(testCase, speed)
      setSuccess(result.success)
    } catch (e) {
      setError((e as Error).message)
      setSuccess(false)
    } finally {
      setPhase('done')
      unsubscribe()
      stopWatchRef.current()
    }
  }

  const labelFor = (id?: string): string => testCase.targets.find((t) => t.id === id)?.label ?? ''

  return (
    <div className="workspace">
      <div className="workspace-header">
        <TargetTabs targets={testCase.targets} activeId={activeTargetId} onSelect={() => {}} disabled />
        <div className="row">
          {phase === 'idle' && (
            <>
              <label>速度</label>
              <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>
                {SPEED_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {s}x
                  </option>
                ))}
              </select>
              <button className="primary" onClick={handleStart}>
                再生を開始
              </button>
            </>
          )}
          {phase === 'running' && <span className="status-line">実行中... ({speed}x)</span>}
          {phase === 'done' && (
            <span className="status-line">
              {success ? '完了しました' : `失敗しました${error ? ` (${error})` : ''}`}
            </span>
          )}
        </div>
      </div>

      <div className="viewport" ref={viewportRef} />

      <div className="workspace-footer">
        <ol className="step-list">
          {testCase.steps.map((s, i) => {
            const p = progress[i]
            return (
              <li key={s.id} className={p ? `status-${p.status}` : ''}>
                <span className="step-type">{s.type}</span>
                <span className="step-detail">
                  {labelFor(s.targetId)}: {s.selector ?? s.url ?? s.key ?? `(${s.winX},${s.winY})`}
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
