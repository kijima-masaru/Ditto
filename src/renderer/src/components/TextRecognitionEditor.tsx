import { useEffect, useState } from 'react'

interface Props {
  /** nullは認識中(OCRがまだ完了していない)ことを表す */
  text: string | null
  onCancel: () => void
  onSaved: () => void
}

/**
 * 録画枠の「テキスト認識」モードで撮影した範囲のOCR結果を確認・編集する画面。
 * OCR完了までは読み込み中表示にし、完了後はテキストエリアで自由に編集できる
 * (誤認識の訂正や不要な機密情報の削除に使う)。保存するとクリップボード履歴に追加される。
 */
export default function TextRecognitionEditor({ text, onCancel, onSaved }: Props): React.JSX.Element {
  const [value, setValue] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (text !== null) setValue(text)
  }, [text])

  const loading = text === null
  const isEmptyResult = !loading && text === ''

  const handleSave = async (): Promise<void> => {
    if (!value.trim()) return
    setSaving(true)
    try {
      await window.api.saveTextRecognitionEntry(value)
      onSaved()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="text-recognition-editor-page">
      <div className="text-recognition-editor-header">
        <h2>テキスト認識結果</h2>
      </div>
      <div className="text-recognition-editor-body">
        {loading ? (
          <div className="text-recognition-editor-loading">認識中...</div>
        ) : (
          <>
            {isEmptyResult && <p className="hint">テキストを検出できませんでした。直接入力することもできます。</p>}
            <textarea
              className="text-recognition-editor-textarea"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              autoFocus
              placeholder="認識されたテキストがここに表示されます"
            />
          </>
        )}
      </div>
      <div className="text-recognition-editor-footer">
        <button onClick={onCancel} disabled={saving}>
          キャンセル
        </button>
        <button className="primary" onClick={handleSave} disabled={loading || saving || !value.trim()}>
          クリップボード履歴に保存
        </button>
      </div>
    </div>
  )
}
