import { uIOhook } from 'uiohook-napi'
import { ensureGlobalHookStarted } from './adapters/windowTargetBase'
import * as win32 from './win32'

/**
 * OSが現在フォーカスしている場所へ、テキストを直接キー入力として注入する共通処理。
 * コマンドパレット(commandPalette.ts)とDitto Remote(remoteServer.ts)の双方から
 * 呼ばれるため、ここに1箇所へ集約している。クリップボードへの書き込みや対象ウィンドウの
 * 再アクティブ化はこの関数の責務ではなく、呼び出し側が必要に応じて行う。
 */

// 1回のSendInputで送るUnicode文字数。長文を1回にまとめて送出すると、対象アプリの
// メッセージループが処理しきれず一部の文字が欠落・入れ替わることがあるため、
// 適度な塊に分けて少し間隔を空けながら送る
const TYPE_CHUNK_SIZE = 15

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// ローカル(コマンドパレット)とリモート(Ditto Remote)から同時に呼ばれると、
// 片方のfinally節のuIOhook.start()がもう片方の注入中にフックを再開してしまい、
// 注入中の合成キーイベントを自分のフックが拾ってしまう競合が起こり得るため、
// Promiseチェーンで直列化して同時実行を防ぐ
let chain: Promise<void> = Promise.resolve()

export function injectText(text: string): Promise<void> {
  const run = chain.then(() => injectTextInner(text))
  chain = run.catch(() => {}) // 1件の失敗で以後のキューを止めない
  return run
}

async function injectTextInner(text: string): Promise<void> {
  ensureGlobalHookStarted()
  uIOhook.stop()
  try {
    for (let i = 0; i < text.length; i += TYPE_CHUNK_SIZE) {
      win32.typeUnicodeText(text.slice(i, i + TYPE_CHUNK_SIZE))
      await wait(20)
    }
    await wait(100)
  } finally {
    uIOhook.start()
  }
}
