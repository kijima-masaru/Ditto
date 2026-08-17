import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ClipboardHistoryEntry, ClipboardTemplate, MacroCase } from '../../../shared/types'
import { useDragReorder, type DragReorderHandlers } from '../hooks/useDragReorder'

/**
 * コマンドパレット専用の別ウィンドウのルート。メインウィンドウと同じrenderer bundleを
 * `?commandPalette=1`付きで読み込むことで実現している(commandPalette.ts参照)。
 * 固定ホットキー(Ctrl+Shift+Space)でどのアプリからでも呼び出せる小さな検索窓で、
 * クリップボード履歴・定型文・マクロを横断的にあいまい検索できる。
 *
 * 検索対象データは既存のlistClipboardHistory等をこのウィンドウから直接呼び出して取得し、
 * 絞り込みもここ(renderer側)で行う。選択した履歴/定型文は元のウィンドウへ直接入力され、
 * マクロを選んだ場合はメインウィンドウの再生画面(実行はボタンを押すまで開始しない)を開く。
 */

type PaletteResult =
  | { kind: 'history'; id: string; primary: string; secondary?: undefined; insertText: string; dragHandlers?: undefined }
  | { kind: 'template'; id: string; primary: string; secondary?: string; insertText: string; dragHandlers?: DragReorderHandlers }
  | { kind: 'macro'; id: string; primary: string; secondary?: undefined; insertText?: undefined; dragHandlers?: DragReorderHandlers }

/** pinnedOrder昇順(未設定は末尾)にソートする。未検索時にコマンドパレットへ
 *  固定表示する定型文・マクロは、フォルダをまたいでドラッグ&ドロップで並び替えられる */
function sortByPinnedOrder<T extends { pinnedOrder?: number }>(items: T[]): T[] {
  return [...items].sort((a, b) => (a.pinnedOrder ?? Infinity) - (b.pinnedOrder ?? Infinity))
}

const DEFAULT_MAX_PER_SECTION = 6

function truncate(text: string, max = 60): string {
  const oneLine = text.replace(/\s+/g, ' ').trim()
  return oneLine.length > max ? `${oneLine.slice(0, max)}…` : oneLine
}

function matches(query: string, ...fields: (string | undefined)[]): boolean {
  if (!query) return true
  const q = query.toLowerCase()
  return fields.some((f) => f && f.toLowerCase().includes(q))
}

const KIND_LABEL: Record<PaletteResult['kind'], string> = {
  history: '履歴',
  template: '定型文',
  macro: 'マクロ'
}

