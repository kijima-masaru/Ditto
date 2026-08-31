import type { NoteSearchOptions } from '../lib/noteSearch'
import { CloseIcon } from './icons'

/**
 * メモの検索・置換バー。判断や実際の書き換えはメモの編集画面(NoteEditorWindowRoot)側が持ち、
 * ここは入力欄とボタンの並びだけを担当する
 */

interface Props {
  query: string
  replacement: string
  options: NoteSearchOptions
  /** 選択範囲の中だけを対象にする */
  inSelection: boolean
  /** 選択範囲が無く「選択範囲内」を選べない状態か */
  selectionEmpty: boolean
  /** 一致件数。検索語が空ならnull */
  matchCount: number | null
  /** いま何件目にいるか(0始まり)。未確定なら-1 */
  matchIndex: number
  /** 正規表現が壊れている */
  invalidRegex: boolean
  onQueryChange: (value: string) => void
  onReplacementChange: (value: string) => void
  onOptionsChange: (options: NoteSearchOptions) => void
  onInSelectionChange: (value: boolean) => void
  onFind: (backward: boolean) => void
  onReplace: () => void
  onReplaceAll: () => void
  onClose: () => void
}

export default function NoteEditorFindBar(props: Props): React.JSX.Element {
  const {
    query,
    replacement,
    options,
    inSelection,
    selectionEmpty,
    matchCount,
    matchIndex,
    invalidRegex,
    onQueryChange,
    onReplacementChange,
    onOptionsChange,
    onInSelectionChange,
    onFind,
    onReplace,
    onReplaceAll,
    onClose
  } = props

  const status = invalidRegex
    ? '正規表現が正しくありません'
    : matchCount === null
      ? ''
      : matchCount === 0
        ? '見つかりません'
        : `${matchIndex >= 0 ? matchIndex + 1 : 1} / ${matchCount}件`

  return (
    <div className="note-find-bar">
      <div className="note-find-row">
        <input
          className="note-find-input"
          value={query}
          autoFocus
          placeholder="検索する文字列"
          aria-label="検索する文字列"
          onChange={(e) => onQueryChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              onFind(e.shiftKey)
            } else if (e.key === 'Escape') {
              e.preventDefault()
              onClose()
            }
          }}
        />
        <button type="button" onClick={() => onFind(true)} title="前を検索">
          前へ
        </button>
        <button type="button" onClick={() => onFind(false)} title="次を検索(Enter)">
          次へ
        </button>
        <span className={`note-find-status${invalidRegex || matchCount === 0 ? ' note-find-status--none' : ''}`}>
          {status}
        </span>
        <button type="button" className="note-find-close" onClick={onClose} title="閉じる(Esc)" aria-label="検索を閉じる">
          <CloseIcon />
        </button>
      </div>

      <div className="note-find-row">
        <input
          className="note-find-input"
          value={replacement}
          placeholder="置換後の文字列"
          aria-label="置換後の文字列"
          onChange={(e) => onReplacementChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault()
              onClose()
            }
          }}
        />
        <button type="button" onClick={onReplace}>
          置換
        </button>
        <button type="button" onClick={onReplaceAll}>
          すべて置換
        </button>
      </div>

      <div className="note-find-row note-find-options">
        <label>
          <input
            type="checkbox"
            checked={options.caseSensitive}
            onChange={(e) => onOptionsChange({ ...options, caseSensitive: e.target.checked })}
          />
          大文字・小文字を区別
        </label>
        <label>
          <input
            type="checkbox"
            checked={options.regex}
            onChange={(e) => onOptionsChange({ ...options, regex: e.target.checked })}
          />
          正規表現
        </label>
        <label className={selectionEmpty ? 'note-find-option--disabled' : ''}>
          <input
            type="checkbox"
            checked={inSelection && !selectionEmpty}
            disabled={selectionEmpty}
            onChange={(e) => onInSelectionChange(e.target.checked)}
          />
          選択範囲内だけ
        </label>
      </div>
    </div>
  )
}
