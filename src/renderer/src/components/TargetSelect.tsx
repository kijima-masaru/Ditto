import { useState } from 'react'
import type { TargetType } from '../../../shared/types'

interface Props {
  onStart: (targetType: TargetType, target: string, targetArgs?: string) => void
}

export default function TargetSelect({ onStart }: Props): React.JSX.Element {
  const [targetType, setTargetType] = useState<TargetType>('web')
  const [url, setUrl] = useState('https://')
  const [exePath, setExePath] = useState('')
  const [exeArgs, setExeArgs] = useState('')

  const pickExe = async (): Promise<void> => {
    const picked = await window.api.pickExecutable()
    if (picked) setExePath(picked)
  }

  const canStart = targetType === 'web' ? url.trim().length > 8 : exePath.trim().length > 0

  return (
    <div className="panel">
      <h2>録画するテスト対象を選択</h2>

      <div className="target-type-toggle">
        <button className={targetType === 'web' ? 'active' : ''} onClick={() => setTargetType('web')}>
          WEB画面
        </button>
        <button className={targetType === 'desktop' ? 'active' : ''} onClick={() => setTargetType('desktop')}>
          デスクトップアプリ
        </button>
      </div>

      {targetType === 'web' ? (
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
          <input value={exeArgs} onChange={(e) => setExeArgs(e.target.value)} placeholder="" />
          <p className="hint">
            ※ デスクトップアプリの記録・再生は画面座標ベースです。ウィンドウサイズ・位置・表示スケールが
            記録時と異なると再生に失敗する場合があります。
          </p>
        </div>
      )}

      <button
        className="primary"
        disabled={!canStart}
        onClick={() => onStart(targetType, targetType === 'web' ? url : exePath, targetType === 'desktop' ? exeArgs : undefined)}
      >
        録画を開始
      </button>
    </div>
  )
}
