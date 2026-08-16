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

/**
 * SendInput + KEYEVENTF_UNICODE によるUnicodeテキスト直接入力。
 *
 * nut-jsのkeyboard.type()はキーボードレイアウトの仮想キーコード変換(VkKeyScan相当)に
 * 依存しており、日本語などレイアウト上にマッピングされない文字は正しく入力できず
 * 文字化けする。KEYEVENTF_UNICODEはレイアウトを介さずUTF-16コード単位を直接注入できるため、
 * 定型文のトリガー展開(textExpansion.ts)のようにテンプレート本文へ任意のUnicode文字列を
 * 打ち込む用途ではこちらを使う。
 */
koffi.struct('KEYBDINPUT', {
  wVk: 'uint16',
  wScan: 'uint16',
  dwFlags: 'uint32',
  time: 'uint32',
  dwExtraInfo: 'uint64'
})

koffi.struct('INPUT', {
  type: 'uint32',
  // ki(KEYBDINPUT)がuint64フィールドを含み8バイトアライメントを要求するため、
  // typeの直後に明示的なパディングを置く
  padding: 'uint32',
  ki: 'KEYBDINPUT',
  // Win32のINPUTは実際にはtype + union(MOUSEINPUT|KEYBDINPUT|HARDWAREINPUT)で、
  // unionのサイズは最大メンバーであるMOUSEINPUT(32バイト)に合わせて確保される
  // (KEYBDINPUTは24バイトで収まるが、union全体としては32バイト分の領域が必要)。
  // そのため実際のsizeof(INPUT)はx64で40バイトであり、この末尾パディングを
  // 省略するとSendInputにcbSizeとして32を渡すことになり、Windows側の内部検証
  // (実サイズとの不一致)でERROR_INVALID_PARAMETER(87)となり入力が全く注入されない
  unionPadding: 'uint64'
})

const SendInput = user32.func('uint32 __stdcall SendInput(uint32 nInputs, _In_ INPUT *pInputs, int cbSize)')

const INPUT_SIZE = koffi.sizeof('INPUT')
const INPUT_KEYBOARD = 1
const KEYEVENTF_UNICODE = 0x0004
const KEYEVENTF_KEYUP = 0x0002
const VK_BACK = 0x08

function unicodeKeyInput(code: number, keyUp: boolean): unknown {
  return {
    type: INPUT_KEYBOARD,
    padding: 0,
    ki: {
      wVk: 0,
      wScan: code,
      dwFlags: KEYEVENTF_UNICODE | (keyUp ? KEYEVENTF_KEYUP : 0),
      time: 0,
      dwExtraInfo: 0
    }
  }
}

function vkKeyInput(vk: number, keyUp: boolean): unknown {
  return {
    type: INPUT_KEYBOARD,
    padding: 0,
    ki: {
      wVk: vk,
      wScan: 0,
      dwFlags: keyUp ? KEYEVENTF_KEYUP : 0,
      time: 0,
      dwExtraInfo: 0
    }
  }
}

/** 任意のUnicode文字列をSendInput経由でフォーカス中のウィンドウへ直接タイプする */
export function typeUnicodeText(text: string): void {
  if (!text) return
  const inputs: unknown[] = []
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    inputs.push(unicodeKeyInput(code, false))
    inputs.push(unicodeKeyInput(code, true))
  }
  SendInput(inputs.length, inputs, INPUT_SIZE)
}

/** Backspaceを指定回数送出する */
export function backspaceKeys(count: number): void {
  if (count <= 0) return
  const inputs: unknown[] = []
  for (let i = 0; i < count; i++) {
    inputs.push(vkKeyInput(VK_BACK, false))
    inputs.push(vkKeyInput(VK_BACK, true))
  }
  SendInput(inputs.length, inputs, INPUT_SIZE)
}

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
