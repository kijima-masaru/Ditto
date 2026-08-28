/**
 * メモの本文をMarkdownとして表示するための、小さな変換器。
 *
 * 業務メモで実際に書く記法(見出し・箇条書き・番号付き・表・コード・引用・
 * 強調・リンク)だけを扱う。外部ライブラリを足さないのは、rendererのバンドルが
 * そのまま起動時間に効くため(構想の「エディタは別ウィンドウで遅延読み込み」と同じ理由)。
 *
 * 入力は必ず先にHTMLとしてエスケープし、そのうえで記法だけをタグへ置き換える。
 * メモの中身がそのままHTMLとして解釈されることはない。
 */

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** リンクとして許すのは http/https/mailto だけ(javascript: 等を弾く) */
function safeUrl(url: string): string | null {
  const trimmed = url.trim()
  return /^(https?:\/\/|mailto:)/i.test(trimmed) ? trimmed : null
}

/** コード片を退避する時の目印。本文には現れない制御文字を使う */
const CODE_MARK = '\u0000'

/** 行の中の記法(強調・コード・リンク)を置き換える。渡すのはエスケープ済みの文字列 */
function inline(text: string): string {
  let result = text
  // コードは中身を装飾しないので先に取り出し、目印に置き換えてから最後に戻す
  const codes: string[] = []
  result = result.replace(/`([^`]+)`/g, (_all, code: string) => {
    codes.push(code)
    return `${CODE_MARK}${codes.length - 1}${CODE_MARK}`
  })
  result = result.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (all, label: string, url: string) => {
    const href = safeUrl(url)
    return href ? `<a href="${href}" target="_blank" rel="noreferrer">${label}</a>` : all
  })
  result = result.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  result = result.replace(/~~([^~]+)~~/g, '<del>$1</del>')
  result = result.replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>')
  result = result.replace(/(^|\s)_([^_\s][^_]*)_/g, '$1<em>$2</em>')
  return result.replace(new RegExp(`${CODE_MARK}(\\d+)${CODE_MARK}`, 'g'), (_all, index: string) => {
    return `<code>${codes[Number(index)]}</code>`
  })
}

const HEADING = /^(#{1,6})\s+(.*)$/
const UNORDERED = /^(\s*)[-*+]\s+(.*)$/
const ORDERED = /^(\s*)\d+[.)]\s+(.*)$/
const QUOTE = /^>\s?(.*)$/
const RULE = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/
const FENCE = /^\s*```/
const TABLE_DIVIDER = /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)+\|?\s*$/

function tableCells(line: string): string[] {
  return line
    .replace(/^\s*\|/, '')
    .replace(/\|\s*$/, '')
    .split('|')
    .map((cell) => cell.trim())
}

/** MarkdownをHTMLへ変換する。対応していない記法はそのままの文字として表示する */
export function markdownToHtml(source: string): string {
  const lines = source.split(/\r\n|\r|\n/)
  const out: string[] = []
  // 開いている箇条書きの入れ子(深い順に積む)
  const listStack: { tag: 'ul' | 'ol'; indent: number }[] = []

  const closeLists = (toIndent = -1): void => {
    while (listStack.length > 0 && listStack[listStack.length - 1].indent > toIndent) {
      out.push(`</${listStack.pop()?.tag}>`)
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    if (FENCE.test(line)) {
      closeLists()
      const body: string[] = []
      i++
      while (i < lines.length && !FENCE.test(lines[i])) {
        body.push(lines[i])
        i++
      }
      out.push(`<pre><code>${escapeHtml(body.join('\n'))}</code></pre>`)
      continue
    }

    if (line.trim() === '') {
      closeLists()
      continue
    }

    if (RULE.test(line)) {
      closeLists()
      out.push('<hr>')
      continue
    }

    // 表は「見出し行 + 区切り行」が並んでいる時だけ表として扱う
    if (i + 1 < lines.length && line.includes('|') && TABLE_DIVIDER.test(lines[i + 1])) {
      closeLists()
      const head = tableCells(line).map((c) => `<th>${inline(escapeHtml(c))}</th>`)
      const rows: string[] = []
      i += 2
      while (i < lines.length && lines[i].includes('|') && lines[i].trim() !== '') {
        const cells = tableCells(lines[i]).map((c) => `<td>${inline(escapeHtml(c))}</td>`)
        rows.push(`<tr>${cells.join('')}</tr>`)
        i++
      }
      i--
      out.push(`<table><thead><tr>${head.join('')}</tr></thead><tbody>${rows.join('')}</tbody></table>`)
      continue
    }

    const heading = HEADING.exec(line)
    if (heading) {
      closeLists()
      const level = heading[1].length
      out.push(`<h${level}>${inline(escapeHtml(heading[2]))}</h${level}>`)
      continue
    }

    const quote = QUOTE.exec(line)
    if (quote) {
      closeLists()
      out.push(`<blockquote>${inline(escapeHtml(quote[1]))}</blockquote>`)
      continue
    }

    const unordered = UNORDERED.exec(line)
    const ordered = unordered ? null : ORDERED.exec(line)
    const item = unordered ?? ordered
    if (item) {
      const indent = item[1].length
      const tag: 'ul' | 'ol' = unordered ? 'ul' : 'ol'
      closeLists(indent)
      const top = listStack[listStack.length - 1]
      if (!top || top.indent < indent) {
        listStack.push({ tag, indent })
        out.push(`<${tag}>`)
      } else if (top.tag !== tag) {
        out.push(`</${listStack.pop()?.tag}>`)
        listStack.push({ tag, indent })
        out.push(`<${tag}>`)
      }
      out.push(`<li>${inline(escapeHtml(item[2]))}</li>`)
      continue
    }

    closeLists()
    out.push(`<p>${inline(escapeHtml(line))}</p>`)
  }
  closeLists()
  return out.join('')
}
