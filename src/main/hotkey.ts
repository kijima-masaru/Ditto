import { uIOhook, UiohookKey, type UiohookKeyboardEvent } from 'uiohook-napi'
import { ensureGlobalHookStarted, keepGlobalHookAlive } from './adapters/windowTargetBase'
import type { HotkeyBinding, HotkeyCombo, NavigationTarget } from '../shared/types'

/**
 * ウィンドウ表示ホットキー。任意のキー組み合わせを、複数組(HotkeyBinding)登録できる。
 * - keycodeがnull: 修飾キー(Ctrl/Shift/Alt/Win)単体を一定時間内に2回押すと発火
 * - keycodeがある: 修飾キーを押しながらそのキーを1回押すと即座に発火(通常のショートカットと同じ)
 * アプリ全体で使うグローバルフック(uiohook-napi)にリスナーを追加する形で実装し、
 * 記録セッションの有無に関わらず常時有効にする(そのためフックはアプリ終了まで維持する)。
 * 各バインディングのダブルタップ判定(lastPressAt)は互いに独立して管理する。
 */
const DOUBLE_PRESS_WINDOW_MS = 400

const MODIFIER_KEYCODES = new Set<number>([
  UiohookKey.Ctrl,
  UiohookKey.CtrlRight,
  UiohookKey.Shift,
  UiohookKey.ShiftRight,
  UiohookKey.Alt,
  UiohookKey.AltRight,
  UiohookKey.Meta,
  UiohookKey.MetaRight
])

const KEYCODE_TO_NAME: Record<number, string> = (() => {
  const map: Record<number, string> = {}
  for (const [name, code] of Object.entries(UiohookKey) as Array<[string, number]>) {
    if (!(code in map)) map[code] = name
  }
  return map
})()

function isModifierKeycode(keycode: number): boolean {
  return MODIFIER_KEYCODES.has(keycode)
}

function modifierFlagsForKeycode(keycode: number | null): Omit<HotkeyCombo, 'keycode' | 'label'> {
  if (keycode === UiohookKey.Ctrl || keycode === UiohookKey.CtrlRight) {
    return { ctrl: true, shift: false, alt: false, meta: false }
  }
  if (keycode === UiohookKey.Shift || keycode === UiohookKey.ShiftRight) {
    return { ctrl: false, shift: true, alt: false, meta: false }
  }
  if (keycode === UiohookKey.Alt || keycode === UiohookKey.AltRight) {
    return { ctrl: false, shift: false, alt: true, meta: false }
  }
  if (keycode === UiohookKey.Meta || keycode === UiohookKey.MetaRight) {
    return { ctrl: false, shift: false, alt: false, meta: true }
  }
  return { ctrl: false, shift: false, alt: false, meta: false }
}

export function formatComboLabel(combo: Omit<HotkeyCombo, 'label'>): string {
  const parts: string[] = []
  if (combo.ctrl) parts.push('Ctrl')
  if (combo.shift) parts.push('Shift')
  if (combo.alt) parts.push('Alt')
  if (combo.meta) parts.push('Win')
  if (combo.keycode === null) {
    return parts.length > 0 ? `${parts[0]} 2回` : '(未設定)'
  }
  parts.push(KEYCODE_TO_NAME[combo.keycode] ?? `Key${combo.keycode}`)
  return parts.join('+')
}

/** 実行時に保持するバインディング。ダブルタップ判定用の状態(lastPressAt)を各バインディングごとに持つ */
interface RuntimeBinding {
  id: string
  combo: HotkeyCombo
  target: NavigationTarget | null
  lastPressAt: number
}

function toRuntimeBinding(b: HotkeyBinding): RuntimeBinding {
  return { id: b.id, combo: b.hotkey, target: b.target, lastPressAt: 0 }
}

let runtimeBindings: RuntimeBinding[] = []
let onTriggerCb: ((target: NavigationTarget | null) => void) | null = null
// OSのキーリピート(長押し中に連続して届くkeydown)を、素早い2回押しと誤検知しないための
// 押下中キー集合。keydownで追加・keyupで削除し、「すでに押されているキー」からのkeydownは
// リピートとみなして無視する(離して押し直した場合のみ新しい1回の押下として扱う)
const heldKeycodes = new Set<number>()

