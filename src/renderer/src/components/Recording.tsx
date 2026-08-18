import { useEffect, useRef, useState } from 'react'
import type { RecordedStep, MacroTarget } from '../../../shared/types'
import TargetTabs from './TargetTabs'
import HelpIcon from './HelpIcon'
import { PlayIcon, PauseIcon, StopIcon, BackIcon } from './icons'

const RECORDING_HELP_TEXT =
  '選択中のタブの対象がOS上で最前面に表示されます。\n' +
  'そちらに切り替えて実際に操作してください。\n' +
  'ログインなど記録に残したくない操作の間は、下の「一時停止」で記録を止められます。'

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
        <div className="row">
          <TargetTabs
            targets={targets}
            activeId={activeTargetId}
            onSelect={handleSelectTarget}
            disabled={status !== 'idle' && status !== 'recording'}
          />
          <HelpIcon text={RECORDING_HELP_TEXT} />
        </div>
        <div className="row">
          <button className="icon-btn" onClick={handleCancel} title="戻る" aria-label="戻る">
            <BackIcon />
          </button>
          {status === 'starting' && <span className="status-line">起動中...</span>}
          {status === 'recording' && !paused && <span className="status-line">{`記録中 (${steps.length} ステップ)`}</span>}
          {status === 'recording' && paused && (
            <span className="status-line">{`一時停止中 (${steps.length} ステップ)`}</span>
          )}
          {status === 'stopping' && <span className="status-line">停止処理中...</span>}
          {status === 'stopped' && (
            <span className="status-line">{`記録を停止しました (${steps.length} ステップ)`}</span>
          )}
          {status === 'error' && <span className="status-line">{`録画の開始に失敗しました: ${error}`}</span>}
        </div>
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
            <button
              className="primary icon-btn"
              onClick={handleStartRecording}
              disabled={status !== 'idle'}
              title="開始"
              aria-label="開始"
            >
              <PlayIcon />
            </button>
            <button
              className="icon-btn"
              onClick={handleTogglePause}
              disabled={status !== 'recording'}
              title={paused ? '記録を再開' : '一時停止'}
              aria-label={paused ? '記録を再開' : '一時停止'}
            >
              {paused ? <PlayIcon /> : <PauseIcon />}
            </button>
            <button
              className="primary icon-btn"
              onClick={handleStop}
              disabled={status !== 'recording'}
              title="録画を停止する"
              aria-label="録画を停止する"
            >
              <StopIcon />
            </button>
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
