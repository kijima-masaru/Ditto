/** クリップボード履歴の右クリックメニュー「クリップボードにセット(整形/変換)」から使う、テキスト加工処理 */

function eachLine(text: string, fn: (line: string) => string): string {
  return text.split(/\r\n|\r|\n/).map(fn).join('\n')
}

export function insertLinePrefix(text: string, prefix: string): string {
  return eachLine(text, (line) => prefix + line)
}

export function wrapLinesInQuotes(text: string): string {
  return eachLine(text, (line) => `"${line}"`)
}

export function numberLines(text: string): string {
  const lines = text.split(/\r\n|\r|\n/)
  return lines.map((line, i) => `${String(i + 1).padStart(3, '0')}: ${line}`).join('\n')
}

export function toLowerCase(text: string): string {
  return text.toLowerCase()
}

export function toUpperCase(text: string): string {
  return text.toUpperCase()
}

/** 全角の英数字・記号・スペースを半角に変換する(半角カナへの変換は対象外) */
export function toHalfWidth(text: string): string {
  return text
    .replace(/[！-～]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/　/g, ' ')
}

/** 半角の英数字・記号・スペースを全角に変換する */
export function toFullWidth(text: string): string {
  return text
    .replace(/[\x21-\x7E]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) + 0xfee0))
    .replace(/ /g, '　')
}

export function tabToSpace(text: string): string {
  return text.replace(/\t/g, ' ')
}

export function spaceToTab(text: string): string {
  return text.replace(/ /g, '\t')
}

export function removeLineBreaks(text: string): string {
  return text.replace(/\r\n|\r|\n/g, '')
}
