/**
 * メモの検索・置換。装飾は見ず、装飾を取り除いたプレーンテキストの上だけで探す。
 * 見つかった位置(文字数)は、そのまま画面の選択範囲やDOMの位置へ変換できる
 * (noteRichText の setSelectionOffsets / replaceRange と同じ座標系)
 */

export interface NoteSearchOptions {
  /** 検索語を正規表現として扱う */
  regex: boolean
  /** 大文字小文字を区別する */
  caseSensitive: boolean
}

export interface NoteMatch {
  start: number
  end: number
  /** 一致した文字列。正規表現のときは括弧の中身も持つ(置換の$1などに使う) */
  groups: string[]
}

/** 正規表現として扱わない場合に、記号をそのままの文字として探すためのエスケープ */
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * 検索語から正規表現を作る。正規表現が壊れている場合はnullを返す
 * (入力途中の「(」などで例外を投げて画面が止まらないようにするため)
 */
export function buildSearchRegExp(query: string, options: NoteSearchOptions): RegExp | null {
  if (query === '') return null
  const source = options.regex ? query : escapeRegExp(query)
  const flags = options.caseSensitive ? 'gm' : 'gmi'
  try {
    return new RegExp(source, flags)
  } catch {
    return null
  }
}

/**
 * 一致箇所をすべて返す。rangeStart/rangeEndを渡すとその範囲内だけを対象にする
 * (「選択範囲内だけ置換」用)
 */
export function findMatches(
  text: string,
  query: string,
  options: NoteSearchOptions,
  rangeStart = 0,
  rangeEnd = text.length
): NoteMatch[] {
  const re = buildSearchRegExp(query, options)
  if (!re) return []
  const target = text.slice(rangeStart, rangeEnd)
  const matches: NoteMatch[] = []
  let result = re.exec(target)
  while (result !== null) {
    const start = rangeStart + result.index
    const end = start + result[0].length
    matches.push({ start, end, groups: Array.from(result) })
    // 空文字に一致し続けて止まらなくなるのを防ぐ
    if (result[0].length === 0) re.lastIndex += 1
    if (matches.length > 100000) break
    result = re.exec(target)
  }
  return matches
}

/** 置換文字列の $& や $1〜$9 を、一致した内容で埋める(正規表現のときだけ) */
export function expandReplacement(replacement: string, match: NoteMatch, regex: boolean): string {
  if (!regex) return replacement
  return replacement.replace(/\$(\$|&|\d)/g, (_all, key: string) => {
    if (key === '$') return '$'
    if (key === '&') return match.groups[0] ?? ''
    return match.groups[Number(key)] ?? ''
  })
}

/** カーソル位置から見て次(または前)の一致を選ぶ */
export function pickMatch(matches: NoteMatch[], from: number, backward: boolean): NoteMatch | null {
  if (matches.length === 0) return null
  if (backward) {
    for (let i = matches.length - 1; i >= 0; i--) if (matches[i].end <= from) return matches[i]
    return matches[matches.length - 1]
  }
  for (const match of matches) if (match.start >= from) return match
  return matches[0]
}
