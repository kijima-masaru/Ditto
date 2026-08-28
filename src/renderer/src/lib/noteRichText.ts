import type { NoteCharStyle } from '../../../shared/types'

/**
 * メモの本文を「装飾付きテキスト」として扱うための土台。
 *
 * 本文の入力欄はcontenteditableのdivで、次の形だけを正しい状態とする。
 *
 *   <div class="note-line">装飾なしの文字<span style="...">装飾した文字</span></div>
 *   <div class="note-line"><br></div>   ← 空行
 *
 * ・1行 = 直下の1つのdiv。行番号や現在行の強調は、この行divを測って描いている
 * ・装飾はspanのstyleだけで表す。入れ子にはせず、常に1段の平らな並びへ均す
 *
 * 装飾の適用・検索置換・整形は、DOMを直接いじらず、いったん「行の配列 × 装飾の
 * 区切り(Run)の配列」へ落としてから作り直す。DOMを部分的に書き換えると、
 * ブラウザが勝手に足すfontタグや入れ子spanで状態が読めなくなるため。
 *
 * 文字位置(オフセット)は常に「装飾を取り除いたプレーンテキスト上の位置」で表す。
 * 保存する本文・検索・文字数がすべて同じ座標系になり、ズレようがなくなる。
 */

/** 行を表すdivに付けるclass */
export const LINE_CLASS = 'note-line'

/**
 * 幅ゼロの文字。選択範囲が無い状態で装飾を指定した時に、
 * 「これから入力する文字が入る場所」として装飾付きのspanの中へ1つだけ置く。
 * カーソルをその中に入れておくと、以降の入力(日本語の変換確定も含む)が
 * そのspanの中へ入るため、指定した装飾がそのまま掛かる。
 * プレーンテキストへ落とす時には必ず取り除くので、本文には残らない
 */
export const ZWSP = '\u200B'

/** 文字サイズとして受け付ける範囲 */
export const FONT_SIZE_MIN = 8
export const FONT_SIZE_MAX = 96

export function clampFontSize(size: number): number {
  return Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, Math.round(size)))
}

/** 同じ装飾が続く文字のかたまり */
export interface Run {
  text: string
  style: NoteCharStyle
}

/** 装飾の変更指示。値を渡さなければ据え置き、null(太字はfalse)なら解除 */
export interface NoteCharStylePatch {
  bold?: boolean
  color?: string | null
  background?: string | null
  fontSize?: number | null
}

/** すべての装飾を外す指示 */
export const CLEAR_STYLE: NoteCharStylePatch = { bold: false, color: null, background: null, fontSize: null }

export function stripZwsp(text: string): string {
  return text.split(ZWSP).join('')
}

export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/* --- 装飾の読み書き --- */

/** ブラウザが返す色表現(rgb(...)など)を#rrggbbへ揃える。透明・不明な値はundefined */
function toHexColor(value: string | null | undefined): string | undefined {
  const v = (value ?? '').trim()
  if (!v || v === 'transparent') return undefined
  const long = /^#([0-9a-f]{6})$/i.exec(v)
  if (long) return `#${long[1].toLowerCase()}`
  const short = /^#([0-9a-f]{3})$/i.exec(v)
  if (short) {
    const [r, g, b] = short[1].split('')
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase()
  }
  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)\s*(?:[,/]\s*([\d.]+)\s*)?\)$/i.exec(v)
  if (!rgb) return undefined
  if (rgb[4] !== undefined && Number(rgb[4]) === 0) return undefined
  const hex = [rgb[1], rgb[2], rgb[3]]
    .map((n) => Math.min(255, Math.max(0, Math.round(Number(n)))).toString(16).padStart(2, '0'))
    .join('')
  return `#${hex}`
}

/** 要素が持つ装飾を読む(タグ由来の太字と、style属性の指定の両方) */
function readStyle(el: Element): NoteCharStyle {
  const style: NoteCharStyle = {}
  const tag = el.tagName
  if (tag === 'B' || tag === 'STRONG') style.bold = true
  const css = (el as HTMLElement).style
  if (!css) return style
  const weight = css.fontWeight
  if (weight) style.bold = weight === 'bold' || weight === 'bolder' || Number(weight) >= 600
  const color = toHexColor(css.color)
  if (color) style.color = color
  const background = toHexColor(css.backgroundColor)
  if (background) style.background = background
  const size = Number.parseFloat(css.fontSize)
  if (Number.isFinite(size) && size > 0) style.fontSize = clampFontSize(size)
  return style
}

