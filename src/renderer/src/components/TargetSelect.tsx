import { useState } from 'react'
import type { TargetKind, TestTarget } from '../../../shared/types'

interface Props {
  onStart: (targets: TestTarget[]) => void
}

export default function TargetSelect({ onStart }: Props): React.JSX.Element {
  const [targets, setTargets] = useState<TestTarget[]>([])
  const [kind, setKind] = useState<TargetKind>('web')
  const [label, setLabel] = useState('')
  const [url, setUrl] = useState('https://')
  const [exePath, setExePath] = useState('')
  const [exeArgs, setExeArgs] = useState('')

  const pickExe = async (): Promise<void> => {
    const picked = await window.api.pickExecutable()
    if (picked) {
      setExePath(picked)
      if (!label) setLabel(picked.split('\\').pop() ?? picked)
    }
  }

  const canAdd = kind === 'web' ? url.trim().length > 8 : exePath.trim().length > 0

  const addTarget = (): void => {
    const newTarget: TestTarget =
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
    setLabel('')
    setUrl('https://')
    setExePath('')
    setExeArgs('')
  }

  const removeTarget = (id: string): void => {
    setTargets((prev) => prev.filter((t) => t.id !== id))
  }

  return (
    <div className="panel">
      <h2>テスト対象を追加</h2>

      <div className="target-type-toggle">
        <button className={kind === 'web' ? 'active' : ''} onClick={() => setKind('web')}>
          WEBアプリ
        </button>
        <button className={kind === 'desktop' ? 'active' : ''} onClick={() => setKind('desktop')}>
          デスクトップアプリ
        </button>
      </div>

      <div className="field">
        <label>表示名(任意)</label>
        <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="例: 管理画面 / メモ帳" />
      </div>

      {kind === 'web' ? (
        <div className="field">
          <label>対象URL</label>
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

      <p className="hint">
        ※ 複数の対象を登録すると、録画中にタブで切り替えながら操作を記録できます。WEBアプリはこのアプリの
        表示エリア内に埋め込んで表示されます。デスクトップアプリはタブを選択すると最前面に表示され、
        他のタブに切り替えると自動的に最小化されます(Windowsの制約上、アプリの表示エリア内に正確に
        重ねて表示することはできません)。記録・再生は画面座標ベースのため、ウィンドウのサイズ・表示
        スケールが記録時と大きく異なると再生に失敗する場合があります。
      </p>

      <button className="primary" disabled={targets.length === 0} onClick={() => onStart(targets)}>
        録画を開始 ({targets.length}件の対象)
      </button>
    </div>
  )
}
