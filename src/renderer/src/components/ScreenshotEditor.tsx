import { useCallback, useEffect, useRef, useState } from 'react'

type ShapeKind = 'rect' | 'ellipse'
type LinePathStyle = 'straight' | 'curve' | 'kagi'
type ArrowEnds = 'none' | 'start' | 'end' | 'both'
type TextAlign = 'left' | 'center' | 'right'
type Point = { x: number; y: number }

interface TextAnnotation {
  id: string
  kind: 'text'
  xFrac: number
  yFrac: number
  text: string
  fontColor: string
  bgColor: string | null
  borderColor: string | null
  fontSize: number
  bold: boolean
  italic: boolean
  underline: boolean
  align: TextAlign
  lineHeight: number
  spaceBefore: boolean
  spaceAfter: boolean
}

interface ShapeAnnotation {
  id: string
  kind: ShapeKind
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
  pathStyle: LinePathStyle
  arrowEnds: ArrowEnds
  x1Frac: number
  y1Frac: number
  x2Frac: number
  y2Frac: number
  /** curveのベジェ制御点、またはカギ線の折れ点(pathStyleにより意味が変わる) */
  auxFrac: Point
  color: string
}

interface FreehandAnnotation {
  id: string
  kind: 'freehand'
  points: Point[]
  color: string
}

type Annotation = TextAnnotation | ShapeAnnotation | LineAnnotation | FreehandAnnotation
type AnnotationPatch = Partial<TextAnnotation> & Partial<ShapeAnnotation> & Partial<LineAnnotation> & Partial<FreehandAnnotation>

const SIMPLE_COLORS = ['#000000', '#ffffff', '#f1f3f4', '#9aa0a6', '#5f6368', '#20344c', '#8b4a2b', '#e07b1a', '#1a9e8f', '#f4c20d']
const PALETTE_HUES = [0, 20, 40, 60, 90, 150, 180, 205, 230, 260, 290, 320]
const PALETTE_LIGHTNESS = [88, 76, 64, 52, 40, 28, 16]

function hslToHex(h: number, s: number, l: number): string {
  const a = (s * Math.min(l, 100 - l)) / 100
  const f = (n: number): string => {
    const k = (n + h / 30) % 12
    const color = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))
    return Math.round(255 * (color / 100))
      .toString(16)
      .padStart(2, '0')
  }
  return `#${f(0)}${f(8)}${f(4)}`
}

function buildPaletteGrid(): string[][] {
  return PALETTE_LIGHTNESS.map((l) => PALETTE_HUES.map((h) => hslToHex(h, 65, l)))
}
const PALETTE_GRID = buildPaletteGrid()

const DEFAULT_FONT_SIZE = 48
const MIN_FONT_SIZE = 16
const MAX_FONT_SIZE = 200
const DEFAULT_SHAPE_W = 0.22
const DEFAULT_SHAPE_H = 0.16
const MIN_SHAPE_FRAC = 0.02
const DEFAULT_LINE_HALF = 0.12
const STROKE_WIDTH_PX = 3
const DRAG_THRESHOLD = 3
const LINE_HEIGHT_OPTIONS = [1, 1.15, 1.5, 2]

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v))
}

function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const lenSq = dx * dx + dy * dy
  if (lenSq === 0) return Math.hypot(p.x - a.x, p.y - a.y)
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq))
  const projX = a.x + t * dx
  const projY = a.y + t * dy
  return Math.hypot(p.x - projX, p.y - projY)
}

function smoothPathD(points: Point[], W: number, H: number): string {
  if (points.length === 0) return ''
  if (points.length === 1) {
    const x = points[0].x * W
    const y = points[0].y * H
    return `M ${x} ${y} L ${x} ${y}`
  }
  const px = (i: number): number => points[i].x * W
  const py = (i: number): number => points[i].y * H
  let d = `M ${px(0)} ${py(0)}`
  for (let i = 1; i < points.length - 1; i++) {
    const mx = (px(i) + px(i + 1)) / 2
    const my = (py(i) + py(i + 1)) / 2
    d += ` Q ${px(i)} ${py(i)} ${mx} ${my}`
  }
  d += ` L ${px(points.length - 1)} ${py(points.length - 1)}`
  return d
}

function linePathD(a: LineAnnotation, W: number, H: number): string {
  const x1 = a.x1Frac * W
  const y1 = a.y1Frac * H
  const x2 = a.x2Frac * W
  const y2 = a.y2Frac * H
  if (a.pathStyle === 'curve') {
    return `M ${x1} ${y1} Q ${a.auxFrac.x * W} ${a.auxFrac.y * H} ${x2} ${y2}`
  }
  if (a.pathStyle === 'kagi') {
    return `M ${x1} ${y1} L ${a.auxFrac.x * W} ${a.auxFrac.y * H} L ${x2} ${y2}`
  }
  return `M ${x1} ${y1} L ${x2} ${y2}`
}