/** 親から受け継いだ装飾に、子の指定を重ねる */
function inherit(base: NoteCharStyle, over: NoteCharStyle): NoteCharStyle {
  const next: NoteCharStyle = { ...base }
  if (over.bold !== undefined) next.bold = over.bold
  if (over.color !== undefined) next.color = over.color
  if (over.background !== undefined) next.background = over.background
  if (over.fontSize !== undefined) next.fontSize = over.fontSize
  if (next.bold === false) delete next.bold
  return next
}

/** 変更指示を当てる。太字false・色nullは「解除」を意味する */
export function applyPatch(base: NoteCharStyle, patch: NoteCharStylePatch): NoteCharStyle {
  const next: NoteCharStyle = { ...base }
  if (patch.bold !== undefined) {
    if (patch.bold) next.bold = true
    else delete next.bold
  }
  if (patch.color !== undefined) {
    if (patch.color) next.color = patch.color
    else delete next.color
  }
  if (patch.background !== undefined) {
    if (patch.background) next.background = patch.background
    else delete next.background
  }
  if (patch.fontSize !== undefined) {
    if (patch.fontSize) next.fontSize = clampFontSize(patch.fontSize)
    else delete next.fontSize
  }
  return next
}

export function styleToCss(style: NoteCharStyle): string {
  const parts: string[] = []
  if (style.bold) parts.push('font-weight:700')
  if (style.color) parts.push(`color:${style.color}`)
  // 画面全体ではなく文字の後ろだけを塗るため、背景はspan(=文字)に対して指定する
  if (style.background) parts.push(`background-color:${style.background}`)
  if (style.fontSize) parts.push(`font-size:${style.fontSize}px`)
  return parts.join(';')
}

export function styleKey(style: NoteCharStyle): string {
  return `${style.bold ? 1 : 0}|${style.color ?? ''}|${style.background ?? ''}|${style.fontSize ?? ''}`
}

export function isPlainStyle(style: NoteCharStyle): boolean {
  return styleKey(style) === styleKey({})
}

/* --- DOM ⇔ 行×Runの相互変換 --- */

const BLOCK_TAGS = new Set([
  'DIV', 'P', 'LI', 'UL', 'OL', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
  'BLOCKQUOTE', 'PRE', 'SECTION', 'ARTICLE', 'HEADER', 'FOOTER', 'TABLE', 'TR', 'TD', 'TH'
])

function isBlock(node: Node): boolean {
  return node.nodeType === Node.ELEMENT_NODE && BLOCK_TAGS.has((node as Element).tagName)
}

function mergeAdjacent(runs: Run[]): Run[] {
  const merged: Run[] = []
  for (const run of runs) {
    if (run.text === '') continue
    const last = merged[merged.length - 1]
    if (last && styleKey(last.style) === styleKey(run.style)) last.text += run.text
    else merged.push({ text: run.text, style: run.style })
  }
  return merged
}

/** brと改行文字で区切りながら、インラインのノード列を行へ展開する */
function linesFromInline(nodes: Node[], baseStyle: NoteCharStyle): Run[][] {
  const lines: Run[][] = [[]]
  let lastWasBr = false
  const walk = (node: Node, style: NoteCharStyle): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = stripZwsp((node as Text).data)
      const parts = text.split(/\r\n|\r|\n/)
      parts.forEach((part, i) => {
        if (i > 0) lines.push([])
        if (part) lines[lines.length - 1].push({ text: part, style })
      })
      if (text) lastWasBr = false
      return
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return
    const el = node as Element
    if (el.tagName === 'BR') {
      lines.push([])
      lastWasBr = true
      return
    }
    const next = inherit(style, readStyle(el))
    for (const child of Array.from(el.childNodes)) walk(child, next)
  }
  for (const node of nodes) walk(node, baseStyle)
  // ブロックの末尾のbrは、行を増やすためではなく高さを保つために入っていることが多い。
  // それで空行が1つ増えてしまうのを防ぐ
  if (lastWasBr && lines.length > 1 && lines[lines.length - 1].length === 0) lines.pop()
  return lines
}

