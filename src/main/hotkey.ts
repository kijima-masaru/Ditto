import { uIOhook, UiohookKey, type UiohookKeyboardEvent } from 'uiohook-napi'
import { ensureGlobalHookStarted, keepGlobalHookAlive } from './adapters/windowTargetBase'
import type { HotkeyCombo } from '../shared/types'

/**
 * ウィンドウ表示ホットキー。任意のキー組み合わせを設定できる。
 * - keycodeがnull: 修飾キー(Ctrl/Shift/Alt/Win)単体を一定時間内に2回押すと発火
 * - keycodeがある: 修飾キーを押しながらそのキーを1回押すと即座に発火(通常のショートカットと同じ)
 * アプリ全体で使うグローバルフック(uiohook-napi)にリスナーを追加する形で実装し、
 * 記録セッションの有無に関わらず常時有効にする(そのためフックはアプリ終了まで維持する)。
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

let currentCombo: HotkeyCombo | null = null
let lastPressAt = 0
let onTriggerCb: (() => void) | null = null

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

function handleTriggerKeydown(e: UiohookKeyboardEvent): void {
  if (!currentCombo) return
  if (currentCombo.keycode === null) {
    const watched = watchedKeycodesForModifierOnly(currentCombo)
    if (watched.includes(e.keycode)) {
      const now = Date.now()
      if (now - lastPressAt <= DOUBLE_PRESS_WINDOW_MS) {
        lastPressAt = 0
        onTriggerCb?.()
      } else {
        lastPressAt = now
      }
      return
    }
    // 選択中のキーを押した状態で他のキーが押された場合はショートカット操作とみなし、連打判定をリセットする
    lastPressAt = 0
  } else {
    if (e.keycode === currentCombo.keycode && matchesModifiers(e, currentCombo)) {
      onTriggerCb?.()
    }
  }
}

export function setupGlobalHotkey(initialCombo: HotkeyCombo, onTrigger: () => void): void {
  currentCombo = initialCombo
  onTriggerCb = onTrigger
  ensureGlobalHookStarted()
  keepGlobalHookAlive()
  uIOhook.on('keydown', handleTriggerKeydown)
}

/** 設定画面での変更を即座に反映する */
export function setHotkeyCombo(combo: HotkeyCombo): void {
  currentCombo = combo
  lastPressAt = 0
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
