import { useEffect, useRef, useState } from 'react'
import type { RecordedStep, MacroTarget } from '../../../shared/types'
import TargetTabs from './TargetTabs'

interface Props {
  targets: MacroTarget[]
  folderId: string | null
  onDone: () => void
  onCancel: () => void
}

export default function Recording({ targets, folderId, onDone, onCancel }: Props): React.JSX.Element {
  const [steps, setSteps] = useState<RecordedStep[]>([])
  const [status, setStatus] = useState<'idle' | 'starting' | 'recording' | 'stopping' | 'stopped' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [macroName, setMacroName] = useState('')
  const [nameError, setNameError] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [activeTargetId, setActiveTargetId] = useState<string>(targets[0]?.id ?? '')
  const [paused, setPaused] = useState(false)
  const started = useRef(false)

  useEffect(() => {
    if (started.current) return
    started.current = true

    const unsubscribe = window.api.onRecordingStep((step) => {
      setSteps((prev) => [...prev, step])
    })

    return () => {
      unsubscribe()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 「選択完了」の時点では記録を開始せず、このボタンを押した時点で初めて開始する
  const handleStartRecording = async (): Promise<void> => {
    setStatus('starting')
    try {
      await window.api.startRecording(targets)
      setStatus('recording')
    } catch (e) {
      setStatus('error')
      setError((e as Error).message)
    }
  }

  const handleSelectTarget = async (id: string): Promise<void> => {
    setActiveTargetId(id)
    await window.api.setActiveTarget(id)
  }

  const handleTogglePause = async (): Promise<void> => {
    const next = !paused
    setPaused(next)
    await window.api.setRecordingPaused(next)
  }

  // 録画を停止するだけで、保存はしない(名前の入力・確認は別ステップにする)
  const handleStop = async (): Promise<void> => {
    setStatus('stopping')
    await window.api.stopRecording()
    setStatus('stopped')
  }

  const handleSave = async (): Promise<void> => {
    if (!macroName.trim()) {
      setNameError(true)
      return
    }
    setNameError(false)
    setSaveError(null)
    setSaving(true)
    try {
      await window.api.saveMacro({ name: macroName.trim(), targets, steps, folderId })
      onDone()
    } catch (e) {
      setSaveError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const handleDiscard = (): void => {
    onCancel()
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
          disabled={status !== 'idle' && status !== 'recording'}
        />
        <span className="status-line">
          {status === 'idle' && '「開始」を押すと記録を開始します'}
          {status === 'starting' && '起動中...'}
          {status === 'recording' && !paused && `記録中 (${steps.length} ステップ)`}
          {status === 'recording' && paused && `一時停止中 (${steps.length} ステップ)`}
          {status === 'stopping' && '停止処理中...'}
          {status === 'stopped' && `記録を停止しました (${steps.length} ステップ)`}
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

        {status !== 'stopped' && (
          <div className="row">
            <button className="primary" onClick={handleStartRecording} disabled={status !== 'idle'}>
              開始
            </button>
            <button onClick={handleTogglePause} disabled={status !== 'recording'}>
              {paused ? '記録を再開' : '一時停止'}
            </button>
            <button className="primary" onClick={handleStop} disabled={status !== 'recording'}>
              録画を停止する
            </button>
            <button onClick={handleCancel}>キャンセル</button>
          </div>
        )}

        {status === 'stopped' && (
          <div className="row">
            <div className="field field--inline">
              <label>保存するマクロ名</label>
              <input
                value={macroName}
                onChange={(e) => {
                  setMacroName(e.target.value)
                  if (e.target.value.trim()) setNameError(false)
                }}
                placeholder="例: ログインフロー確認"
                autoFocus
              />
            </div>
            <button className="primary" onClick={handleSave} disabled={saving}>
              {saving ? '保存中...' : 'この内容で保存'}
            </button>
            <button onClick={handleDiscard} disabled={saving}>
              保存せずに破棄
            </button>
          </div>
        )}
        {nameError && <p className="error">マクロ名を入力してください。</p>}
        {saveError && <p className="error">保存に失敗しました: {saveError}</p>}
      </div>
    </div>
  )
}
