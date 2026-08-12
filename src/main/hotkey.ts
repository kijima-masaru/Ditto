import { uIOhook, UiohookKey, type UiohookKeyboardEvent } from 'uiohook-napi'
import { ensureGlobalHookStarted, keepGlobalHookAlive } from './adapters/windowTargetBase'
import type { HotkeyModifier } from '../shared/types'

/**
 * 選択したキー(Ctrl/Shift/Alt)を一定時間内に2回押すとウィンドウを表示するグローバルホットキー。
 * アプリ全体で使うグローバルフック(uiohook-napi)にリスナーを追加する形で実装し、
 * 記録セッションの有無に関わらず常時有効にする(そのためフックはアプリ終了まで維持する)。
 */
const DOUBLE_PRESS_WINDOW_MS = 400

const MODIFIER_KEYCODES: Record<HotkeyModifier, number[]> = {
  Ctrl: [UiohookKey.Ctrl, UiohookKey.CtrlRight],
  Shift: [UiohookKey.Shift, UiohookKey.ShiftRight],
  Alt: [UiohookKey.Alt, UiohookKey.AltRight]
}

let currentModifier: HotkeyModifier = 'Ctrl'
let lastPressAt = 0

export function setupGlobalHotkey(initialModifier: HotkeyModifier, onTrigger: () => void): void {
  currentModifier = initialModifier
  ensureGlobalHookStarted()
  keepGlobalHookAlive()

  const handleKeydown = (e: UiohookKeyboardEvent): void => {
    const watched = MODIFIER_KEYCODES[currentModifier]
    if (watched.includes(e.keycode)) {
      const now = Date.now()
      if (now - lastPressAt <= DOUBLE_PRESS_WINDOW_MS) {
        lastPressAt = 0
        onTrigger()
      } else {
        lastPressAt = now
      }
      return
    }
    // 選択中のキーを押した状態で他のキーが押された場合はショートカット操作とみなし、連打判定をリセットする
    lastPressAt = 0
  }

  uIOhook.on('keydown', handleKeydown)
}

/** 設定画面での変更を即座に反映する */
export function setHotkeyModifier(modifier: HotkeyModifier): void {
  currentModifier = modifier
  lastPressAt = 0
}