/**
 * 任意のHTML断片(自前の正しい形・ブラウザが崩した形・貼り付けられたHTML)を
 * 「行の配列 × Runの配列」へ落とす。ここを通した後は形の違いが消える
 */
export function extractLines(container: Node, baseStyle: NoteCharStyle = {}): Run[][] {
  const lines: Run[][] = []
  let inlineBuffer: Node[] = []
  const flushInline = (): void => {
    if (inlineBuffer.length === 0) return
    lines.push(...linesFromInline(inlineBuffer, baseStyle))
    inlineBuffer = []
  }
  for (const child of Array.from(container.childNodes)) {
    if (isBlock(child)) {
      flushInline()
      const el = child as Element
      lines.push(...extractLines(el, inherit(baseStyle, readStyle(el))))
    } else {
      inlineBuffer.push(child)
    }
  }
  flushInline()
  if (lines.length === 0) lines.push([])
  return lines.map((runs) => mergeAdjacent(runs))
}

/**
 * 背景色を付けた文字に付けるclass。文字色を指定していない場合でも読めるよう、
 * CSS側で濃い文字色を当てる(蛍光ペンで塗った紙と同じで、暗いテーマの白い文字のままだと
 * 明るい背景色の上で読めなくなるため)。文字色を明示している場合はstyle属性が勝つ
 */
export const MARK_CLASS = 'note-mark'

export function renderLine(runs: Run[]): string {
  const merged = mergeAdjacent(runs)
  if (merged.length === 0) return '<br>'
  return merged
    .map((run) => {
      const css = styleToCss(run.style)
      const text = escapeHtml(run.text)
      if (!css) return text
      const className = run.style.background ? ` class="${MARK_CLASS}"` : ''
      return `<span${className} style="${css}">${text}</span>`
    })
    .join('')
}

export function renderDocument(lines: Run[][]): string {
  const body = lines.length === 0 ? [[]] : lines
  return body.map((runs) => `<div class="${LINE_CLASS}">${renderLine(runs)}</div>`).join('')
}

export function plainTextOf(lines: Run[][]): string {
  return lines.map((runs) => runs.map((r) => stripZwsp(r.text)).join('')).join('\n')
}

export function hasAnyStyle(lines: Run[][]): boolean {
  return lines.some((runs) => runs.some((run) => stripZwsp(run.text) !== '' && !isPlainStyle(run.style)))
}

/** プレーンテキストを、装飾なしの正しい形のHTMLへ変換する */
export function htmlFromPlainText(text: string): string {
  return renderDocument(text.split(/\r\n|\r|\n/).map((line) => (line ? [{ text: line, style: {} }] : [])))
}

/**
 * 保存されていたHTML(または貼り付けられたHTML)を、この画面が扱う正しい形へ直す。
 * DOMParserで読むだけで画面には差し込まず、内容はテキストと装飾に還元してから
 * 組み立て直すので、スクリプトや画像などが紛れ込むことはない
 */
export function htmlToCanonical(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  return renderDocument(extractLines(doc.body))
}

/* --- 文字位置(プレーンテキスト上のオフセット)とDOMの対応 --- */

interface DomPoint {
  node: Node
  offset: number
}

/** 直下の行div。ブラウザが崩した状態では行以外が混じることがある */
export function lineElements(root: HTMLElement): HTMLElement[] {
  return Array.from(root.children) as HTMLElement[]
}

/**
 * 画面のDOMから「プレーンテキスト」と「その各文字の直前を指すDOM位置」を作る。
 * 幅ゼロの文字は本文には数えず、位置の対応からも外す
 */
function buildIndex(root: HTMLElement): { text: string; points: DomPoint[] } {
  const points: DomPoint[] = []
  let text = ''
  let lastEnd: DomPoint = { node: root, offset: 0 }
  lineElements(root).forEach((line, index) => {
    if (index > 0) {
      points.push(lastEnd)
      text += '\n'
    }
    lastEnd = { node: line, offset: 0 }
    const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT)
    let node = walker.nextNode() as Text | null
    while (node) {
      const data = node.data
      for (let i = 0; i < data.length; i++) {
        if (data[i] === ZWSP) continue
        points.push({ node, offset: i })
        text += data[i]
      }
      lastEnd = { node, offset: data.length }
      node = walker.nextNode() as Text | null
    }
  })
  points.push(lastEnd)
  return { text, points }
}

