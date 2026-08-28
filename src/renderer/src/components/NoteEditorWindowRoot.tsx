import { useCallback, useEffect, useRef, useState } from 'react'
import type { Note } from '../../../shared/types'

/**
 * メモの編集専用の別ウィンドウのルート。
 * メインウィンドウと同じrenderer bundleを`?noteEditor=1`付きで読み込むことで
 * 実現している(noteEditorWindow.ts参照)。
 *
 * 本文の入力欄は素のtextareaにしている。日本語の変換中の表示や確定前の入力を
 * OS任せにできるため、日本語入力が最も確実に動く。エディタ部品(行番号・検索置換・
 * 矩形選択など)の導入は、実機のWindowsでIMEの挙動を検証してから行う。
 *
 * 本文を右クリックすると、選択範囲を定型文として登録できる(メモ=書いて育てる /
 * 定型文=繰り返し入力する、という役割の違いを行き来できるようにするため)。
 *
 * 保存は自動で行う(入力が止まってから少し待って保存、ウィンドウを離れた時も保存)。
 * メモは保存操作を意識させた時点で使われなくなるため、Ctrl+Sは「今すぐ保存」の
 * 補助として用意するだけにしている。
 */

/** 入力が止まってから保存するまでの待ち時間 */
const AUTOSAVE_DELAY_MS = 800
/** 名前の変更を保存するまでの待ち時間 */
const RENAME_DELAY_MS = 600

// 表示対象のメモIDはウィンドウ生成時にクエリ文字列で渡される
// (IPCで受け取ると、mainからの送信がマウントより早い場合に取りこぼすため)
const initialNoteId = new URLSearchParams(window.location.search).get('noteId')

