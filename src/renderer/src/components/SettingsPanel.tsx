import { useEffect, useState } from 'react'
import type { HotkeyModifier } from '../../../shared/types'

const OPTIONS: { value: HotkeyModifier; label: string }[] = [
  { value: 'Ctrl', label: 'Ctrl' },
  { value: 'Shift', label: 'Shift' },
  { value: 'Alt', label: 'Alt' }
]

export default function SettingsPanel(): React.JSX.Element {
  const [modifier, setModifier] = useState<HotkeyModifier>('Ctrl')
  const [loading, setLoading] = useState(true)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    window.api.getSettings().then((s) => {
      setModifier(s.hotkeyModifier)
      setLoading(false)
    })
  }, [])

  const handleChange = async (value: HotkeyModifier): Promise<void> => {
    setModifier(value)
    await window.api.setHotkeyModifier(value)
    setSaved(true)
    window.setTimeout(() => setSaved(false), 1500)
  }

  if (loading) return <div className="panel">読み込み中...</div>

  return (
    <div className="panel">
      <h2>設定</h2>
      <div className="field">
        <label>ウィンドウ表示ホットキー</label>
        <p className="hint">選択したキーを素早く2回押すと、閉じている(トレイに常駐中の)ウィンドウを表示します。</p>
        <div className="target-type-toggle">
          {OPTIONS.map((o) => (
            <button
              key={o.value}
              className={modifier === o.value ? 'active' : ''}
              onClick={() => handleChange(o.value)}
            >
              {o.label}2回押し
            </button>
          ))}
        </div>
        {saved && <p className="hint">保存しました</p>}
      </div>
    </div>
  )
}
