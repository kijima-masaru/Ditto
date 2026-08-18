import { useEffect, useState } from 'react'
import type { TargetHistoryEntry, TargetKind, MacroTarget } from '../../../shared/types'

interface Props {
  onStart: (targets: MacroTarget[]) => void
}

export default function TargetSelect({ onStart }: Props): React.JSX.Element {
  const [targets, setTargets] = useState<MacroTarget[]>([])
  const [kind, setKind] = useState<TargetKind>('web')
  const [label, setLabel] = useState('')
  const [url, setUrl] = useState('https://')
  const [exePath, setExePath] = useState('')
  const [exeArgs, setExeArgs] = useState('')
  const [history, setHistory] = useState<TargetHistoryEntry[]>([])

  useEffect(() => {
    window.api.listTargetHistory().then(setHistory)
  }, [])

  const pickExe = async (): Promise<void> => {
    const picked = await window.api.pickExecutable()
    if (picked) {
      setExePath(picked)
      if (!label) setLabel(picked.split('\\').pop() ?? picked)
    }
  }

  const applyHistoryEntry = (entry: TargetHistoryEntry): void => {
    setKind(entry.kind)
    setLabel(entry.label)
    if (entry.kind === 'web') {
      setUrl(entry.url ?? 'https://')
    } else {
      setExePath(entry.exePath ?? '')
      setExeArgs(entry.exeArgs ?? '')
    }
  }

  const canAdd = kind === 'web' ? url.trim().length > 8 : exePath.trim().length > 0

  const addTarget = async (): Promise<void> => {
    const newTarget: MacroTarget =
      kind === 'web'
        ? { id: crypto.randomUUID(), kind: 'web', label: label.trim() || url.trim(), url: url.trim() }
        : {
            id: crypto.randomUUID(),
            kind: 'desktop',
            label: label.trim() || exePath.split('\\').pop() || exePath,
            exePath,
            exeArgs: exeArgs.trim() || undefined
          }
    setTargets((prev) => [...prev, newTarget])

    const recorded = await window.api.recordTargetHistory({
      kind: newTarget.kind,
      label: newTarget.label,
      url: newTarget.url,
      exePath: newTarget.exePath,
      exeArgs: newTarget.exeArgs
    })
    setHistory((prev) => [recorded, ...prev.filter((h) => h.id !== recorded.id)])

    setLabel('')
    setUrl('https://')
    setExePath('')
    setExeArgs('')
  }

  const removeTarget = (id: string): void => {
    setTargets((prev) => prev.filter((t) => t.id !== id))
  }

  const historyForKind = history.filter((h) => h.kind === kind)

  return (
    <div className="target-select-workspace">
      <div className="panel target-select-scroll">
      <div className="target-type-toggle">
        <button className={kind === 'web' ? 'active' : ''} onClick={() => setKind('web')}>
          WEBアプリ
        </button>
        <button className={kind === 'desktop' ? 'active' : ''} onClick={() => setKind('desktop')}>
          デスクトップアプリ
        </button>
      </div>

      {historyForKind.length > 0 && (
        <div className="field">
          <label>履歴から選択</label>
          <ul className="target-history-list">
            {historyForKind.map((h) => (
              <li key={h.id}>
                <button className="target-history-item" onClick={() => applyHistoryEntry(h)}>
                  <div className="target-history-item-label">{h.label}</div>
                  <div className="target-history-item-detail">{h.kind === 'web' ? h.url : h.exePath}</div>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="field">
        <label>アプリ・画面名(任意)</label>
        <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="例: 管理画面 / メモ帳" />
      </div>

      {kind === 'web' ? (
        <div className="field">
          <label>対象URL(あなたの既定ブラウザで開きます)</label>
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com" />
        </div>
      ) : (
        <div className="field">
          <label>対象アプリの実行ファイル(.exe)</label>
          <div className="row">
            <input value={exePath} readOnly placeholder="ファイルを選択してください" />
            <button onClick={pickExe}>参照...</button>
          </div>
          <label>起動引数(任意)</label>
          <input value={exeArgs} onChange={(e) => setExeArgs(e.target.value)} />
        </div>
      )}

      <button onClick={addTarget} disabled={!canAdd}>
        対象をリストに追加
      </button>

      {targets.length > 0 && (
        <div className="target-list">
          <h3>登録した対象 ({targets.length})</h3>
          <ul className="step-list">
            {targets.map((t) => (
              <li key={t.id}>
                <span className="badge">{t.kind === 'web' ? 'WEB' : 'APP'}</span>
                <span className="step-type">{t.label}</span>
                <span className="step-detail">{t.kind === 'web' ? t.url : t.exePath}</span>
                <button className="danger" onClick={() => removeTarget(t.id)}>
                  削除
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="hint">※ 複数の対象を登録すると、録画中にタブで切り替えながら操作を記録できます。</p>
      <p className="hint">
        ※WEBアプリ・デスクトップ アプリのどちらも、タブを選択するとそのウィンドウが最前面に表示され、他のタブに切り替えると自動的に
        最小化されます。
      </p>
      <p className="hint">
        ※WEBアプリはこのアプリに埋め込まず、あなたの既定ブラウザで開くため、ログインなどの
        操作もいつも通りご自身のブラウザ(保存済みパスワードやセッション)で行えます。
      </p>
      <p className="hint">
        ※記録・再生は画面座標 ベースのため、ウィンドウのサイズ・表示スケールが記録時と大きく異なると再生に失敗する場合があります。
      </p>
      <p className="hint">※ログイン操作など記録に残したくない部分は、録画画面の「一時停止」で記録を止められます。</p>
      </div>

      <div className="target-select-footer">
        <button className="primary" disabled={targets.length === 0} onClick={() => onStart(targets)}>
          選択完了
        </button>
      </div>
    </div>
  )
}
