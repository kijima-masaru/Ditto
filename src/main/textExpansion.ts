import { uIOhook, UiohookKey, type UiohookKeyboardEvent } from 'uiohook-napi'
import { ensureGlobalHookStarted, keepGlobalHookAlive } from './adapters/windowTargetBase'
import * as clipboardStore from './clipboardStore'
import { resolveTemplateText } from './templateVariables'
import { backspaceKeys, typeUnicodeText } from './win32'
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
// トリガー文字列 -> 定型文id。動的変数({{date}}等)は展開の都度resolveTemplateTextで
// その場で解決するため、本文の生テキストではなくidを保持する
let triggerMap = new Map<string, string>()
let buffer = ''
// 展開中にnut-jsで送出したキー入力自身をフックが拾って再判定してしまう(無限ループ・
// バッファ破壊)のを防ぐためのガード
let expanding = false

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// 1回のSendInputで送るUnicode文字数。長文を1回にまとめて送出すると、対象アプリの
// メッセージループが処理しきれず一部の文字が欠落・入れ替わることがあるため、
// 適度な塊に分けて少し間隔を空けながら送る
const TYPE_CHUNK_SIZE = 15

async function expand(trigger: string, templateId: string): Promise<void> {
  expanding = true
  // 展開中はグローバルフックを一時停止する。稼働させたままSendInputで大量のキー
  // イベントを注入すると、自プロセス自身のフックがそれらを拾って処理する分だけ
  // Nodeメインスレッドの処理が割り込み、フック配送側でのタイムアウト・順序崩壊が
  // 起こり文字化けや欠落につながるため、注入中はフック自体を外して競合を断つ
  uIOhook.stop()
  try {
    // {{date}}/{{seq}}/{{clipboard}}等の動的変数は、実際に展開する直前(=このタイミング)で
    // その場で解決する。トリガーのBackspace消去より前に呼ぶ必要がある({{clipboard}}が
    // 展開直前のクリップボード内容を指すため、クリップボード自体はここでは書き換えない)
    const text = await resolveTemplateText(templateId)
    // Backspaceを1つずつ、短い間隔を空けて送出する。同一キーのdown/upを
    // 間隔なしで連続送出すると、キーリピート判定を行うアプリ側で一部が
    // 取りこぼされることがあるため、1回ずつ確実に処理させる
    for (let i = 0; i < trigger.length; i++) {
      backspaceKeys(1)
      await wait(15)
    }
    // nut-jsのkeyboard.type()はキーボードレイアウトの仮想キー変換に依存し、
    // レイアウト上にない文字(日本語等)は文字化けするため、SendInput+
    // KEYEVENTF_UNICODEで直接注入するwin32.typeUnicodeTextを使う。
    // 長文は対象アプリのメッセージループが追いつけるよう分割して送出する
    for (let i = 0; i < text.length; i += TYPE_CHUNK_SIZE) {
      typeUnicodeText(text.slice(i, i + TYPE_CHUNK_SIZE))
      await wait(20)
    }
    // SendInput()はイベントをOSキューに積んだ時点で処理を返すため、呼び出しが
    // 完了しても対象アプリへの配送がまだ完了していない場合がある。直後にフックを
    // 再開すると、配送中の末尾数文字を自プロセスのフックが拾ってしまい順序が
    // 崩れることがあるため、フック再開前に配送が完了するのを少し待つ
    await wait(100)
  } catch (err) {
    log.error('[textExpansion] expand failed', err)
  } finally {
    uIOhook.start()
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

  for (const [trigger, templateId] of triggerMap) {
    if (buffer.endsWith(trigger)) {
      buffer = ''
      void expand(trigger, templateId)
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
    if (t.trigger) next.set(t.trigger, t.id)
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
