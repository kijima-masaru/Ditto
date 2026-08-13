import { useCallback, useEffect, useRef, useState } from 'react'

interface TextAnnotation {
  id: string
  /** 画像の実ピクセルサイズに対する割合(0〜1)。中心座標を表す。表示サイズに関わらず正しい位置に合成するため割合で保持する */
  xFrac: number
  yFrac: number
  text: string
  color: string
  /** 画像の実ピクセル基準のフォントサイズ。画面表示時は画像の表示倍率に応じて縮小して見せる */
  fontSize: number
}

const COLORS = ['#ff3b30', '#ffd60a', '#34c759', '#0a84ff', '#ffffff', '#000000']
const DEFAULT_FONT_SIZE = 48
const MIN_FONT_SIZE = 16
const MAX_FONT_SIZE = 200

interface Props {
  imageDataUrl: string
  onCancel: () => void
  onSaved: (path: string) => void
}

export default function ScreenshotEditor({ imageDataUrl, onCancel, onSaved }: Props): React.JSX.Element {
  const [annotations, setAnnotations] = useState<TextAnnotation[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editorScale, setEditorScale] = useState(1)
  const [saving, setSaving] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const imgRef = useRef<HTMLImageElement | null>(null)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const inputRefs = useRef<Map<string, HTMLTextAreaElement>>(new Map())
  const dragRef = useRef<{ id: string; startX: number; startY: number; startXFrac: number; startYFrac: number; moved: boolean } | null>(null)
  const nextOffsetRef = useRef(0)

  const recomputeScale = useCallback(() => {
    const img = imgRef.current
    if (img && img.naturalWidth > 0) setEditorScale(img.clientWidth / img.naturalWidth)
  }, [])

  useEffect(() => {
    window.addEventListener('resize', recomputeScale)
    return () => window.removeEventListener('resize', recomputeScale)
  }, [recomputeScale])

  useEffect(() => {
    if (!editingId) return
    const el = inputRefs.current.get(editingId)
    if (el) {
      el.focus()
      el.setSelectionRange(el.value.length, el.value.length)
    }
  }, [editingId])

  const exitEditing = useCallback((id: string): void => {
    setEditingId((cur) => (cur === id ? null : cur))
    setAnnotations((prev) => prev.filter((a) => a.id !== id || a.text.trim() !== ''))
  }, [])

  const addText = (): void => {
    const offset = nextOffsetRef.current
    nextOffsetRef.current += 1
    const id = `${Date.now()}-${offset}`
    const jitter = (offset % 5) * 0.04
    const next: TextAnnotation = {
      id,
      xFrac: 0.5 + jitter,
      yFrac: 0.5 + jitter,
      text: '',
      color: COLORS[0],
      fontSize: DEFAULT_FONT_SIZE
    }
    setAnnotations((prev) => [...prev, next])
    setSelectedId(id)
    setEditingId(id)
  }

  const updateAnnotation = (id: string, patch: Partial<TextAnnotation>): void => {
    setAnnotations((prev) => prev.map((a) => (a.id === id ? { ...a, ...patch } : a)))
  }

  const deleteAnnotation = (id: string): void => {
    setAnnotations((prev) => prev.filter((a) => a.id !== id))
    setSelectedId((cur) => (cur === id ? null : cur))
    setEditingId((cur) => (cur === id ? null : cur))
  }

  const handleBoxPointerDown = (e: React.PointerEvent, a: TextAnnotation): void => {
    if (editingId === a.id) return
    e.stopPropagation()
    dragRef.current = { id: a.id, startX: e.clientX, startY: e.clientY, startXFrac: a.xFrac, startYFrac: a.yFrac, moved: false }
    window.addEventListener('pointermove', handleWindowPointerMove)
    window.addEventListener('pointerup', handleWindowPointerUp)
  }

  const handleWindowPointerMove = (e: PointerEvent): void => {
    const drag = dragRef.current
    const wrap = wrapRef.current
    if (!drag || !wrap) return
    const rect = wrap.getBoundingClientRect()
    const dx = e.clientX - drag.startX
    const dy = e.clientY - drag.startY
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) drag.moved = true
    if (!drag.moved) return
    const xFrac = Math.min(1, Math.max(0, drag.startXFrac + dx / rect.width))
    const yFrac = Math.min(1, Math.max(0, drag.startYFrac + dy / rect.height))
    updateAnnotation(drag.id, { xFrac, yFrac })
  }

  const handleWindowPointerUp = (): void => {
    const drag = dragRef.current
    window.removeEventListener('pointermove', handleWindowPointerMove)
    window.removeEventListener('pointerup', handleWindowPointerUp)
    if (!drag) return
    dragRef.current = null
    if (!drag.moved) {
      if (selectedId === drag.id) setEditingId(drag.id)
      else setSelectedId(drag.id)
    }
  }

  const handleBackgroundClick = (): void => {
    if (editingId) exitEditing(editingId)
    setSelectedId(null)
  }

  const selected = annotations.find((a) => a.id === selectedId) ?? null

  const changeSelectedColor = (color: string): void => {
    if (selected) updateAnnotation(selected.id, { color })
  }

  const changeSelectedFontSize = (delta: number): void => {
    if (!selected) return
    const next = Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, selected.fontSize + delta))
    updateAnnotation(selected.id, { fontSize: next })
  }

  const handleSave = async (): Promise<void> => {
    const img = imgRef.current
    if (!img) return
    setSaving(true)
    setErrorMessage(null)
    try {
      const canvas = document.createElement('canvas')
      canvas.width = img.naturalWidth
      canvas.height = img.naturalHeight
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('保存の準備に失敗しました')
      ctx.drawImage(img, 0, 0)

      for (const a of annotations) {
        const lines = a.text.split('\n').filter((l) => l.length > 0)
        if (lines.length === 0) continue
        ctx.fillStyle = a.color
        ctx.font = `700 ${a.fontSize}px 'Segoe UI', sans-serif`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        const lineHeight = a.fontSize * 1.25
        const centerX = a.xFrac * canvas.width
        const centerY = a.yFrac * canvas.height
        const startY = centerY - (lineHeight * (lines.length - 1)) / 2
        lines.forEach((line, i) => {
          ctx.fillText(line, centerX, startY + i * lineHeight)
        })
      }

      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
      if (!blob) throw new Error('画像の書き出しに失敗しました')
      const bytes = new Uint8Array(await blob.arrayBuffer())
      const path = await window.api.saveScreenshot(bytes)
      onSaved(path)
    } catch (e) {
      setErrorMessage((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="screenshot-editor-overlay">
      <div className="screenshot-editor-modal">
        <div className="screenshot-editor-header">
          <span>スクリーンショットを確認</span>
          <button className="debug-log-close-btn" onClick={onCancel} title="閉じる">
            ×
          </button>
        </div>

        <div className="screenshot-editor-toolbar">
          <button className="settings-action-btn" onClick={addText}>
            + テキストを追加
          </button>
          {selected && (
            <>
              <div className="screenshot-editor-colors">
                {COLORS.map((c) => (
                  <button
                    key={c}
                    className={`screenshot-editor-color${selected.color === c ? ' active' : ''}`}
                    style={{ background: c }}
                    onClick={() => changeSelectedColor(c)}
                  />
                ))}
              </div>
              <div className="screenshot-editor-font-size">
                <button className="settings-action-btn" onClick={() => changeSelectedFontSize(-8)}>
                  A-
                </button>
                <button className="settings-action-btn" onClick={() => changeSelectedFontSize(8)}>
                  A+
                </button>
              </div>
              <button className="danger" onClick={() => deleteAnnotation(selected.id)}>
                削除
              </button>
            </>
          )}
        </div>

        <div className="screenshot-editor-canvas-area">
          <div className="screenshot-editor-image-wrap" ref={wrapRef} onClick={handleBackgroundClick}>
            <img
              ref={imgRef}
              src={imageDataUrl}
              alt="スクリーンショット"
              className="screenshot-editor-image"
              onLoad={recomputeScale}
            />
            {annotations.map((a) => (
              <div
                key={a.id}
                className={`screenshot-text-box${selectedId === a.id ? ' selected' : ''}`}
                style={{ left: `${a.xFrac * 100}%`, top: `${a.yFrac * 100}%` }}
                onPointerDown={(e) => handleBoxPointerDown(e, a)}
                onClick={(e) => e.stopPropagation()}
              >
                {editingId === a.id ? (
                  <textarea
                    ref={(el) => {
                      if (el) inputRefs.current.set(a.id, el)
                      else inputRefs.current.delete(a.id)
                    }}
                    className="screenshot-text-input"
                    style={{ color: a.color, fontSize: `${a.fontSize * editorScale}px` }}
                    value={a.text}
                    onChange={(e) => updateAnnotation(a.id, { text: e.target.value })}
                    onBlur={() => exitEditing(a.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') e.currentTarget.blur()
                    }}
                  />
                ) : (
                  <div
                    className="screenshot-text-display"
                    style={{ color: a.color, fontSize: `${a.fontSize * editorScale}px` }}
                  >
                    {a.text}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {errorMessage && <p className="error">{errorMessage}</p>}

        <div className="screenshot-editor-footer">
          <button onClick={onCancel} disabled={saving}>
            キャンセル
          </button>
          <button className="primary" onClick={handleSave} disabled={saving}>
            {saving ? '保存中...' : '保存'}
          </button>
        </div>
      </div>
    </div>
  )
}
