import * as SecureStore from 'expo-secure-store'

/**
 * ボタン配置(ボタン数と、各ボタンに割り当てた定型文・マクロ)の永続化。
 *
 * 未設定(null)のときは「PC側でコマンドパレットに固定した項目をそのまま並べる」という
 * 自動配置として扱う。設定モードで一度でもカスタマイズしたら、その内容をここに保存する。
 *
 * 保存先はexpo-secure-store。秘密情報ではないので本来は用途違いだが、既に依存にあり
 * ネイティブモジュールを増やさずに済むため流用している。Androidのsecure-storeは値が
 * 2048バイトを超えると保存できないため、ラベルは持たず種別とidだけを保存し、表示名は
 * 接続時にPCから受け取った一覧から解決する(未接続時は「名称」のプレースホルダになる)。
 */

const STORAGE_KEY = 'ditto_remote_layout'

/** グリッドは最大3列×4行。これ以上増やすと1マスが小さすぎて押し間違えるため上限とする */
export const MAX_BUTTONS = 12
export const MIN_BUTTONS = 1

export interface SlotAssignment {
  kind: 'template' | 'macro'
  id: string
}

export interface LayoutConfig {
  count: number
  /** 長さはcountと一致させる。nullは「そのマスは空き」 */
  slots: (SlotAssignment | null)[]
}

export function clampCount(count: number): number {
  if (!Number.isFinite(count)) return MAX_BUTTONS
  return Math.min(MAX_BUTTONS, Math.max(MIN_BUTTONS, Math.round(count)))
}

/** ボタン数を変えたときにslotsの長さを合わせる(減らす方向でも割り当ては末尾から捨てるだけ) */
export function resizeSlots(slots: (SlotAssignment | null)[], count: number): (SlotAssignment | null)[] {
  const next = slots.slice(0, count)
  while (next.length < count) next.push(null)
  return next
}

function isSlotAssignment(value: unknown): value is SlotAssignment {
  if (!value || typeof value !== 'object') return false
  const v = value as { kind?: unknown; id?: unknown }
  return (v.kind === 'template' || v.kind === 'macro') && typeof v.id === 'string'
}

/** 保存内容は端末に残り続けるため、アプリ更新でスキーマがずれていても壊れないよう検証してから返す */
function parseLayout(raw: string): LayoutConfig | null {
  try {
    const parsed = JSON.parse(raw) as { count?: unknown; slots?: unknown }
    if (typeof parsed.count !== 'number' || !Array.isArray(parsed.slots)) return null
    const count = clampCount(parsed.count)
    const slots = parsed.slots.map((s) => (isSlotAssignment(s) ? { kind: s.kind, id: s.id } : null))
    return { count, slots: resizeSlots(slots, count) }
  } catch {
    return null
  }
}

export async function loadLayout(): Promise<LayoutConfig | null> {
  const raw = await SecureStore.getItemAsync(STORAGE_KEY)
  return raw ? parseLayout(raw) : null
}

export async function saveLayout(layout: LayoutConfig): Promise<void> {
  const count = clampCount(layout.count)
  const normalized: LayoutConfig = { count, slots: resizeSlots(layout.slots, count) }
  await SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify(normalized))
}

/** 設定モードの「自動配置に戻す」用 */
export async function clearLayout(): Promise<void> {
  await SecureStore.deleteItemAsync(STORAGE_KEY)
}
