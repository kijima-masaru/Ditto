import { useState } from 'react'

interface Props {
  onStart: (target: string, targetArgs?: string) => void
}

export default function TargetSelect({ onStart }: Props): React.JSX.Element {
  const [exePath, setExePath] = useState('')
  const [exeArgs, setExeArgs] = useState('')

  const pickExe = async (): Promise<void> => {
    const picked = await window.api.pickExecutable()
    if (picked) setExePath(picked)
  }

  const canStart = exePath.trim().length > 0

  return (
    <div className="panel">
      <h2>録画するテスト対象を選択</h2>

      <div className="field">
        <label>対象アプリの実行ファイル(.exe)</label>
        <div className="row">
          <input value={exePath} readOnly placeholder="ファイルを選択してください" />
          <button onClick={pickExe}>参照...</button>
        </div>
        <label>起動引数(任意)</label>
        <input value={exeArgs} onChange={(e) => setExeArgs(e.target.value)} placeholder="" />
        <p className="hint">
          ※ 記録・再生は画面座標ベースです。ウィンドウサイズ・位置・表示スケールが記録時と異なると
          再生に失敗する場合があります。
        </p>
      </div>

      <button className="primary" disabled={!canStart} onClick={() => onStart(exePath, exeArgs || undefined)}>
        録画を開始
      </button>
    </div>
  )
}
