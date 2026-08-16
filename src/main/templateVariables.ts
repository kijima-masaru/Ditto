import { clipboard } from 'electron'
import * as clipboardStore from './clipboardStore'

/**
 * 定型文の本文に埋め込める動的変数の解決。
 *
 * 対応する記法(いずれも{{ }}で囲む):
 *   {{date}}            現在日時を YYYY-MM-DD で挿入
 *   {{date:フォーマット}} YYYY/MM/DD/HH/mm/ssトークンを使った任意フォーマットで挿入
 *   {{seq}}             この定型文が使われた回数(1始まり)を3桁ゼロ埋めで挿入
 *   {{seq:桁数}}         ゼロ埋めの桁数を指定(例: {{seq:4}} → 0001)
 *   {{clipboard}}       この定型文を使う直前にクリップボードに入っていた内容を挿入
 *
 * 使用箇所(クリップボードへのコピー・トリガー展開・コマンドパレットからの入力・
 * マクロの定型文ステップ)すべてでこのモジュールを経由することで、解決ロジックを一本化する。
 */

const VARIABLE_PATTERN = /\{\{\s*(date|seq|clipboard)(?::([^}]*))?\s*\}\}/g

const DATE_TOKEN_PATTERN = /YYYY|MM|DD|HH|mm|ss/g

function formatDate(date: Date, format: string): string {
  const pad = (n: number): string => String(n).padStart(2, '0')
  const tokens: Record<string, string> = {
    YYYY: String(date.getFullYear()),
    MM: pad(date.getMonth() + 1),
    DD: pad(date.getDate()),
    HH: pad(date.getHours()),
    mm: pad(date.getMinutes()),
    ss: pad(date.getSeconds())
  }
  return format.replace(DATE_TOKEN_PATTERN, (token) => tokens[token])
}

function formatSeq(seq: number, widthArg: string | undefined): string {
  const width = Number(widthArg)
  const padWidth = Number.isInteger(width) && width > 0 ? width : 3
  return String(seq).padStart(padWidth, '0')
}

/** 本文中の{{...}}変数をすべて解決済みの文字列に置き換える(純粋な文字列処理) */
export function substituteVariables(text: string, clipboardBefore: string, seq: number): string {
  return text.replace(VARIABLE_PATTERN, (match, kind: string, arg: string | undefined) => {
    switch (kind) {
      case 'date':
        return formatDate(new Date(), arg && arg.length > 0 ? arg : 'YYYY-MM-DD')
      case 'seq':
        return formatSeq(seq, arg)
      case 'clipboard':
        return clipboardBefore
      default:
        return match
    }
  })
}

/**
 * 定型文idから、動的変数を解決した本文を組み立てる。
 * クリップボードの読み取りは本文を書き換える(コピー/入力する)直前に行う必要があるため、
 * 呼び出し側で先にクリップボードへ書き込んだり対象ウィンドウへの入力を始めたりする前に
 * このモジュールが解決する。{{seq}}用のカウンタもここで実際に1つ進める(=呼ぶたびに
 * 消費されるため、プレビュー目的で気軽に呼び出さないこと)
 */
export async function resolveTemplateText(templateId: string): Promise<string> {
  const template = await clipboardStore.getTemplate(templateId)
  if (!template) throw new Error('定型文が見つかりません')
  const clipboardBefore = clipboard.readText()
  const seq = await clipboardStore.incrementAndGetSeq(templateId)
  return substituteVariables(template.text, clipboardBefore, seq)
}
