import { useEffect, useRef, useState } from 'react'
import type { RecordedStep, TargetType } from '../../../shared/types'

interface Props {
  targetType: TargetType
  target: string
  targetArgs?: string
  onDone: () => void
  onCancel: () => void
}

export default function Recording({ targetType, target, targetArgs, onDone, onCancel }: Props): React.JSX.Element {
  const [steps, setSteps] = useState<RecordedStep[]>([])
  const [status, setStatus] = useState<'starting' | 'recording' | 'stopping' | 'error'>('starting')
  const [error, setError] = useState<string | null>(null)
  const [testName, setTestName] = useState('')
  const started = useRef(false)

  useEffect(() => {
    if (started.current) return
    started.current = true

    const unsubscribe = window.api.onRecordingStep((step) => {
      setSteps((prev) => [...prev, step])
    })

    window.api
      .startRecording(targetType, target, targetArgs)
      .then(() => setStatus('recording'))
      .catch((e: Error) => {
        setStatus('error')
        setError(e.message)
      })

    return () => unsubscribe()
  }, [targetType, target, targetArgs])

  const handleStopAndSave = async (): Promise<void> => {
    setStatus('stopping')
    const finalSteps = await window.api.stopRecording()
    if (!testName.trim()) {
      onDone()
      return
    }
    await window.api.saveTest({
      name: testName.trim(),
      targetType,
      target,
      targetArgs,
      steps: finalSteps
    })
    onDone()
  }

  const handleCancel = async (): Promise<void> => {
    try {
      await window.api.stopRecording()
    } finally {
      onCancel()
    }
  }

  return (
    <div className="panel">
      <h2>録画中: {target}</h2>

      {status === 'error' && (
        <p className="error">
          録画の開始に失敗しました: {error}
          <br />
          (Web/デスクトップエンジンが未実装の可能性があります)
        </p>
      )}

      <p className="status-line">
        状態: {status === 'starting' && '起動中...'}
        {status === 'recording' && `記録中 (${steps.length} ステップ)`}
        {status === 'stopping' && '停止処理中...'}
      </p>

      <ul className="step-list">
        {steps.map((s) => (
          <li key={s.id}>
            <span className="step-type">{s.type}</span>
            <span className="step-detail">{s.selector ?? s.url ?? s.key ?? `(${s.winX},${s.winY})`}</span>
          </li>
        ))}
      </ul>

      <div className="field">
        <label>保存するテスト名</label>
        <input value={testName} onChange={(e) => setTestName(e.target.value)} placeholder="例: ログインフロー確認" />
      </div>

      <div className="row">
        <button className="primary" onClick={handleStopAndSave} disabled={status !== 'recording'}>
          録画を停止して保存
        </button>
        <button onClick={handleCancel}>キャンセル</button>
      </div>
    </div>
  )
}
