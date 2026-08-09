import { useEffect, useRef, useState } from 'react'
import type { RecordedStep, TestTarget } from '../../../shared/types'
import { reportViewport, watchViewport } from '../viewport'
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
  const started = useRef(false)
  const viewportRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (started.current) return
    started.current = true

    const unsubscribe = window.api.onRecordingStep((step) => {
      setSteps((prev) => [...prev, step])
    })

    let stopWatch = (): void => {}
    void (async () => {
      const el = viewportRef.current
      if (el) {
        await reportViewport(el)
        stopWatch = watchViewport(el)
      }
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
      stopWatch()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleSelectTarget = async (id: string): Promise<void> => {
    setActiveTargetId(id)
    await window.api.setActiveTarget(id)
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
          {status === 'recording' && `記録中 (${steps.length} ステップ)`}
          {status === 'stopping' && '停止処理中...'}
          {status === 'error' && `録画の開始に失敗しました: ${error}`}
        </span>
      </div>

      <div className="viewport" ref={viewportRef} />

      <div className="workspace-footer">
        <ul className="step-list">
          {steps.map((s) => (
            <li key={s.id}>
              <span className="step-type">{s.type}</span>
              <span className="step-detail">
                {labelFor(s.targetId)}: {s.selector ?? s.url ?? s.key ?? `(${s.winX},${s.winY})`}
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
          <button className="primary" onClick={handleStopAndSave} disabled={status !== 'recording'}>
            録画を停止して保存
          </button>
          <button onClick={handleCancel}>キャンセル</button>
        </div>
      </div>
    </div>
  )
}
