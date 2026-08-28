/**
 * 選択範囲へまとめて掛ける整形・変換。サクラエディタの「変換」に当たるもの。
 *
 * どれも「テキストを受け取ってテキストを返す」だけの関数にしてある。
 * 呼び出し側(メモの編集画面)は選択範囲のプレーンテキストを渡し、
 * 返ってきたテキストで置き換える
 */

export interface NoteTextTransform {
  id: string
  label: string
  apply: (text: string) => string
}

function mapLines(text: string, fn: (line: string) => string): string {
  return text.split('\n').map(fn).join('\n')
}

/** 半角(!〜~)と全角(！〜～)は同じ並び順なので、コード位置をずらすだけで変換できる */
const HALF_START = 0x21
const HALF_END = 0x7e
const FULL_OFFSET = 0xfee0

function toFullWidth(text: string): string {
  return text.replace(/[\x21-\x7e]/g, (c) => String.fromCharCode(c.charCodeAt(0) + FULL_OFFSET)).replace(/ /g, '　')
}

function toHalfWidth(text: string): string {
  return text
    .replace(/[！-～]/g, (c) => {
      const code = c.charCodeAt(0) - FULL_OFFSET
      return code >= HALF_START && code <= HALF_END ? String.fromCharCode(code) : c
    })
    .replace(/　/g, ' ')
}

// 半角カタカナ→全角カタカナ。濁点・半濁点は次の文字と組み合わせて1文字になるため、
// 2文字の並びを先に置き換えてから1文字ずつ変換する
const KANA_PAIRS: Record<string, string> = {
  'ｶﾞ': 'ガ', 'ｷﾞ': 'ギ', 'ｸﾞ': 'グ', 'ｹﾞ': 'ゲ', 'ｺﾞ': 'ゴ',
  'ｻﾞ': 'ザ', 'ｼﾞ': 'ジ', 'ｽﾞ': 'ズ', 'ｾﾞ': 'ゼ', 'ｿﾞ': 'ゾ',
  'ﾀﾞ': 'ダ', 'ﾁﾞ': 'ヂ', 'ﾂﾞ': 'ヅ', 'ﾃﾞ': 'デ', 'ﾄﾞ': 'ド',
  'ﾊﾞ': 'バ', 'ﾋﾞ': 'ビ', 'ﾌﾞ': 'ブ', 'ﾍﾞ': 'ベ', 'ﾎﾞ': 'ボ',
  'ﾊﾟ': 'パ', 'ﾋﾟ': 'ピ', 'ﾌﾟ': 'プ', 'ﾍﾟ': 'ペ', 'ﾎﾟ': 'ポ',
  'ｳﾞ': 'ヴ'
}
const KANA_SINGLES: Record<string, string> = {
  'ｱ': 'ア', 'ｲ': 'イ', 'ｳ': 'ウ', 'ｴ': 'エ', 'ｵ': 'オ',
  'ｶ': 'カ', 'ｷ': 'キ', 'ｸ': 'ク', 'ｹ': 'ケ', 'ｺ': 'コ',
  'ｻ': 'サ', 'ｼ': 'シ', 'ｽ': 'ス', 'ｾ': 'セ', 'ｿ': 'ソ',
  'ﾀ': 'タ', 'ﾁ': 'チ', 'ﾂ': 'ツ', 'ﾃ': 'テ', 'ﾄ': 'ト',
  'ﾅ': 'ナ', 'ﾆ': 'ニ', 'ﾇ': 'ヌ', 'ﾈ': 'ネ', 'ﾉ': 'ノ',
  'ﾊ': 'ハ', 'ﾋ': 'ヒ', 'ﾌ': 'フ', 'ﾍ': 'ヘ', 'ﾎ': 'ホ',
  'ﾏ': 'マ', 'ﾐ': 'ミ', 'ﾑ': 'ム', 'ﾒ': 'メ', 'ﾓ': 'モ',
  'ﾔ': 'ヤ', 'ﾕ': 'ユ', 'ﾖ': 'ヨ',
  'ﾗ': 'ラ', 'ﾘ': 'リ', 'ﾙ': 'ル', 'ﾚ': 'レ', 'ﾛ': 'ロ',
  'ﾜ': 'ワ', 'ｦ': 'ヲ', 'ﾝ': 'ン',
  'ｧ': 'ァ', 'ｨ': 'ィ', 'ｩ': 'ゥ', 'ｪ': 'ェ', 'ｫ': 'ォ',
  'ｬ': 'ャ', 'ｭ': 'ュ', 'ｮ': 'ョ', 'ｯ': 'ッ',
  'ｰ': 'ー', '｡': '。', '｢': '「', '｣': '」', '､': '、', '･': '・',
  'ﾞ': '゛', 'ﾟ': '゜'
}

