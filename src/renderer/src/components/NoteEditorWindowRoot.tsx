import { useCallback, useEffect, useRef, useState } from 'react'
import type { Note, NoteCharStyle, NoteEditorAppearance, NoteVersion } from '../../../shared/types'
import {
  CLEAR_STYLE,
  LINE_CLASS,
  applyPatch,
  extractLines,
  findStyleMarker,
  getSelectionOffsets,
  hasAnyStyle,
  htmlFromPlainText,
  htmlToCanonical,
  insertStyleMarker,
  lineElements,
  locate,
  plainTextOf,
  renderDocument,
  replaceRange,
  setSelectionOffsets,
  styleAt,
  styleOfRange,
  styleRange,
  type NoteCharStylePatch,
  type Run
} from '../lib/noteRichText'
import { NOTE_TEXT_TRANSFORMS } from '../lib/noteTextTransforms'
import { expandReplacement, findMatches, pickMatch, type NoteSearchOptions } from '../lib/noteSearch'
import NoteEditorFindBar from './NoteEditorFindBar'
import NoteEditorVersions from './NoteEditorVersions'
import ConfirmDialog from './ConfirmDialog'

/**
 * メモの編集専用の別ウィンドウのルート。
 * メインウィンドウと同じrenderer bundleを`?noteEditor=1`付きで読み込むことで
 * 実現している(noteEditorWindow.ts参照)。
 *
 * 本文の入力欄はcontenteditableのdivで、1行=1つのdiv、装飾=spanのstyle、という
 * 決まった形だけを扱う(noteRichText.ts参照)。太字・文字色・文字サイズ・文字の背景色は
 * 「選択している文字」に、選択が無ければ「これから入力する文字」に掛かる。
 * textareaでは文字ごとに装飾を持てないため、v1.29.0までのtextareaから置き換えている。
 *
 * 保存はプレーンテキスト(notes/<id>.txt)と装飾付き(notes/<id>.html)の両方へ行う。
 * 装飾を本文ファイルに混ぜないのは、Dittoが壊れてもエクスプローラから本文を
 * 救出できる性質を残すため。
 *
 * 取り消し(Ctrl+Z)は自前で持っている。装飾や検索置換はDOMを組み立て直す形で
 * 適用しており、ブラウザ標準の取り消し履歴には乗らないため。
 *
 * 本文を右クリックすると、選択範囲を定型文として登録できる(メモ=書いて育てる /
 * 定型文=繰り返し入力する、という役割の違いを行き来できるようにするため)。
 *
 * クリップボード履歴から「メモに追記」された場合、対象がこのウィンドウで開いているメモなら
 * main側はファイルを書き換えず、このウィンドウへ追記を依頼してくる(noteEditorWindow.appendIfOpen参照)。
 */

/** 入力が止まってから保存するまでの待ち時間 */
const AUTOSAVE_DELAY_MS = 800
/** 名前の変更を保存するまでの待ち時間 */
const RENAME_DELAY_MS = 600
/** 表示設定の変更を保存するまでの待ち時間 */
const APPEARANCE_SAVE_DELAY_MS = 300
/** 続けて入力している間は取り消し履歴を1つにまとめる時間 */
const UNDO_COALESCE_MS = 700
/** 取り消し履歴の保持数 */
const UNDO_LIMIT = 200

/** 文字サイズとして選べる値 */
const FONT_SIZE_CHOICES = [10, 11, 12, 13, 14, 16, 18, 20, 24, 28, 32, 40, 48]

const DEFAULT_APPEARANCE: NoteEditorAppearance = {
  fontSize: 14,
  lineNumbers: true,
  highlightCurrentLine: true,
  wordWrap: true
}

// 表示対象のメモIDはウィンドウ生成時にクエリ文字列で渡される
// (IPCで受け取ると、mainからの送信がマウントより早い場合に取りこぼすため)
const initialNoteId = new URLSearchParams(window.location.search).get('noteId')

interface Snapshot {
  html: string
  start: number
  end: number
}

interface LineMetric {
  top: number
  height: number
}

