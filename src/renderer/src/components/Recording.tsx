import { useEffect, useRef, useState } from 'react'
import type { RecordedStep, TestTarget } from '../../../shared/types'
import TargetTabs from './TargetTabs'

interface Props {
  targets: TestTarget[]
  onDone: () => void
  onCancel: () => void
}

export default function Recording({ targets, onDone, onCancel }: Props): React.JSX.Element {
  const [steps, setSteps] = useState<RecordedStep[]>([])
  const [status, setStatus] = useState<'starting' | 'recording' | 'stopping' | 'error'>('starting')
  const [error, setError] = useState<string | null>(null)
  const [testName, setTestName] = useState('')
  const [activeTargetId, setActiveTargetId] = useState<string>(targets[0]?.id ?? '')
  const [paused, setPaused] = useState(false)
  const started = useRef(false)

  useEffect(() => {
    if (started.current) return
    started.current = true

    const unsubscribe = window.api.onRecordingStep((step) => {
      setSteps((prev) => [...prev, step])
    })

    void (async () => {
      try {
        await window.api.startRecording(targets)
        setStatus('recording')
      } catch (e) {
        setStatus('error')
        setError((e as Error).message)
      }
    })()

    return () => {
      unsubscribe()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleSelectTarget = async (id: string): Promise<void> => {
    setActiveTargetId(id)
    await window.api.setActiveTarget(id)
  }

  const handleTogglePause = async (): Promise<void> => {
    const next = !paused
    setPaused(next)
    await window.api.setRecordingPaused(next)
  }

  const handleStopAndSave = async (): Promise<void> => {
    setStatus('stopping')
    const finalSteps = await window.api.stopRecording()
    if (!testName.trim()) {
      onDone()
      return
    }
    await window.api.saveTest({ name: testName.trim(), targets, steps: finalSteps })
    onDone()
  }

  const handleCancel = async (): Promise<void> => {
    try {
      await window.api.stopRecording()
    } finally {
      onCancel()
    }
  }

  const labelFor = (id: string): string => targets.find((t) => t.id === id)?.label ?? id

  return (
    <div className="workspace">
      <div className="workspace-header">
        <TargetTabs
          targets={targets}
          activeId={activeTargetId}
          onSelect={handleSelectTarget}
          disabled={status !== 'recording'}
        />
        <span className="status-line">
          {status === 'starting' && '起動中...'}
          {status === 'recording' && !paused && `記録中 (${steps.length} ステップ)`}
          {status === 'recording' && paused && `一時停止中 (${steps.length} ステップ)`}
          {status === 'stopping' && '停止処理中...'}
          {status === 'error' && `録画の開始に失敗しました: ${error}`}
        </span>
      </div>

      <div className="notice-panel">
        <p>
          選択中のタブの対象がOS上で最前面に表示されます。そちらに切り替えて実際に操作してください。
          ログインなど記録に残したくない操作の間は、下の「一時停止」で記録を止められます。
        </p>
      </div>

      <div className="workspace-footer">
        <ul className="step-list">
          {steps.map((s) => (
            <li key={s.id}>
              <span className="step-type">{s.type}</span>
              <span className="step-detail">
                {labelFor(s.targetId)}: {s.key ?? `(${s.winX},${s.winY})`}
              </span>
            </li>
          ))}
        </ul>

        <div className="row">
          <div className="field field--inline">
            <label>保存するテスト名</label>
            <input
              value={testName}
              onChange={(e) => setTestName(e.target.value)}
              placeholder="例: ログインフロー確認"
            />
          </div>
          <button onClick={handleTogglePause} disabled={status !== 'recording'}>
            {paused ? '記録を再開' : '一時停止'}
          </button>
          <button className="primary" onClick={handleStopAndSave} disabled={status !== 'recording'}>
            録画を停止して保存
          </button>
          <button onClick={handleCancel}>キャンセル</button>
        </div>
      </div>
    </div>
  )
}
