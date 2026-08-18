import { MAX_BUTTONS, type LayoutConfig, type SlotAssignment } from './layoutStorage'
import type { RemoteMacroItem, RemoteTemplateItem } from './protocol'

/**
 * ボタングリッドの寸法計算と、スロットへの割り当て解決。画面の描画から切り離しておくと
 * 端末サイズやボタン数を変えたときの挙動をここだけ見れば追える。
 */

export interface GridItem {
  kind: 'template' | 'macro'
  id: string
  label: string
}

export interface GridMetrics {
  columns: number
  rows: number
  /** ボタン1個の一辺(正方形) */
  cellSize: number
  /** ボタン同士の間隔(縦横とも同じ) */
  gap: number
  /** ボタンの下に出す名称ラベルの高さ(フォントサイズ+余白) */
  labelHeight: number
  /** 名称ラベルのフォントサイズ。ボタンが小さいときは併せて小さくする */
  labelFontSize: number
}

const MIN_GAP = 6
const MAX_GAP = 16

/**
 * 列数はボタン数から決める。正方形に近い配置がいちばん指が届きやすいので√を基準にしつつ、
 * 最大配置(12個)が3列×4行になるよう3列で頭打ちにする(4列にすると1マスが細くなりすぎる)
 */
export function columnsFor(count: number): number {
  return Math.min(3, Math.max(1, Math.ceil(Math.sqrt(count))))
}

/**
 * 使える領域(width×height)にcount個のボタンを詰めたときの寸法を返す。
 * 幅で決まるか高さで決まるかは端末とボタン数次第なので、両方から出して小さい方を採る。
 */
export function computeGridMetrics(width: number, height: number, count: number): GridMetrics {
  const columns = columnsFor(count)
  const rows = Math.ceil(count / columns)
  // 間隔は画面の短辺に比例させる。小さい端末で間延びせず、大きい端末で詰まりすぎない
  const gap = Math.round(Math.min(MAX_GAP, Math.max(MIN_GAP, Math.min(width, height) * 0.03)))

  const cellFromWidth = (width - gap * (columns - 1)) / columns
  // 高さ側はラベル分を先に引く必要があるが、ラベル高はセルサイズに依存する。
  // 相互依存を避けるため、まず幅基準の暫定サイズでラベル高を見積もってから高さ側を出す
  const provisionalLabel = labelMetricsFor(cellFromWidth)
  const cellFromHeight = (height - gap * (rows - 1)) / rows - provisionalLabel.labelHeight

  const cellSize = Math.max(0, Math.floor(Math.min(cellFromWidth, cellFromHeight)))
  const { labelHeight, labelFontSize } = labelMetricsFor(cellSize)
  // 列数の上限(3)のせいで1マスが幅で頭打ちになると縦に余りが出るが、その余りは行間へ
  // 配分せずグリッド全体を上下中央に置く。行間を広げるとボタンが散らばって見えるため
  return { columns, rows, cellSize, gap, labelHeight, labelFontSize }
}

/** ボタンが小さいときに名称ラベルだけ大きいと不格好なので、セルサイズに追随させる */
function labelMetricsFor(cellSize: number): { labelHeight: number; labelFontSize: number } {
  const labelFontSize = Math.round(Math.min(13, Math.max(9, cellSize * 0.13)))
  return { labelHeight: labelFontSize + 8, labelFontSize }
}

function toGridItem(templates: RemoteTemplateItem[], macros: RemoteMacroItem[], a: SlotAssignment): GridItem | null {
  if (a.kind === 'template') {
    const t = templates.find((x) => x.id === a.id)
    return t ? { kind: 'template', id: t.id, label: t.label } : null
  }
  const m = macros.find((x) => x.id === a.id)
  return m ? { kind: 'macro', id: m.id, label: m.name } : null
}

/**
 * 割り当てなしのときに並べる既定の順序。PC側でピン留めした順(定型文→マクロ)をそのまま使う。
 * itemsはピン留めで絞らず全件届く(設定モードの割り当て候補に使うため)ので、
 * 自動配置に使うぶんはここでpinnedのものだけに絞る
 */
export function autoItems(templates: RemoteTemplateItem[], macros: RemoteMacroItem[]): GridItem[] {
  // pinnedを送らない古いPC(ピン留め済みだけを返していた頃のDitto)に繋いだ場合、
  // 値はundefinedになる。=== trueで判定すると全件が弾かれて自動配置が空になるため、
  // 「falseと明示されたものだけ除く」という判定にして旧サーバーでも従来どおり動かす
  const isPinned = (item: { pinned?: boolean }): boolean => item.pinned !== false
  return [
    ...templates.filter(isPinned).map((t): GridItem => ({ kind: 'template', id: t.id, label: t.label })),
    ...macros.filter(isPinned).map((m): GridItem => ({ kind: 'macro', id: m.id, label: m.name }))
  ]
}

/**
 * 表示するマスの中身を決める。nullは空きマス(未割り当て、または割り当て先の項目が
 * PC側で外された・未接続で解決できない場合)で、押せないプレースホルダとして描画する。
 *
 * layoutがnullのときは自動配置。カスタマイズしていないユーザーの見え方を変えないため、
 * PC側でピン留めした項目をそのまま最大数まで並べる。
 */
export function resolveSlots(
  layout: LayoutConfig | null,
  templates: RemoteTemplateItem[],
  macros: RemoteMacroItem[]
): (GridItem | null)[] {
  if (!layout) {
    const items = autoItems(templates, macros).slice(0, MAX_BUTTONS)
    // 1つも無いときは空グリッドにせず1マスだけ出す(ペアリング前でもレイアウトが崩れないように)
    return items.length > 0 ? items : [null]
  }
  return layout.slots.map((a) => (a ? toGridItem(templates, macros, a) : null))
}

/** 自動配置のときも設定モードの初期値として使えるよう、現在の見た目をLayoutConfigに落とす */
export function layoutFromItems(items: (GridItem | null)[]): LayoutConfig {
  const slots = items.map((i) => (i ? { kind: i.kind, id: i.id } : null))
  return { count: Math.max(1, slots.length), slots }
}