export default function NoteEditorWindowRoot(): React.JSX.Element {
  const [noteId, setNoteId] = useState<string | null>(initialNoteId)
  const [note, setNote] = useState<Note | null>(null)
  const [title, setTitle] = useState('')
  const [status, setStatus] = useState<'loading' | 'saved' | 'editing' | 'saving' | 'notfound'>('loading')
  const [appearance, setAppearance] = useState<NoteEditorAppearance>(DEFAULT_APPEARANCE)
  const [viewOpen, setViewOpen] = useState(false)
  const [currentStyle, setCurrentStyle] = useState<NoteCharStyle>({})
  const [counts, setCounts] = useState({ lines: 0, chars: 0 })
  const [lineMetrics, setLineMetrics] = useState<LineMetric[]>([])
  const [scrollTop, setScrollTop] = useState(0)
  const [toast, setToast] = useState<string | null>(null)

  const editorRef = useRef<HTMLDivElement>(null)
  const noteIdRef = useRef<string | null>(null)
  const dirtyRef = useRef(false)
  const saveTimerRef = useRef<number | null>(null)
  const titleFocusedRef = useRef(false)
  const composingRef = useRef(false)
  const appearanceRef = useRef(appearance)
  appearanceRef.current = appearance
  /** 入力欄の外(ツールバーや色の選択)を触っても、直前の選択範囲へ装飾を掛けられるようにする */
  const selectionRef = useRef<{ start: number; end: number }>({ start: 0, end: 0 })
  const undoRef = useRef<Snapshot[]>([])
  const redoRef = useRef<Snapshot[]>([])
  const lastSnapshotAtRef = useRef(0)

  const showToast = useCallback((message: string): void => {
    setToast(message)
    window.setTimeout(() => setToast(null), 2000)
  }, [])

  /* --- 画面の状態を読み直す --- */

  /** 行番号の位置・現在行の強調・文字数・ツールバーの状態を、今のDOMから作り直す */
  const refresh = useCallback((): void => {
    const editor = editorRef.current
    if (!editor) return
    const lines = extractLines(editor)
    const plain = plainTextOf(lines)
    setCounts({ lines: plain === '' ? 0 : lines.length, chars: plain.length })
    const selection = getSelectionOffsets(editor)
    if (selection) {
      selectionRef.current = selection
      setCurrentStyle(styleOfRange(lines, selection.start, selection.end))
    }
    const elements = lineElements(editor)
    if (appearanceRef.current.lineNumbers) {
      setLineMetrics(elements.map((el) => ({ top: el.offsetTop, height: el.offsetHeight })))
    } else if (lineMetricsLengthRef.current > 0) {
      setLineMetrics([])
    }
    const currentLine =
      appearanceRef.current.highlightCurrentLine && selection ? locate(lines, selection.end).line : -1
    elements.forEach((el, index) => el.classList.toggle('is-current', index === currentLine))
  }, [])

  const lineMetricsLengthRef = useRef(0)
  lineMetricsLengthRef.current = lineMetrics.length

  /** 内容が変わった時の共通処理(自動保存の予約と表示の更新) */
  const markChanged = useCallback((): void => {
    dirtyRef.current = true
    setStatus('editing')
    if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current)
    saveTimerRef.current = window.setTimeout(() => void flushRef.current(), AUTOSAVE_DELAY_MS)
    refresh()
  }, [refresh])

  /* --- 保存 --- */

  const flush = useCallback(async (forceVersion = false): Promise<void> => {
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
    }
    const id = noteIdRef.current
    const editor = editorRef.current
    if (!id || !editor || !dirtyRef.current) return
    const lines = extractLines(editor)
    const plain = plainTextOf(lines)
    // 装飾が1つも無いメモでは装飾ファイルを消す。残したままだと、装飾を全部外したのに
    // 次に開いた時に古い装飾が復活してしまう
    const html = hasAnyStyle(lines) ? renderDocument(lines) : null
    dirtyRef.current = false
    setStatus('saving')
    const updated = await window.api.updateNoteBody(id, plain, html, forceVersion)
    if (!dirtyRef.current) setStatus('saved')
    if (updated) {
      setNote(updated)
      // 名前を自動生成している場合は本文に追従させる(利用者が入力中の欄は書き換えない)
      if (!updated.titleManual && !titleFocusedRef.current) setTitle(updated.title)
    }
  }, [])
  const flushRef = useRef(flush)
  flushRef.current = flush

  /* --- 取り消し・やり直し --- */

  const snapshotNow = useCallback((): Snapshot | null => {
    const editor = editorRef.current
    if (!editor) return null
    const selection = getSelectionOffsets(editor) ?? selectionRef.current
    return { html: editor.innerHTML, start: selection.start, end: selection.end }
  }, [])

  /**
   * 取り消し履歴に今の状態を積む。連続した文字入力までいちいち積むと
   * Ctrl+Zが1文字ずつしか戻らなくなるため、短い間隔の入力はまとめる
   */
  const pushSnapshot = useCallback(
    (force: boolean): void => {
      const now = Date.now()
      if (!force && undoRef.current.length > 0 && now - lastSnapshotAtRef.current < UNDO_COALESCE_MS) {
        lastSnapshotAtRef.current = now
        return
      }
      const snapshot = snapshotNow()
      if (!snapshot) return
      const last = undoRef.current[undoRef.current.length - 1]
      if (last && last.html === snapshot.html) {
        lastSnapshotAtRef.current = now
        return
      }
      undoRef.current.push(snapshot)
      if (undoRef.current.length > UNDO_LIMIT) undoRef.current.shift()
      redoRef.current = []
      lastSnapshotAtRef.current = now
    },
    [snapshotNow]
  )

  const restore = useCallback(
    (snapshot: Snapshot): void => {
      const editor = editorRef.current
      if (!editor) return
      editor.innerHTML = snapshot.html
      editor.focus()
      setSelectionOffsets(editor, snapshot.start, snapshot.end)
      markChanged()
    },
    [markChanged]
  )

  const undo = useCallback((): void => {
    const previous = undoRef.current.pop()
    if (!previous) return
    const current = snapshotNow()
    if (current) redoRef.current.push(current)
    lastSnapshotAtRef.current = 0
    restore(previous)
  }, [restore, snapshotNow])

  const redo = useCallback((): void => {
    const next = redoRef.current.pop()
    if (!next) return
    const current = snapshotNow()
    if (current) undoRef.current.push(current)
    lastSnapshotAtRef.current = 0
    restore(next)
  }, [restore, snapshotNow])

  /* --- 本文の書き換え(装飾・検索置換・整形はすべてここを通る) --- */

  /**
   * 行×Runの形で組み立て直した内容を画面へ反映し、カーソル位置を戻す。
   * DOMを部分的にいじらず必ず全体を作り直すのは、ブラウザが足す入れ子や
   * fontタグで形が崩れるのを避けるため
   */
  const writeDoc = useCallback(
    (lines: Run[][], start: number, end = start): void => {
      const editor = editorRef.current
      if (!editor) return
      editor.innerHTML = renderDocument(lines)
      editor.focus()
      setSelectionOffsets(editor, start, end)
      markChanged()
    },
    [markChanged]
  )

  const insertText = useCallback(
    (text: string): void => {
      const editor = editorRef.current
      if (!editor) return
      const selection = getSelectionOffsets(editor) ?? selectionRef.current
      pushSnapshot(true)
      const lines = extractLines(editor)
      const style = styleAt(lines, selection.start)
      const next = replaceRange(lines, selection.start, selection.end, text, style)
      writeDoc(next, selection.start + text.length)
    },
    [pushSnapshot, writeDoc]
  )

  /**
   * 装飾を掛ける。選択範囲があればその文字へ、無ければ「これから入力する文字」へ。
   * 後者は幅ゼロの文字を装飾付きのspanとして置き、その中へカーソルを入れることで、
   * 続けて打った文字(日本語の変換確定を含む)がその装飾を受け継ぐようにしている
   */
  const applyStyle = useCallback(
    (patch: NoteCharStylePatch, coalesce = false): void => {
      const editor = editorRef.current
      if (!editor) return
      const selection = getSelectionOffsets(editor) ?? selectionRef.current
      pushSnapshot(!coalesce)
      const lines = extractLines(editor)
      if (selection.start === selection.end) {
        const style = applyPatch(styleAt(lines, selection.start), patch)
        editor.innerHTML = renderDocument(insertStyleMarker(lines, selection.start, style))
        editor.focus()
        const marker = findStyleMarker(editor)
        if (marker) {
          const range = document.createRange()
          range.setStart(marker, marker.data.length)
          range.collapse(true)
          const domSelection = window.getSelection()
          domSelection?.removeAllRanges()
          domSelection?.addRange(range)
        } else {
          setSelectionOffsets(editor, selection.start)
        }
        markChanged()
        return
      }
      writeDoc(styleRange(lines, selection.start, selection.end, patch), selection.start, selection.end)
    },
    [markChanged, pushSnapshot, writeDoc]
  )

  /* --- メモの読み込み --- */

  useEffect(() => {
    window.api.getSettings().then((settings) => {
      // メインウィンドウとは別のBrowserWindowなのでdata-theme属性を独自に引き継ぐ必要がある
      document.documentElement.setAttribute('data-theme', settings.theme)
      setAppearance(settings.noteEditorAppearance)
    })
  }, [])

  useEffect(() => {
    let cancelled = false
    const load = async (): Promise<void> => {
      await flushRef.current()
      if (!noteId) {
        setStatus('notfound')
        return
      }
      setStatus('loading')
      const [list, plain, html] = await Promise.all([
        window.api.listNotes(),
        window.api.getNoteBody(noteId),
        window.api.getNoteHtml(noteId)
      ])
      if (cancelled) return
      const found = list.find((n) => n.id === noteId) ?? null
      setNote(found)
      if (!found) {
        setStatus('notfound')
        return
      }
      noteIdRef.current = noteId
      dirtyRef.current = false
      undoRef.current = []
      redoRef.current = []
      const editor = editorRef.current
      if (editor) {
        // 装飾ファイルと本文ファイルが食い違っている場合は本文ファイルを採る。
        // 本文(テキスト)の方を常に正とすることで、装飾側が壊れても文章は失わない
        let content = htmlFromPlainText(plain)
        if (html !== null) {
          const canonical = htmlToCanonical(html)
          const probe = document.createElement('div')
          probe.innerHTML = canonical
          if (plainTextOf(extractLines(probe)) === plain) content = canonical
        }
        editor.innerHTML = content
        editor.scrollTop = 0
        setSelectionOffsets(editor, 0)
      }
      setTitle(found.title)
      setStatus('saved')
      document.title = `${found.title} - メモ`
      refresh()
      // どのメモを開いているかをmainへ伝える(履歴からの追記をこのウィンドウで受けるため)
      void window.api.notifyNoteEditorShowing(noteId)
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [noteId, refresh])

  // 既にこのウィンドウが開いている状態で別のメモを開いた場合の差し替え
  useEffect(() => {
    return window.api.onOpenNoteInEditor((id) => setNoteId(id))
  }, [])

  // ウィンドウを離れた時・閉じる時にも保存する(入力途中の内容を残さない)
  useEffect(() => {
    const onBlur = (): void => void flushRef.current()
    window.addEventListener('blur', onBlur)
    window.addEventListener('beforeunload', onBlur)
    return () => {
      window.removeEventListener('blur', onBlur)
      window.removeEventListener('beforeunload', onBlur)
    }
  }, [])

  // クリップボード履歴から、今開いているメモへの追記が届いた場合。
  // 画面が持っている本文の末尾へ足し、そのまま自動保存の流れに乗せる
  useEffect(() => {
    return window.api.onAppendToOpenNote((text) => {
      const editor = editorRef.current
      if (!editor) return
      pushSnapshot(true)
      const lines = extractLines(editor)
      const plain = plainTextOf(lines)
      const separator = plain.length === 0 || plain.endsWith('\n') ? '' : '\n'
      const at = plain.length
      writeDoc(replaceRange(lines, at, at, `${separator}${text}`, {}), at + separator.length + text.length)
    })
  }, [pushSnapshot, writeDoc])

  // 選択範囲が変わるたびにツールバーの状態と現在行の強調を合わせる
  useEffect(() => {
    const onSelectionChange = (): void => {
      const editor = editorRef.current
      if (!editor) return
      const selection = window.getSelection()
      if (!selection || selection.rangeCount === 0) return
      if (!editor.contains(selection.getRangeAt(0).startContainer)) return
      refresh()
    }
    document.addEventListener('selectionchange', onSelectionChange)
    return () => document.removeEventListener('selectionchange', onSelectionChange)
  }, [refresh])

  useEffect(() => {
    const onResize = (): void => refresh()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [refresh])

  // 表示設定(行番号・現在行・折り返し)を変えた直後は行の位置が変わるので測り直す
  useEffect(() => {
    refresh()
  }, [appearance, refresh])

  /* --- 表示設定 --- */

  const appearanceSaveTimerRef = useRef<number | null>(null)
  const updateAppearance = (patch: Partial<NoteEditorAppearance>): void => {
    setAppearance((previous) => {
      const next = { ...previous, ...patch }
      if (appearanceSaveTimerRef.current !== null) window.clearTimeout(appearanceSaveTimerRef.current)
      appearanceSaveTimerRef.current = window.setTimeout(() => {
        void window.api.setNoteEditorAppearance(next)
      }, APPEARANCE_SAVE_DELAY_MS)
      return next
    })
  }

  /* --- 名前 --- */

  const renameTimerRef = useRef<number | null>(null)
  const handleTitleChange = (value: string): void => {
    setTitle(value)
    const id = noteIdRef.current
    if (!id) return
    if (renameTimerRef.current !== null) window.clearTimeout(renameTimerRef.current)
    renameTimerRef.current = window.setTimeout(() => {
      void window.api.renameNote(id, value).then((updated) => {
        if (updated) setNote(updated)
      })
    }, RENAME_DELAY_MS)
  }

  /* --- 検索・置換 --- */

  const [findOpen, setFindOpen] = useState(false)
  const [findQuery, setFindQuery] = useState('')
  const [replacement, setReplacement] = useState('')
  const [searchOptions, setSearchOptions] = useState<NoteSearchOptions>({ regex: false, caseSensitive: false })
  const [inSelection, setInSelection] = useState(false)
  const [matchInfo, setMatchInfo] = useState<{ count: number | null; index: number; invalid: boolean }>({
    count: null,
    index: -1,
    invalid: false
  })
  // 検索バーへ移った時点で入力欄の選択は外れるため、直前の選択範囲を覚えておく
  const searchScopeRef = useRef<{ start: number; end: number }>({ start: 0, end: 0 })

  const searchScope = useCallback(
    (plainLength: number): { start: number; end: number } => {
      const scope = searchScopeRef.current
      if (inSelection && scope.end > scope.start) return scope
      return { start: 0, end: plainLength }
    },
    [inSelection]
  )

  const updateMatchInfo = useCallback(
    (query: string, options: NoteSearchOptions, caret: number): void => {
      const editor = editorRef.current
      if (!editor) return
      if (query === '') {
        setMatchInfo({ count: null, index: -1, invalid: false })
        return
      }
      const plain = plainTextOf(extractLines(editor))
      const scope = searchScope(plain.length)
      const matches = findMatches(plain, query, options, scope.start, scope.end)
      if (matches.length === 0) {
        const invalid = options.regex && findMatches(plain, query, options).length === 0 && !isValidRegExp(query)
        setMatchInfo({ count: 0, index: -1, invalid })
        return
      }
      const index = matches.findIndex((m) => m.start >= caret)
      setMatchInfo({ count: matches.length, index: index < 0 ? 0 : index, invalid: false })
    },
    [searchScope]
  )

  const runFind = useCallback(
    (backward: boolean): void => {
      const editor = editorRef.current
      if (!editor || findQuery === '') return
      const plain = plainTextOf(extractLines(editor))
      const scope = searchScope(plain.length)
      const matches = findMatches(plain, findQuery, searchOptions, scope.start, scope.end)
      if (matches.length === 0) {
        setMatchInfo({ count: 0, index: -1, invalid: !isValidRegExp(searchOptions.regex ? findQuery : '') })
        return
      }
      const from = backward ? selectionRef.current.start : selectionRef.current.end
      const match = pickMatch(matches, from, backward)
      if (!match) return
      editor.focus()
      setSelectionOffsets(editor, match.start, match.end)
      selectionRef.current = { start: match.start, end: match.end }
      scrollSelectionIntoView()
      setMatchInfo({ count: matches.length, index: matches.indexOf(match), invalid: false })
    },
    [findQuery, searchOptions, searchScope]
  )

  const runReplace = useCallback((): void => {
    const editor = editorRef.current
    if (!editor || findQuery === '') return
    const lines = extractLines(editor)
    const plain = plainTextOf(lines)
    const scope = searchScope(plain.length)
    const matches = findMatches(plain, findQuery, searchOptions, scope.start, scope.end)
    const selection = selectionRef.current
    const current = matches.find((m) => m.start === selection.start && m.end === selection.end)
    if (!current) {
      runFind(false)
      return
    }
    const text = expandReplacement(replacement, current, searchOptions.regex)
    pushSnapshot(true)
    const style = styleAt(lines, current.start)
    writeDoc(replaceRange(lines, current.start, current.end, text, style), current.start + text.length)
    window.setTimeout(() => runFind(false), 0)
  }, [findQuery, pushSnapshot, replacement, runFind, searchOptions, searchScope, writeDoc])

  const runReplaceAll = useCallback((): void => {
    const editor = editorRef.current
    if (!editor || findQuery === '') return
    let lines = extractLines(editor)
    const plain = plainTextOf(lines)
    const scope = searchScope(plain.length)
    const matches = findMatches(plain, findQuery, searchOptions, scope.start, scope.end)
    if (matches.length === 0) {
      showToast('見つかりませんでした')
      return
    }
    pushSnapshot(true)
    // 後ろから置き換える。前から行うと、置換で文字数が変わったぶん
    // 残りの一致位置がずれてしまうため
    for (let i = matches.length - 1; i >= 0; i--) {
      const match = matches[i]
      const text = expandReplacement(replacement, match, searchOptions.regex)
      lines = replaceRange(lines, match.start, match.end, text, styleAt(lines, match.start))
    }
    writeDoc(lines, matches[0].start)
    showToast(`${matches.length}件を置換しました`)
    setMatchInfo({ count: 0, index: -1, invalid: false })
  }, [findQuery, pushSnapshot, replacement, searchOptions, searchScope, showToast, writeDoc])

  const openFind = useCallback((): void => {
    searchScopeRef.current = selectionRef.current
    setInSelection(selectionRef.current.end > selectionRef.current.start)
    setFindOpen(true)
  }, [])

  const closeFind = useCallback((): void => {
    setFindOpen(false)
    setMatchInfo({ count: null, index: -1, invalid: false })
    editorRef.current?.focus()
  }, [])

  useEffect(() => {
    if (!findOpen) return
    updateMatchInfo(findQuery, searchOptions, selectionRef.current.start)
  }, [findOpen, findQuery, searchOptions, inSelection, updateMatchInfo])

  /* --- 整形・変換 --- */

  const runTransform = useCallback(
    (transformId: string): void => {
      const transform = NOTE_TEXT_TRANSFORMS.find((t) => t.id === transformId)
      const editor = editorRef.current
      if (!transform || !editor) return
      const lines = extractLines(editor)
      const plain = plainTextOf(lines)
      const selection = selectionRef.current
      const hasSelection = selection.end > selection.start
      const start = hasSelection ? selection.start : 0
      const end = hasSelection ? selection.end : plain.length
      const source = plain.slice(start, end)
      const result = transform.apply(source)
      if (result === source) {
        showToast('変換するところはありませんでした')
        return
      }
      pushSnapshot(true)
      writeDoc(replaceRange(lines, start, end, result, styleAt(lines, start)), start, start + result.length)
      showToast(`${transform.label}を適用しました`)
    },
    [pushSnapshot, showToast, writeDoc]
  )

  const openTransformMenu = useCallback(async (): Promise<void> => {
    const selection = selectionRef.current
    const scope = selection.end > selection.start ? '選択範囲に適用' : 'メモ全体に適用'
    const chosen = await window.api.showContextMenu([
      // 何に対して掛かるのかをメニューの先頭に出す(選択が無い時はメモ全体が対象になるため)
      { id: 'scope', label: scope, enabled: false },
      { id: 'scope-sep', type: 'separator' },
      ...NOTE_TEXT_TRANSFORMS.map((transform) => ({ id: transform.id, label: transform.label }))
    ])
    if (chosen) runTransform(chosen)
  }, [runTransform])

  /* --- 編集履歴(版) --- */

  const [versionsOpen, setVersionsOpen] = useState(false)
  const [versions, setVersions] = useState<NoteVersion[]>([])
  const [restoreTarget, setRestoreTarget] = useState<NoteVersion | null>(null)

  const openVersions = useCallback(async (): Promise<void> => {
    const id = noteIdRef.current
    if (!id) return
    await flushRef.current()
    setVersions(await window.api.listNoteVersions(id))
    setVersionsOpen(true)
  }, [])

  const restoreVersion = useCallback(
    async (version: NoteVersion): Promise<void> => {
      const id = noteIdRef.current
      const editor = editorRef.current
      if (!id || !editor) return
      const content = await window.api.getNoteVersion(id, version.id)
      if (!content) {
        showToast('この版は見つかりませんでした')
        return
      }
      pushSnapshot(true)
      editor.innerHTML = content.html ? htmlToCanonical(content.html) : htmlFromPlainText(content.plain)
      editor.focus()
      setSelectionOffsets(editor, 0)
      dirtyRef.current = true
      // 戻す直前の内容も版として残す(戻したあとに「やっぱり元に戻す」ができるように)
      await flushRef.current(true)
      setVersions(await window.api.listNoteVersions(id))
      refresh()
      showToast('選んだ内容に戻しました')
    },
    [pushSnapshot, refresh, showToast]
  )

  /* --- 入力欄のイベント --- */

  const handleBeforeInput = (e: React.FormEvent<HTMLDivElement>): void => {
    const inputType = (e.nativeEvent as InputEvent).inputType
    if (inputType === 'historyUndo' || inputType === 'historyRedo') {
      e.preventDefault()
      if (inputType === 'historyUndo') undo()
      else redo()
      return
    }
    const coalesce =
      inputType === 'insertText' ||
      inputType === 'insertCompositionText' ||
      inputType === 'deleteContentBackward' ||
      inputType === 'deleteContentForward'
    pushSnapshot(!coalesce)
  }

  /**
   * ブラウザが作った形が崩れていたら正しい形へ直す。
   * 全選択して消した後や、ブラウザが独自にdivを入れ子にした場合に起きる
   */
  const ensureStructure = (): void => {
    const editor = editorRef.current
    if (!editor) return
    const children = Array.from(editor.childNodes)
    const canonical =
      children.length > 0 &&
      children.every((child) => child.nodeType === Node.ELEMENT_NODE && (child as HTMLElement).tagName === 'DIV') &&
      editor.querySelector('div div,p,ul,ol,li,h1,h2,h3,h4,h5,h6,blockquote,pre,table,img') === null
    if (canonical) {
      for (const child of Array.from(editor.children)) child.classList.add(LINE_CLASS)
      return
    }
    const selection = getSelectionOffsets(editor)
    editor.innerHTML = renderDocument(extractLines(editor))
    if (selection) setSelectionOffsets(editor, selection.start, selection.end)
  }

  const handleInput = (): void => {
    // 日本語の変換中はDOMを触らない(変換候補の表示が壊れるため)。確定後にまとめて直す
    if (!composingRef.current) ensureStructure()
    markChanged()
  }

  const handlePaste = (e: React.ClipboardEvent<HTMLDivElement>): void => {
    e.preventDefault()
    const text = e.clipboardData.getData('text/plain')
    if (text) insertText(text)
  }

  const handleDrop = (e: React.DragEvent<HTMLDivElement>): void => {
    e.preventDefault()
    const text = e.dataTransfer.getData('text/plain')
    if (text) insertText(text)
  }

  /**
   * 本文の右クリックメニュー。書いたメモの一部を、繰り返し使う定型文へ
   * 「昇格」させられるようにしている(メモ=書いて育てる / 定型文=繰り返し入力する)
   */
  const handleContextMenu = async (e: React.MouseEvent): Promise<void> => {
    e.preventDefault()
    const editor = editorRef.current
    if (!editor) return
    const selection = getSelectionOffsets(editor) ?? selectionRef.current
    const plain = plainTextOf(extractLines(editor))
    const selected = plain.slice(selection.start, selection.end)
    const hasSelection = selected.length > 0
    const result = await window.api.showContextMenu([
      { id: 'to-template', label: '選択範囲を定型文として登録', enabled: hasSelection },
      { id: 'copy', label: '選択範囲をコピー', enabled: hasSelection },
      { type: 'separator', id: 'sep' },
      {
        id: 'transform',
        label: hasSelection ? '選択範囲を変換' : 'メモ全体を変換',
        submenu: NOTE_TEXT_TRANSFORMS.map((transform) => ({ id: transform.id, label: transform.label }))
      }
    ])
    if (!result) return
    if (result === 'to-template') {
      if (!hasSelection) return
      try {
        await window.api.createClipboardTemplate(selected)
        showToast('定型文として登録しました')
      } catch (err) {
        showToast(`登録できませんでした: ${(err as Error).message}`)
      }
      return
    }
    if (result === 'copy') {
      if (!hasSelection) return
      await window.api.copyToClipboard(selected)
      showToast('コピーしました')
      return
    }
    runTransform(result)
  }

  const handleKeyDown = (e: React.KeyboardEvent): void => {
    if (!e.ctrlKey || e.altKey) {
      if (e.key === 'Escape' && findOpen) {
        e.preventDefault()
        closeFind()
      }
      return
    }
    const key = e.key.toLowerCase()
    if (key === 's') {
      e.preventDefault()
      dirtyRef.current = true
      void flush(true)
      showToast('保存しました')
    } else if (key === 'z' && !e.shiftKey) {
      e.preventDefault()
      undo()
    } else if (key === 'y' || (key === 'z' && e.shiftKey)) {
      e.preventDefault()
      redo()
    } else if (key === 'b') {
      e.preventDefault()
      applyStyle({ bold: !currentStyle.bold })
    } else if (key === 'f' || key === 'h') {
      e.preventDefault()
      openFind()
    }
  }

  /* --- 描画 --- */

  if (status === 'notfound') {
    return (
      <div className="note-editor-window">
        <div className="note-editor-empty">メモが見つかりませんでした</div>
      </div>
    )
  }

  const statusLabel = status === 'saving' ? '保存中...' : status === 'editing' ? '未保存' : '保存済み'
  const bodyClass = [
    'note-editor-body',
    appearance.wordWrap ? '' : 'note-editor-body--nowrap',
    appearance.highlightCurrentLine ? 'note-editor-body--current-line' : ''
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div className="note-editor-window" onKeyDown={handleKeyDown}>
      <div className="note-editor-header">
        <input
          className="note-editor-title"
          value={title}
          onChange={(e) => handleTitleChange(e.target.value)}
          onFocus={() => {
            titleFocusedRef.current = true
          }}
          onBlur={() => {
            titleFocusedRef.current = false
          }}
          placeholder="メモの名前(空にすると本文の1行目を使います)"
          aria-label="メモの名前"
        />
      </div>

      <div className="note-editor-toolbar">
        <button
          type="button"
          className={`note-tool note-tool--bold${currentStyle.bold ? ' active' : ''}`}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => applyStyle({ bold: !currentStyle.bold })}
          title="太字 (Ctrl+B)"
        >
          B
        </button>

        <label className="note-tool-field" title="文字サイズ">
          <span className="note-tool-label">サイズ</span>
          <select
            value={currentStyle.fontSize ?? ''}
            onChange={(e) => applyStyle({ fontSize: e.target.value === '' ? null : Number(e.target.value) })}
          >
            <option value="">既定</option>
            {FONT_SIZE_CHOICES.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </label>

        <label className="note-tool-field" title="文字色">
          <span className="note-tool-label">文字色</span>
          <input
            type="color"
            value={currentStyle.color ?? '#222222'}
            onChange={(e) => applyStyle({ color: e.target.value }, true)}
          />
          <button
            type="button"
            className="note-tool-clear"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => applyStyle({ color: null })}
            title="文字色を既定に戻す"
          >
            ✕
          </button>
        </label>

        <label className="note-tool-field" title="文字の背景色(文字の後ろだけを塗ります)">
          <span className="note-tool-label">背景</span>
          <input
            type="color"
            value={currentStyle.background ?? '#ffff88'}
            onChange={(e) => applyStyle({ background: e.target.value }, true)}
          />
          <button
            type="button"
            className="note-tool-clear"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => applyStyle({ background: null })}
            title="文字の背景色を消す"
          >
            ✕
          </button>
        </label>

        <button
          type="button"
          className="note-tool"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => applyStyle(CLEAR_STYLE)}
          title="選択範囲の装飾をすべて外す"
        >
          書式クリア
        </button>

        <span className="note-toolbar-spacer" />

        <button
          type="button"
          className={`note-tool${findOpen ? ' active' : ''}`}
          onClick={() => (findOpen ? closeFind() : openFind())}
          title="検索・置換 (Ctrl+F)"
        >
          検索
        </button>
        <button type="button" className="note-tool" onClick={() => void openTransformMenu()} title="整形・変換">
          変換
        </button>
        <button
          type="button"
          className={`note-tool${versionsOpen ? ' active' : ''}`}
          onClick={() => (versionsOpen ? setVersionsOpen(false) : void openVersions())}
          title="編集履歴"
        >
          履歴
        </button>
        <button
          type="button"
          className={`note-tool${viewOpen ? ' active' : ''}`}
          onClick={() => setViewOpen((v) => !v)}
          title="行番号・折り返し・既定の文字サイズ"
        >
          表示
        </button>
      </div>

      {viewOpen && (
        <div className="note-editor-appearance">
          <label className="note-editor-appearance-item">
            既定の文字サイズ
            <input
              type="number"
              min={10}
              max={32}
              value={appearance.fontSize}
              onChange={(e) => updateAppearance({ fontSize: Number(e.target.value) })}
            />
          </label>
          <label className="note-editor-appearance-item">
            <input
              type="checkbox"
              checked={appearance.lineNumbers}
              onChange={(e) => updateAppearance({ lineNumbers: e.target.checked })}
            />
            行番号
          </label>
          <label className="note-editor-appearance-item">
            <input
              type="checkbox"
              checked={appearance.highlightCurrentLine}
              onChange={(e) => updateAppearance({ highlightCurrentLine: e.target.checked })}
            />
            現在行を強調
          </label>
          <label className="note-editor-appearance-item">
            <input
              type="checkbox"
              checked={appearance.wordWrap}
              onChange={(e) => updateAppearance({ wordWrap: e.target.checked })}
            />
            折り返す
          </label>
          <span className="note-editor-appearance-note">
            太字・文字色・文字サイズ・背景色は、選んだ文字だけに掛かります(上のツールバー)
          </span>
        </div>
      )}

      {findOpen && (
        <NoteEditorFindBar
          query={findQuery}
          replacement={replacement}
          options={searchOptions}
          inSelection={inSelection}
          selectionEmpty={searchScopeRef.current.end <= searchScopeRef.current.start}
          matchCount={matchInfo.count}
          matchIndex={matchInfo.index}
          invalidRegex={matchInfo.invalid}
          onQueryChange={setFindQuery}
          onReplacementChange={setReplacement}
          onOptionsChange={setSearchOptions}
          onInSelectionChange={setInSelection}
          onFind={runFind}
          onReplace={runReplace}
          onReplaceAll={runReplaceAll}
          onClose={closeFind}
        />
      )}

      <div className="note-editor-main">
        {appearance.lineNumbers && (
          <div className="note-editor-gutter" style={{ fontSize: `${appearance.fontSize}px` }} aria-hidden="true">
            {lineMetrics.map((metric, index) => (
              <div
                key={index}
                className="note-editor-gutter-line"
                style={{ top: `${metric.top - scrollTop}px`, height: `${metric.height}px` }}
              >
                {index + 1}
              </div>
            ))}
          </div>
        )}

        <div
          ref={editorRef}
          className={bodyClass}
          style={{ fontSize: `${appearance.fontSize}px` }}
          contentEditable
          suppressContentEditableWarning
          spellCheck={false}
          role="textbox"
          aria-multiline="true"
          aria-label="メモの本文"
          onBeforeInput={handleBeforeInput}
          onInput={handleInput}
          onPaste={handlePaste}
          onDrop={handleDrop}
          onContextMenu={handleContextMenu}
          onScroll={(e) => setScrollTop((e.target as HTMLDivElement).scrollTop)}
          onCompositionStart={() => {
            composingRef.current = true
          }}
          onCompositionEnd={() => {
            composingRef.current = false
            ensureStructure()
            markChanged()
          }}
        />

        {counts.chars === 0 && status !== 'loading' && (
          <div
            className={`note-editor-placeholder${appearance.lineNumbers ? ' note-editor-placeholder--gutter' : ''}`}
            style={{ fontSize: `${appearance.fontSize}px` }}>
            ここに書きます。入力が止まると自動で保存されます。
          </div>
        )}

        {versionsOpen && (
          <NoteEditorVersions
            versions={versions}
            onRestore={(version) => setRestoreTarget(version)}
            onClose={() => setVersionsOpen(false)}
          />
        )}
      </div>

      <div className="note-editor-footer">
        <span className={`note-editor-status${status === 'editing' ? ' note-editor-status--dirty' : ''}`}>
          {statusLabel}
        </span>
        {toast && <span className="note-editor-toast">{toast}</span>}
        {note && <span className="note-editor-updated">最終更新 {formatUpdatedAt(note.updatedAt)}</span>}
        <span className="note-editor-count">
          {counts.lines}行 / {counts.chars}文字
        </span>
      </div>

      {restoreTarget && (
        <ConfirmDialog
          message="今の内容をこの版に戻します。戻す直前の内容も履歴に残ります。"
          confirmLabel="戻す"
          onConfirm={() => {
            const target = restoreTarget
            setRestoreTarget(null)
            void restoreVersion(target)
          }}
          onCancel={() => setRestoreTarget(null)}
        />
      )}
    </div>
  )
}

/** フッターに出す最終更新日時 */
function formatUpdatedAt(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (n: number): string => String(n).padStart(2, '0')
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`
  if (new Date().toDateString() === date.toDateString()) return time
  return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${time}`
}

/** 検索語が正規表現として成立しているか */
function isValidRegExp(source: string): boolean {
  if (source === '') return true
  try {
    new RegExp(source)
    return true
  } catch {
    return false
  }
}

/** 選択箇所が画面の外にある場合にスクロールして見せる */
function scrollSelectionIntoView(): void {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0) return
  const node = selection.getRangeAt(0).startContainer
  const element = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement
  element?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
}
