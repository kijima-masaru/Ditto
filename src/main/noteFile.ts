import fs from 'fs/promises'
import iconv from 'iconv-lite'
import type { NoteFileEncoding, NoteNewline } from '../shared/types'

/**
 * メモを外部のテキストファイル(.txt/.md/.csv/.log)として読み書きする。
 *
 * 日本語のテキストファイルは文字コードがUTF-8とShift_JIS(CP932)に割れており、
 * 改行コードもCRLFとLFが混在する。取り込んだ時の形をメモ側に覚えておき、
 * 保存の時も同じ形へ戻すことで「サクラエディタで開いていたファイルを
 * Dittoで開いて直して保存する」が成立するようにしている。
 *
 * アプリ内部では改行を常に\nに正規化して扱い、ファイルへ書き出す時だけ
 * 元の改行コードへ戻す(画面・検索・文字数がすべて同じ数え方になるようにするため)。
 */

/** 判別のために読む先頭バイト数。全体を読むと大きなファイルで無駄になる */
const BOM_UTF8 = Buffer.from([0xef, 0xbb, 0xbf])
const BOM_UTF16LE = Buffer.from([0xff, 0xfe])
const BOM_UTF16BE = Buffer.from([0xfe, 0xff])

function startsWith(buffer: Buffer, prefix: Buffer): boolean {
  return buffer.length >= prefix.length && buffer.subarray(0, prefix.length).equals(prefix)
}

/**
 * UTF-8として矛盾なく読めるかを調べる。Node は不正なバイト列をU+FFFDへ
 * 置き換えて読むため、読み直したものを再度エンコードして元と一致するかで判定する
 */
function isValidUtf8(buffer: Buffer): boolean {
  return Buffer.from(buffer.toString('utf8'), 'utf8').equals(buffer)
}

/** 改行コードを数え、いちばん多いものをそのファイルの改行コードとみなす */
function detectNewline(text: string): NoteNewline {
  const crlf = (text.match(/\r\n/g) ?? []).length
  const lf = (text.match(/(?<!\r)\n/g) ?? []).length
  const cr = (text.match(/\r(?!\n)/g) ?? []).length
  if (crlf === 0 && lf === 0 && cr === 0) return 'crlf'
  if (crlf >= lf && crlf >= cr) return 'crlf'
  return lf >= cr ? 'lf' : 'cr'
}

export interface ReadFileResult {
  /** 改行を\nへ正規化した本文 */
  text: string
  encoding: NoteFileEncoding
  newline: NoteNewline
}

/**
 * テキストファイルを読み、文字コードと改行コードを判別して本文を返す。
 * BOMがあればそれを信じ、無ければUTF-8として読めるかどうかで
 * UTF-8とShift_JIS(CP932)を切り分ける
 */
export async function readTextFile(filePath: string): Promise<ReadFileResult> {
  const buffer = await fs.readFile(filePath)
  let encoding: NoteFileEncoding
  let raw: string
  if (startsWith(buffer, BOM_UTF8)) {
    encoding = 'utf8bom'
    raw = buffer.subarray(BOM_UTF8.length).toString('utf8')
  } else if (startsWith(buffer, BOM_UTF16LE)) {
    encoding = 'utf16le'
    raw = iconv.decode(buffer.subarray(BOM_UTF16LE.length), 'utf16-le')
  } else if (startsWith(buffer, BOM_UTF16BE)) {
    // ビッグエンディアンは読めるようにしておくが、保存し直す時はUTF-8にする
    // (Windowsのテキストファイルとしては事実上使われないため)
    encoding = 'utf8'
    raw = iconv.decode(buffer.subarray(BOM_UTF16BE.length), 'utf16-be')
  } else if (isValidUtf8(buffer)) {
    encoding = 'utf8'
    raw = buffer.toString('utf8')
  } else {
    encoding = 'shift_jis'
    raw = iconv.decode(buffer, 'cp932')
  }
  return { text: raw.replace(/\r\n|\r/g, '\n'), encoding, newline: detectNewline(raw) }
}

function toNewline(text: string, newline: NoteNewline): string {
  if (newline === 'lf') return text
  return text.split('\n').join(newline === 'crlf' ? '\r\n' : '\r')
}

/** 指定の文字コード・改行コードでテキストファイルへ書き出す */
export async function writeTextFile(
  filePath: string,
  text: string,
  encoding: NoteFileEncoding,
  newline: NoteNewline
): Promise<void> {
  const body = toNewline(text, newline)
  let buffer: Buffer
  if (encoding === 'shift_jis') {
    buffer = iconv.encode(body, 'cp932')
  } else if (encoding === 'utf16le') {
    buffer = Buffer.concat([BOM_UTF16LE, iconv.encode(body, 'utf16-le')])
  } else if (encoding === 'utf8bom') {
    buffer = Buffer.concat([BOM_UTF8, Buffer.from(body, 'utf8')])
  } else {
    buffer = Buffer.from(body, 'utf8')
  }
  // 書き込みの途中で中断されても元のファイルが壊れないよう、一時ファイルへ書いてから置き換える
  const tmp = `${filePath}.dittotmp`
  await fs.writeFile(tmp, buffer)
  await fs.rename(tmp, filePath)
}

/** 取り込み・保存ダイアログで見せる拡張子。業務で扱うテキスト系だけに絞る */
export const NOTE_FILE_FILTERS = [
  { name: 'テキスト', extensions: ['txt', 'md', 'csv', 'log', 'json', 'yml', 'yaml'] },
  { name: 'すべてのファイル', extensions: ['*'] }
]
