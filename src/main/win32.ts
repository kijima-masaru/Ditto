import koffi from 'koffi'

/**
 * Win32 API (user32.dll) をkoffi経由で直接呼び出すヘルパー。
 * ネイティブアドオンのビルド(node-gyp/Visual Studio Build Tools)を必要とせず、
 * デスクトップアプリ対象のウィンドウを操作するために使用する。
 *
 * 注意: Win32のBOOLはC言語の_Bool(1バイト)ではなくint(4バイト)のtypedefであるため、
 * 戻り値の型はすべて'int'で宣言し、0以外をtrueとして扱う。
 *
 * デスクトップ対象をこのアプリの表示エリア内に正確に重ねて表示する(SetParentでの
 * 埋め込み、あるいはMoveWindowでの座標合わせ)は検証したが、いずれもこの環境では
 * DPI仮想化やDWM/GPUコンポジタとの相性で信頼できる描画が得られなかった
 * (SetParentは親子関係・Z-orderは正しく設定できるが内容が描画されない、
 * MoveWindowはAPI呼び出し自体は成功を返すのに実際の座標に反映されない、等)。
 * そのため、アクティブなタブに切り替えた対象を最前面に表示・非アクティブなタブは
 * 最小化する、というシンプルで確実な方式を採用している。
 */

const user32 = koffi.load('user32.dll')

const ShowWindow = user32.func('int __stdcall ShowWindow(void *hWnd, int nCmdShow)')
const IsWindow = user32.func('int __stdcall IsWindow(void *hWnd)')
const SetForegroundWindow = user32.func('int __stdcall SetForegroundWindow(void *hWnd)')

const SW_MINIMIZE = 6
const SW_RESTORE = 9

export type NativeHandle = unknown

/** 数値(active-winのwindow id)をHWNDポインタに変換する */
export function idToHandle(id: number): NativeHandle {
  const buf = Buffer.alloc(8)
  buf.writeBigUInt64LE(BigInt(id))
  return koffi.decode(buf, 'void *')
}

export function windowExists(hwnd: NativeHandle): boolean {
  try {
    return Number(IsWindow(hwnd)) !== 0
  } catch {
    return false
  }
}

/** ウィンドウを復元して最前面に表示しフォーカスする */
export function activateWindow(hwnd: NativeHandle): void {
  ShowWindow(hwnd, SW_RESTORE)
  SetForegroundWindow(hwnd)
}

/** ウィンドウを最小化する(非アクティブなタブの対象を画面から隠すため) */
export function minimizeWindow(hwnd: NativeHandle): void {
  ShowWindow(hwnd, SW_MINIMIZE)
}