function matchesModifiers(e: UiohookKeyboardEvent, combo: HotkeyCombo): boolean {
  return e.ctrlKey === combo.ctrl && e.shiftKey === combo.shift && e.altKey === combo.alt && e.metaKey === combo.meta
}

function watchedKeycodesForModifierOnly(combo: HotkeyCombo): number[] {
  if (combo.ctrl) return [UiohookKey.Ctrl, UiohookKey.CtrlRight]
  if (combo.shift) return [UiohookKey.Shift, UiohookKey.ShiftRight]
  if (combo.alt) return [UiohookKey.Alt, UiohookKey.AltRight]
  if (combo.meta) return [UiohookKey.Meta, UiohookKey.MetaRight]
  return []
}

function handleTriggerKeyup(e: UiohookKeyboardEvent): void {
  heldKeycodes.delete(e.keycode)
}

function handleTriggerKeydown(e: UiohookKeyboardEvent): void {
  if (runtimeBindings.length === 0) return
  const isRepeat = heldKeycodes.has(e.keycode)
  heldKeycodes.add(e.keycode)
  if (isRepeat) return

  for (const binding of runtimeBindings) {
    if (binding.combo.keycode === null) {
      const watched = watchedKeycodesForModifierOnly(binding.combo)
      if (watched.length === 0) continue // 未設定(修飾キーなし)のバインディングは発火しない
      if (watched.includes(e.keycode)) {
        const now = Date.now()
        if (now - binding.lastPressAt <= DOUBLE_PRESS_WINDOW_MS) {
          binding.lastPressAt = 0
          onTriggerCb?.(binding.target)
        } else {
          binding.lastPressAt = now
        }
      } else {
        // 選択中のキーを押した状態で他のキーが押された場合はショートカット操作とみなし、連打判定をリセットする
        binding.lastPressAt = 0
      }
    } else {
      if (e.keycode === binding.combo.keycode && matchesModifiers(e, binding.combo)) {
        onTriggerCb?.(binding.target)
      }
    }
  }
}

export function setupGlobalHotkeys(
  initialBindings: HotkeyBinding[],
  onTrigger: (target: NavigationTarget | null) => void
): void {
  runtimeBindings = initialBindings.map(toRuntimeBinding)
  onTriggerCb = onTrigger
  ensureGlobalHookStarted()
  keepGlobalHookAlive()
  uIOhook.on('keydown', handleTriggerKeydown)
  uIOhook.on('keyup', handleTriggerKeyup)
}

/** 設定画面での変更を即座に反映する */
export function setHotkeyBindingsRuntime(bindings: HotkeyBinding[]): void {
  runtimeBindings = bindings.map(toRuntimeBinding)
}

// --- ホットキーのキャプチャ(設定画面で「キーを押して設定」した際に使う) ---

let captureCleanup: (() => void) | null = null

export function startHotkeyCapture(
  onPreview: (label: string) => void,
  onResult: (combo: HotkeyCombo) => void
): void {
  cancelHotkeyCapture()
  ensureGlobalHookStarted()

  let firstModifierKeycode: number | null = null

  const finish = (partial: Omit<HotkeyCombo, 'label'>): void => {
    cleanup()
    onResult({ ...partial, label: formatComboLabel(partial) })
  }

  const onKeydown = (e: UiohookKeyboardEvent): void => {
    if (isModifierKeycode(e.keycode)) {
      if (firstModifierKeycode === null) firstModifierKeycode = e.keycode
      onPreview(formatComboLabel({ ctrl: e.ctrlKey, shift: e.shiftKey, alt: e.altKey, meta: e.metaKey, keycode: null }))
      return
    }
    finish({ ctrl: e.ctrlKey, shift: e.shiftKey, alt: e.altKey, meta: e.metaKey, keycode: e.keycode })
  }

  const onKeyup = (e: UiohookKeyboardEvent): void => {
    if (e.keycode === firstModifierKeycode) {
      finish({ ...modifierFlagsForKeycode(firstModifierKeycode), keycode: null })
    }
  }

  const cleanup = (): void => {
    uIOhook.removeListener('keydown', onKeydown)
    uIOhook.removeListener('keyup', onKeyup)
    captureCleanup = null
  }

  uIOhook.on('keydown', onKeydown)
  uIOhook.on('keyup', onKeyup)
  captureCleanup = cleanup
}

export function cancelHotkeyCapture(): void {
  captureCleanup?.()
  captureCleanup = null
}
