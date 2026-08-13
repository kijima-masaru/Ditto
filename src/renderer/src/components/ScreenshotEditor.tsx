import { useCallback, useEffect, useRef, useState } from 'react'

type ShapeKind = 'rect' | 'ellipse'
type LineStyle = 'straight' | 'arrow' | 'curve'

interface TextAnnotation {
  id: string
  kind: 'text'
  /** 画像の実ピクセルサイズに対する割合(0〜1)。テキスト中心の座標 */
  xFrac: number
  yFrac: number
  text: string
  fontColor: string
  bgColor: string | null
  borderColor: string | null
  /** 画像の実ピクセル基準のフォントサイズ */
  fontSize: number
}

interface ShapeAnnotation {
  id: string
  kind: ShapeKind
  /** 左上を基準にした割合座標 */
  xFrac: number
  yFrac: number
  widthFrac: number
  heightFrac: number
  borderColor: string | null
  bgColor: string | null
}

interface LineAnnotation {
  id: string
  kind: 'line'
  style: LineStyle
  x1Frac: number
  y1Frac: number
  x2Frac: number
  y2Frac: number
  /** 曲線の制御点(2次ベジェ)。style==='curve'の時のみ使用。生成時はp1-p2の中点にし、
   *  中点を制御点にすると直線と全く同じ形になるため、曲線に切り替えた瞬間の見た目が飛ばない */
  cxFrac: number
  cyFrac: number
  color: string
}

type Annotation = TextAnnotation | ShapeAnnotation | LineAnnotation
type AnnotationPatch = Partial<TextAnnotation> & Partial<ShapeAnnotation> & Partial<LineAnnotation>

const COLORS = ['#ff3b30', '#ffd60a', '#34c759', '#0a84ff', '#ffffff', '#000000']
const DEFAULT_FONT_SIZE = 48
const MIN_FONT_SIZE = 16
const MAX_FONT_SIZE = 200
const DEFAULT_SHAPE_W = 0.22
const DEFAULT_SHAPE_H = 0.16
const MIN_SHAPE_FRAC = 0.02
const DEFAULT_LINE_HALF = 0.12
const STROKE_WIDTH_PX = 3
const DRAG_THRESHOLD = 3

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v))
}

interface Props {
  imageDataUrl: string
  onCancel: () => void
  onSaved: (path: string) => void
}

