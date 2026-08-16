import { uIOhook, UiohookKey, type UiohookKeyboardEvent } from 'uiohook-napi'
import { keyboard, Key as NutKey } from '@nut-tree-fork/nut-js'
import { ensureGlobalHookStarted, keepGlobalHookAlive } from './adapters/windowTargetBase'
import * as clipboardStore from './clipboardStore'
import log from './logger'

/**
 * 定型文のトリガー展開。グローバルキーボードフック(uiohook-napi)で直近の入力を監視し、
 * 登録済みのトリガー文字列(例: ";greeting")が末尾に一致した瞬間、その文字列をBackspaceで
 * 消してから本文をタイプし直す。ホットキー検知(hotkey.ts)と同じ共有フックを使う。
 *
 * 物理キーコードから文字を判定する都合上、IME入力(日本語変換など)を経由しない
 * 半角/直接入力モードでの利用を前提とする。IMEがON中はローマ字が変換対象の未確定文字列
 * (プリエディット)として扱われ、物理キー入力と実際にアプリへ渡る文字が一致しないため、
 * トリガーは半角英数字と一部記号(TEMPLATE_TRIGGER_PATTERN参照)のみに絞っている。
 */

const MAX_BUFFER_LENGTH = 40

// UiohookKeyの物理キーコード→キーを押した時の文字(shift無し)。英字・数字のみ機械的に構築する
const CHAR_KEYCODES: Record<number, string> = {}
for (const letter of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
  CHAR_KEYCODES[UiohookKey[letter as keyof typeof UiohookKey]] = letter.toLowerCase()
}
for (const digit of '0123456789') {
  CHAR_KEYCODES[UiohookKey[digit as keyof typeof UiohookKey]] = digit
}

function charForKeydown(e: UiohookKeyboardEvent): string | null {
  const mapped = CHAR_KEYCODES[e.keycode]
  if (mapped !== undefined) return mapped
  switch (e.keycode) {
    case UiohookKey.Semicolon:
      return e.shiftKey ? ':' : ';'
    case UiohookKey.Minus:
      return e.shiftKey ? '_' : '-'
    case UiohookKey.Period:
      return '.'
    case UiohookKey.Slash:
      return '/'
    case UiohookKey.Comma:
      return ','
    default:
      return null
  }
}

let enabled = false
let triggerMap = new Map<string, string>()
let buffer = ''
// 展開中にnut-jsで送出したキー入力自身をフックが拾って再判定してしまう(無限ループ・
// バッファ破壊)のを防ぐためのガード
let expanding = false

async function expand(trigger: string, text: string): Promise<void> {
  expanding = true
  try {
    for (let i = 0; i < trigger.length; i++) {
      await keyboard.type(NutKey.Backspace)
    }
    await keyboard.type(text)
  } catch (err) {
    log.error('[textExpansion] expand failed', err)
  } finally {
    expanding = false
  }
}

function handleKeydown(e: UiohookKeyboardEvent): void {
  if (!enabled || expanding) return

  // Ctrl/Alt/Meta併用はショートカット操作とみなし、文字入力の続きとして扱わない
  if (e.ctrlKey || e.altKey || e.metaKey) {
    buffer = ''
    return
  }

  if (e.keycode === UiohookKey.Backspace) {
    buffer = buffer.slice(0, -1)
    return
  }

  const ch = charForKeydown(e)
  if (ch === null) {
    // 矢印キー・Enter・Tab等、文脈が変わる操作ではバッファをリセットする
    buffer = ''
    return
  }

  buffer = (buffer + ch).slice(-MAX_BUFFER_LENGTH)

  for (const [trigger, text] of triggerMap) {
    if (buffer.endsWith(trigger)) {
      buffer = ''
      void expand(trigger, text)
      return
    }
  }
}

function handleMousedown(): void {
  // クリックで入力対象(フォーカス)が変わりうるため、直前までの入力の続きとして扱わない
  buffer = ''
}

/** clipboardStoreの定型文からトリガー設定済みのものだけを抽出し、判定用マップを作り直す */
export async function refreshTriggerMap(): Promise<void> {
  const templates = await clipboardStore.listTemplates()
  const next = new Map<string, string>()
  for (const t of templates) {
    if (t.trigger) next.set(t.trigger, t.text)
  }
  triggerMap = next
}

export function setEnabled(value: boolean): void {
  enabled = value
  buffer = ''
}

export function initTextExpansion(): void {
  ensureGlobalHookStarted()
  keepGlobalHookAlive()
  uIOhook.on('keydown', handleKeydown)
  uIOhook.on('mousedown', handleMousedown)
  void refreshTriggerMap()
}
