import { useEffect, useRef, useState } from 'react'
import type { PlaybackProgress, TestCase } from '../../../shared/types'

interface Props {
  testCase: TestCase
  onDone: () => void
}

export default function Playback({ testCase, onDone }: Props): React.JSX.Element {
  const [progress, setProgress] = useState<PlaybackProgress[]>([])
  const [finished, setFinished] = useState(false)
  const [success, setSuccess] = useState<boolean | null>(null)
  const [error, setError] = useState<string | null>(null)
  const started = useRef(false)

  useEffect(() => {
    if (started.current) return
    started.current = true

    const unsubscribe = window.api.onPlaybackProgress((p) => {
      setProgress((prev) => {
        const next = [...prev]
        next[p.stepIndex] = p
        return next
      })
    })

    window.api
      .runPlayback(testCase)
      .then((result) => {
        setSuccess(result.success)
        setFinished(true)
      })
      .catch((e: Error) => {
        setError(e.message)
        setFinished(true)
        setSuccess(false)
      })

    return () => unsubscribe()
  }, [testCase])

  return (
    <div className="panel">
      <h2>再生中: {testCase.name}</h2>
      <p className="status-line">
        {!finished && '実行中...'}
        {finished && success && '✅ 完了しました'}
        {finished && !success && `❌ 失敗しました ${error ? `(${error})` : ''}`}
      </p>

      <ol className="step-list">
        {testCase.steps.map((s, i) => {
          const p = progress[i]
          return (
            <li key={s.id} className={p ? `status-${p.status}` : ''}>
              <span className="step-type">{s.type}</span>
              <span className="step-detail">{s.key ?? `(${s.winX},${s.winY})`}</span>
              {p?.message && <span className="step-message">{p.message}</span>}
            </li>
          )
        })}
      </ol>

      <button className="primary" onClick={onDone}>
        テスト一覧に戻る
      </button>
    </div>
  )
}
