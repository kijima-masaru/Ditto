import { useCallback, useEffect, useState } from 'react'
import type { ContextMenuItem, MacroCase, Note, NoteFolder } from '../../../shared/types'
import { flattenFolders, folderBreadcrumb } from '../folderTree'
import { useDragReorder } from '../hooks/useDragReorder'
import ConfirmDialog from './ConfirmDialog'

/**
 * メモの一覧。クリップボード・マクロと同じくフォルダで整理でき、操作方法(右クリック
 * メニュー・ドラッグ&ドロップでの並び替え)も揃えている。
 *
 * 本文の編集はこの画面では行わない。Ditto本体は幅が狭く文章を書くには向かないため、
 * メモを開くと編集専用の別ウィンドウ(noteEditorWindow.ts)が開く。
 */

interface Props {
  initialFolderId?: string | null
}

function buildMoveSubmenu(flatFolders: { folder: NoteFolder; depth: number }[]): ContextMenuItem[] {
  const items: ContextMenuItem[] = [{ id: 'move:root', label: 'home' }]
  for (const { folder, depth } of flatFolders) {
    items.push({ id: `move:${folder.id}`, label: `${'　'.repeat(depth)}${folder.name}` })
  }
  return items
}

/** idの並び順を1つ上/下の要素と入れ替えた新しい配列を返す。端で動かせない場合はnull */
function swapOrder(ids: string[], id: string, direction: 'up' | 'down'): string[] | null {
  const index = ids.indexOf(id)
  const targetIndex = direction === 'up' ? index - 1 : index + 1
  if (index === -1 || targetIndex < 0 || targetIndex >= ids.length) return null
  const next = [...ids]
  ;[next[index], next[targetIndex]] = [next[targetIndex], next[index]]
  return next
}

