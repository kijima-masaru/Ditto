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
  /** curveの2次ベジェ制御点 */
  auxFrac: Point
  /** カギ線の折れ点。フリーハンドの形に応じて複数になることがある */
  kagiPoints: Point[]
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

/** トリミング範囲(画像全体に対する割合)。x,yは左上角 */
type CropRect = { x: number; y: number; w: number; h: number }

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
const MIN_CROP_FRAC = 0.05
const MAX_HISTORY = 50

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

/** カギ線の折れ点群。未設定(空配列)の場合の既定の折れ点を1つ補う */
function kagiBendPoints(a: LineAnnotation): Point[] {
  return a.kagiPoints.length > 0 ? a.kagiPoints : [{ x: a.x2Frac, y: a.y1Frac }]
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
    let d = `M ${x1} ${y1}`
    for (const b of kagiBendPoints(a)) d += ` L ${b.x * W} ${b.y * H}`
    d += ` L ${x2} ${y2}`
    return d
  }
  return `M ${x1} ${y1} L ${x2} ${y2}`
}

/** 矢印の向きを決めるための「先端の1つ手前の点」を始点側・終点側それぞれ求める */
function lineArrowRefs(a: LineAnnotation, W: number, H: number): { startFrom: Point; endFrom: Point } {
  const p1: Point = { x: a.x1Frac * W, y: a.y1Frac * H }
  const p2: Point = { x: a.x2Frac * W, y: a.y2Frac * H }
  if (a.pathStyle === 'curve') {
    const aux: Point = { x: a.auxFrac.x * W, y: a.auxFrac.y * H }
    return { startFrom: aux, endFrom: aux }
  }
  if (a.pathStyle === 'kagi') {
    const bends = kagiBendPoints(a)
    const first: Point = { x: bends[0].x * W, y: bends[0].y * H }
    const last: Point = { x: bends[bends.length - 1].x * W, y: bends[bends.length - 1].y * H }
    return { startFrom: first, endFrom: last }
  }
  return { startFrom: p2, endFrom: p1 }
}

function arrowHeadPoints(tip: Point, from: Point, size: number): string {
  const angle = Math.atan2(tip.y - from.y, tip.x - from.x)
  const p1x = tip.x - size * Math.cos(angle - Math.PI / 6)
  const p1y = tip.y - size * Math.sin(angle - Math.PI / 6)
  const p2x = tip.x - size * Math.cos(angle + Math.PI / 6)
  const p2y = tip.y - size * Math.sin(angle + Math.PI / 6)
  return `${tip.x},${tip.y} ${p1x},${p1y} ${p2x},${p2y}`
}

const KAGI_SIMPLIFY_EPSILON = 0.02
const MAX_KAGI_VERTICES = 6

/** Douglas-Peuckerによるポリライン単純化。フリーハンドの形の骨格を少数の頂点に落とす */
function douglasPeucker(points: Point[], epsilon: number): Point[] {
  if (points.length < 3) return points
  const start = points[0]
  const end = points[points.length - 1]
  let maxDist = -1
  let index = 0
  for (let i = 1; i < points.length - 1; i++) {
    const d = distanceToSegment(points[i], start, end)
    if (d > maxDist) {
      maxDist = d
      index = i
    }
  }
  if (maxDist > epsilon) {
    const left = douglasPeucker(points.slice(0, index + 1), epsilon)
    const right = douglasPeucker(points.slice(index), epsilon)
    return [...left.slice(0, -1), ...right]
  }
  return [start, end]
}

/** 頂点数が多すぎる場合は許容誤差を広げながら単純化をやり直す */
function simplifyForKagi(points: Point[]): Point[] {
  let eps = KAGI_SIMPLIFY_EPSILON
  let simplified = douglasPeucker(points, eps)
  let guard = 0
  while (simplified.length > MAX_KAGI_VERTICES && guard < 8) {
    eps *= 1.6
    simplified = douglasPeucker(points, eps)
    guard++
  }
  return simplified
}

/**
 * 単純化した頂点列(始点・終点含む)から、水平・垂直線分のみで構成される
 * カギ線の折れ点列(始点・終点は含まない)を作る。頂点が3つ以上あれば
 * 折れ点も複数になり、フリーハンドの形の複雑さに応じた角ができる。
 */