export default function CommandPaletteRoot(): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [history, setHistory] = useState<ClipboardHistoryEntry[]>([])
  const [templates, setTemplates] = useState<ClipboardTemplate[]>([])
  const [macros, setMacros] = useState<MacroCase[]>([])
  const [maxPerSection, setMaxPerSection] = useState(DEFAULT_MAX_PER_SECTION)
  const inputRef = useRef<HTMLInputElement>(null)

  const reload = useCallback(() => {
    Promise.all([
      window.api.listClipboardHistory(),
      window.api.listClipboardTemplates(),
      window.api.listMacros(),
      window.api.getSettings()
    ]).then(([h, t, m, s]) => {
      setHistory(h)
      setTemplates(t)
      setMacros(m)
      setMaxPerSection(s.commandPaletteMaxPerSection)
      // メインウィンドウとは別のBrowserWindowなのでdata-theme属性を独自に引き継ぐ必要がある
      document.documentElement.setAttribute('data-theme', s.theme)
    })
  }, [])

  useEffect(() => {
    reload()
  }, [reload])

  useEffect(() => {
    return window.api.onCommandPaletteShown(() => {
      setQuery('')
      setSelectedIndex(0)
      reload()
      // ホットキー(例: Ctrl+Shift+Space)を押した物理的なキーアップは、この直後に
      // OSから届く。即座に検索欄へフォーカスしてしまうと、そのキーアップの対象が
      // 押されたキー自体(Spaceなど)を検索欄に入力してしまうため、キーアップが
      // 届き終わるであろう時間だけフォーカスを遅らせる
      window.setTimeout(() => inputRef.current?.focus(), 150)
    })
  }, [reload])

  // 未入力時は自分でコマンドパレットに固定指定した定型文・マクロのみを表示する
  // (履歴は「固定指定」という概念がないため未入力時は常に表示しない)。
  // 何か入力した場合のみ、Ditto内の履歴・定型文・マクロすべてを検索対象にする
  const isSearching = query.trim().length > 0

  // 固定指定した定型文・マクロは、フォルダをまたいでドラッグ&ドロップで
  // 並び替えられる(pinnedOrderで管理。フォルダ内並び順のorderとは別)
  const pinnedTemplates = useMemo(() => sortByPinnedOrder(templates.filter((t) => t.pinned)), [templates])
  const pinnedMacros = useMemo(() => sortByPinnedOrder(macros.filter((m) => m.pinned)), [macros])

  const handleReorderPinnedTemplates = useCallback((orderedIds: string[]): void => {
    void window.api.reorderPinnedClipboardTemplates(orderedIds).then(reload)
  }, [reload])
  const handleReorderPinnedMacros = useCallback((orderedIds: string[]): void => {
    void window.api.reorderPinnedMacros(orderedIds).then(reload)
  }, [reload])

  const templateDrag = useDragReorder(pinnedTemplates, (t) => t.id, handleReorderPinnedTemplates)
  const macroDrag = useDragReorder(pinnedMacros, (m) => m.id, handleReorderPinnedMacros)

  const results = useMemo<PaletteResult[]>(() => {
    const historyResults: PaletteResult[] = isSearching
      ? history
          .filter((h) => h.type === 'text' && matches(query, h.text))
          .slice(0, maxPerSection)
          .map((h) => ({ kind: 'history', id: h.id, primary: truncate(h.text), insertText: h.text }))
      : []

    const templateResults: PaletteResult[] = isSearching
      ? templates
          .filter((t) => matches(query, t.label, t.text, t.trigger))
          .slice(0, maxPerSection)
          .map((t) => ({
            kind: 'template',
            id: t.id,
            primary: t.label || truncate(t.text),
            secondary: t.label ? truncate(t.text) : t.trigger,
            insertText: t.text
          }))
      : templateDrag.orderedItems.slice(0, maxPerSection).map((t) => ({
          kind: 'template',
          id: t.id,
          primary: t.label || truncate(t.text),
          secondary: t.label ? truncate(t.text) : t.trigger,
          insertText: t.text,
          dragHandlers: templateDrag.getHandlers(t)
        }))

    const macroResults: PaletteResult[] = isSearching
      ? macros
          .filter((m) => matches(query, m.name))
          .slice(0, maxPerSection)
          .map((m) => ({ kind: 'macro', id: m.id, primary: m.name }))
      : macroDrag.orderedItems.slice(0, maxPerSection).map((m) => ({
          kind: 'macro',
          id: m.id,
          primary: m.name,
          dragHandlers: macroDrag.getHandlers(m)
        }))

    return [...historyResults, ...templateResults, ...macroResults]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSearching, query, history, templates, macros, templateDrag.orderedItems, macroDrag.orderedItems, maxPerSection])

  useEffect(() => {
    setSelectedIndex((i) => Math.min(i, Math.max(results.length - 1, 0)))
  }, [results.length])

  const activate = useCallback((result: PaletteResult): void => {
    if (result.kind === 'macro') {
      void window.api.openMacroViaCommandPalette(result.id)
    } else if (result.kind === 'template') {
      // 定型文は{{date}}/{{seq}}/{{clipboard}}等の動的変数をmain側でその場で
      // 解決してから入力する必要があるため、生テキストではなくidを渡す
      void window.api.insertTemplateViaCommandPalette(result.id)
    } else {
      void window.api.insertViaCommandPalette(result.insertText)
    }
  }, [])

  const handleKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.preventDefault()
      window.api.hideCommandPalette()
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIndex((i) => Math.min(i + 1, results.length - 1))
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIndex((i) => Math.max(i - 1, 0))
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      const selected = results[selectedIndex]
      if (selected) activate(selected)
    }
  }

  let flatIndex = -1
  const renderSection = (kind: PaletteResult['kind']): React.JSX.Element | null => {
    const items = results.filter((r) => r.kind === kind)
    if (items.length === 0) return null
    return (
      <div className="command-palette-section" key={kind}>
        <div className="command-palette-section-title">{KIND_LABEL[kind]}</div>
        {items.map((r) => {
          flatIndex += 1
          const idx = flatIndex
          const drag = r.dragHandlers
          return (
            <div
              key={`${r.kind}-${r.id}`}
              className={`command-palette-item${idx === selectedIndex ? ' command-palette-item--active' : ''}${drag ? ` ${drag.className}` : ''}`}
              onMouseEnter={() => setSelectedIndex(idx)}
              onClick={() => activate(r)}
              {...(drag
                ? {
                    draggable: drag.draggable,
                    onDragStart: drag.onDragStart,
                    onDragEnter: drag.onDragEnter,
                    onDragOver: drag.onDragOver,
                    onDrop: drag.onDrop,
                    onDragEnd: drag.onDragEnd
                  }
                : {})}
            >
              <div className="command-palette-item-primary">{r.primary}</div>
              {r.secondary && <div className="command-palette-item-secondary">{r.secondary}</div>}
            </div>
          )
        })}
      </div>
    )
  }

  return (
    <div className="command-palette" onKeyDown={handleKeyDown}>
      <input
        ref={inputRef}
        className="command-palette-input"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="クリップボード・定型文・マクロを検索..."
      />
      <div className="command-palette-results">
        {results.length === 0 ? (
          <div className="command-palette-empty">
            {isSearching
              ? '一致する項目がありません'
              : 'コマンドパレットに固定した定型文・マクロがありません。\n入力すると履歴・定型文・マクロすべてから検索できます。'}
          </div>
        ) : (
          <>
            {renderSection('history')}
            {renderSection('template')}
            {renderSection('macro')}
          </>
        )}
      </div>
    </div>
  )
}