export function plainTextFromDom(root: HTMLElement): string {
  return plainTextFromLines(lineElements(root))
}

/**
 * DOM上の位置がプレーンテキストの何文字目かを求める。
 *
 * 「その位置がある行より前の行の文字数(+改行1文字)」と「その行の中での文字数」を
 * 足して求める。行の中にはブロックが無いので、行頭からその位置までのRangeの
 * 文字列がそのまま行内の文字数になる
 */
function offsetOfPoint(root: HTMLElement, node: Node, offset: number): number {
  let lineNode: Node | null = node
  while (lineNode && lineNode.parentNode !== root) lineNode = lineNode.parentNode
  const lines = lineElements(root)
  const lineIndex = lineNode ? lines.indexOf(lineNode as HTMLElement) : -1
  if (lineIndex < 0) {
    // 行の外(入力欄そのものを指している等)。位置だけは矛盾しない値へ寄せる
    return node === root && offset >= lines.length ? plainTextFromLines(lines).length : 0
  }
  let total = 0
  for (let i = 0; i < lineIndex; i++) total += stripZwsp(lines[i].textContent ?? '').length + 1
  const range = document.createRange()
  try {
    range.setStart(lines[lineIndex], 0)
    range.setEnd(node, offset)
  } catch {
    return total
  }
  return total + stripZwsp(range.toString()).length
}

function plainTextFromLines(lines: HTMLElement[]): string {
  return lines.map((line) => stripZwsp(line.textContent ?? '')).join('\n')
}

/** 現在の選択範囲をプレーンテキスト上の位置で返す。入力欄の外を選んでいる場合はnull */
export function getSelectionOffsets(root: HTMLElement): { start: number; end: number } | null {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0) return null
  const range = selection.getRangeAt(0)
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null
  const start = offsetOfPoint(root, range.startContainer, range.startOffset)
  const end = range.collapsed ? start : offsetOfPoint(root, range.endContainer, range.endOffset)
  return start <= end ? { start, end } : { start: end, end: start }
}

/** プレーンテキスト上の位置でカーソル・選択範囲を設定する */
export function setSelectionOffsets(root: HTMLElement, start: number, end = start): void {
  const { text, points } = buildIndex(root)
  const clamp = (n: number): number => Math.min(Math.max(n, 0), text.length)
  const from = points[clamp(start)]
  const to = points[clamp(end)]
  if (!from || !to) return
  const range = document.createRange()
  try {
    range.setStart(from.node, from.offset)
    range.setEnd(to.node, to.offset)
  } catch {
    return
  }
  const selection = window.getSelection()
  if (!selection) return
  selection.removeAllRanges()
  selection.addRange(range)
}

/* --- 行×Runに対する編集 --- */

function lineLength(runs: Run[]): number {
  return runs.reduce((sum, run) => sum + run.text.length, 0)
}

/** 行を指定位置で2つに割る(装飾は保ったまま) */
function splitLine(runs: Run[], at: number): [Run[], Run[]] {
  const head: Run[] = []
  const tail: Run[] = []
  let seen = 0
  for (const run of runs) {
    const start = seen
    const end = seen + run.text.length
    if (end <= at) head.push(run)
    else if (start >= at) tail.push(run)
    else {
      head.push({ text: run.text.slice(0, at - start), style: run.style })
      tail.push({ text: run.text.slice(at - start), style: run.style })
    }
    seen = end
  }
  return [head, tail]
}

/** プレーンテキスト上の位置を「何行目の何文字目か」へ変換する */
export function locate(lines: Run[][], offset: number): { line: number; column: number } {
  let remaining = Math.max(0, offset)
  for (let i = 0; i < lines.length; i++) {
    const length = lineLength(lines[i])
    if (remaining <= length) return { line: i, column: remaining }
    remaining -= length + 1
  }
  const last = Math.max(0, lines.length - 1)
  return { line: last, column: lineLength(lines[last] ?? []) }
}

