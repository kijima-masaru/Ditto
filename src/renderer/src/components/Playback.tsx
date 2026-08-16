import { useEffect, useState } from 'react'
import type { PlaybackProgress, MacroCase, ClipboardTemplate } from '../../../shared/types'
import TargetTabs from './TargetTabs'

interface Props {
  macroCase: MacroCase
  onDone: () => void
}

export default function Playback({ macroCase: initialMacroCase, onDone }: Props): React.JSX.Element {
  const [macroCase, setMacroCase] = useState<MacroCase>(initialMacroCase)
  const [phase, setPhase] = useState<'idle' | 'running' | 'done'>('idle')
  const [progress, setProgress] = useState<PlaybackProgress[]>([])
  const [activeTargetId, setActiveTargetId] = useState<string>(macroCase.targets[0]?.id ?? '')
  const [success, setSuccess] = useState<boolean | null>(null)
  const [error, setError] = useState<string | null>(null)

  // 「定型文入力」ステップ追加用のフォーム状態(実行対象・入力する定型文)
  const [templates, setTemplates] = useState<ClipboardTemplate[]>([])
  const [addStepTargetId, setAddStepTargetId] = useState<string>(macroCase.targets[0]?.id ?? '')
  const [addStepTemplateId, setAddStepTemplateId] = useState<string>('')
  const [addingStep, setAddingStep] = useState(false)

  useEffect(() => {
    window.api.listClipboardTemplates().then((list) => {
      setTemplates(list)
      setAddStepTemplateId((cur) => cur || list[0]?.id || '')
    })
  }, [])

  const handleAddTemplateStep = async (): Promise<void> => {
    if (!addStepTargetId || !addStepTemplateId) return
    const template = templates.find((t) => t.id === addStepTemplateId)
    setAddingStep(true)
    try {
      const updated = await window.api.addTemplateStepToMacro(
        macroCase.id,
        addStepTargetId,
        addStepTemplateId,
        template?.label ?? ''
      )
      setMacroCase(updated)
    } finally {
      setAddingStep(false)
    }
  }

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

    try {
      const result = await window.api.runPlayback(macroCase)
      setSuccess(result.success)
    } catch (e) {
      setError((e as Error).message)
      setSuccess(false)
    } finally {
      setPhase('done')
      unsubscribe()
    }
  }

  const labelFor = (id?: string): string => macroCase.targets.find((t) => t.id === id)?.label ?? ''

  return (
    <div className="workspace">
      <div className="workspace-header">
        <TargetTabs targets={macroCase.targets} activeId={activeTargetId} onSelect={() => {}} disabled />
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

      <div className="notice-panel">
        <p>
          アクティブなタブの対象がOS上で最前面に表示され、そのウィンドウに対して操作を再生します。
          各操作の間隔は記録時に実際に空いていた時間をそのまま再現します。
        </p>
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

        {phase !== 'running' && (
          <div className="row inline-form add-template-step-form">
            <select value={addStepTargetId} onChange={(e) => setAddStepTargetId(e.target.value)}>
              {macroCase.targets.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
            <select value={addStepTemplateId} onChange={(e) => setAddStepTemplateId(e.target.value)}>
              {templates.length === 0 && <option value="">定型文がありません</option>}
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label || t.text.slice(0, 20)}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={addingStep || !addStepTargetId || !addStepTemplateId}
              onClick={handleAddTemplateStep}
              title="末尾に、選択した対象へ定型文を入力するステップを追加します。{{date}}等の動的変数はそのステップの再生時にその場で解決されます"
            >
              定型文入力ステップを追加
            </button>
          </div>
        )}

        <button className="primary" onClick={onDone}>
          マクロに戻る
        </button>
      </div>
    </div>
  )
}