export default function ScreenshotEditor({ imageDataUrl, onCancel, onSaved }: Props): React.JSX.Element {
  const [annotations, setAnnotations] = useState<Annotation[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editingTextId, setEditingTextId] = useState<string | null>(null)
  const [renderedSize, setRenderedSize] = useState({ width: 0, height: 0 })
  const [saving, setSaving] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const imgRef = useRef<HTMLImageElement | null>(null)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const inputRefs = useRef<Map<string, HTMLTextAreaElement>>(new Map())
  const dragRef = useRef<{
    id: string
    mode: 'move' | 'resize' | 'p1' | 'p2' | 'curve'
    startX: number
    startY: number
    start: Annotation
    moved: boolean
  } | null>(null)
  const nextOffsetRef = useRef(0)

  const recomputeSize = useCallback(() => {
    const img = imgRef.current
    if (img && img.naturalWidth > 0) {
      setRenderedSize({ width: img.clientWidth, height: img.clientHeight })
    }
  }, [])

  useEffect(() => {
    window.addEventListener('resize', recomputeSize)
    return () => window.removeEventListener('resize', recomputeSize)
  }, [recomputeSize])

  useEffect(() => {
    if (!editingTextId) return
    const el = inputRefs.current.get(editingTextId)
    if (el) {
      el.focus()
      el.setSelectionRange(el.value.length, el.value.length)
    }
  }, [editingTextId])

  const editorScale =
    imgRef.current && imgRef.current.naturalWidth > 0 ? renderedSize.width / imgRef.current.naturalWidth : 1

  const updateAnnotation = (id: string, patch: AnnotationPatch): void => {
    setAnnotations((prev) => prev.map((a) => (a.id === id ? ({ ...a, ...patch } as Annotation) : a)))
  }

  const deleteAnnotation = (id: string): void => {
    setAnnotations((prev) => prev.filter((a) => a.id !== id))
    setSelectedId((cur) => (cur === id ? null : cur))
    setEditingTextId((cur) => (cur === id ? null : cur))
  }

  const exitTextEditing = useCallback((id: string): void => {
    setEditingTextId((cur) => (cur === id ? null : cur))
    setAnnotations((prev) => prev.filter((a) => a.id !== id || a.kind !== 'text' || a.text.trim() !== ''))
  }, [])

  const nextId = (): string => {
    const offset = nextOffsetRef.current
    nextOffsetRef.current += 1
    return `${Date.now()}-${offset}`
  }

  const nextJitter = (): number => (nextOffsetRef.current % 5) * 0.03

  const addText = (): void => {
    const id = nextId()
    const jitter = nextJitter()
    const next: TextAnnotation = {
      id,
      kind: 'text',
      xFrac: 0.5 + jitter,
      yFrac: 0.5 + jitter,
      text: '',
      fontColor: COLORS[0],
      bgColor: null,
      borderColor: null,
      fontSize: DEFAULT_FONT_SIZE
    }
    setAnnotations((prev) => [...prev, next])
    setSelectedId(id)
    setEditingTextId(id)
  }

  const addShape = (kind: ShapeKind): void => {
    const id = nextId()
    const jitter = nextJitter()
    const next: ShapeAnnotation = {
      id,
      kind,
      xFrac: 0.5 - DEFAULT_SHAPE_W / 2 + jitter,
      yFrac: 0.5 - DEFAULT_SHAPE_H / 2 + jitter,
      widthFrac: DEFAULT_SHAPE_W,
      heightFrac: DEFAULT_SHAPE_H,
      borderColor: COLORS[0],
      bgColor: null
    }
    setAnnotations((prev) => [...prev, next])
    setSelectedId(id)
  }

  const addLine = (): void => {
    const id = nextId()
    const jitter = nextJitter()
    const x1 = 0.5 - DEFAULT_LINE_HALF + jitter
    const x2 = 0.5 + DEFAULT_LINE_HALF + jitter
    const y = 0.5 + jitter
    const next: LineAnnotation = {
      id,
      kind: 'line',
      style: 'straight',
      x1Frac: x1,
      y1Frac: y,
      x2Frac: x2,
      y2Frac: y,
      cxFrac: (x1 + x2) / 2,
      cyFrac: y,
      color: COLORS[0]
    }
    setAnnotations((prev) => [...prev, next])
    setSelectedId(id)
  }

  const beginDrag = (
    e: React.PointerEvent,
    a: Annotation,
    mode: 'move' | 'resize' | 'p1' | 'p2' | 'curve'
  ): void => {
    if (a.kind === 'text' && editingTextId === a.id) return
    e.stopPropagation()
    dragRef.current = { id: a.id, mode, startX: e.clientX, startY: e.clientY, start: { ...a }, moved: false }
    window.addEventListener('pointermove', handleWindowPointerMove)
    window.addEventListener('pointerup', handleWindowPointerUp)
  }

  const handleWindowPointerMove = (e: PointerEvent): void => {
    const drag = dragRef.current
    const wrap = wrapRef.current
    if (!drag || !wrap) return
    const rect = wrap.getBoundingClientRect()
    const dxPx = e.clientX - drag.startX
    const dyPx = e.clientY - drag.startY
    if (!drag.moved && (Math.abs(dxPx) > DRAG_THRESHOLD || Math.abs(dyPx) > DRAG_THRESHOLD)) drag.moved = true
    if (!drag.moved) return
    const dx = dxPx / rect.width
    const dy = dyPx / rect.height
    const start = drag.start

    if (start.kind === 'text') {
      if (drag.mode === 'move') {
        updateAnnotation(drag.id, { xFrac: clamp01(start.xFrac + dx), yFrac: clamp01(start.yFrac + dy) })
      }
    } else if (start.kind === 'rect' || start.kind === 'ellipse') {
      if (drag.mode === 'move') {
        // 図形全体が画面外へ出て操作不能にならないよう、左上を基準に全体が枠内に収まる範囲でクランプする
        const maxX = Math.max(0, 1 - start.widthFrac)
        const maxY = Math.max(0, 1 - start.heightFrac)
        updateAnnotation(drag.id, {
          xFrac: Math.min(maxX, Math.max(0, start.xFrac + dx)),
          yFrac: Math.min(maxY, Math.max(0, start.yFrac + dy))
        })
      } else if (drag.mode === 'resize') {
        updateAnnotation(drag.id, {
          widthFrac: Math.min(1 - start.xFrac, Math.max(MIN_SHAPE_FRAC, start.widthFrac + dx)),
          heightFrac: Math.min(1 - start.yFrac, Math.max(MIN_SHAPE_FRAC, start.heightFrac + dy))
        })
      }
    } else if (start.kind === 'line') {
      if (drag.mode === 'move') {
        // 端点・制御点いずれかが画面外に出ないよう、全体の平行移動量をまとめてクランプする
        // (個別にクランプすると線の形が歪んでしまうため)
        const xs = [start.x1Frac, start.x2Frac, start.cxFrac]
        const ys = [start.y1Frac, start.y2Frac, start.cyFrac]
        const minX = Math.min(...xs)
        const maxX = Math.max(...xs)
        const minY = Math.min(...ys)
        const maxY = Math.max(...ys)
        const clampedDx = Math.min(1 - maxX, Math.max(0 - minX, dx))
        const clampedDy = Math.min(1 - maxY, Math.max(0 - minY, dy))
        updateAnnotation(drag.id, {
          x1Frac: start.x1Frac + clampedDx,
          y1Frac: start.y1Frac + clampedDy,
          x2Frac: start.x2Frac + clampedDx,
          y2Frac: start.y2Frac + clampedDy,
          cxFrac: start.cxFrac + clampedDx,
          cyFrac: start.cyFrac + clampedDy
        })
      } else if (drag.mode === 'p1') {
        updateAnnotation(drag.id, { x1Frac: clamp01(start.x1Frac + dx), y1Frac: clamp01(start.y1Frac + dy) })
      } else if (drag.mode === 'p2') {
        updateAnnotation(drag.id, { x2Frac: clamp01(start.x2Frac + dx), y2Frac: clamp01(start.y2Frac + dy) })
      } else if (drag.mode === 'curve') {
        updateAnnotation(drag.id, { cxFrac: clamp01(start.cxFrac + dx), cyFrac: clamp01(start.cyFrac + dy) })
      }
    }
  }

  const handleWindowPointerUp = (): void => {
    const drag = dragRef.current
    window.removeEventListener('pointermove', handleWindowPointerMove)
    window.removeEventListener('pointerup', handleWindowPointerUp)
    if (!drag) return
    dragRef.current = null
    if (!drag.moved) {
      if (drag.start.kind === 'text' && selectedId === drag.id) {
        setEditingTextId(drag.id)
      } else {
        setSelectedId(drag.id)
      }
    }
  }

  const handleBackgroundClick = (): void => {
    if (editingTextId) exitTextEditing(editingTextId)
    setSelectedId(null)
  }

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (!selectedId || editingTextId) return
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        deleteAnnotation(selectedId)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [selectedId, editingTextId])

  const selected = annotations.find((a) => a.id === selectedId) ?? null

  const changeSelectedFontSize = (delta: number): void => {
    if (!selected || selected.kind !== 'text') return
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

      const W = canvas.width
      const H = canvas.height
      const strokeW = Math.max(3, W * 0.004)

      // 図形・線を先に描画し、テキストは常にその上に重ねる(プレビュー画面のレイヤー順と揃える)
      for (const a of annotations) {
        if (a.kind === 'rect' || a.kind === 'ellipse') {
          const x = a.xFrac * W
          const y = a.yFrac * H
          const w = a.widthFrac * W
          const h = a.heightFrac * H
          ctx.beginPath()
          if (a.kind === 'rect') ctx.rect(x, y, w, h)
          else ctx.ellipse(x + w / 2, y + h / 2, Math.abs(w / 2), Math.abs(h / 2), 0, 0, Math.PI * 2)
          if (a.bgColor) {
            ctx.fillStyle = a.bgColor
            ctx.fill()
          }
          if (a.borderColor) {
            ctx.strokeStyle = a.borderColor
            ctx.lineWidth = strokeW
            ctx.stroke()
          }
        } else if (a.kind === 'line') {
          const x1 = a.x1Frac * W
          const y1 = a.y1Frac * H
          const x2 = a.x2Frac * W
          const y2 = a.y2Frac * H
          ctx.strokeStyle = a.color
          ctx.lineWidth = strokeW
          ctx.lineCap = 'round'
          ctx.beginPath()
          ctx.moveTo(x1, y1)
          if (a.style === 'curve') {
            ctx.quadraticCurveTo(a.cxFrac * W, a.cyFrac * H, x2, y2)
          } else {
            ctx.lineTo(x2, y2)
          }
          ctx.stroke()
          if (a.style === 'arrow') {
            const angle = Math.atan2(y2 - y1, x2 - x1)
            const headLen = Math.max(12, W * 0.015)
            ctx.beginPath()
            ctx.moveTo(x2, y2)
            ctx.lineTo(x2 - headLen * Math.cos(angle - Math.PI / 6), y2 - headLen * Math.sin(angle - Math.PI / 6))
            ctx.lineTo(x2 - headLen * Math.cos(angle + Math.PI / 6), y2 - headLen * Math.sin(angle + Math.PI / 6))
            ctx.closePath()
            ctx.fillStyle = a.color
            ctx.fill()
          }
        }
      }

      for (const a of annotations) {
        if (a.kind !== 'text') continue
        const lines = a.text.split('\n').filter((l) => l.length > 0)
        if (lines.length === 0) continue
        ctx.font = `700 ${a.fontSize}px 'Segoe UI', sans-serif`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        const lineHeight = a.fontSize * 1.25
        const centerX = a.xFrac * W
        const centerY = a.yFrac * H
        let maxWidth = 0
        for (const line of lines) maxWidth = Math.max(maxWidth, ctx.measureText(line).width)
        const boxW = maxWidth + a.fontSize * 0.6
        const boxH = lineHeight * lines.length + a.fontSize * 0.3
        if (a.bgColor) {
          ctx.fillStyle = a.bgColor
          ctx.fillRect(centerX - boxW / 2, centerY - boxH / 2, boxW, boxH)
        }
        if (a.borderColor) {
          ctx.strokeStyle = a.borderColor
          ctx.lineWidth = Math.max(2, a.fontSize * 0.05)
          ctx.strokeRect(centerX - boxW / 2, centerY - boxH / 2, boxW, boxH)
        }
        ctx.fillStyle = a.fontColor
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

  const W = renderedSize.width
  const H = renderedSize.height

  return (
    <div className="screenshot-editor-page">
      <div className="screenshot-editor-header">
        <span>スクリーンショットを確認</span>
        <button className="debug-log-close-btn" onClick={onCancel} title="閉じる">
          ×
        </button>
      </div>

      <div className="screenshot-editor-toolbar">
        <div className="screenshot-editor-insert-group">
          <button className="settings-action-btn" onClick={addText}>
            + テキスト
          </button>
          <button className="settings-action-btn" onClick={() => addShape('rect')}>
            + 四角形
          </button>
          <button className="settings-action-btn" onClick={() => addShape('ellipse')}>
            + 楕円
          </button>
          <button className="settings-action-btn" onClick={addLine}>
            + 線
          </button>
        </div>

        {selected && selected.kind === 'text' && (
          <>
            <PropertyGroup label="文字色">
              <ColorSwatches value={selected.fontColor} onChange={(c) => updateAnnotation(selected.id, { fontColor: c ?? COLORS[0] })} />
            </PropertyGroup>
            <PropertyGroup label="背景色">
              <ColorSwatches allowNone value={selected.bgColor} onChange={(c) => updateAnnotation(selected.id, { bgColor: c })} />
            </PropertyGroup>
            <PropertyGroup label="枠線">
              <ColorSwatches allowNone value={selected.borderColor} onChange={(c) => updateAnnotation(selected.id, { borderColor: c })} />
            </PropertyGroup>
            <PropertyGroup label="サイズ">
              <div className="screenshot-editor-font-size">
                <button className="settings-action-btn" onClick={() => changeSelectedFontSize(-8)}>
                  A-
                </button>
                <button className="settings-action-btn" onClick={() => changeSelectedFontSize(8)}>
                  A+
                </button>
              </div>
            </PropertyGroup>
          </>
        )}

        {selected && (selected.kind === 'rect' || selected.kind === 'ellipse') && (
          <>
            <PropertyGroup label="枠線">
              <ColorSwatches allowNone value={selected.borderColor} onChange={(c) => updateAnnotation(selected.id, { borderColor: c })} />
            </PropertyGroup>
            <PropertyGroup label="塗りつぶし">
              <ColorSwatches allowNone value={selected.bgColor} onChange={(c) => updateAnnotation(selected.id, { bgColor: c })} />
            </PropertyGroup>
          </>
        )}

        {selected && selected.kind === 'line' && (
          <>
            <PropertyGroup label="種類">
              <div className="screenshot-editor-line-style">
                <button
                  className={selected.style === 'straight' ? 'active' : ''}
                  onClick={() => updateAnnotation(selected.id, { style: 'straight' })}
                >
                  直線
                </button>
                <button
                  className={selected.style === 'arrow' ? 'active' : ''}
                  onClick={() => updateAnnotation(selected.id, { style: 'arrow' })}
                >
                  矢印
                </button>
                <button
                  className={selected.style === 'curve' ? 'active' : ''}
                  onClick={() => updateAnnotation(selected.id, { style: 'curve' })}
                >
                  曲線
                </button>
              </div>
            </PropertyGroup>
            <PropertyGroup label="色">
              <ColorSwatches value={selected.color} onChange={(c) => updateAnnotation(selected.id, { color: c ?? COLORS[0] })} />
            </PropertyGroup>
          </>
        )}

        {selected && (
          <button className="danger" onClick={() => deleteAnnotation(selected.id)}>
            削除
          </button>
        )}
      </div>

      <div className="screenshot-editor-canvas-area">
        <div className="screenshot-editor-image-wrap" ref={wrapRef} onClick={handleBackgroundClick}>
          <img ref={imgRef} src={imageDataUrl} alt="スクリーンショット" className="screenshot-editor-image" onLoad={recomputeSize} />

          {W > 0 && H > 0 && (
            <svg className="screenshot-annotation-svg" width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
              {annotations.map((a) => {
                if (a.kind === 'rect' || a.kind === 'ellipse') {
                  const x = a.xFrac * W
                  const y = a.yFrac * H
                  const w = a.widthFrac * W
                  const h = a.heightFrac * H
                  const isSelected = selectedId === a.id
                  return (
                    <g key={a.id} onClick={(e) => e.stopPropagation()}>
                      {a.kind === 'rect' ? (
                        <rect
                          x={x}
                          y={y}
                          width={w}
                          height={h}
                          fill={a.bgColor ?? 'transparent'}
                          stroke={a.borderColor ?? 'transparent'}
                          strokeWidth={STROKE_WIDTH_PX}
                          style={{ cursor: 'move' }}
                          onPointerDown={(e) => beginDrag(e, a, 'move')}
                        />
                      ) : (
                        <ellipse
                          cx={x + w / 2}
                          cy={y + h / 2}
                          rx={Math.abs(w / 2)}
                          ry={Math.abs(h / 2)}
                          fill={a.bgColor ?? 'transparent'}
                          stroke={a.borderColor ?? 'transparent'}
                          strokeWidth={STROKE_WIDTH_PX}
                          style={{ cursor: 'move' }}
                          onPointerDown={(e) => beginDrag(e, a, 'move')}
                        />
                      )}
                      {!a.bgColor && (
                        <rect
                          x={x}
                          y={y}
                          width={w}
                          height={h}
                          fill="transparent"
                          style={{ cursor: 'move', pointerEvents: 'all' }}
                          onPointerDown={(e) => beginDrag(e, a, 'move')}
                        />
                      )}
                      {isSelected && (
                        <>
                          <rect
                            x={x}
                            y={y}
                            width={w}
                            height={h}
                            fill="none"
                            stroke="#0a84ff"
                            strokeWidth={1}
                            strokeDasharray="4 3"
                            pointerEvents="none"
                          />
                          <rect
                            x={x + w - 8}
                            y={y + h - 8}
                            width={16}
                            height={16}
                            fill="#fff"
                            stroke="#333"
                            strokeWidth={1.5}
                            style={{ cursor: 'nwse-resize' }}
                            onPointerDown={(e) => beginDrag(e, a, 'resize')}
                          />
                        </>
                      )}
                    </g>
                  )
                }

                if (a.kind === 'line') {
                  const x1 = a.x1Frac * W
                  const y1 = a.y1Frac * H
                  const x2 = a.x2Frac * W
                  const y2 = a.y2Frac * H
                  const cx = a.cxFrac * W
                  const cy = a.cyFrac * H
                  const pathD = a.style === 'curve' ? `M ${x1} ${y1} Q ${cx} ${cy} ${x2} ${y2}` : `M ${x1} ${y1} L ${x2} ${y2}`
                  const isSelected = selectedId === a.id
                  let arrowPoints = ''
                  if (a.style === 'arrow') {
                    const angle = Math.atan2(y2 - y1, x2 - x1)
                    const headLen = 14
                    const p1x = x2 - headLen * Math.cos(angle - Math.PI / 6)
                    const p1y = y2 - headLen * Math.sin(angle - Math.PI / 6)
                    const p2x = x2 - headLen * Math.cos(angle + Math.PI / 6)
                    const p2y = y2 - headLen * Math.sin(angle + Math.PI / 6)
                    arrowPoints = `${x2},${y2} ${p1x},${p1y} ${p2x},${p2y}`
                  }
                  return (
                    <g key={a.id} onClick={(e) => e.stopPropagation()}>
                      <path d={pathD} fill="none" stroke={a.color} strokeWidth={STROKE_WIDTH_PX} strokeLinecap="round" pointerEvents="none" />
                      {a.style === 'arrow' && <polygon points={arrowPoints} fill={a.color} pointerEvents="none" />}
                      <path
                        d={pathD}
                        fill="none"
                        stroke="transparent"
                        strokeWidth={16}
                        style={{ cursor: 'move', pointerEvents: 'all' }}
                        onPointerDown={(e) => beginDrag(e, a, 'move')}
                      />
                      {isSelected && (
                        <>
                          <circle
                            cx={x1}
                            cy={y1}
                            r={7}
                            fill="#fff"
                            stroke="#0a84ff"
                            strokeWidth={2}
                            style={{ cursor: 'grab' }}
                            onPointerDown={(e) => beginDrag(e, a, 'p1')}
                          />
                          <circle
                            cx={x2}
                            cy={y2}
                            r={7}
                            fill="#fff"
                            stroke="#0a84ff"
                            strokeWidth={2}
                            style={{ cursor: 'grab' }}
                            onPointerDown={(e) => beginDrag(e, a, 'p2')}
                          />
                          {a.style === 'curve' && (
                            <circle
                              cx={cx}
                              cy={cy}
                              r={7}
                              fill="#ffd60a"
                              stroke="#333"
                              strokeWidth={1.5}
                              style={{ cursor: 'grab' }}
                              onPointerDown={(e) => beginDrag(e, a, 'curve')}
                            />
                          )}
                        </>
                      )}
                    </g>
                  )
                }

                return null
              })}
            </svg>
          )}

          {annotations.map((a) => {
            if (a.kind !== 'text') return null
            const isEditing = editingTextId === a.id
            return (
              <div
                key={a.id}
                className={`screenshot-text-box${selectedId === a.id ? ' selected' : ''}`}
                style={{ left: `${a.xFrac * 100}%`, top: `${a.yFrac * 100}%` }}
                onPointerDown={(e) => beginDrag(e, a, 'move')}
                onClick={(e) => e.stopPropagation()}
              >
                {isEditing ? (
                  <textarea
                    ref={(el) => {
                      if (el) inputRefs.current.set(a.id, el)
                      else inputRefs.current.delete(a.id)
                    }}
                    className="screenshot-text-input"
                    style={{
                      color: a.fontColor,
                      fontSize: `${a.fontSize * editorScale}px`,
                      background: a.bgColor ?? 'rgba(0, 0, 0, 0.35)',
                      borderColor: a.borderColor ?? 'rgba(255, 255, 255, 0.7)'
                    }}
                    value={a.text}
                    onChange={(e) => updateAnnotation(a.id, { text: e.target.value })}
                    onBlur={() => exitTextEditing(a.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') e.currentTarget.blur()
                    }}
                  />
                ) : (
                  <div
                    className="screenshot-text-display"
                    style={{
                      color: a.fontColor,
                      fontSize: `${a.fontSize * editorScale}px`,
                      background: a.bgColor ?? 'transparent',
                      border: a.borderColor ? `2px solid ${a.borderColor}` : 'none'
                    }}
                  >
                    {a.text}
                  </div>
                )}
              </div>
            )
          })}
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
  )
}

function PropertyGroup({ label, children }: { label: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="screenshot-editor-group">
      <span className="screenshot-editor-group-label">{label}</span>
      {children}
    </div>
  )
}

function ColorSwatches({
  value,
  onChange,
  allowNone
}: {
  value: string | null
  onChange: (color: string | null) => void
  allowNone?: boolean
}): React.JSX.Element {
  return (
    <div className="screenshot-editor-colors">
      {allowNone && (
        <button
          className={`screenshot-editor-color screenshot-editor-color--none${value === null ? ' active' : ''}`}
          onClick={() => onChange(null)}
          title="なし"
        />
      )}
      {COLORS.map((c) => (
        <button
          key={c}
          className={`screenshot-editor-color${value === c ? ' active' : ''}`}
          style={{ background: c }}
          onClick={() => onChange(c)}
        />
      ))}
    </div>
  )
}