/** 指定位置に入力した文字が受け継ぐ装飾(直前の文字のもの。行頭なら直後の文字のもの) */
export function styleAt(lines: Run[][], offset: number): NoteCharStyle {
  const { line, column } = locate(lines, offset)
  const runs = lines[line] ?? []
  let seen = 0
  let before: NoteCharStyle | null = null
  let after: NoteCharStyle | null = null
  for (const run of runs) {
    const start = seen
    const end = seen + run.text.length
    if (column > start && column <= end) before = run.style
    if (after === null && column <= start) after = run.style
    seen = end
  }
  return before ?? after ?? {}
}

/** 範囲を別のテキストへ置き換える。挿入した文字にはstyleの装飾を掛ける */
export function replaceRange(
  lines: Run[][],
  start: number,
  end: number,
  text: string,
  style: NoteCharStyle
): Run[][] {
  const from = locate(lines, start)
  const to = locate(lines, end)
  const head = splitLine(lines[from.line] ?? [], from.column)[0]
  const tail = splitLine(lines[to.line] ?? [], to.column)[1]
  const inserted = text.split(/\r\n|\r|\n/)
  const middle: Run[][] = inserted.map((part) => (part ? [{ text: part, style }] : []))
  middle[0] = [...head, ...middle[0]]
  middle[middle.length - 1] = [...middle[middle.length - 1], ...tail]
  return [...lines.slice(0, from.line), ...middle.map(mergeAdjacent), ...lines.slice(to.line + 1)]
}

/** 範囲のプレーンテキストを取り出す */
export function sliceText(lines: Run[][], start: number, end: number): string {
  return plainTextOf(lines).slice(start, end)
}

/** 範囲の文字へ装飾を掛ける */
export function styleRange(lines: Run[][], start: number, end: number, patch: NoteCharStylePatch): Run[][] {
  if (start >= end) return lines
  const from = locate(lines, start)
  const to = locate(lines, end)
  return lines.map((runs, index) => {
    if (index < from.line || index > to.line) return runs
    const length = lineLength(runs)
    const left = index === from.line ? from.column : 0
    const right = index === to.line ? to.column : length
    if (left >= right) return runs
    const [head, rest] = splitLine(runs, left)
    const [target, tail] = splitLine(rest, right - left)
    const styled = target.map((run) => ({ text: run.text, style: applyPatch(run.style, patch) }))
    return mergeAdjacent([...head, ...styled, ...tail])
  })
}

/**
 * 選択範囲が無い時に、これから入力する文字のための「置き場」を差し込む。
 * 幅ゼロの文字1つを装飾付きのspanとして入れ、その中へカーソルを置く
 */
export function insertStyleMarker(lines: Run[][], offset: number, style: NoteCharStyle): Run[][] {
  const { line, column } = locate(lines, offset)
  const [head, tail] = splitLine(lines[line] ?? [], column)
  const next = [...lines]
  next[line] = [...head, { text: ZWSP, style }, ...tail]
  return next
}

/** 差し込んだ置き場(幅ゼロの文字だけのspan)を探す */
export function findStyleMarker(root: HTMLElement): Text | null {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let node = walker.nextNode() as Text | null
  while (node) {
    if (node.data === ZWSP) return node
    node = walker.nextNode() as Text | null
  }
  return null
}

/** 選択範囲(または選択が無ければカーソル位置)に掛かっている装飾を返す */
export function styleOfRange(lines: Run[][], start: number, end: number): NoteCharStyle {
  if (start >= end) return styleAt(lines, start)
  const from = locate(lines, start)
  const to = locate(lines, end)
  let common: NoteCharStyle | null = null
  for (let index = from.line; index <= to.line; index++) {
    const runs = lines[index] ?? []
    const length = lineLength(runs)
    const left = index === from.line ? from.column : 0
    const right = index === to.line ? to.column : length
    if (left >= right) continue
    const [, rest] = splitLine(runs, left)
    const [target] = splitLine(rest, right - left)
    for (const run of target) {
      if (run.text === '') continue
      if (common === null) common = run.style
      else if (styleKey(common) !== styleKey(run.style)) return {}
    }
  }
  return common ?? {}
}