function buildOrthogonalBends(vertices: Point[]): Point[] {
  const bends: Point[] = []
  const EPS = 0.003
  for (let i = 0; i < vertices.length - 1; i++) {
    const a = vertices[i]
    const b = vertices[i + 1]
    const dx = Math.abs(b.x - a.x)
    const dy = Math.abs(b.y - a.y)
    const corner: Point = dx >= dy ? { x: b.x, y: a.y } : { x: a.x, y: b.y }
    if (Math.hypot(corner.x - a.x, corner.y - a.y) > EPS && Math.hypot(corner.x - b.x, corner.y - b.y) > EPS) {
      bends.push(corner)
    }
    if (i < vertices.length - 2) bends.push(b)
  }
  return bends
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
  const [currentImageUrl, setCurrentImageUrl] = useState(imageDataUrl)
  const [cropMode, setCropMode] = useState(false)
  const [cropRect, setCropRect] = useState<CropRect | null>(null)

  const imgRef = useRef<HTMLImageElement | null>(null)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const inputRefs = useRef<Map<string, HTMLTextAreaElement>>(new Map())
  const cropDragRef = useRef<{
    mode: 'move' | 'nw' | 'ne' | 'sw' | 'se'
    startX: number
    startY: number
    start: CropRect
  } | null>(null)
  const dragRef = useRef<{
    id: string
    mode: 'move' | 'resize' | 'p1' | 'p2' | 'aux' | 'bend'
    bendIndex?: number
    startX: number
    startY: number
    start: Annotation
    moved: boolean
    beforeAnnotations: Annotation[]
  } | null>(null)
  const drawingRef = useRef<Point[] | null>(null)
  const justFinishedDrawingRef = useRef(false)
  const nextOffsetRef = useRef(0)

  // --- Undo/Redoの履歴管理 ---
  // annotationsRef: setState前後のタイミング差を気にせず「直前の確定状態」を
  // どのハンドラーからも参照できるようにするためのミラー
  const annotationsRef = useRef<Annotation[]>(annotations)
  useEffect(() => {
    annotationsRef.current = annotations
  }, [annotations])
  // currentImageUrlRef: トリミング適用でcurrentImageUrlが変わるため、Undoでは
  // 注釈だけでなく画像そのものも巻き戻す必要がある。そのための最新値ミラー
  const currentImageUrlRef = useRef<string>(currentImageUrl)
  useEffect(() => {
    currentImageUrlRef.current = currentImageUrl
  }, [currentImageUrl])
  interface HistoryEntry {
    annotations: Annotation[]
    imageUrl: string
  }
  const undoStackRef = useRef<HistoryEntry[]>([])
  const redoStackRef = useRef<HistoryEntry[]>([])
  // 履歴の中身自体はrefで持つが、Undo/Redoボタンのdisabled切り替えのため
  // 履歴が変化するたびにこのstateだけインクリメントして再レンダリングを促す
  const [historyVersion, setHistoryVersion] = useState(0)
  // テキスト編集モードに入った時点のannotationsスナップショット。
  // exitTextEditing時に「編集で実際に変化していれば」1回だけ履歴に積む
  const textEditSnapshotRef = useRef<Annotation[] | null>(null)

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

  // Undo履歴を1件積んでから更新する版。プロパティパネルのボタン類(色・線種・
  // 矢印の向き・太字/斜体/下線・配置・行間隔・文字サイズなど)から使う。
  // 画像URL(トリミング適用前の値)も一緒に保存し、Undo時に注釈と画像の
  // 対応がずれないようにする
  const pushHistory = useCallback((snapshot: Annotation[]): void => {
    undoStackRef.current.push({ annotations: snapshot, imageUrl: currentImageUrlRef.current })
    if (undoStackRef.current.length > MAX_HISTORY) undoStackRef.current.shift()
    redoStackRef.current = []
    setHistoryVersion((v) => v + 1)
  }, [])

  const updateAnnotationWithHistory = (id: string, patch: AnnotationPatch): void => {
    pushHistory(annotationsRef.current)
    updateAnnotation(id, patch)
    // プロパティパネル経由の変更は種類を問わずここを通るため、記憶したい
    // スタイル項目が含まれていれば一箇所でまとめてlocalStorageへ反映する
    const target = annotationsRef.current.find((a) => a.id === id)
    if (target) rememberStyle(target.kind, patch)
  }

  const undo = useCallback((): void => {
    const entry = undoStackRef.current.pop()
    if (!entry) return
    redoStackRef.current.push({ annotations: annotationsRef.current, imageUrl: currentImageUrlRef.current })
    if (redoStackRef.current.length > MAX_HISTORY) redoStackRef.current.shift()
    setAnnotations(entry.annotations)
    setCurrentImageUrl(entry.imageUrl)
    setSelectedId(null)
    setEditingTextId(null)
    textEditSnapshotRef.current = null
    setHistoryVersion((v) => v + 1)
  }, [])

  const redo = useCallback((): void => {
    const entry = redoStackRef.current.pop()
    if (!entry) return
    undoStackRef.current.push({ annotations: annotationsRef.current, imageUrl: currentImageUrlRef.current })
    if (undoStackRef.current.length > MAX_HISTORY) undoStackRef.current.shift()
    setAnnotations(entry.annotations)
    setCurrentImageUrl(entry.imageUrl)
    setSelectedId(null)
    setEditingTextId(null)
    textEditSnapshotRef.current = null
    setHistoryVersion((v) => v + 1)
  }, [])

  const deleteAnnotation = (id: string): void => {
    pushHistory(annotationsRef.current)
    setAnnotations((prev) => prev.filter((a) => a.id !== id))
    setSelectedId((cur) => (cur === id ? null : cur))
    setEditingTextId((cur) => (cur === id ? null : cur))
  }

  const exitTextEditing = useCallback(
    (id: string): void => {
      setEditingTextId((cur) => (cur === id ? null : cur))
      const before = textEditSnapshotRef.current
      textEditSnapshotRef.current = null
      if (before) {
        const beforeText = before.find((a) => a.id === id)
        const currentText = annotationsRef.current.find((a) => a.id === id)
        // updateAnnotationは変更のたびに新しいオブジェクトを作るため、参照が
        // 変わっていれば編集中に実際にテキストが変化したと判定できる
        if (beforeText !== currentText) pushHistory(before)
      }
      setAnnotations((prev) => prev.filter((a) => a.id !== id || a.kind !== 'text' || a.text.trim() !== ''))
    },
    [pushHistory]
  )

  const nextId = (): string => {
    const offset = nextOffsetRef.current
    nextOffsetRef.current += 1
    return `${Date.now()}-${offset}`
  }

  const nextJitter = (): number => (nextOffsetRef.current % 5) * 0.03

  const addText = (): void => {
    pushHistory(annotationsRef.current)
    const id = nextId()
    const jitter = nextJitter()
    const next: TextAnnotation = {
      id,
      kind: 'text',
      xFrac: 0.5 + jitter,
      yFrac: 0.5 + jitter,
      text: '',
      ...getLastTextStyle()
    }
    // 追加直後にそのまま編集モードへ入るため、「編集開始前」のスナップショットは
    // 追加後の状態(このnextを含む配列)にしておく
    textEditSnapshotRef.current = [...annotationsRef.current, next]
    setAnnotations((prev) => [...prev, next])
    setSelectedId(id)
    setEditingTextId(id)
  }

  const addShape = (kind: ShapeKind): void => {
    pushHistory(annotationsRef.current)
    const id = nextId()
    const jitter = nextJitter()
    const next: ShapeAnnotation = {
      id,
      kind,
      xFrac: 0.5 - DEFAULT_SHAPE_W / 2 + jitter,
      yFrac: 0.5 - DEFAULT_SHAPE_H / 2 + jitter,
      widthFrac: DEFAULT_SHAPE_W,
      heightFrac: DEFAULT_SHAPE_H,
      ...getLastShapeStyle()
    }
    setAnnotations((prev) => [...prev, next])
    setSelectedId(id)
  }

  const addLine = (): void => {
    pushHistory(annotationsRef.current)
    const id = nextId()
    const jitter = nextJitter()
    const x1 = 0.5 - DEFAULT_LINE_HALF + jitter
    const x2 = 0.5 + DEFAULT_LINE_HALF + jitter
    const y = 0.5 + jitter
    const next: LineAnnotation = {
      id,
      kind: 'line',
      x1Frac: x1,
      y1Frac: y,
      x2Frac: x2,
      y2Frac: y,
      auxFrac: { x: (x1 + x2) / 2, y },
      kagiPoints: [],
      ...getLastLineStyle()
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
    pushHistory(annotationsRef.current)
    const start = pts[0]
    const end = pts[pts.length - 1]
    let aux: Point
    let kagiPoints: Point[] = []
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
      // フリーハンドの形を少数の頂点に単純化してから直交な折れ点列に変換する。
      // 形が複雑なほど折れ点(角)も増える
      const vertices = simplifyForKagi(pts)
      kagiPoints = buildOrthogonalBends(vertices)
      aux = kagiPoints[0] ?? { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 }
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
      kagiPoints,
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
    if (cropMode) return
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
    pushHistory(annotationsRef.current)
    const id = nextId()
    const next: FreehandAnnotation = { id, kind: 'freehand', points, color: getLastFreehandColor() }
    setAnnotations((prev) => [...prev, next])
    setSelectedId(id)
    // pointerdown+upが完了すると直後にブラウザがclickイベントも発火し、それが
    // 背景クリック扱いになって選択を解除してしまうため、次のクリック1回だけ無視する
    justFinishedDrawingRef.current = true
  }

  const beginDrag = (
    e: React.PointerEvent,
    a: Annotation,
    mode: 'move' | 'resize' | 'p1' | 'p2' | 'aux' | 'bend',
    bendIndex?: number
  ): void => {
    if (a.kind === 'text' && editingTextId === a.id) return
    if (drawTool) return
    e.stopPropagation()
    dragRef.current = {
      id: a.id,
      mode,
      bendIndex,
      startX: e.clientX,
      startY: e.clientY,
      start: { ...a },
      moved: false,
      beforeAnnotations: annotationsRef.current
    }
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
        const kagiXs = start.kagiPoints.map((p) => p.x)
        const kagiYs = start.kagiPoints.map((p) => p.y)
        const xs = [start.x1Frac, start.x2Frac, start.auxFrac.x, ...kagiXs]
        const ys = [start.y1Frac, start.y2Frac, start.auxFrac.y, ...kagiYs]
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
          auxFrac: { x: start.auxFrac.x + clampedDx, y: start.auxFrac.y + clampedDy },
          kagiPoints: start.kagiPoints.map((p) => ({ x: p.x + clampedDx, y: p.y + clampedDy }))
        })
      } else if (drag.mode === 'p1') {
        updateAnnotation(drag.id, { x1Frac: clamp01(start.x1Frac + dx), y1Frac: clamp01(start.y1Frac + dy) })
      } else if (drag.mode === 'p2') {
        updateAnnotation(drag.id, { x2Frac: clamp01(start.x2Frac + dx), y2Frac: clamp01(start.y2Frac + dy) })
      } else if (drag.mode === 'aux') {
        updateAnnotation(drag.id, {
          auxFrac: { x: clamp01(start.auxFrac.x + dx), y: clamp01(start.auxFrac.y + dy) }
        })
      } else if (drag.mode === 'bend' && drag.bendIndex !== undefined) {
        const idx = drag.bendIndex
        const startBends = kagiBendPoints(start)
        const nextPoints = startBends.map((p, i) => (i === idx ? { x: clamp01(p.x + dx), y: clamp01(p.y + dy) } : p))
        updateAnnotation(drag.id, { kagiPoints: nextPoints })
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
        textEditSnapshotRef.current = annotationsRef.current
        setEditingTextId(drag.id)
      } else {
        setSelectedId(drag.id)
      }
    } else {
      // 実際にドラッグで動かした場合のみ、ドラッグ開始前の状態を1回だけ履歴に積む
      pushHistory(drag.beforeAnnotations)
    }
  }

  const handleBackgroundClick = (): void => {
    if (cropMode) return
    if (justFinishedDrawingRef.current) {
      justFinishedDrawingRef.current = false
      return
    }
    if (editingTextId) exitTextEditing(editingTextId)
    setSelectedId(null)
  }

  const startCrop = (): void => {
    setSelectedId(null)
    setDrawTool(null)
    setCropRect({ x: 0.08, y: 0.08, w: 0.84, h: 0.84 })
    setCropMode(true)
  }

  const cancelCrop = (): void => {
    setCropMode(false)
    setCropRect(null)
  }

  const beginCropDrag = (e: React.PointerEvent, mode: 'move' | 'nw' | 'ne' | 'sw' | 'se'): void => {
    if (!cropRect) return
    e.stopPropagation()
    cropDragRef.current = { mode, startX: e.clientX, startY: e.clientY, start: { ...cropRect } }
    window.addEventListener('pointermove', handleCropPointerMove)
    window.addEventListener('pointerup', handleCropPointerUp)
  }

  const handleCropPointerMove = (e: PointerEvent): void => {
    const drag = cropDragRef.current
    const wrap = wrapRef.current
    if (!drag || !wrap) return
    const rect = wrap.getBoundingClientRect()
    const dx = (e.clientX - drag.startX) / rect.width
    const dy = (e.clientY - drag.startY) / rect.height
    const s = drag.start

    if (drag.mode === 'move') {
      const maxX = Math.max(0, 1 - s.w)
      const maxY = Math.max(0, 1 - s.h)
      setCropRect({ x: Math.min(maxX, Math.max(0, s.x + dx)), y: Math.min(maxY, Math.max(0, s.y + dy)), w: s.w, h: s.h })
      return
    }

    let x = s.x
    let y = s.y
    let w = s.w
    let h = s.h
    if (drag.mode === 'nw' || drag.mode === 'sw') {
      const newX = clamp01(s.x + dx)
      w = s.x + s.w - newX
      x = newX
    }
    if (drag.mode === 'ne' || drag.mode === 'se') {
      w = clamp01(s.x + s.w + dx) - s.x
    }
    if (drag.mode === 'nw' || drag.mode === 'ne') {
      const newY = clamp01(s.y + dy)
      h = s.y + s.h - newY
      y = newY
    }
    if (drag.mode === 'sw' || drag.mode === 'se') {
      h = clamp01(s.y + s.h + dy) - s.y
    }
    if (w < MIN_CROP_FRAC) {
      if (drag.mode === 'nw' || drag.mode === 'sw') x = s.x + s.w - MIN_CROP_FRAC
      w = MIN_CROP_FRAC
    }
    if (h < MIN_CROP_FRAC) {
      if (drag.mode === 'nw' || drag.mode === 'ne') y = s.y + s.h - MIN_CROP_FRAC
      h = MIN_CROP_FRAC
    }
    setCropRect({ x, y, w, h })
  }

  const handleCropPointerUp = (): void => {
    cropDragRef.current = null
    window.removeEventListener('pointermove', handleCropPointerMove)
    window.removeEventListener('pointerup', handleCropPointerUp)
  }

  const applyCrop = (): void => {
    const rect = cropRect
    const img = imgRef.current
    if (!rect || !img || img.naturalWidth === 0 || rect.w < 0.01 || rect.h < 0.01) {
      setCropMode(false)
      setCropRect(null)
      return
    }

    const sx = rect.x * img.naturalWidth
    const sy = rect.y * img.naturalHeight
    const sw = rect.w * img.naturalWidth
    const sh = rect.h * img.naturalHeight
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(sw))
    canvas.height = Math.max(1, Math.round(sh))
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      setCropMode(false)
      setCropRect(null)
      return
    }
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height)
    const newUrl = canvas.toDataURL('image/png')

    const remap = (p: Point): Point => ({ x: (p.x - rect.x) / rect.w, y: (p.y - rect.y) / rect.h })
    const intersects = (x0: number, y0: number, x1: number, y1: number): boolean => x1 > 0 && x0 < 1 && y1 > 0 && y0 < 1

    // 座標再マッピングで注釈が消えることもある不可逆操作なので必ず履歴に積む
    pushHistory(annotationsRef.current)
    setAnnotations((prev) =>
      prev
        .map((a): Annotation => {
          switch (a.kind) {
            case 'text': {
              const p = remap({ x: a.xFrac, y: a.yFrac })
              return { ...a, xFrac: p.x, yFrac: p.y }
            }
            case 'rect':
            case 'ellipse': {
              const p0 = remap({ x: a.xFrac, y: a.yFrac })
              return { ...a, xFrac: p0.x, yFrac: p0.y, widthFrac: a.widthFrac / rect.w, heightFrac: a.heightFrac / rect.h }
            }
            case 'line': {
              const p1 = remap({ x: a.x1Frac, y: a.y1Frac })
              const p2 = remap({ x: a.x2Frac, y: a.y2Frac })
              return {
                ...a,
                x1Frac: p1.x,
                y1Frac: p1.y,
                x2Frac: p2.x,
                y2Frac: p2.y,
                auxFrac: remap(a.auxFrac),
                kagiPoints: a.kagiPoints.map(remap)
              }
            }
            case 'freehand':
              return { ...a, points: a.points.map(remap) }
          }
        })
        .filter((a) => {
          switch (a.kind) {
            case 'text':
              return intersects(a.xFrac - 0.02, a.yFrac - 0.02, a.xFrac + 0.02, a.yFrac + 0.02)
            case 'rect':
            case 'ellipse':
              return intersects(a.xFrac, a.yFrac, a.xFrac + a.widthFrac, a.yFrac + a.heightFrac)
            case 'line': {
              const xs = [a.x1Frac, a.x2Frac, a.auxFrac.x, ...a.kagiPoints.map((p) => p.x)]
              const ys = [a.y1Frac, a.y2Frac, a.auxFrac.y, ...a.kagiPoints.map((p) => p.y)]
              return intersects(Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys))
            }
            case 'freehand': {
              const xs = a.points.map((p) => p.x)
              const ys = a.points.map((p) => p.y)
              return intersects(Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys))
            }
          }
        })
    )

    setCurrentImageUrl(newUrl)
    setSelectedId(null)
    setCropMode(false)
    setCropRect(null)
  }

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      // テキスト編集中はtextarea標準のUndo/Redoと衝突させないため、
      // Ctrl+Z等のショートカットも含めてここでは一切発火させない
      if (editingTextId) return

      const isMod = e.ctrlKey || e.metaKey
      if (isMod && !e.altKey) {
        const key = e.key.toLowerCase()
        if (key === 'z') {
          e.preventDefault()
          if (e.shiftKey) redo()
          else undo()
          return
        }
        if (key === 'y') {
          e.preventDefault()
          redo()
          return
        }
      }

      if (!selectedId) return
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        deleteAnnotation(selectedId)
      } else if (e.key === 'Escape') {
        setSelectedId(null)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [selectedId, editingTextId, undo, redo])

  const selected = annotations.find((a) => a.id === selectedId) ?? null

  const changeSelectedFontSize = (delta: number): void => {
    if (!selected || selected.kind !== 'text') return
    const next = Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, selected.fontSize + delta))
    updateAnnotationWithHistory(selected.id, { fontSize: next })
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
          const { startFrom, endFrom } = lineArrowRefs(a, W, H)
          ctx.strokeStyle = a.color
          ctx.lineWidth = strokeW
          ctx.lineCap = 'round'
          const path2d = new Path2D(linePathD(a, W, H))
          ctx.stroke(path2d)
          const headLen = Math.max(12, W * 0.015)
          if (a.arrowEnds === 'end' || a.arrowEnds === 'both') {
            const pts = arrowHeadPoints(p2, endFrom, headLen)
            const poly = new Path2D(`M ${pts.split(' ').join(' L ')} Z`)
            ctx.fillStyle = a.color
            ctx.fill(poly)
          }
          if (a.arrowEnds === 'start' || a.arrowEnds === 'both') {
            const pts = arrowHeadPoints(p1, startFrom, headLen)
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
  // undoStackRef/redoStackRefの中身はrefなので直接は再レンダリングを起こさないが、
  // push/undo/redoのたびにhistoryVersionが変化して再レンダリングされるため、
  // その時点の最新の中身をここで読み直せば表示に反映される
  const canUndo = historyVersion >= 0 && undoStackRef.current.length > 0
  const canRedo = historyVersion >= 0 && redoStackRef.current.length > 0
  // フリーハンド描画中のプレビュー線・新規フリーハンド注釈の初期色として
  // 直前に使った色を反映する(handleDrawingPointerUpからも同じ値を参照する)
  const lastFreehandColor = getLastFreehandColor()

  return (
    <div className="screenshot-editor-page">
      <div className="screenshot-editor-toolbar">
        {cropMode ? (
          <div className="se-icon-group">
            <span className="se-crop-hint">トリミング範囲をドラッグで調整してください</span>
            <span className="se-sep" />
            <button className="se-text-btn" onClick={cancelCrop}>
              キャンセル
            </button>
            <button className="se-text-btn se-text-btn--primary" onClick={applyCrop}>
              適用
            </button>
          </div>
        ) : (
          <div className="se-icon-group">
            <button className="se-tool-btn" onClick={undo} disabled={!canUndo} title="元に戻す (Ctrl+Z)">
              <UndoIcon />
              <span className="se-tool-btn-label">戻す</span>
            </button>
            <button className="se-tool-btn" onClick={redo} disabled={!canRedo} title="やり直す (Ctrl+Y)">
              <RedoIcon />
              <span className="se-tool-btn-label">進む</span>
            </button>
            <span className="se-sep" />
            <button className="se-tool-btn" onClick={addText} title="テキストを追加">
              <TextGlyph />
              <span className="se-tool-btn-label">テキスト</span>
            </button>
            <button className="se-tool-btn" onClick={() => addShape('rect')} title="四角形を追加">
              <RectIcon />
              <span className="se-tool-btn-label">四角形</span>
            </button>
            <button className="se-tool-btn" onClick={() => addShape('ellipse')} title="楕円を追加">
              <EllipseIcon />
              <span className="se-tool-btn-label">楕円</span>
            </button>
            <button className="se-tool-btn" onClick={addLine} title="線を追加">
              <LineIcon />
              <span className="se-tool-btn-label">線</span>
            </button>
            <button
              className={`se-tool-btn${drawTool === 'freehand' ? ' active' : ''}`}
              onClick={startFreehand}
              title="フリーハンドで描く"
            >
              <PenIcon />
              <span className="se-tool-btn-label">ペン</span>
            </button>
            <span className="se-sep" />
            <button className="se-tool-btn" onClick={startCrop} title="トリミング">
              <CropIcon />
              <span className="se-tool-btn-label">トリミング</span>
            </button>
          </div>
        )}

        {!cropMode && selected && selected.kind === 'text' && (
          <TextProperties
            annotation={selected}
            onChange={(patch) => updateAnnotationWithHistory(selected.id, patch)}
            onFontSizeDelta={changeSelectedFontSize}
          />
        )}

        {selected && (selected.kind === 'rect' || selected.kind === 'ellipse') && (
          <div className="se-icon-group se-icon-group--divider">
            <ColorPicker
              value={selected.borderColor}
              onChange={(c) => updateAnnotationWithHistory(selected.id, { borderColor: c })}
              allowNone
              icon={<BorderColorIcon />}
              title="枠線の色"
            />
            <ColorPicker
              value={selected.bgColor}
              onChange={(c) => updateAnnotationWithHistory(selected.id, { bgColor: c })}
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
              onClick={() => updateAnnotationWithHistory(selected.id, { pathStyle: 'straight' })}
              title="直線"
            >
              <LineIcon />
            </button>
            <button
              className={`se-icon-btn${selected.pathStyle === 'curve' ? ' active' : ''}`}
              onClick={() => updateAnnotationWithHistory(selected.id, { pathStyle: 'curve' })}
              title="曲線"
            >
              <CurveIcon />
            </button>
            <button
              className={`se-icon-btn${selected.pathStyle === 'kagi' ? ' active' : ''}`}
              onClick={() =>
                updateAnnotationWithHistory(selected.id, {
                  pathStyle: 'kagi',
                  kagiPoints: selected.kagiPoints.length > 0 ? selected.kagiPoints : [{ x: selected.x2Frac, y: selected.y1Frac }]
                })
              }
              title="カギ線"
            >
              <KagiIcon />
            </button>
            <span className="se-sep" />
            <button
              className={`se-icon-btn${selected.arrowEnds === 'none' ? ' active' : ''}`}
              onClick={() => updateAnnotationWithHistory(selected.id, { arrowEnds: 'none' })}
              title="矢印なし"
            >
              <ArrowNoneIcon />
            </button>
            <button
              className={`se-icon-btn${selected.arrowEnds === 'start' ? ' active' : ''}`}
              onClick={() => updateAnnotationWithHistory(selected.id, { arrowEnds: 'start' })}
              title="矢印(始点)"
            >
              <ArrowStartIcon />
            </button>
            <button
              className={`se-icon-btn${selected.arrowEnds === 'end' ? ' active' : ''}`}
              onClick={() => updateAnnotationWithHistory(selected.id, { arrowEnds: 'end' })}
              title="矢印(終点)"
            >
              <ArrowEndIcon />
            </button>
            <button
              className={`se-icon-btn${selected.arrowEnds === 'both' ? ' active' : ''}`}
              onClick={() => updateAnnotationWithHistory(selected.id, { arrowEnds: 'both' })}
              title="矢印(両端)"
            >
              <ArrowBothIcon />
            </button>
            <span className="se-sep" />
            <ColorPicker
              value={selected.color}
              onChange={(c) => updateAnnotationWithHistory(selected.id, { color: c ?? SIMPLE_COLORS_DEFAULT })}
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
              onChange={(c) => updateAnnotationWithHistory(selected.id, { color: c ?? SIMPLE_COLORS_DEFAULT })}
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
          <img
            ref={imgRef}
            src={currentImageUrl}
            alt="スクリーンショット"
            className="screenshot-editor-image"
            onLoad={recomputeSize}
            draggable={false}
            onDragStart={(e) => e.preventDefault()}
          />

          {W > 0 && H > 0 && (
            <svg
              className="screenshot-annotation-svg"
              width={W}
              height={H}
              viewBox={`0 0 ${W} ${H}`}
              style={{ pointerEvents: cropMode ? 'none' : undefined }}
            >
              {drawingPoints && drawingPoints.length > 1 && (
                <path d={smoothPathD(drawingPoints, W, H)} fill="none" stroke={lastFreehandColor} strokeWidth={STROKE_WIDTH_PX} strokeLinecap="round" strokeLinejoin="round" />
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
                  const isSelected = selectedId === a.id
                  const pathD = linePathD(a, W, H)
                  const headLen = 14
                  const { startFrom, endFrom } = lineArrowRefs(a, W, H)
                  const bendPoints = a.pathStyle === 'kagi' ? kagiBendPoints(a) : []
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
                          {a.pathStyle === 'curve' && (
                            <circle
                              cx={a.auxFrac.x * W}
                              cy={a.auxFrac.y * H}
                              r={7}
                              fill="#ffd60a"
                              stroke="#333"
                              strokeWidth={1.5}
                              style={{ cursor: 'grab' }}
                              onPointerDown={(e) => beginDrag(e, a, 'aux')}
                            />
                          )}
                          {a.pathStyle === 'kagi' &&
                            bendPoints.map((b, i) => (
                              <circle
                                key={i}
                                cx={b.x * W}
                                cy={b.y * H}
                                r={7}
                                fill="#ffd60a"
                                stroke="#333"
                                strokeWidth={1.5}
                                style={{ cursor: 'grab' }}
                                onPointerDown={(e) => beginDrag(e, a, 'bend', i)}
                              />
                            ))}
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

          {cropMode && cropRect && W > 0 && H > 0 && (
            <div className="screenshot-crop-overlay">
              <div className="screenshot-crop-mask" style={{ left: 0, top: 0, right: 0, height: `${cropRect.y * 100}%` }} />
              <div
                className="screenshot-crop-mask"
                style={{ left: 0, bottom: 0, right: 0, top: `${(cropRect.y + cropRect.h) * 100}%` }}
              />
              <div
                className="screenshot-crop-mask"
                style={{ left: 0, top: `${cropRect.y * 100}%`, width: `${cropRect.x * 100}%`, height: `${cropRect.h * 100}%` }}
              />
              <div
                className="screenshot-crop-mask"
                style={{
                  right: 0,
                  top: `${cropRect.y * 100}%`,
                  width: `${(1 - cropRect.x - cropRect.w) * 100}%`,
                  height: `${cropRect.h * 100}%`
                }}
              />
              <div
                className="screenshot-crop-rect"
                style={{
                  left: `${cropRect.x * 100}%`,
                  top: `${cropRect.y * 100}%`,
                  width: `${cropRect.w * 100}%`,
                  height: `${cropRect.h * 100}%`
                }}
                onPointerDown={(e) => beginCropDrag(e, 'move')}
              >
                <div className="screenshot-crop-handle nw" onPointerDown={(e) => beginCropDrag(e, 'nw')} />
                <div className="screenshot-crop-handle ne" onPointerDown={(e) => beginCropDrag(e, 'ne')} />
                <div className="screenshot-crop-handle sw" onPointerDown={(e) => beginCropDrag(e, 'sw')} />
                <div className="screenshot-crop-handle se" onPointerDown={(e) => beginCropDrag(e, 'se')} />
              </div>
            </div>
          )}
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

// --- 直前に使った注釈スタイルの記憶 ---
// 種類(text/shape/line/freehand)ごとに直前使用したスタイルをlocalStorageへ
// 永続化し、次回の新規作成時の初期値として使う。「shape」はrect/ellipse共通。
const LAST_STYLES_KEY = 'ditto:lastAnnotationStyles'

interface LastTextStyle {
  fontColor?: string
  bgColor?: string | null
  borderColor?: string | null
  fontSize?: number
  bold?: boolean
  italic?: boolean
  underline?: boolean
  align?: TextAlign
  lineHeight?: number
  spaceBefore?: boolean
  spaceAfter?: boolean
}
interface LastShapeStyle {
  borderColor?: string | null
  bgColor?: string | null
}
interface LastLineStyle {
  pathStyle?: LinePathStyle
  arrowEnds?: ArrowEnds
  color?: string
}
interface LastFreehandStyle {
  color?: string
}
interface LastAnnotationStyles {
  text?: LastTextStyle
  shape?: LastShapeStyle
  line?: LastLineStyle
  freehand?: LastFreehandStyle
}

function loadLastStyles(): LastAnnotationStyles {
  try {
    const raw = window.localStorage.getItem(LAST_STYLES_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as LastAnnotationStyles
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

/**
 * プロパティパネルでの変更(patch)のうち、記憶対象のフィールドだけを
 * annotationKindに応じてlocalStorageへ書き足す。記憶対象外のフィールドしか
 * 含まないpatch(位置やサイズなど)の場合は何もしない。
 */
function rememberStyle(annotationKind: Annotation['kind'], patch: AnnotationPatch): void {
  const current = loadLastStyles()
  let next: LastAnnotationStyles | null = null

  if (annotationKind === 'text') {
    const p: LastTextStyle = {}
    if ('fontColor' in patch) p.fontColor = patch.fontColor
    if ('bgColor' in patch) p.bgColor = patch.bgColor
    if ('borderColor' in patch) p.borderColor = patch.borderColor
    if ('fontSize' in patch) p.fontSize = patch.fontSize
    if ('bold' in patch) p.bold = patch.bold
    if ('italic' in patch) p.italic = patch.italic
    if ('underline' in patch) p.underline = patch.underline
    if ('align' in patch) p.align = patch.align
    if ('lineHeight' in patch) p.lineHeight = patch.lineHeight
    if ('spaceBefore' in patch) p.spaceBefore = patch.spaceBefore
    if ('spaceAfter' in patch) p.spaceAfter = patch.spaceAfter
    if (Object.keys(p).length > 0) next = { ...current, text: { ...current.text, ...p } }
  } else if (annotationKind === 'rect' || annotationKind === 'ellipse') {
    const p: LastShapeStyle = {}
    if ('borderColor' in patch) p.borderColor = patch.borderColor
    if ('bgColor' in patch) p.bgColor = patch.bgColor
    if (Object.keys(p).length > 0) next = { ...current, shape: { ...current.shape, ...p } }
  } else if (annotationKind === 'line') {
    const p: LastLineStyle = {}
    if ('pathStyle' in patch) p.pathStyle = patch.pathStyle
    if ('arrowEnds' in patch) p.arrowEnds = patch.arrowEnds
    if ('color' in patch) p.color = patch.color
    if (Object.keys(p).length > 0) next = { ...current, line: { ...current.line, ...p } }
  } else if (annotationKind === 'freehand') {
    const p: LastFreehandStyle = {}
    if ('color' in patch) p.color = patch.color
    if (Object.keys(p).length > 0) next = { ...current, freehand: { ...current.freehand, ...p } }
  }

  if (!next) return
  try {
    window.localStorage.setItem(LAST_STYLES_KEY, JSON.stringify(next))
  } catch {
    // localStorageが使えない/容量超過の場合は記憶を諦める
  }
}

function isTextAlign(v: unknown): v is TextAlign {
  return v === 'left' || v === 'center' || v === 'right'
}
function isLinePathStyle(v: unknown): v is LinePathStyle {
  return v === 'straight' || v === 'curve' || v === 'kagi'
}
function isArrowEnds(v: unknown): v is ArrowEnds {
  return v === 'none' || v === 'start' || v === 'end' || v === 'both'
}

/** 新規テキスト注釈の初期値。記憶された値があればそれを使い、なければ既存の固定デフォルトへフォールバック */
function getLastTextStyle(): Pick<
  TextAnnotation,
  'fontColor' | 'bgColor' | 'borderColor' | 'fontSize' | 'bold' | 'italic' | 'underline' | 'align' | 'lineHeight' | 'spaceBefore' | 'spaceAfter'
> {
  const s = loadLastStyles().text ?? {}
  return {
    fontColor: typeof s.fontColor === 'string' ? s.fontColor : SIMPLE_COLORS_DEFAULT,
    bgColor: typeof s.bgColor === 'string' ? s.bgColor : null,
    borderColor: typeof s.borderColor === 'string' ? s.borderColor : null,
    fontSize: typeof s.fontSize === 'number' && Number.isFinite(s.fontSize) ? s.fontSize : DEFAULT_FONT_SIZE,
    bold: typeof s.bold === 'boolean' ? s.bold : false,
    italic: typeof s.italic === 'boolean' ? s.italic : false,
    underline: typeof s.underline === 'boolean' ? s.underline : false,
    align: isTextAlign(s.align) ? s.align : 'center',
    lineHeight: typeof s.lineHeight === 'number' && Number.isFinite(s.lineHeight) ? s.lineHeight : 1.15,
    spaceBefore: typeof s.spaceBefore === 'boolean' ? s.spaceBefore : false,
    spaceAfter: typeof s.spaceAfter === 'boolean' ? s.spaceAfter : false
  }
}

/** 新規図形(rect/ellipse共通)注釈の初期値 */
function getLastShapeStyle(): Pick<ShapeAnnotation, 'borderColor' | 'bgColor'> {
  const s = loadLastStyles().shape ?? {}
  return {
    borderColor: typeof s.borderColor === 'string' ? s.borderColor : SIMPLE_COLORS_DEFAULT,
    bgColor: typeof s.bgColor === 'string' ? s.bgColor : null
  }
}

/** 新規線注釈の初期値 */
function getLastLineStyle(): Pick<LineAnnotation, 'pathStyle' | 'arrowEnds' | 'color'> {
  const s = loadLastStyles().line ?? {}
  return {
    pathStyle: isLinePathStyle(s.pathStyle) ? s.pathStyle : 'straight',
    arrowEnds: isArrowEnds(s.arrowEnds) ? s.arrowEnds : 'none',
    color: typeof s.color === 'string' ? s.color : SIMPLE_COLORS_DEFAULT
  }
}

/** 新規フリーハンド注釈(および描画中プレビュー)の初期色 */
function getLastFreehandColor(): string {
  const s = loadLastStyles().freehand ?? {}
  return typeof s.color === 'string' ? s.color : SIMPLE_COLORS_DEFAULT
}

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
  return iconSvg(
    <>
      <line x1="5" y1="6" x2="19" y2="6" />
      <line x1="12" y1="6" x2="12" y2="19" />
    </>
  )
}

function iconSvg(children: React.ReactNode): React.JSX.Element {
  return (
    <svg width="27" height="27" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      {children}
    </svg>
  )
}

function UndoIcon(): React.JSX.Element {
  return iconSvg(
    <>
      <path d="M3 10h10a5 5 0 0 1 0 10h-2" />
      <polyline points="7 5 3 10 7 15" />
    </>
  )
}
function RedoIcon(): React.JSX.Element {
  return iconSvg(
    <>
      <path d="M21 10H11a5 5 0 0 0 0 10h2" />
      <polyline points="17 5 21 10 17 15" />
    </>
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
function CropIcon(): React.JSX.Element {
  return iconSvg(
    <>
      <path d="M6 2v14a2 2 0 0 0 2 2h14" />
      <path d="M18 22V8a2 2 0 0 0-2-2H2" />
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
    <svg width="27" height="27" viewBox="0 0 24 24">
      <text x="12" y="18" fontSize="21" fontWeight="700" textAnchor="middle" fill="currentColor">
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
