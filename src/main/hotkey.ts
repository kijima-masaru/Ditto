import { uIOhook, UiohookKey, type UiohookKeyboardEvent } from 'uiohook-napi'
import { ensureGlobalHookStarted, keepGlobalHookAlive } from './adapters/windowTargetBase'

/**
 * Ctrlキーを一定時間内に2回押すとウィンドウを表示するグローバルホットキー。
 * アプリ全体で使うグローバルフック(uiohook-napi)にリスナーを追加する形で実装し、
 * 記録セッションの有無に関わらず常時有効にする(そのためフックはアプリ終了まで維持する)。
 */
const DOUBLE_PRESS_WINDOW_MS = 400
const CTRL_KEYCODES: number[] = [UiohookKey.Ctrl, UiohookKey.CtrlRight]

export function setupGlobalHotkey(onTrigger: () => void): void {
  ensureGlobalHookStarted()
  keepGlobalHookAlive()

  let lastCtrlPressAt = 0

  const handleKeydown = (e: UiohookKeyboardEvent): void => {
    if (CTRL_KEYCODES.includes(e.keycode)) {
      const now = Date.now()
      if (now - lastCtrlPressAt <= DOUBLE_PRESS_WINDOW_MS) {
        lastCtrlPressAt = 0
        onTrigger()
      } else {
        lastCtrlPressAt = now
      }
      return
    }
    // Ctrlを押した状態で他のキーが押された場合はショートカット操作とみなし、連打判定をリセットする
    lastCtrlPressAt = 0
  }

  uIOhook.on('keydown', handleKeydown)
}