export default function NoteEditorWindowRoot(): React.JSX.Element {
  const [noteId, setNoteId] = useState<string | null>(initialNoteId)
  const [note, setNote] = useState<Note | null>(null)
  const [body, setBody] = useState('')
  const [title, setTitle] = useState('')
  const [status, setStatus] = useState<'loading' | 'saved' | 'editing' | 'saving' | 'notfound'>('loading')

  // 保存処理は入力のたびに作り直さないよう、最新値をrefで持つ
  const noteIdRef = useRef<string | null>(null)
  const bodyRef = useRef('')
  const dirtyRef = useRef(false)
  const saveTimerRef = useRef<number | null>(null)
  const titleFocusedRef = useRef(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    // メインウィンドウとは別のBrowserWindowなのでdata-theme属性を独自に引き継ぐ必要がある
    window.api.getSettings().then((s) => document.documentElement.setAttribute('data-theme', s.theme))
  }, [])

  /** 未保存の内容があれば今すぐ保存する */
  const flush = useCallback(async (): Promise<void> => {
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
    }
    const id = noteIdRef.current
    if (!id || !dirtyRef.current) return
    const saved = bodyRef.current
    dirtyRef.current = false
    setStatus('saving')
    const updated = await window.api.updateNoteBody(id, saved)
    // 保存中にさらに入力されていた場合は「保存済み」にしない
    if (!dirtyRef.current) setStatus('saved')
    if (updated) {
      setNote(updated)
      // 名前を自動生成している場合は本文に追従させる(利用者が入力中の欄は書き換えない)
      if (!updated.titleManual && !titleFocusedRef.current) setTitle(updated.title)
    }
  }, [])

  // 対象のメモを読み込む。別のメモへ切り替わる場合は、先に未保存の内容を保存する
  useEffect(() => {
    let cancelled = false
    const load = async (): Promise<void> => {
      await flush()
      if (!noteId) {
        setStatus('notfound')
        return
      }
      setStatus('loading')
      const [list, loadedBody] = await Promise.all([window.api.listNotes(), window.api.getNoteBody(noteId)])
      if (cancelled) return
      const found = list.find((n) => n.id === noteId) ?? null
      setNote(found)
      if (!found) {
        setStatus('notfound')
        return
      }
      noteIdRef.current = noteId
      bodyRef.current = loadedBody
      dirtyRef.current = false
      setBody(loadedBody)
      setTitle(found.title)
      setStatus('saved')
      document.title = `${found.title} - メモ`
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [noteId, flush])

  // 既にこのウィンドウが開いている状態で別のメモを開いた場合の差し替え
  useEffect(() => {
    return window.api.onOpenNoteInEditor((id) => setNoteId(id))
  }, [])

  // ウィンドウを離れた時・閉じる時にも保存する(入力途中の内容を残さない)
  useEffect(() => {
    const onBlur = (): void => void flush()
    window.addEventListener('blur', onBlur)
    window.addEventListener('beforeunload', onBlur)
    return () => {
      window.removeEventListener('blur', onBlur)
      window.removeEventListener('beforeunload', onBlur)
    }
  }, [flush])

  const handleBodyChange = (value: string): void => {
    setBody(value)
    bodyRef.current = value
    dirtyRef.current = true
    setStatus('editing')
    if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current)
    saveTimerRef.current = window.setTimeout(() => void flush(), AUTOSAVE_DELAY_MS)
  }

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

  const [toast, setToast] = useState<string | null>(null)

  const showToast = (message: string): void => {
    setToast(message)
    window.setTimeout(() => setToast(null), 2000)
  }

  /**
   * 本文の右クリックメニュー。書いたメモの一部を、繰り返し使う定型文へ
   * 「昇格」させられるようにしている(メモ=書いて育てる / 定型文=繰り返し入力する)
   */
  const handleBodyContextMenu = async (e: React.MouseEvent): Promise<void> => {
    e.preventDefault()
    const el = textareaRef.current
    if (!el) return
    const selected = el.value.slice(el.selectionStart, el.selectionEnd)
    const hasSelection = selected.length > 0
    const result = await window.api.showContextMenu([
      { id: 'to-template', label: '選択範囲を定型文として登録', enabled: hasSelection },
      { id: 'copy', label: '選択範囲をコピー', enabled: hasSelection }
    ])
    if (!hasSelection) return
    if (result === 'to-template') {
      try {
        await window.api.createClipboardTemplate(selected)
        showToast('定型文として登録しました')
      } catch (err) {
        showToast(`登録できませんでした: ${(err as Error).message}`)
      }
    } else if (result === 'copy') {
      await window.api.copyToClipboard(selected)
      showToast('コピーしました')
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent): void => {
    if (e.ctrlKey && (e.key === 's' || e.key === 'S')) {
      e.preventDefault()
      void flush()
    }
  }

  if (status === 'notfound') {
    return (
      <div className="note-editor-window">
        <div className="note-editor-empty">メモが見つかりませんでした</div>
      </div>
    )
  }

  if (!note) {
    return (
      <div className="note-editor-window">
        <div className="note-editor-empty">読み込み中...</div>
      </div>
    )
  }

  const lineCount = body === '' ? 0 : body.split(/\r\n|\r|\n/).length
  const statusLabel = status === 'saving' ? '保存中...' : status === 'editing' ? '未保存' : '保存済み'

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

      <textarea
        ref={textareaRef}
        className="note-editor-body"
        onContextMenu={handleBodyContextMenu}
        value={body}
        onChange={(e) => handleBodyChange(e.target.value)}
        placeholder="ここに書きます。入力が止まると自動で保存されます。"
        spellCheck={false}
        autoFocus
        aria-label="メモの本文"
      />

      <div className="note-editor-footer">
        <span className={`note-editor-status${status === 'editing' ? ' note-editor-status--dirty' : ''}`}>
          {statusLabel}
        </span>
        {toast && <span className="note-editor-toast">{toast}</span>}
        <span className="note-editor-count">
          {lineCount}行 / {body.length}文字
        </span>
      </div>
    </div>
  )
}
