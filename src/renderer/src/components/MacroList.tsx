import { useEffect, useState } from 'react'
import type { ContextMenuItem, MacroCase, MacroFolder } from '../../../shared/types'
import { flattenFolders, folderBreadcrumb } from '../folderTree'
import { useHoverIntent } from '../hooks/useHoverIntent'
import { useDragReorder } from '../hooks/useDragReorder'
import { useListKeyboard } from '../lib/useListKeyboard'
import FolderPreviewFlyout from './FolderPreviewFlyout'
import ConfirmDialog from './ConfirmDialog'
import { FolderIcon, PinIcon } from './icons'

interface Props {
  onRun: (macroCase: MacroCase) => void
  onCreateMacro: (folderId: string | null) => void
  initialFolderId?: string | null
}

function buildMoveSubmenu(flatFolders: { folder: MacroFolder; depth: number }[]): ContextMenuItem[] {
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

export default function MacroList({ onRun, onCreateMacro, initialFolderId = null }: Props): React.JSX.Element {
  const [macros, setMacros] = useState<MacroCase[]>([])
  const [folders, setFolders] = useState<MacroFolder[]>([])
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(initialFolderId)
  const [loading, setLoading] = useState(true)

  const [renamingMacroId, setRenamingMacroId] = useState<string | null>(null)
  const [renameMacroInput, setRenameMacroInput] = useState('')
  const [deletingMacroId, setDeletingMacroId] = useState<string | null>(null)

  const [creatingFolder, setCreatingFolder] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const [renamingFolderId, setRenamingFolderId] = useState<string | null>(null)
  const [renameFolderInput, setRenameFolderInput] = useState('')
  const [deletingFolderId, setDeletingFolderId] = useState<string | null>(null)

  const folderPreview = useHoverIntent(300, 200, { respectPreviewWindows: true })

  const reload = async (): Promise<void> => {
    setLoading(true)
    const [macroList, folderList] = await Promise.all([window.api.listMacros(), window.api.listFolders()])
    setMacros(macroList)
    setFolders(folderList)
    setLoading(false)
  }

  useEffect(() => {
    reload()
  }, [])

  useEffect(() => {
    return window.api.onNavigateToFolder(({ kind, folderId }) => {
      if (kind === 'macro') setCurrentFolderId(folderId)
    })
  }, [])

  const startRenameMacro = (t: MacroCase): void => {
    setRenamingMacroId(t.id)
    setRenameMacroInput(t.name)
  }

  const saveRenameMacro = async (): Promise<void> => {
    if (!renamingMacroId || !renameMacroInput.trim()) return
    await window.api.renameMacro(renamingMacroId, renameMacroInput.trim())
    setRenamingMacroId(null)
    reload()
  }

  const confirmDeleteMacro = async (id: string): Promise<void> => {
    await window.api.deleteMacro(id)
    setDeletingMacroId(null)
    reload()
  }

  const handleMoveMacro = async (id: string, folderId: string | null): Promise<void> => {
    await window.api.moveMacro(id, folderId)
    reload()
  }

  const saveCreateFolder = async (): Promise<void> => {
    if (!newFolderName.trim()) return
    await window.api.createFolder(newFolderName.trim(), currentFolderId)
    setNewFolderName('')
    setCreatingFolder(false)
    reload()
  }

  const startRenameFolder = (f: MacroFolder): void => {
    setRenamingFolderId(f.id)
    setRenameFolderInput(f.name)
  }

  const saveRenameFolder = async (): Promise<void> => {
    if (!renamingFolderId || !renameFolderInput.trim()) return
    await window.api.renameFolder(renamingFolderId, renameFolderInput.trim())
    setRenamingFolderId(null)
    reload()
  }

  const confirmDeleteFolder = async (id: string): Promise<void> => {
    await window.api.deleteFolder(id)
    setDeletingFolderId(null)
    if (currentFolderId === id) setCurrentFolderId(null)
    reload()
  }

  const handleReorderFolders = async (orderedIds: string[]): Promise<void> => {
    await window.api.reorderFolders(orderedIds)
    reload()
  }

  const handleReorderMacros = async (orderedIds: string[]): Promise<void> => {
    await window.api.reorderMacros(orderedIds)
    reload()
  }

  const flatFolders = flattenFolders(folders)
  const breadcrumb = folderBreadcrumb(folders, currentFolderId)
  const currentFolder = folders.find((f) => f.id === currentFolderId) ?? null
  const subfolders = folders.filter((f) => f.parentId === currentFolderId)
  const visibleMacros = macros.filter((t) => (t.folderId ?? null) === currentFolderId)
  const folderDrag = useDragReorder(subfolders, (f) => f.id, handleReorderFolders)
  const macroDrag = useDragReorder(visibleMacros, (t) => t.id, handleReorderMacros)

  // 削除確認モーダルの対象。フォルダをまたいで移動していてもidから引けるよう、
  // 表示中のリストではなく全件から探す
  const deletingFolder = deletingFolderId ? (folders.find((f) => f.id === deletingFolderId) ?? null) : null
  const deletingMacro = deletingMacroId ? (macros.find((t) => t.id === deletingMacroId) ?? null) : null

  const handleAreaContextMenu = async (e: React.MouseEvent): Promise<void> => {
    e.preventDefault()
    const items: ContextMenuItem[] = []
    if (currentFolderId === null) {
      items.push({ id: 'create-folder', label: '新規フォルダを作成' })
    }
    items.push({ id: 'create-macro', label: '新規マクロを作成' })
    if (currentFolderId !== null) {
      items.push({ id: 'sep1', type: 'separator' })
      items.push({ id: 'go-up', label: '上の階層に戻る' })
    }
    const result = await window.api.showContextMenu(items)
    if (result === 'create-folder') {
      setCreatingFolder(true)
      setNewFolderName('')
    } else if (result === 'create-macro') {
      onCreateMacro(currentFolderId)
    } else if (result === 'go-up') {
      setCurrentFolderId(currentFolder?.parentId ?? null)
    }
  }

  const handleFolderContextMenu = async (e: React.MouseEvent, f: MacroFolder): Promise<void> => {
    e.preventDefault()
    e.stopPropagation()
    const ids = subfolders.map((sf) => sf.id)
    const index = ids.indexOf(f.id)
    const result = await window.api.showContextMenu([
      { id: 'create-macro', label: '新規マクロを作成' },
      { id: 'sep0', type: 'separator' },
      { id: 'rename', label: '名前変更' },
      { id: 'move-up', label: '上に移動', enabled: index > 0 },
      { id: 'move-down', label: '下に移動', enabled: index < ids.length - 1 },
      { id: 'sep', type: 'separator' },
      { id: 'delete', label: '削除' }
    ])
    if (result === 'create-macro') onCreateMacro(f.id)
    else if (result === 'rename') startRenameFolder(f)
    else if (result === 'delete') setDeletingFolderId(f.id)
    else if (result === 'move-up' || result === 'move-down') {
      const next = swapOrder(ids, f.id, result === 'move-up' ? 'up' : 'down')
      if (next) handleReorderFolders(next)
    }
  }

  const handleTogglePinMacro = async (t: MacroCase): Promise<void> => {
    await window.api.setMacroPinned(t.id, !t.pinned)
    reload()
  }

  // eはキーボード(Shift+F10・メニューキー)から呼ぶ場合はnullになる
  const handleMacroContextMenu = async (e: React.MouseEvent | null, t: MacroCase): Promise<void> => {
    e?.preventDefault()
    e?.stopPropagation()
    const ids = visibleMacros.map((vt) => vt.id)
    const index = ids.indexOf(t.id)
    const result = await window.api.showContextMenu([
      { id: 'run', label: '実行' },
      { id: 'rename', label: '名前変更' },
      { id: 'pin', label: t.pinned ? 'コマンドパレットの固定を解除' : 'コマンドパレットに固定' },
      { id: 'move', label: '移動', submenu: buildMoveSubmenu(flatFolders) },
      { id: 'move-up', label: '上に移動', enabled: index > 0 },
      { id: 'move-down', label: '下に移動', enabled: index < ids.length - 1 },
      { id: 'sep', type: 'separator' },
      { id: 'delete', label: '削除' }
    ])
    if (result === 'run') onRun(t)
    else if (result === 'rename') startRenameMacro(t)
    else if (result === 'pin') void handleTogglePinMacro(t)
    else if (result === 'delete') setDeletingMacroId(t.id)
    else if (result?.startsWith('move:')) {
      const dest = result.slice('move:'.length)
      handleMoveMacro(t.id, dest === 'root' ? null : dest)
    } else if (result === 'move-up' || result === 'move-down') {
      const next = swapOrder(ids, t.id, result === 'move-up' ? 'up' : 'down')
      if (next) handleReorderMacros(next)
    }
  }

  // 一覧をキーボードだけで操作できるようにする(useListKeyboard.ts参照)。
  // マクロはEnterで実行する(右クリックメニューの「実行」と同じ)
  const macroKeys = useListKeyboard('マクロ', {
    items: macroDrag.orderedItems,
    onActivate: (t) => onRun(t),
    onContextMenu: (t) => void handleMacroContextMenu(null, t),
    onDelete: (t) => setDeletingMacroId(t.id),
    disabled: renamingMacroId !== null || deletingMacroId !== null
  })

  if (loading) return <div className="panel">読み込み中...</div>

  return (
    <div className="folder-browser" onContextMenu={handleAreaContextMenu}>
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

      {subfolders.length === 0 && visibleMacros.length === 0 && !creatingFolder ? (
        <div className="panel">
          {currentFolderId ? (
            <p>このフォルダにはマクロがありません。</p>
          ) : (
            <>
              <p>保存されたマクロはまだありません。</p>
              <p>右クリックして「新規マクロを作成」から記録してください。</p>
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
                  onMouseEnter={() => folderPreview.scheduleShow(f.id)}
                  onMouseLeave={folderPreview.scheduleHide}
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
                      <FolderIcon />
                      <span>{f.name}</span>
                    </button>
                  )}

                  {folderPreview.activeId === f.id && renamingFolderId !== f.id && deletingFolderId !== f.id && (
                    <div
                      className="folder-preview-flyout"
                      onMouseEnter={folderPreview.cancelHide}
                      onMouseLeave={folderPreview.scheduleHide}
                    >
                      <FolderPreviewFlyout
                        folders={folders}
                        items={macros}
                        folderId={f.id}
                        kind="macro"
                        depth={1}
                        getItemFolderId={(t) => t.folderId ?? null}
                        onNavigate={setCurrentFolderId}
                        renderItem={(t) => (
                          <div
                            key={t.id}
                            className="folder-preview-item macro-name-item"
                            onContextMenu={(e) => handleMacroContextMenu(e, t)}
                          >
                            {t.name}
                          </div>
                        )}
                      />
                    </div>
                  )}
                </li>
                )
              })}
            </ul>
          )}

          {visibleMacros.length > 0 && (
            <ul className="macro-name-list" {...macroKeys.listProps}>
              {macroDrag.orderedItems.map((t) => {
                const isEditingMacro = renamingMacroId === t.id || deletingMacroId === t.id
                const drag = isEditingMacro ? null : macroDrag.getHandlers(t)
                return (
                <li
                  key={t.id}
                  className={drag?.className}
                  {...macroKeys.getItemProps(t)}
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
                  {renamingMacroId === t.id ? (
                    <div className="row inline-form">
                      <input
                        value={renameMacroInput}
                        onChange={(e) => setRenameMacroInput(e.target.value)}
                        autoFocus
                        onKeyDown={(e) => e.key === 'Enter' && saveRenameMacro()}
                      />
                      <button className="primary" onClick={saveRenameMacro} disabled={!renameMacroInput.trim()}>
                        保存
                      </button>
                      <button onClick={() => setRenamingMacroId(null)}>キャンセル</button>
                    </div>
                  ) : (
                    <div className="macro-name-item" onContextMenu={(e) => handleMacroContextMenu(e, t)}>
                      {t.name}
                      {t.pinned && (
                        <span className="clip-item-pin" title="コマンドパレットに固定">
                          <PinIcon />
                        </span>
                      )}
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
      {deletingMacro && (
        <ConfirmDialog
          message={`「${deletingMacro.name}」を削除しますか?`}
          onConfirm={() => confirmDeleteMacro(deletingMacro.id)}
          onCancel={() => setDeletingMacroId(null)}
        />
      )}
    </div>
  )
}
