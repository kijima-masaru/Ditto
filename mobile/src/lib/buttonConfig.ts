import * as SecureStore from 'expo-secure-store'

/**
 * ホーム画面のボタン配置(個数と各スロットへの割り当て)を端末に保存する。
 *
 * 秘密情報ではないのでSecureStoreである必要はないが、この用途のために
 * AsyncStorageを足すとネイティブモジュールが増えて再ビルドが必要になるため、
 * 既に入っているSecureStoreに相乗りしている。
 * ただしAndroidのSecureStoreは1項目あたり2048バイトを超えると失敗しうるので、
 * ラベルはLABEL_MAX_LENGTHで切り詰めて上限に余裕を持たせている
 * (12スロット x 約80バイト = 約1KB に収まる想定)。
 */

const STORAGE_KEY = 'ditto_remote_buttons'

/** グリッドの列数。モックに合わせて3で固定 */
export const GRID_COLUMNS = 3
/** 配置できるボタンの最大数(3列 x 4行) */
export const MAX_BUTTONS = 12
/** 初期表示のボタン数 */
export const DEFAULT_BUTTON_COUNT = 6
/** 保存するラベルの最大文字数(SecureStoreの容量対策) */
const LABEL_MAX_LENGTH = 24

export interface ButtonSlot {
  kind: 'template' | 'macro'
  id: string
  /**
   * 表示名のキャッシュ。PCに未接続でもボタンの名称を出せるようにするため保持する。
   * PC側で名称が変わった場合は、接続後に受け取ったitemsで上書きされる
   */
  label: string
}

export interface ButtonLayout {
  /** 1〜MAX_BUTTONS */
  count: number
  /** 長さはcountと一致させる。未割り当てのスロットはnull */
  slots: (ButtonSlot | null)[]
}

export function createDefaultLayout(): ButtonLayout {
  return { count: DEFAULT_BUTTON_COUNT, slots: Array<ButtonSlot | null>(DEFAULT_BUTTON_COUNT).fill(null) }
}

/** countの変更に合わせてslotsの長さを揃える。増える分はnull、減る分は末尾から捨てる */
export function resizeLayout(layout: ButtonLayout, count: number): ButtonLayout {
  const clamped = Math.min(MAX_BUTTONS, Math.max(1, count))
  const slots = Array.from({ length: clamped }, (_, i) => layout.slots[i] ?? null)
  return { count: clamped, slots }
}

export function setSlot(layout: ButtonLayout, index: number, slot: ButtonSlot | null): ButtonLayout {
  const slots = layout.slots.slice()
  slots[index] = slot
  return { ...layout, slots }
}

/** 保存前に不正な値を落とす。アプリ更新でスロットの形が変わっても壊れないようにする */
function normalize(raw: unknown): ButtonLayout | null {
  if (typeof raw !== 'object' || raw === null) return null
  const obj = raw as Partial<ButtonLayout>
  if (typeof obj.count !== 'number' || !Array.isArray(obj.slots)) return null
  const count = Math.min(MAX_BUTTONS, Math.max(1, Math.floor(obj.count)))
  const slots = Array.from({ length: count }, (_, i): ButtonSlot | null => {
    const s = obj.slots?.[i]
    if (!s || typeof s !== 'object') return null
    const { kind, id, label } = s as Partial<ButtonSlot>
    if ((kind !== 'template' && kind !== 'macro') || typeof id !== 'string' || !id) return null
    return { kind, id, label: typeof label === 'string' ? label : '' }
  })
  return { count, slots }
}

export async function loadLayout(): Promise<ButtonLayout> {
  try {
    const raw = await SecureStore.getItemAsync(STORAGE_KEY)
    if (!raw) return createDefaultLayout()
    return normalize(JSON.parse(raw)) ?? createDefaultLayout()
  } catch {
    return createDefaultLayout()
  }
}

export async function saveLayout(layout: ButtonLayout): Promise<void> {
  const trimmed: ButtonLayout = {
    count: layout.count,
    slots: layout.slots.map((s) => (s ? { ...s, label: s.label.slice(0, LABEL_MAX_LENGTH) } : null))
  }
  await SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify(trimmed))
}
