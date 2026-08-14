import log from './logger'
import type { ClipboardFormatRule } from '../shared/types'

/**
 * enabledな整形・置換ルールを登録順に全て適用したテキストを返す。
 * 不正な正規表現など、個別のルール適用に失敗した場合はそのルールだけスキップし、
 * 他のルールの適用や後続の履歴保存処理自体は止めない。
 */
export function applyFormatRules(text: string, rules: ClipboardFormatRule[]): string {
  let result = text
  for (const rule of rules) {
    try {
      if (rule.isRegex) {
        if (!rule.find) continue
        result = result.replace(new RegExp(rule.find, 'g'), rule.replace)
      } else {
        if (!rule.find) continue
        result = result.split(rule.find).join(rule.replace)
      }
    } catch (err) {
      log.warn('clipboardFormat: invalid rule skipped', rule.id, err)
    }
  }
  return result
}
