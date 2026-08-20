import koffi from 'koffi'
import log from './logger'

/**
 * マクロ再生中、実際のユーザーのマウス操作(物理ハードウェア由来の入力)だけを遮断し、
 * マクロ自身が生成する入力(nut-js経由のSendInput呼び出し。OSがLLMHF_INJECTEDフラグを
 * 自動的に付与する)は素通しする、WH_MOUSE_LLの低レベルフックによる実装。
 *
 * 注意: このアプリはkoffiによるFFI呼び出しのみでネイティブアドオンのビルド
 * (node-gyp/Visual Studio Build Tools)を避ける設計方針だが、低レベルフックは
 * 本来OSから即座に(数十ms未満で)応答が返ることを期待する仕組みであり、
 * koffiの登録コールバック(koffi.register)がその要求を満たせない場合、
 * マウス入力の遅延・カクつきが一時的に発生する可能性がある。
 * フック処理自体は単純なフラグ判定のみで即座に返すため通常は問題にならない想定だが、
 * 実機で違和感があれば直ちにこの機能を無効化すること。
 * 必ずtry/finally等でstopBlockingRealMouseInput()を呼び、フックを残さないこと。
 */

const user32 = koffi.load('user32.dll')

const WH_MOUSE_LL = 14
const LLMHF_INJECTED = 0x00000001

koffi.struct('POINT', { x: 'long', y: 'long' })
koffi.struct('MSLLHOOKSTRUCT', {
  pt: 'POINT',
  mouseData: 'uint32',
  flags: 'uint32',
  time: 'uint32',
  dwExtraInfo: 'uintptr_t'
})

const LowLevelMouseProc = koffi.proto('__stdcall', 'LowLevelMouseProc', 'intptr_t', ['int', 'uintptr_t', 'void *'])

const SetWindowsHookExW = user32.func(
  'void * __stdcall SetWindowsHookExW(int idHook, LowLevelMouseProc *lpfn, void *hMod, uint32 dwThreadId)'
)
const UnhookWindowsHookEx = user32.func('int __stdcall UnhookWindowsHookEx(void *hhk)')
const CallNextHookEx = user32.func('intptr_t __stdcall CallNextHookEx(void *hhk, int nCode, uintptr_t wParam, void *lParam)')

let hookHandle: unknown = null
let callbackHandle: bigint | null = null

export function startBlockingRealMouseInput(): void {
  if (hookHandle) return

  const proc = (nCode: number, wParam: number, lParam: unknown): number => {
    if (nCode >= 0 && lParam) {
      try {
        const info = koffi.decode(lParam, 'MSLLHOOKSTRUCT') as { flags: number }
        const injected = (info.flags & LLMHF_INJECTED) !== 0
        if (!injected) return 1 // 実際のユーザー操作(注入フラグなし)は握りつぶす
      } catch (err) {
        // デコードに失敗した場合は安全側(素通し)に倒す
        log.warn(`mouseBlock: failed to decode MSLLHOOKSTRUCT: ${err}`)
      }
    }
    return Number(CallNextHookEx(hookHandle, nCode, wParam, lParam))
  }

  callbackHandle = koffi.register(proc, koffi.pointer(LowLevelMouseProc))
  hookHandle = SetWindowsHookExW(WH_MOUSE_LL, callbackHandle, null, 0)
  if (!hookHandle) {
    log.warn('mouseBlock: SetWindowsHookExW failed')
    koffi.unregister(callbackHandle)
    callbackHandle = null
  }
}

export function stopBlockingRealMouseInput(): void {
  if (hookHandle) {
    UnhookWindowsHookEx(hookHandle)
    hookHandle = null
  }
  if (callbackHandle) {
    koffi.unregister(callbackHandle)
    callbackHandle = null
  }
}

export function isBlockingRealMouseInput(): boolean {
  return hookHandle !== null
}