function formatUpdatedAt(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export default function NotesPanel({ initialFolderId = null }: Props): React.JSX.Element {
  const [notes, setNotes] = useState<Note[]>([])
  const [folders, setFolders] = useState<NoteFolder[]>([])
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(initialFolderId)
  const [loading, setLoading] = useState(true)

  const [query, setQuery] = useState('')
  // 検索は本文まで対象にするためmain側で行う。一致したメモのidを保持する
  const [hitIds, setHitIds] = useState<string[] | null>(null)

  const [renamingNoteId, setRenamingNoteId] = useState<string | null>(null)
  const [renameNoteInput, setRenameNoteInput] = useState('')
  const [deletingNoteId, setDeletingNoteId] = useState<string | null>(null)

  const [creatingFolder, setCreatingFolder] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const [renamingFolderId, setRenamingFolderId] = useState<string | null>(null)
  const [renameFolderInput, setRenameFolderInput] = useState('')
  const [deletingFolderId, setDeletingFolderId] = useState<string | null>(null)

  const reload = useCallback(async (): Promise<void> => {
    const [noteList, folderList] = await Promise.all([window.api.listNotes(), window.api.listNoteFolders()])
    setNotes(noteList)
    setFolders(folderList)
    setLoading(false)
  }, [])

  useEffect(() => {
    reload()
  }, [reload])

  // 編集ウィンドウで保存されたら一覧(名前・抜粋・更新日時)を追従させる
  useEffect(() => {
    return window.api.onNotesChanged(() => {
      void reload()
    })
  }, [reload])

  // 入力のたびに本文を読みに行かないよう、少し待ってから検索する
  useEffect(() => {
    const trimmed = query.trim()
    if (!trimmed) {
      setHitIds(null)
      return undefined
    }
    const timer = window.setTimeout(() => {
      void window.api.searchNotes(trimmed).then(setHitIds)
    }, 200)
    return () => window.clearTimeout(timer)
  }, [query])

  const openNote = (id: string): void => {
    void window.api.openNoteEditor(id)
  }

  const handleCreateNote = async (folderId: string | null): Promise<void> => {
    const note = await window.api.createNote(folderId)
    await reload()
    openNote(note.id)
  }

  /** テキストファイルを選び、新しいメモとして取り込む(文字コードはmain側で判別する) */
  const handleImportFile = async (folderId: string | null): Promise<void> => {
    const note = await window.api.importNoteFromFile(folderId)
    if (!note) return
    await reload()
    openNote(note.id)
  }

  /**
   * メモを「マクロの入力ステップ」としてマクロへ足す。どのマクロのどの対象に足すかは
   * 入れ子のメニューで選ばせる(手順書をメモに置いたまま、対象アプリへ流し込めるようにするため)
   */
  const buildMacroSubmenu = (macros: MacroCase[]): ContextMenuItem[] => {
    if (macros.length === 0) return [{ id: 'no-macro', label: 'マクロがありません', enabled: false }]
    return macros.map((macroCase) => ({
      id: `macro:${macroCase.id}`,
      label: macroCase.name,
      submenu:
        macroCase.targets.length === 0
          ? [{ id: 'no-target', label: '対象がありません', enabled: false }]
          : macroCase.targets.map((target) => ({
              id: `macro-step:${macroCase.id}:${target.id}`,
              label: target.label || target.url || target.exePath || target.id
            }))
    }))
  }

  const startRenameNote = (n: Note): void => {
    setRenamingNoteId(n.id)
    setRenameNoteInput(n.title)
  }

  const saveRenameNote = async (): Promise<void> => {
    if (!renamingNoteId) return
    await window.api.renameNote(renamingNoteId, renameNoteInput)
    setRenamingNoteId(null)
    reload()
  }

  const confirmDeleteNote = async (id: string): Promise<void> => {
    await window.api.deleteNote(id)
    setDeletingNoteId(null)
    reload()
  }

  const handleMoveNote = async (id: string, folderId: string | null): Promise<void> => {
    await window.api.moveNote(id, folderId)
    reload()
  }

  const saveCreateFolder = async (): Promise<void> => {
    if (!newFolderName.trim()) return
    await window.api.createNoteFolder(newFolderName.trim(), currentFolderId)
    setNewFolderName('')
    setCreatingFolder(false)
    reload()
  }

  const startRenameFolder = (f: NoteFolder): void => {
    setRenamingFolderId(f.id)
    setRenameFolderInput(f.name)
  }

  const saveRenameFolder = async (): Promise<void> => {
    if (!renamingFolderId || !renameFolderInput.trim()) return
    await window.api.renameNoteFolder(renamingFolderId, renameFolderInput.trim())
    setRenamingFolderId(null)
    reload()
  }

  const confirmDeleteFolder = async (id: string): Promise<void> => {
    await window.api.deleteNoteFolder(id)
    setDeletingFolderId(null)
    if (currentFolderId === id) setCurrentFolderId(null)
    reload()
  }

  const handleReorderFolders = async (orderedIds: string[]): Promise<void> => {
    await window.api.reorderNoteFolders(orderedIds)
    reload()
  }

  const handleReorderNotes = async (orderedIds: string[]): Promise<void> => {
    await window.api.reorderNotes(orderedIds)
    reload()
  }

  const searching = hitIds !== null
  const flatFolders = flattenFolders(folders)
  const breadcrumb = folderBreadcrumb(folders, currentFolderId)
  const currentFolder = folders.find((f) => f.id === currentFolderId) ?? null
  const subfolders = searching ? [] : folders.filter((f) => f.parentId === currentFolderId)
  // 検索中はフォルダをまたいで一致したメモだけを並べる(どこにあるか探し回らずに済むように)
  const visibleNotes = searching
    ? notes.filter((n) => hitIds.includes(n.id))
    : notes.filter((n) => (n.folderId ?? null) === currentFolderId)
  const folderDrag = useDragReorder(subfolders, (f) => f.id, handleReorderFolders)
  const noteDrag = useDragReorder(visibleNotes, (n) => n.id, handleReorderNotes)

  const deletingFolder = deletingFolderId ? (folders.find((f) => f.id === deletingFolderId) ?? null) : null
  const deletingNote = deletingNoteId ? (notes.find((n) => n.id === deletingNoteId) ?? null) : null

  const handleAreaContextMenu = async (e: React.MouseEvent): Promise<void> => {
    e.preventDefault()
    const items: ContextMenuItem[] = [
      { id: 'create-note', label: '新規メモを作成' },
      { id: 'import-file', label: 'ファイルから読み込む...' },
      { id: 'create-folder', label: '新規フォルダを作成' }
    ]
    if (currentFolderId !== null) {
      items.push({ id: 'sep1', type: 'separator' })
      items.push({ id: 'go-up', label: '上の階層に戻る' })
    }
    const result = await window.api.showContextMenu(items)
    if (result === 'create-note') void handleCreateNote(currentFolderId)
    else if (result === 'import-file') void handleImportFile(currentFolderId)
    else if (result === 'create-folder') {
      setCreatingFolder(true)
      setNewFolderName('')
    } else if (result === 'go-up') {
      setCurrentFolderId(currentFolder?.parentId ?? null)
    }
  }

  const handleFolderContextMenu = async (e: React.MouseEvent, f: NoteFolder): Promise<void> => {
    e.preventDefault()
    e.stopPropagation()
    const ids = subfolders.map((sf) => sf.id)
    const index = ids.indexOf(f.id)
    const result = await window.api.showContextMenu([
      { id: 'create-note', label: '新規メモを作成' },
      { id: 'import-file', label: 'ファイルから読み込む...' },
      { id: 'sep0', type: 'separator' },
      { id: 'rename', label: '名前変更' },
      { id: 'move-up', label: '上に移動', enabled: index > 0 },
      { id: 'move-down', label: '下に移動', enabled: index < ids.length - 1 },
      { id: 'sep', type: 'separator' },
      { id: 'delete', label: '削除' }
    ])
    if (result === 'create-note') void handleCreateNote(f.id)
    else if (result === 'import-file') void handleImportFile(f.id)
    else if (result === 'rename') startRenameFolder(f)
    else if (result === 'delete') setDeletingFolderId(f.id)
    else if (result === 'move-up' || result === 'move-down') {
      const next = swapOrder(ids, f.id, result === 'move-up' ? 'up' : 'down')
      if (next) handleReorderFolders(next)
    }
  }

  const handleNoteContextMenu = async (e: React.MouseEvent, n: Note): Promise<void> => {
    e.preventDefault()
    e.stopPropagation()
    const ids = visibleNotes.map((vn) => vn.id)
    const index = ids.indexOf(n.id)
    const macros = await window.api.listMacros()
    const result = await window.api.showContextMenu([
      { id: 'open', label: '開く' },
      { id: 'rename', label: '名前変更' },
      { id: 'pin', label: n.pinned ? 'コマンドパレットの固定を解除' : 'コマンドパレットに固定' },
      { id: 'to-macro', label: 'マクロに入力ステップとして追加', submenu: buildMacroSubmenu(macros) },
      { id: 'move', label: '移動', submenu: buildMoveSubmenu(flatFolders) },
      { id: 'move-up', label: '上に移動', enabled: !searching && index > 0 },
      { id: 'move-down', label: '下に移動', enabled: !searching && index < ids.length - 1 },
      { id: 'sep', type: 'separator' },
      { id: 'delete', label: '削除' }
    ])
    if (result === 'open') openNote(n.id)
    else if (result?.startsWith('macro-step:')) {
      const [, macroId, targetId] = result.split(':')
      void window.api.addNoteStepToMacro(macroId, targetId, n.id, n.title)
    } else if (result === 'rename') startRenameNote(n)
    else if (result === 'pin') void window.api.setNotePinned(n.id, !n.pinned).then(reload)
    else if (result === 'delete') setDeletingNoteId(n.id)
    else if (result?.startsWith('move:')) {
      const dest = result.slice('move:'.length)
      handleMoveNote(n.id, dest === 'root' ? null : dest)
    } else if (result === 'move-up' || result === 'move-down') {
      const next = swapOrder(ids, n.id, result === 'move-up' ? 'up' : 'down')
      if (next) handleReorderNotes(next)
    }
  }

  if (loading) return <div className="panel">読み込み中...</div>

  return (
    <div className="folder-browser" onContextMenu={handleAreaContextMenu}>
      <div className="notes-toolbar" onContextMenu={(e) => e.stopPropagation()}>
        <input
          className="notes-search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="メモを検索(本文も対象)"
        />
        <button className="primary notes-new-btn" onClick={() => handleCreateNote(currentFolderId)}>
          新規メモ
        </button>
      </div>

      {!searching && (
        <div className="breadcrumb">
          {currentFolderId === null ? (
            <span className="breadcrumb-current">home</span>
          ) : (
            <button onClick={() => setCurrentFolderId(null)}>home</button>
          )}
          {breadcrumb.map((f, i) => (
            <span key={f.id} className="breadcrumb-item">
              <span className="breadcrumb-sep">/</span>
              {i === breadcrumb.length - 1 ? (
                <span className="breadcrumb-current">{f.name}</span>
              ) : (
                <button onClick={() => setCurrentFolderId(f.id)}>{f.name}</button>
              )}
            </span>
          ))}
        </div>
      )}

      {creatingFolder && (
        <div className="row inline-form" onContextMenu={(e) => e.stopPropagation()}>
          <input
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            placeholder="フォルダ名"
            autoFocus
            onKeyDown={(e) => e.key === 'Enter' && saveCreateFolder()}
          />
          <button className="primary" onClick={saveCreateFolder} disabled={!newFolderName.trim()}>
            作成
          </button>
          <button onClick={() => setCreatingFolder(false)}>キャンセル</button>
        </div>
      )}

      {subfolders.length === 0 && visibleNotes.length === 0 && !creatingFolder ? (
        <div className="panel">
          {searching ? (
            <p>一致するメモがありません。</p>
          ) : currentFolderId ? (
            <p>このフォルダにはメモがありません。</p>
          ) : (
            <>
              <p>メモはまだありません。</p>
              <p>「新規メモ」から作成すると、編集用のウィンドウが開きます。</p>
            </>
          )}
        </div>
      ) : (
        <>
          {subfolders.length > 0 && (
            <ul className="folder-cards">
              {folderDrag.orderedItems.map((f) => {
                const isRenamingFolder = renamingFolderId === f.id
                const isPending = isRenamingFolder || deletingFolderId === f.id
                const drag = isPending ? null : folderDrag.getHandlers(f)
                return (
                  <li
                    key={f.id}
                    className={isRenamingFolder ? 'row inline-form' : `folder-card${drag ? ` ${drag.className}` : ''}`}
                    onContextMenu={(e) => handleFolderContextMenu(e, f)}
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
                    {isRenamingFolder ? (
                      <>
                        <input
                          value={renameFolderInput}
                          onChange={(e) => setRenameFolderInput(e.target.value)}
                          autoFocus
                          onKeyDown={(e) => e.key === 'Enter' && saveRenameFolder()}
                        />
                        <button className="primary" onClick={saveRenameFolder} disabled={!renameFolderInput.trim()}>
                          保存
                        </button>
                        <button onClick={() => setRenamingFolderId(null)}>キャンセル</button>
                      </>
                    ) : (
                      <button className="folder-card-name" onClick={() => setCurrentFolderId(f.id)}>
                        📁 {f.name}
                      </button>
                    )}
                  </li>
                )
              })}
            </ul>
          )}

          {visibleNotes.length > 0 && (
            <ul className="note-list">
              {noteDrag.orderedItems.map((n) => {
                const isEditingNote = renamingNoteId === n.id || deletingNoteId === n.id
                // 検索中は表示順が並び順と一致しないため、ドラッグでの並び替えは無効にする
                const drag = isEditingNote || searching ? null : noteDrag.getHandlers(n)
                return (
                  <li
                    key={n.id}
                    className={drag?.className}
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
                    {renamingNoteId === n.id ? (
                      <div className="row inline-form">
                        <input
                          value={renameNoteInput}
                          onChange={(e) => setRenameNoteInput(e.target.value)}
                          placeholder="空にすると本文の1行目を使います"
                          autoFocus
                          onKeyDown={(e) => e.key === 'Enter' && saveRenameNote()}
                        />
                        <button className="primary" onClick={saveRenameNote}>
                          保存
                        </button>
                        <button onClick={() => setRenamingNoteId(null)}>キャンセル</button>
                      </div>
                    ) : (
                      <div
                        className="note-item"
                        onClick={() => openNote(n.id)}
                        onContextMenu={(e) => handleNoteContextMenu(e, n)}
                      >
                        <div className="note-item-title">
                          {n.title}
                          {n.pinned && (
                            <span className="clip-item-pin" title="コマンドパレットに固定">
                              📌
                            </span>
                          )}
                        </div>
                        {n.preview && <div className="note-item-preview">{n.preview}</div>}
                        <div className="note-item-meta">{formatUpdatedAt(n.updatedAt)}</div>
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </>
      )}

      {deletingFolder && (
        <ConfirmDialog
          message={`「${deletingFolder.name}」を削除しますか?(中身は上の階層に移動されます)`}
          onConfirm={() => confirmDeleteFolder(deletingFolder.id)}
          onCancel={() => setDeletingFolderId(null)}
        />
      )}
      {deletingNote && (
        <ConfirmDialog
          message={`「${deletingNote.title}」を削除しますか?`}
          onConfirm={() => confirmDeleteNote(deletingNote.id)}
          onCancel={() => setDeletingNoteId(null)}
        />
      )}
    </div>
  )
}