function kanaToFullWidth(text: string): string {
  let result = text
  for (const [from, to] of Object.entries(KANA_PAIRS)) result = result.split(from).join(to)
  for (const [from, to] of Object.entries(KANA_SINGLES)) result = result.split(from).join(to)
  return result
}

/** 行頭の空白(タブ・半角スペース)の並び */
const INDENT = /^[\t ]*/

export const NOTE_TEXT_TRANSFORMS: NoteTextTransform[] = [
  { id: 'upper', label: '大文字にする', apply: (t) => t.toUpperCase() },
  { id: 'lower', label: '小文字にする', apply: (t) => t.toLowerCase() },
  { id: 'to-full', label: '半角を全角にする', apply: toFullWidth },
  { id: 'to-half', label: '全角を半角にする', apply: toHalfWidth },
  { id: 'kana-full', label: '半角カタカナを全角にする', apply: kanaToFullWidth },
  { id: 'trim', label: '各行の前後の空白を削除', apply: (t) => mapLines(t, (l) => l.trim()) },
  { id: 'trim-end', label: '各行の行末の空白を削除', apply: (t) => mapLines(t, (l) => l.replace(/[\t ]+$/, '')) },
  {
    id: 'squeeze-blank',
    label: '連続する空行を1行にまとめる',
    apply: (t) => t.replace(/(?:\n[\t ]*){3,}/g, '\n\n')
  },
  {
    id: 'remove-blank',
    label: '空行を削除',
    apply: (t) =>
      t
        .split('\n')
        .filter((l) => l.trim() !== '')
        .join('\n')
  },
  {
    id: 'unique',
    label: '重複する行を削除',
    apply: (t) => {
      const seen = new Set<string>()
      return t
        .split('\n')
        .filter((l) => {
          if (seen.has(l)) return false
          seen.add(l)
          return true
        })
        .join('\n')
    }
  },
  {
    id: 'sort-asc',
    label: '行を昇順に並べ替え',
    apply: (t) => t.split('\n').sort((a, b) => a.localeCompare(b, 'ja')).join('\n')
  },
  {
    id: 'sort-desc',
    label: '行を降順に並べ替え',
    apply: (t) => t.split('\n').sort((a, b) => b.localeCompare(a, 'ja')).join('\n')
  },
  { id: 'reverse', label: '行の並びを逆にする', apply: (t) => t.split('\n').reverse().join('\n') },
  {
    id: 'number',
    label: '行番号を付ける',
    apply: (t) => {
      const lines = t.split('\n')
      const width = String(lines.length).length
      return lines.map((l, i) => `${String(i + 1).padStart(width, ' ')}: ${l}`).join('\n')
    }
  },
  { id: 'indent', label: 'インデントを深くする', apply: (t) => mapLines(t, (l) => `\t${l}`) },
  {
    id: 'outdent',
    label: 'インデントを浅くする',
    apply: (t) => mapLines(t, (l) => l.replace(/^(?:\t| {1,4})/, ''))
  },
  {
    id: 'tab-to-space',
    label: 'タブを空白4つにする',
    apply: (t) => t.split('\t').join('    ')
  },
  {
    id: 'space-to-tab',
    label: '行頭の空白4つをタブにする',
    apply: (t) => mapLines(t, (l) => l.replace(INDENT, (m) => m.split('    ').join('\t')))
  }
]
