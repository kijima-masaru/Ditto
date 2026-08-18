import { useEffect, useRef, useState } from 'react'
import type { PlaybackProgress, MacroCase } from '../../../shared/types'
import TargetTabs from './TargetTabs'
import HelpIcon from './HelpIcon'
import { PlayIcon, PauseIcon, StopIcon } from './icons'

interface Props {
  macroCase: MacroCase
}

const PLAYBACK_HELP_TEXT =
  'アクティブなタブの対象がOS上で最前面に表示され、そのウィンドウに対して操作を再生します。\n' +
  '各操作の間隔は記録時に実際に空いていた時間をそのまま再現します。'

export default function Playback({ macroCase }: Props): React.JSX.Element {
  const [phase, setPhase] = useState<'idle' | 'running' | 'done'>('idle')
  const [paused, setPaused] = useState(false)
  const [progress, setProgress] = useState<PlaybackProgress[]>([])
  const [activeTargetId, setActiveTargetId] = useState<string>(macroCase.targets[0]?.id ?? '')
  const [success, setSuccess] = useState<boolean | null>(null)
  const [error, setError] = useState<string | null>(null)
  const phaseRef = useRef(phase)

  useEffect(() => {
    phaseRef.current = phase
  }, [phase])

  // モーダルが外側クリック等で閉じられ、このコンポーネントがアンマウントされた際に
  // 実行中の再生がバックグラウンドに残り続けないようにする
  useEffect(() => {
    return () => {
      if (phaseRef.current === 'running') {
        void window.api.abortPlayback()
      }
    }
  }, [])

  const handleStart = async (): Promise<void> => {
    setPhase('running')
    setPaused(false)
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

    try {
      const result = await window.api.runPlayback(macroCase)
      setSuccess(result.success)
    } catch (e) {
      setError((e as Error).message)
      setSuccess(false)
    } finally {
      setPhase('done')
      setPaused(false)
      unsubscribe()
    }
  }

  const handleTogglePause = async (): Promise<void> => {
    const next = !paused
    setPaused(next)
    await window.api.setPlaybackPaused(next)
  }

  const handleStop = async (): Promise<void> => {
    await window.api.abortPlayback()
  }

  const handlePlayPauseClick = async (): Promise<void> => {
    if (phase === 'running') {
      await handleTogglePause()
    } else {
      await handleStart()
    }
  }

  const labelFor = (id?: string): string => macroCase.targets.find((t) => t.id === id)?.label ?? ''

  return (
    <div className="workspace">
      <div className="workspace-header">
        <div className="row">
          <TargetTabs targets={macroCase.targets} activeId={activeTargetId} onSelect={() => {}} disabled />
          <HelpIcon text={PLAYBACK_HELP_TEXT} />
        </div>
        <div className="row">
          <button
            className="primary icon-btn"
            onClick={handlePlayPauseClick}
            title={phase === 'running' && !paused ? '一時停止' : phase === 'done' ? 'もう一度実行' : '再生を開始'}
            aria-label={phase === 'running' && !paused ? '一時停止' : phase === 'done' ? 'もう一度実行' : '再生を開始'}
          >
            {phase === 'running' && !paused ? <PauseIcon /> : <PlayIcon />}
          </button>
          <button
            className="icon-btn"
            onClick={handleStop}
            disabled={phase !== 'running'}
            title="停止"
            aria-label="停止"
          >
            <StopIcon />
          </button>
          {phase === 'running' && <span className="status-line">実行中...</span>}
          {phase === 'done' && (
            <span className="status-line">
              {success ? '完了しました' : `失敗しました${error ? ` (${error})` : ''}`}
            </span>
          )}
        </div>
      </div>

      <div className="workspace-footer">
        <ol className="step-list">
          {macroCase.steps.map((s, i) => {
            const p = progress[i]
            const detail = s.type === 'type' ? (s.label ?? '定型文入力') : (s.key ?? `(${s.winX},${s.winY})`)
            return (
              <li key={s.id} className={p ? `status-${p.status}` : ''}>
                <span className="step-type">{s.type}</span>
                <span className="step-detail">
                  {labelFor(s.targetId)}: {detail}
                </span>
                {p?.message && <span className="step-message">{p.message}</span>}
                {p?.evidencePath && (
                  <button
                    type="button"
                    className="step-evidence-link"
                    onClick={() => window.api.openRecordingFolder(p.evidencePath as string)}
                    title="失敗時点の画面を保存したエビデンス画像を開きます"
                  >
                    エビデンス画像を開く
                  </button>
                )}
              </li>
            )
          })}
        </ol>
      </div>
    </div>
  )
}
