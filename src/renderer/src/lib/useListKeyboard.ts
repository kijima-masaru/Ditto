/**
 * 一覧をキーボードだけで操作するための共通の仕組み。
 *
 * このアプリの一覧(クリップの履歴・定型文・整形ルール、マクロ、メモ)は
 * すべて「クリックで実行、右クリックでそれ以外の操作すべて」という同じ作法で作られている。
 * ところが項目は素の<li onClick>で、tabindexもroleも無かったため、Tabキーは一覧を素通りし、
 * 項目にフォーカスできない以上その右クリックメニューもキーボードからは開けなかった
 * (=履歴から貼るという主目的がマウス必須だった)。
 *
 * ここでは一覧全体でTabの止まり場を1つに保つ「roving tabindex」を使う。
 * 一覧の中の移動は↑↓が担当するため、項目が100件あってもTabを100回押すことにはならない。
 *
 * 割り当て:
 *   ↑ ↓          項目間の移動(端で止まる。行き過ぎて別の場所へ飛ばない)
 *   Home / End    先頭 / 末尾へ
 *   Enter / Space クリックと同じ(履歴・定型文なら貼り付け、マクロ・メモなら開く)
 *   Delete        削除。確認ダイアログのある一覧ではそれを開く
 *   Shift+F10     右クリックメニューを開く(Windowsのメニューキーも同じ)
 */
import { useCallback, useEffect, useRef, useState } from 'react'

interface Identified {
  id: string
}

interface Options<T extends Identified> {
  items: T[]
  /** Enter・Space・クリックで起きること */
  onActivate: (item: T) => void
  /** Shift+F10・メニューキーで開く右クリックメニュー */
  onContextMenu: (item: T) => void
  /** Deleteキー。確認ダイアログを開く実装を渡す(未指定ならDeleteは無効) */
  onDelete?: (item: T) => void
  /**
   * 編集フォームを開いている等、一覧としての操作を止めたい間はtrueにする。
   * roleとtabindexごと外すので、フォームの中の入力欄が素直にTabで辿れる
   */
  disabled?: boolean
}

interface ItemProps {
  role: 'option' | undefined
  tabIndex: number | undefined
  'aria-selected': boolean | undefined
  ref: (el: HTMLElement | null) => void
  onFocus: () => void
  onKeyDown: (e: React.KeyboardEvent) => void
}

interface ListKeyboard<T extends Identified> {
  /** <ul>へ渡す */
  listProps: { role: 'listbox' | undefined; 'aria-label': string | undefined }
  /** 各項目へ渡す */
  getItemProps: (item: T) => ItemProps
  /** 今キーボードで選んでいる項目のid(見た目を変えたい場合に使う) */
  activeId: string | null
}

export function useListKeyboard<T extends Identified>(label: string, options: Options<T>): ListKeyboard<T> {
  const { items, onActivate, onContextMenu, onDelete, disabled = false } = options
  const [activeId, setActiveId] = useState<string | null>(null)
  const nodes = useRef(new Map<string, HTMLElement>())

  // 消えた項目をフォーカスの行き先として覚え続けないようにする
  // (削除・検索での絞り込みの後、Tabの止まり場が消えてしまうのを防ぐ)
  useEffect(() => {
    if (activeId && !items.some((i) => i.id === activeId)) setActiveId(null)
  }, [items, activeId])

  // 実際にTabで止まる項目。まだ選んでいなければ先頭にする
  const focusableId = activeId && items.some((i) => i.id === activeId) ? activeId : (items[0]?.id ?? null)

  const moveTo = useCallback((id: string | undefined): void => {
    if (!id) return
    setActiveId(id)
    nodes.current.get(id)?.focus()
  }, [])

  const getItemProps = useCallback(
    (item: T): ItemProps => ({
      role: disabled ? undefined : 'option',
      tabIndex: disabled ? undefined : item.id === focusableId ? 0 : -1,
      'aria-selected': disabled ? undefined : item.id === focusableId,
      ref: (el: HTMLElement | null) => {
        if (el) nodes.current.set(item.id, el)
        else nodes.current.delete(item.id)
      },
      onFocus: () => setActiveId(item.id),
      onKeyDown: (e: React.KeyboardEvent) => {
        if (disabled) return
        // 項目の中に入力欄やボタンがある場合、そちらの操作を奪わない
        const target = e.target as HTMLElement
        if (target !== e.currentTarget && /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(target.tagName)) return

        const index = items.findIndex((i) => i.id === item.id)
        if (index < 0) return

        switch (e.key) {
          case 'ArrowDown':
            e.preventDefault()
            moveTo(items[Math.min(index + 1, items.length - 1)]?.id)
            return
          case 'ArrowUp':
            e.preventDefault()
            moveTo(items[Math.max(index - 1, 0)]?.id)
            return
          case 'Home':
            e.preventDefault()
            moveTo(items[0]?.id)
            return
          case 'End':
            e.preventDefault()
            moveTo(items[items.length - 1]?.id)
            return
          case 'Enter':
          case ' ':
            e.preventDefault()
            onActivate(item)
            return
          case 'Delete':
            if (!onDelete) return
            e.preventDefault()
            onDelete(item)
            return
          // Windowsのメニューキー。Shift+F10も同じ扱いにする
          case 'ContextMenu':
            e.preventDefault()
            onContextMenu(item)
            return
          case 'F10':
            if (!e.shiftKey) return
            e.preventDefault()
            onContextMenu(item)
            return
          default:
        }
      }
    }),
    [items, focusableId, disabled, moveTo, onActivate, onContextMenu, onDelete]
  )

  return {
    listProps: { role: disabled ? undefined : 'listbox', 'aria-label': disabled ? undefined : label },
    getItemProps,
    activeId: focusableId
  }
}