function arrowHeadPoints(tip: Point, from: Point, size: number): string {
  const angle = Math.atan2(tip.y - from.y, tip.x - from.x)
  const p1x = tip.x - size * Math.cos(angle - Math.PI / 6)
  const p1y = tip.y - size * Math.sin(angle - Math.PI / 6)
  const p2x = tip.x - size * Math.cos(angle + Math.PI / 6)
  const p2y = tip.y - size * Math.sin(angle + Math.PI / 6)
  return `${tip.x},${tip.y} ${p1x},${p1y} ${p2x},${p2y}`
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
  const [drawTool, setDrawTool] = useState<'freehand' | null>(null)
  const [drawingPoints, setDrawingPoints] = useState<Point[] | null>(null)
  const [fileName, setFileName] = useState(() => `screenshot-${new Date().toISOString().replace(/[:.]/g, '-')}`)

  const imgRef = useRef<HTMLImageElement | null>(null)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const inputRefs = useRef<Map<string, HTMLTextAreaElement>>(new Map())
  const dragRef = useRef<{
    id: string
    mode: 'move' | 'resize' | 'p1' | 'p2' | 'aux'
    startX: number
    startY: number
    start: Annotation
    moved: boolean
  } | null>(null)
  const drawingRef = useRef<Point[] | null>(null)
  const justFinishedDrawingRef = useRef(false)
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
      fontColor: SIMPLE_COLORS_DEFAULT,
      bgColor: null,
      borderColor: null,
      fontSize: DEFAULT_FONT_SIZE,
      bold: false,
      italic: false,
      underline: false,
      align: 'center',
      lineHeight: 1.15,
      spaceBefore: false,
      spaceAfter: false
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
      borderColor: SIMPLE_COLORS_DEFAULT,
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
      pathStyle: 'straight',
      arrowEnds: 'none',
      x1Frac: x1,
      y1Frac: y,
      x2Frac: x2,
      y2Frac: y,
      auxFrac: { x: (x1 + x2) / 2, y },
      color: SIMPLE_COLORS_DEFAULT
    }
    setAnnotations((prev) => [...prev, next])
    setSelectedId(id)
  }

  const startFreehand = (): void => {
    setSelectedId(null)
    setDrawTool('freehand')
  }

  const reshapeFreehand = (a: FreehandAnnotation, target: 'curve' | 'kagi'): void => {
    const pts = a.points
    if (pts.length < 2) return
    const start = pts[0]
    const end = pts[pts.length - 1]
    let aux: Point
    if (target === 'curve') {
      let peak = pts[0]
      let maxDist = -1
      for (const p of pts) {
        const d = distanceToSegment(p, start, end)
        if (d > maxDist) {
          maxDist = d
          peak = p
        }
      }
      aux = { x: peak.x * 2 - (start.x + end.x) / 2, y: peak.y * 2 - (start.y + end.y) / 2 }
    } else {
      const bendA: Point = { x: end.x, y: start.y }
      const bendB: Point = { x: start.x, y: end.y }
      const mid = pts[Math.floor(pts.length / 2)]
      const distA = Math.hypot(mid.x - bendA.x, mid.y - bendA.y)
      const distB = Math.hypot(mid.x - bendB.x, mid.y - bendB.y)
      aux = distA <= distB ? bendA : bendB
    }
    const newLine: LineAnnotation = {
      id: a.id,
      kind: 'line',
      pathStyle: target,
      arrowEnds: 'none',
      x1Frac: start.x,
      y1Frac: start.y,
      x2Frac: end.x,
      y2Frac: end.y,
      auxFrac: aux,
      color: a.color
    }
    setAnnotations((prev) => prev.map((x) => (x.id === a.id ? newLine : x)))
  }

  const pointFromClient = (clientX: number, clientY: number): Point | null => {
    const wrap = wrapRef.current
    if (!wrap) return null
    const rect = wrap.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return null
    return { x: clamp01((clientX - rect.left) / rect.width), y: clamp01((clientY - rect.top) / rect.height) }
  }

  const handleWrapPointerDown = (e: React.PointerEvent): void => {
    if (drawTool !== 'freehand') return
    const p = pointFromClient(e.clientX, e.clientY)
    if (!p) return
    drawingRef.current = [p]
    setDrawingPoints([p])
    window.addEventListener('pointermove', handleDrawingPointerMove)
    window.addEventListener('pointerup', handleDrawingPointerUp)
  }

  const handleDrawingPointerMove = (e: PointerEvent): void => {
    const points = drawingRef.current
    if (!points) return
    const p = pointFromClient(e.clientX, e.clientY)
    if (!p) return
    const last = points[points.length - 1]
    if (Math.hypot(p.x - last.x, p.y - last.y) < 0.003) return
    points.push(p)
    setDrawingPoints([...points])
  }

  const handleDrawingPointerUp = (): void => {
    window.removeEventListener('pointermove', handleDrawingPointerMove)
    window.removeEventListener('pointerup', handleDrawingPointerUp)
    const points = drawingRef.current
    drawingRef.current = null
    setDrawingPoints(null)
    setDrawTool(null)
    if (!points || points.length < 2) return
    const id = nextId()
    const next: FreehandAnnotation = { id, kind: 'freehand', points, color: SIMPLE_COLORS_DEFAULT }
    setAnnotations((prev) => [...prev, next])
    setSelectedId(id)
    // pointerdown+upが完了すると直後にブラウザがclickイベントも発火し、それが
    // 背景クリック扱いになって選択を解除してしまうため、次のクリック1回だけ無視する
    justFinishedDrawingRef.current = true
  }

  const beginDrag = (e: React.PointerEvent, a: Annotation, mode: 'move' | 'resize' | 'p1' | 'p2' | 'aux'): void => {
    if (a.kind === 'text' && editingTextId === a.id) return
    if (drawTool) return
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
        const xs = [start.x1Frac, start.x2Frac, start.auxFrac.x]
        const ys = [start.y1Frac, start.y2Frac, start.auxFrac.y]
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
          auxFrac: { x: start.auxFrac.x + clampedDx, y: start.auxFrac.y + clampedDy }
        })
      } else if (drag.mode === 'p1') {
        updateAnnotation(drag.id, { x1Frac: clamp01(start.x1Frac + dx), y1Frac: clamp01(start.y1Frac + dy) })
      } else if (drag.mode === 'p2') {
        updateAnnotation(drag.id, { x2Frac: clamp01(start.x2Frac + dx), y2Frac: clamp01(start.y2Frac + dy) })
      } else if (drag.mode === 'aux') {
        updateAnnotation(drag.id, {
          auxFrac: { x: clamp01(start.auxFrac.x + dx), y: clamp01(start.auxFrac.y + dy) }
        })
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
    if (justFinishedDrawingRef.current) {
      justFinishedDrawingRef.current = false
      return
    }
    if (editingTextId) exitTextEditing(editingTextId)
    setSelectedId(null)
  }

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (!selectedId || editingTextId) return
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        deleteAnnotation(selectedId)
      } else if (e.key === 'Escape') {
        setSelectedId(null)
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
        } else if (a.kind === 'freehand') {
          if (a.points.length < 2) continue
          const pathD = smoothPathD(a.points, W, H)
          const path2d = new Path2D(pathD)
          ctx.strokeStyle = a.color
          ctx.lineWidth = strokeW
          ctx.lineCap = 'round'
          ctx.lineJoin = 'round'
          ctx.stroke(path2d)
        } else if (a.kind === 'line') {
          const p1: Point = { x: a.x1Frac * W, y: a.y1Frac * H }
          const p2: Point = { x: a.x2Frac * W, y: a.y2Frac * H }
          const aux: Point = { x: a.auxFrac.x * W, y: a.auxFrac.y * H }
          ctx.strokeStyle = a.color
          ctx.lineWidth = strokeW
          ctx.lineCap = 'round'
          const path2d = new Path2D(linePathD(a, W, H))
          ctx.stroke(path2d)
          const headLen = Math.max(12, W * 0.015)
          if (a.arrowEnds === 'end' || a.arrowEnds === 'both') {
            const from = a.pathStyle === 'straight' ? p1 : aux
            const pts = arrowHeadPoints(p2, from, headLen)
            const poly = new Path2D(`M ${pts.split(' ').join(' L ')} Z`)
            ctx.fillStyle = a.color
            ctx.fill(poly)
          }
          if (a.arrowEnds === 'start' || a.arrowEnds === 'both') {
            const from = a.pathStyle === 'straight' ? p2 : aux
            const pts = arrowHeadPoints(p1, from, headLen)
            const poly = new Path2D(`M ${pts.split(' ').join(' L ')} Z`)
            ctx.fillStyle = a.color
            ctx.fill(poly)
          }
        }
      }

      for (const a of annotations) {
        if (a.kind !== 'text') continue
        const lines = a.text.split('\n').filter((l) => l.length > 0)
        if (lines.length === 0) continue
        const weight = a.bold ? '700' : '400'
        const style = a.italic ? 'italic' : 'normal'
        ctx.font = `${style} ${weight} ${a.fontSize}px 'Segoe UI', sans-serif`
        ctx.textAlign = a.align === 'left' ? 'left' : a.align === 'right' ? 'right' : 'center'
        ctx.textBaseline = 'middle'
        const lineHeight = a.fontSize * a.lineHeight
        const spacing = a.fontSize * 0.3
        const spaceBefore = a.spaceBefore ? spacing : 0
        const spaceAfter = a.spaceAfter ? spacing : 0
        const centerX = a.xFrac * W
        const centerY = a.yFrac * H
        let maxWidth = 0
        for (const line of lines) maxWidth = Math.max(maxWidth, ctx.measureText(line).width)
        const textBlockHeight = lineHeight * lines.length
        const boxH = textBlockHeight + a.fontSize * 0.3 + spaceBefore + spaceAfter
        const boxW = maxWidth + a.fontSize * 0.6
        const boxTop = centerY - boxH / 2
        if (a.bgColor) {
          ctx.fillStyle = a.bgColor
          ctx.fillRect(centerX - boxW / 2, boxTop, boxW, boxH)
        }
        if (a.borderColor) {
          ctx.strokeStyle = a.borderColor
          ctx.lineWidth = Math.max(2, a.fontSize * 0.05)
          ctx.strokeRect(centerX - boxW / 2, boxTop, boxW, boxH)
        }
        ctx.fillStyle = a.fontColor
        const textStartY = boxTop + spaceBefore + a.fontSize * 0.15 + lineHeight / 2
        const anchorX = a.align === 'left' ? centerX - boxW / 2 + a.fontSize * 0.3 : a.align === 'right' ? centerX + boxW / 2 - a.fontSize * 0.3 : centerX
        lines.forEach((line, i) => {
          const y = textStartY + i * lineHeight
          ctx.fillText(line, anchorX, y)
          if (a.underline) {
            const w = ctx.measureText(line).width
            const underlineY = y + a.fontSize * 0.35
            const startX = a.align === 'left' ? anchorX : a.align === 'right' ? anchorX - w : anchorX - w / 2
            ctx.strokeStyle = a.fontColor
            ctx.lineWidth = Math.max(1, a.fontSize * 0.04)
            ctx.beginPath()
            ctx.moveTo(startX, underlineY)
            ctx.lineTo(startX + w, underlineY)
            ctx.stroke()
          }
        })
      }

      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
      if (!blob) throw new Error('画像の書き出しに失敗しました')
      const bytes = new Uint8Array(await blob.arrayBuffer())
      const path = await window.api.saveScreenshot(bytes, fileName)
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
        <div className="se-icon-group">
          <button className="se-icon-btn" onClick={addText} title="テキストを追加">
            <TextGlyph />
          </button>
          <button className="se-icon-btn" onClick={() => addShape('rect')} title="四角形を追加">
            <RectIcon />
          </button>
          <button className="se-icon-btn" onClick={() => addShape('ellipse')} title="楕円を追加">
            <EllipseIcon />
          </button>
          <button className="se-icon-btn" onClick={addLine} title="線を追加">
            <LineIcon />
          </button>
          <button
            className={`se-icon-btn${drawTool === 'freehand' ? ' active' : ''}`}
            onClick={startFreehand}
            title="フリーハンドで描く"
          >
            <PenIcon />
          </button>
        </div>

        {selected && selected.kind === 'text' && (
          <TextProperties
            annotation={selected}
            onChange={(patch) => updateAnnotation(selected.id, patch)}
            onFontSizeDelta={changeSelectedFontSize}
          />
        )}

        {selected && (selected.kind === 'rect' || selected.kind === 'ellipse') && (
          <div className="se-icon-group se-icon-group--divider">
            <ColorPicker
              value={selected.borderColor}
              onChange={(c) => updateAnnotation(selected.id, { borderColor: c })}
              allowNone
              icon={<BorderColorIcon />}
              title="枠線の色"
            />
            <ColorPicker
              value={selected.bgColor}
              onChange={(c) => updateAnnotation(selected.id, { bgColor: c })}
              allowNone
              icon={<FillColorIcon />}
              title="塗りつぶしの色"
            />
          </div>
        )}

        {selected && selected.kind === 'line' && (
          <div className="se-icon-group se-icon-group--divider">
            <button
              className={`se-icon-btn${selected.pathStyle === 'straight' ? ' active' : ''}`}
              onClick={() => updateAnnotation(selected.id, { pathStyle: 'straight' })}
              title="直線"
            >
              <LineIcon />
            </button>
            <button
              className={`se-icon-btn${selected.pathStyle === 'curve' ? ' active' : ''}`}
              onClick={() => updateAnnotation(selected.id, { pathStyle: 'curve' })}
              title="曲線"
            >
              <CurveIcon />
            </button>
            <button
              className={`se-icon-btn${selected.pathStyle === 'kagi' ? ' active' : ''}`}
              onClick={() => updateAnnotation(selected.id, { pathStyle: 'kagi' })}
              title="カギ線"
            >
              <KagiIcon />
            </button>
            <span className="se-sep" />
            <button
              className={`se-icon-btn${selected.arrowEnds === 'none' ? ' active' : ''}`}
              onClick={() => updateAnnotation(selected.id, { arrowEnds: 'none' })}
              title="矢印なし"
            >
              <ArrowNoneIcon />
            </button>
            <button
              className={`se-icon-btn${selected.arrowEnds === 'start' ? ' active' : ''}`}
              onClick={() => updateAnnotation(selected.id, { arrowEnds: 'start' })}
              title="矢印(始点)"
            >
              <ArrowStartIcon />
            </button>
            <button
              className={`se-icon-btn${selected.arrowEnds === 'end' ? ' active' : ''}`}
              onClick={() => updateAnnotation(selected.id, { arrowEnds: 'end' })}
              title="矢印(終点)"
            >
              <ArrowEndIcon />
            </button>
            <button
              className={`se-icon-btn${selected.arrowEnds === 'both' ? ' active' : ''}`}
              onClick={() => updateAnnotation(selected.id, { arrowEnds: 'both' })}
              title="矢印(両端)"
            >
              <ArrowBothIcon />
            </button>
            <span className="se-sep" />
            <ColorPicker
              value={selected.color}
              onChange={(c) => updateAnnotation(selected.id, { color: c ?? SIMPLE_COLORS_DEFAULT })}
              icon={<LineColorIcon />}
              title="線の色"
            />
          </div>
        )}

        {selected && selected.kind === 'freehand' && (
          <div className="se-icon-group se-icon-group--divider">
            <button className="se-text-btn" onClick={() => reshapeFreehand(selected, 'curve')} title="曲線に整形">
              曲線に整形
            </button>
            <button className="se-text-btn" onClick={() => reshapeFreehand(selected, 'kagi')} title="カギ線に整形">
              カギ線に整形
            </button>
            <span className="se-sep" />
            <ColorPicker
              value={selected.color}
              onChange={(c) => updateAnnotation(selected.id, { color: c ?? SIMPLE_COLORS_DEFAULT })}
              icon={<LineColorIcon />}
              title="線の色"
            />
          </div>
        )}

        {selected && (
          <button className="se-icon-btn se-icon-btn--danger" onClick={() => deleteAnnotation(selected.id)} title="削除">
            <TrashIcon />
          </button>
        )}
      </div>

      <div className="screenshot-editor-canvas-area">
        <div
          className={`screenshot-editor-image-wrap${drawTool ? ' drawing' : ''}`}
          ref={wrapRef}
          onClick={handleBackgroundClick}
          onPointerDown={handleWrapPointerDown}
        >
          <img ref={imgRef} src={imageDataUrl} alt="スクリーンショット" className="screenshot-editor-image" onLoad={recomputeSize} />

          {W > 0 && H > 0 && (
            <svg className="screenshot-annotation-svg" width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
              {drawingPoints && drawingPoints.length > 1 && (
                <path d={smoothPathD(drawingPoints, W, H)} fill="none" stroke={SIMPLE_COLORS_DEFAULT} strokeWidth={STROKE_WIDTH_PX} strokeLinecap="round" strokeLinejoin="round" />
              )}
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
                          <rect x={x} y={y} width={w} height={h} fill="none" stroke="#0a84ff" strokeWidth={1} strokeDasharray="4 3" pointerEvents="none" />
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

                if (a.kind === 'freehand') {
                  const isSelected = selectedId === a.id
                  const d = smoothPathD(a.points, W, H)
                  return (
                    <g key={a.id} onClick={(e) => e.stopPropagation()}>
                      <path
                        d={d}
                        fill="none"
                        stroke={a.color}
                        strokeWidth={isSelected ? STROKE_WIDTH_PX + 1 : STROKE_WIDTH_PX}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        pointerEvents="none"
                      />
                      <path
                        d={d}
                        fill="none"
                        stroke="transparent"
                        strokeWidth={16}
                        style={{ cursor: 'move', pointerEvents: 'all' }}
                        onPointerDown={(e) => beginDrag(e, a, 'move')}
                      />
                    </g>
                  )
                }

                if (a.kind === 'line') {
                  const x1 = a.x1Frac * W
                  const y1 = a.y1Frac * H
                  const x2 = a.x2Frac * W
                  const y2 = a.y2Frac * H
                  const aux = { x: a.auxFrac.x * W, y: a.auxFrac.y * H }
                  const isSelected = selectedId === a.id
                  const pathD = linePathD(a, W, H)
                  const headLen = 14
                  const endFrom = a.pathStyle === 'straight' ? { x: x1, y: y1 } : aux
                  const startFrom = a.pathStyle === 'straight' ? { x: x2, y: y2 } : aux
                  return (
                    <g key={a.id} onClick={(e) => e.stopPropagation()}>
                      <path d={pathD} fill="none" stroke={a.color} strokeWidth={STROKE_WIDTH_PX} strokeLinecap="round" pointerEvents="none" />
                      {(a.arrowEnds === 'end' || a.arrowEnds === 'both') && (
                        <polygon points={arrowHeadPoints({ x: x2, y: y2 }, endFrom, headLen)} fill={a.color} pointerEvents="none" />
                      )}
                      {(a.arrowEnds === 'start' || a.arrowEnds === 'both') && (
                        <polygon points={arrowHeadPoints({ x: x1, y: y1 }, startFrom, headLen)} fill={a.color} pointerEvents="none" />
                      )}
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
                          <circle cx={x1} cy={y1} r={7} fill="#fff" stroke="#0a84ff" strokeWidth={2} style={{ cursor: 'grab' }} onPointerDown={(e) => beginDrag(e, a, 'p1')} />
                          <circle cx={x2} cy={y2} r={7} fill="#fff" stroke="#0a84ff" strokeWidth={2} style={{ cursor: 'grab' }} onPointerDown={(e) => beginDrag(e, a, 'p2')} />
                          {a.pathStyle !== 'straight' && (
                            <circle cx={aux.x} cy={aux.y} r={7} fill="#ffd60a" stroke="#333" strokeWidth={1.5} style={{ cursor: 'grab' }} onPointerDown={(e) => beginDrag(e, a, 'aux')} />
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
            const spaceBeforePx = a.spaceBefore ? a.fontSize * editorScale * 0.3 : 0
            const spaceAfterPx = a.spaceAfter ? a.fontSize * editorScale * 0.3 : 0
            const commonStyle: React.CSSProperties = {
              color: a.fontColor,
              fontSize: `${a.fontSize * editorScale}px`,
              fontWeight: a.bold ? 700 : 400,
              fontStyle: a.italic ? 'italic' : 'normal',
              textDecoration: a.underline ? 'underline' : 'none',
              textAlign: a.align,
              lineHeight: a.lineHeight,
              paddingTop: spaceBeforePx,
              paddingBottom: spaceAfterPx
            }
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
                    style={{ ...commonStyle, background: a.bgColor ?? 'rgba(0, 0, 0, 0.35)', borderColor: a.borderColor ?? 'rgba(255, 255, 255, 0.7)' }}
                    value={a.text}
                    onChange={(e) => updateAnnotation(a.id, { text: e.target.value })}
                    onBlur={() => exitTextEditing(a.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') e.currentTarget.blur()
                    }}
                  />
                ) : (
                  <div className="screenshot-text-display" style={{ ...commonStyle, background: a.bgColor ?? 'transparent', border: a.borderColor ? `2px solid ${a.borderColor}` : 'none' }}>
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
        <input
          className="screenshot-editor-filename"
          value={fileName}
          onChange={(e) => setFileName(e.target.value)}
          placeholder="ファイル名"
        />
        <span className="screenshot-editor-filename-ext">.png</span>
        <div className="screenshot-editor-footer-actions">
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

const SIMPLE_COLORS_DEFAULT = '#ff3b30'

function TextProperties({
  annotation,
  onChange,
  onFontSizeDelta
}: {
  annotation: TextAnnotation
  onChange: (patch: AnnotationPatch) => void
  onFontSizeDelta: (delta: number) => void
}): React.JSX.Element {
  const [lineMenuOpen, setLineMenuOpen] = useState(false)
  const [paraMenuOpen, setParaMenuOpen] = useState(false)

  return (
    <div className="se-icon-group se-icon-group--divider">
      <ColorPicker value={annotation.fontColor} onChange={(c) => onChange({ fontColor: c ?? SIMPLE_COLORS_DEFAULT })} icon={<FontColorIcon />} title="文字の色" />
      <ColorPicker value={annotation.bgColor} onChange={(c) => onChange({ bgColor: c })} allowNone icon={<FillColorIcon />} title="背景色" />
      <ColorPicker value={annotation.borderColor} onChange={(c) => onChange({ borderColor: c })} allowNone icon={<BorderColorIcon />} title="枠線の色" />
      <span className="se-sep" />
      <button className="se-icon-btn" onClick={() => onFontSizeDelta(-8)} title="文字を小さく">
        <span className="se-glyph">A-</span>
      </button>
      <button className="se-icon-btn" onClick={() => onFontSizeDelta(8)} title="文字を大きく">
        <span className="se-glyph">A+</span>
      </button>
      <span className="se-sep" />
      <button className={`se-icon-btn${annotation.bold ? ' active' : ''}`} onClick={() => onChange({ bold: !annotation.bold })} title="太字">
        <span className="se-glyph" style={{ fontWeight: 700 }}>
          B
        </span>
      </button>
      <button className={`se-icon-btn${annotation.italic ? ' active' : ''}`} onClick={() => onChange({ italic: !annotation.italic })} title="斜体">
        <span className="se-glyph" style={{ fontStyle: 'italic' }}>
          I
        </span>
      </button>
      <button className={`se-icon-btn${annotation.underline ? ' active' : ''}`} onClick={() => onChange({ underline: !annotation.underline })} title="下線">
        <span className="se-glyph" style={{ textDecoration: 'underline' }}>
          U
        </span>
      </button>
      <span className="se-sep" />
      <button className={`se-icon-btn${annotation.align === 'left' ? ' active' : ''}`} onClick={() => onChange({ align: 'left' })} title="左揃え">
        <AlignLeftIcon />
      </button>
      <button className={`se-icon-btn${annotation.align === 'center' ? ' active' : ''}`} onClick={() => onChange({ align: 'center' })} title="中央揃え">
        <AlignCenterIcon />
      </button>
      <button className={`se-icon-btn${annotation.align === 'right' ? ' active' : ''}`} onClick={() => onChange({ align: 'right' })} title="右揃え">
        <AlignRightIcon />
      </button>
      <span className="se-sep" />
      <div className="se-dropdown">
        <button className="se-icon-btn" onClick={() => setLineMenuOpen((o) => !o)} title="行間隔">
          <LineHeightIcon />
        </button>
        {lineMenuOpen && (
          <>
            <div className="se-dropdown-backdrop" onClick={() => setLineMenuOpen(false)} />
            <div className="se-dropdown-menu">
              {LINE_HEIGHT_OPTIONS.map((v) => (
                <button
                  key={v}
                  className={`se-dropdown-item${annotation.lineHeight === v ? ' checked' : ''}`}
                  onClick={() => {
                    onChange({ lineHeight: v })
                    setLineMenuOpen(false)
                  }}
                >
                  {annotation.lineHeight === v ? '✓ ' : '　'}
                  {v}行
                </button>
              ))}
            </div>
          </>
        )}
      </div>
      <div className="se-dropdown">
        <button className="se-icon-btn" onClick={() => setParaMenuOpen((o) => !o)} title="段落の間隔">
          <ParagraphSpacingIcon />
        </button>
        {paraMenuOpen && (
          <>
            <div className="se-dropdown-backdrop" onClick={() => setParaMenuOpen(false)} />
            <div className="se-dropdown-menu">
              <button
                className={`se-dropdown-item${annotation.spaceBefore ? ' checked' : ''}`}
                onClick={() => onChange({ spaceBefore: !annotation.spaceBefore })}
              >
                {annotation.spaceBefore ? '✓ ' : '　'}段落の前にスペースを追加
              </button>
              <button
                className={`se-dropdown-item${annotation.spaceAfter ? ' checked' : ''}`}
                onClick={() => onChange({ spaceAfter: !annotation.spaceAfter })}
              >
                {annotation.spaceAfter ? '✓ ' : '　'}段落の後にスペースを追加
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function ColorPicker({
  value,
  onChange,
  allowNone,
  icon,
  title
}: {
  value: string | null
  onChange: (color: string | null) => void
  allowNone?: boolean
  icon: React.ReactNode
  title: string
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const nativeInputRef = useRef<HTMLInputElement | null>(null)

  const openEyedropper = async (): Promise<void> => {
    const EyeDropperCtor = (window as unknown as { EyeDropper?: new () => { open: () => Promise<{ sRGBHex: string }> } })
      .EyeDropper
    if (!EyeDropperCtor) return
    try {
      const result = await new EyeDropperCtor().open()
      onChange(result.sRGBHex)
      setOpen(false)
    } catch {
      // ユーザーがキャンセルした場合は何もしない
    }
  }

  return (
    <div className="se-color-picker">
      <button className="se-icon-btn" onClick={() => setOpen((o) => !o)} title={title}>
        {icon}
        <span className="se-color-indicator" style={{ background: value ?? 'repeating-conic-gradient(#ccc 0% 25%, #fff 0% 50%) 0 0/8px 8px' }} />
      </button>
      {open && (
        <>
          <div className="se-dropdown-backdrop" onClick={() => setOpen(false)} />
          <div className="se-color-popover">
            <div className="se-color-section-label">シンプル</div>
            <div className="se-color-row">
              {SIMPLE_COLORS.map((c) => (
                <button
                  key={c}
                  className={`se-color-swatch${value === c ? ' active' : ''}`}
                  style={{ background: c }}
                  onClick={() => {
                    onChange(c)
                    setOpen(false)
                  }}
                />
              ))}
            </div>
            <div className="se-color-section-label">カスタム</div>
            <div className="se-color-row">
              <button className="se-color-swatch se-color-swatch--action" onClick={() => nativeInputRef.current?.click()} title="色を追加">
                +
              </button>
              <button className="se-color-swatch se-color-swatch--action" onClick={openEyedropper} title="スポイト">
                <EyedropperIcon />
              </button>
              <input
                ref={nativeInputRef}
                type="color"
                className="se-color-native-input"
                onChange={(e) => {
                  onChange(e.target.value)
                  setOpen(false)
                }}
              />
            </div>
            <div className="se-color-grid">
              {PALETTE_GRID.map((row, i) => (
                <div className="se-color-row" key={i}>
                  {row.map((c) => (
                    <button key={c} className="se-color-swatch" style={{ background: c }} onClick={() => { onChange(c); setOpen(false) }} />
                  ))}
                </div>
              ))}
            </div>
            {allowNone && (
              <button
                className="se-color-none-btn"
                onClick={() => {
                  onChange(null)
                  setOpen(false)
                }}
              >
                透明
              </button>
            )}
          </div>
        </>
      )}
    </div>
  )
}

function TextGlyph(): React.JSX.Element {
  return <span className="se-glyph">T</span>
}

function iconSvg(children: React.ReactNode): React.JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      {children}
    </svg>
  )
}

function RectIcon(): React.JSX.Element {
  return iconSvg(<rect x="3" y="5" width="18" height="14" rx="1" />)
}
function EllipseIcon(): React.JSX.Element {
  return iconSvg(<ellipse cx="12" cy="12" rx="9" ry="7" />)
}
function LineIcon(): React.JSX.Element {
  return iconSvg(<line x1="5" y1="19" x2="19" y2="5" />)
}
function CurveIcon(): React.JSX.Element {
  return iconSvg(<path d="M5 19 Q12 2 19 5" />)
}
function KagiIcon(): React.JSX.Element {
  return iconSvg(<path d="M5 19 L5 8 L19 8" />)
}
function PenIcon(): React.JSX.Element {
  return iconSvg(
    <>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </>
  )
}
function TrashIcon(): React.JSX.Element {
  return iconSvg(
    <>
      <path d="M3 6h18" />
      <path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />
      <path d="M19 6l-1 14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1L5 6" />
    </>
  )
}
function AlignLeftIcon(): React.JSX.Element {
  return iconSvg(
    <>
      <line x1="4" y1="6" x2="20" y2="6" />
      <line x1="4" y1="12" x2="14" y2="12" />
      <line x1="4" y1="18" x2="17" y2="18" />
    </>
  )
}
function AlignCenterIcon(): React.JSX.Element {
  return iconSvg(
    <>
      <line x1="4" y1="6" x2="20" y2="6" />
      <line x1="7" y1="12" x2="17" y2="12" />
      <line x1="6" y1="18" x2="18" y2="18" />
    </>
  )
}
function AlignRightIcon(): React.JSX.Element {
  return iconSvg(
    <>
      <line x1="4" y1="6" x2="20" y2="6" />
      <line x1="10" y1="12" x2="20" y2="12" />
      <line x1="7" y1="18" x2="20" y2="18" />
    </>
  )
}
function LineHeightIcon(): React.JSX.Element {
  return iconSvg(
    <>
      <path d="M7 3v18" />
      <path d="M4 6l3-3 3 3" />
      <path d="M4 18l3 3 3-3" />
      <line x1="13" y1="6" x2="20" y2="6" />
      <line x1="13" y1="12" x2="20" y2="12" />
      <line x1="13" y1="18" x2="20" y2="18" />
    </>
  )
}
function ParagraphSpacingIcon(): React.JSX.Element {
  return iconSvg(
    <>
      <line x1="4" y1="4" x2="20" y2="4" />
      <line x1="4" y1="10" x2="20" y2="10" />
      <line x1="4" y1="16" x2="20" y2="16" />
      <line x1="4" y1="21" x2="20" y2="21" />
    </>
  )
}
function ArrowNoneIcon(): React.JSX.Element {
  return iconSvg(<line x1="5" y1="12" x2="19" y2="12" />)
}
function ArrowEndIcon(): React.JSX.Element {
  return iconSvg(
    <>
      <line x1="5" y1="12" x2="19" y2="12" />
      <polyline points="14,7 19,12 14,17" />
    </>
  )
}
function ArrowStartIcon(): React.JSX.Element {
  return iconSvg(
    <>
      <line x1="5" y1="12" x2="19" y2="12" />
      <polyline points="10,7 5,12 10,17" />
    </>
  )
}
function ArrowBothIcon(): React.JSX.Element {
  return iconSvg(
    <>
      <line x1="5" y1="12" x2="19" y2="12" />
      <polyline points="10,7 5,12 10,17" />
      <polyline points="14,7 19,12 14,17" />
    </>
  )
}
function FontColorIcon(): React.JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24">
      <text x="12" y="16" fontSize="16" fontWeight="700" textAnchor="middle" fill="currentColor">
        A
      </text>
    </svg>
  )
}
function FillColorIcon(): React.JSX.Element {
  return iconSvg(
    <>
      <path d="M10 3l7 7-8 8-7-7z" />
      <path d="M3 18c0 1.7 1.3 3 3 3s3-1.3 3-3-3-5-3-5-3 3.3-3 5z" />
    </>
  )
}
function BorderColorIcon(): React.JSX.Element {
  return iconSvg(
    <>
      <rect x="4" y="4" width="16" height="16" rx="1" strokeDasharray="3 2" />
    </>
  )
}
function LineColorIcon(): React.JSX.Element {
  return iconSvg(<line x1="4" y1="19" x2="20" y2="5" />)
}
function EyedropperIcon(): React.JSX.Element {
  return iconSvg(
    <>
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L11 15l-4 1 1-4Z" />
    </>
  )
}
