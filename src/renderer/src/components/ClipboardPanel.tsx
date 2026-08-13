import { useEffect, useState } from 'react'
import type {
  ClipboardHistoryEntry,
  ClipboardTemplate,
  ClipboardTemplateFolder,
  ContextMenuItem
} from '../../../shared/types'
import { flattenFolders, folderBreadcrumb } from '../folderTree'
import { useHoverIntent } from '../hooks/useHoverIntent'
import { useDragReorder } from '../hooks/useDragReorder'
import FolderPreviewFlyout from './FolderPreviewFlyout'

type SubTab = 'history' | 'templates'

function truncate(text: string, max = 80): string {
  const oneLine = text.replace(/\s+/g, ' ').trim()
  return oneLine.length > max ? `${oneLine.slice(0, max)}…` : oneLine
}

function buildMoveSubmenu(flatFolders: { folder: ClipboardTemplateFolder; depth: number }[]): ContextMenuItem[] {
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

export default function ClipboardPanel(): React.JSX.Element {
  const [subTab, setSubTab] = useState<SubTab>('history')
  const [historyQuery, setHistoryQuery] = useState('')
  const [history, setHistory] = useState<ClipboardHistoryEntry[]>([])
  const [templates, setTemplates] = useState<ClipboardTemplate[]>([])
  const [templateFolders, setTemplateFolders] = useState<ClipboardTemplateFolder[]>([])
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)

  const [creating, setCreating] = useState(false)
  const [newText, setNewText] = useState('')
  const [newLabel, setNewLabel] = useState('')

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editText, setEditText] = useState('')
  const [editLabel, setEditLabel] = useState('')

  const [deletingTemplateId, setDeletingTemplateId] = useState<string | null>(null)

  const [creatingFolder, setCreatingFolder] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const [renamingFolderId, setRenamingFolderId] = useState<string | null>(null)
  const [renameFolderInput, setRenameFolderInput] = useState('')
  const [deletingFolderId, setDeletingFolderId] = useState<string | null>(null)

  const folderPreview = useHoverIntent(300, 200, { respectPreviewWindows: true })

  const reload = async (): Promise<void> => {
    const [h, t, f] = await Promise.all([
      window.api.listClipboardHistory(),
      window.api.listClipboardTemplates(),
      window.api.listClipboardTemplateFolders()
    ])
    setHistory(h)
    setTemplates(t)
    setTemplateFolders(f)
  }

  useEffect(() => {
    reload()
    const unsubscribe = window.api.onClipboardDataChanged(() => reload())
    return unsubscribe
  }, [])

  useEffect(() => {
    return window.api.onNavigateToFolder(({ kind, folderId }) => {
      if (kind === 'clipboard') setCurrentFolderId(folderId)
    })
  }, [])

  const handleCopy = async (id: string, text: string): Promise<void> => {
    await window.api.copyToClipboard(text)
    setCopiedId(id)
    window.setTimeout(() => setCopiedId((cur) => (cur === id ? null : cur)), 1200)
  }

  const handleHistoryContextMenu = (e: React.MouseEvent, entry: ClipboardHistoryEntry): void => {
    e.preventDefault()
    window.api.showClipboardHistoryMenu(entry.id, entry.text)
  }

  const handleCreateTemplate = async (): Promise<void> => {
    if (!newText.trim()) return
    await window.api.createClipboardTemplate(newText.trim(), newLabel.trim() || undefined, currentFolderId)
    setNewText('')
    setNewLabel('')
    setCreating(false)
    reload()
  }

  const startEdit = (t: ClipboardTemplate): void => {
    setEditingId(t.id)
    setEditText(t.text)
    setEditLabel(t.label ?? '')
  }

  const handleSaveEdit = async (): Promise<void> => {
    if (!editingId || !editText.trim()) return
    await window.api.updateClipboardTemplate(editingId, editText.trim(), editLabel.trim() || undefined)
    setEditingId(null)
    reload()
  }

  const handleDeleteTemplate = async (id: string): Promise<void> => {
    await window.api.deleteClipboardTemplate(id)
    setDeletingTemplateId(null)
    reload()
  }

  const handleMoveTemplate = async (id: string, folderId: string | null): Promise<void> => {
    await window.api.moveClipboardTemplate(id, folderId)
    reload()
  }

  const saveCreateFolder = async (): Promise<void> => {
    if (!newFolderName.trim()) return
    await window.api.createClipboardTemplateFolder(newFolderName.trim(), currentFolderId)
    setNewFolderName('')
    setCreatingFolder(false)
    reload()
  }

  const startRenameFolder = (f: ClipboardTemplateFolder): void => {
    setRenamingFolderId(f.id)
    setRenameFolderInput(f.name)
  }

  const saveRenameFolder = async (): Promise<void> => {
    if (!renamingFolderId || !renameFolderInput.trim()) return
    await window.api.renameClipboardTemplateFolder(renamingFolderId, renameFolderInput.trim())
    setRenamingFolderId(null)
    reload()
  }

  const confirmDeleteFolder = async (id: string): Promise<void> => {
    await window.api.deleteClipboardTemplateFolder(id)
    setDeletingFolderId(null)
    if (currentFolderId === id) setCurrentFolderId(null)
    reload()
  }

  const handleReorderFolders = async (orderedIds: string[]): Promise<void> => {
    await window.api.reorderClipboardTemplateFolders(orderedIds)
    reload()
  }

  const handleReorderTemplates = async (orderedIds: string[]): Promise<void> => {
    await window.api.reorderClipboardTemplates(orderedIds)
    reload()
  }

  const trimmedHistoryQuery = historyQuery.trim().toLowerCase()
  const filteredHistory = trimmedHistoryQuery
    ? history.filter((h) => h.text.toLowerCase().includes(trimmedHistoryQuery))
    : history

  const subfolders = templateFolders.filter((f) => f.parentId === currentFolderId)
  const visibleTemplates = templates.filter((t) => (t.folderId ?? null) === currentFolderId)
  const breadcrumb = folderBreadcrumb(templateFolders, currentFolderId)
  const flatFolders = flattenFolders(templateFolders)
  const currentFolder = templateFolders.find((f) => f.id === currentFolderId) ?? null
  const folderDrag = useDragReorder(subfolders, (f) => f.id, handleReorderFolders)
  const templateDrag = useDragReorder(visibleTemplates, (t) => t.id, handleReorderTemplates)

  const handleAreaContextMenu = async (e: React.MouseEvent): Promise<void> => {
    e.preventDefault()
    const items: ContextMenuItem[] = []
    if (currentFolderId === null) {
      items.push({ id: 'create-folder', label: '新規フォルダを作成' })
    }
    items.push({ id: 'create-template', label: '新規定型文を作成' })
    if (currentFolderId !== null) {
      items.push({ id: 'sep1', type: 'separator' })
      items.push({ id: 'go-up', label: '上の階層に戻る' })
      if (currentFolder?.parentId !== null) {
        items.push({ id: 'go-root', label: 'homeに移動' })
      }
    }
    const result = await window.api.showContextMenu(items)
    if (result === 'create-folder') {
      setCreatingFolder(true)
      setNewFolderName('')
    } else if (result === 'create-template') {
      setCreating(true)
      setNewText('')
      setNewLabel('')
    } else if (result === 'go-up') {
      setCurrentFolderId(currentFolder?.parentId ?? null)
    } else if (result === 'go-root') {
      setCurrentFolderId(null)
    }
  }

  const handleFolderContextMenu = async (e: React.MouseEvent, f: ClipboardTemplateFolder): Promise<void> => {
    e.preventDefault()
    e.stopPropagation()
    const ids = subfolders.map((sf) => sf.id)
    const index = ids.indexOf(f.id)
    const result = await window.api.showContextMenu([
      { id: 'create-template', label: '新規定型文を作成' },
      { id: 'sep0', type: 'separator' },
      { id: 'rename', label: '名前変更' },
      { id: 'move-up', label: '上に移動', enabled: index > 0 },
      { id: 'move-down', label: '下に移動', enabled: index < ids.length - 1 },
      { id: 'sep', type: 'separator' },
      { id: 'delete', label: '削除' }
    ])
    if (result === 'create-template') {
      setCurrentFolderId(f.id)
      setCreating(true)
      setNewText('')
      setNewLabel('')
    } else if (result === 'rename') startRenameFolder(f)
    else if (result === 'delete') setDeletingFolderId(f.id)
    else if (result === 'move-up' || result === 'move-down') {
      const next = swapOrder(ids, f.id, result === 'move-up' ? 'up' : 'down')
      if (next) handleReorderFolders(next)
    }
  }

  const handleTemplateContextMenu = async (e: React.MouseEvent, t: ClipboardTemplate): Promise<void> => {
    e.preventDefault()
    e.stopPropagation()
    const ids = visibleTemplates.map((vt) => vt.id)
    const index = ids.indexOf(t.id)
    const result = await window.api.showContextMenu([
      { id: 'edit', label: '編集' },
      { id: 'move', label: '移動', submenu: buildMoveSubmenu(flatFolders) },
      { id: 'move-up', label: '上に移動', enabled: index > 0 },
      { id: 'move-down', label: '下に移動', enabled: index < ids.length - 1 },
      { id: 'sep', type: 'separator' },
      { id: 'delete', label: '削除' }
    ])
    if (result === 'edit') startEdit(t)
    else if (result === 'delete') setDeletingTemplateId(t.id)
    else if (result?.startsWith('move:')) {
      const dest = result.slice('move:'.length)
      handleMoveTemplate(t.id, dest === 'root' ? null : dest)
    } else if (result === 'move-up' || result === 'move-down') {
      const next = swapOrder(ids, t.id, result === 'move-up' ? 'up' : 'down')
      if (next) handleReorderTemplates(next)
    }
  }

  return (
    <div className="clipboard-panel">
      <div className="clipboard-subtabs">
        <button
          className={subTab === 'history' ? 'active' : ''}
          onMouseEnter={() => setSubTab('history')}
          onClick={() => setSubTab('history')}
        >
          履歴
        </button>
        <button
          className={subTab === 'templates' ? 'active' : ''}
          onMouseEnter={() => setSubTab('templates')}
          onClick={() => setSubTab('templates')}
        >
          定型文
        </button>
      </div>

      {subTab === 'history' && (
        <>
          <p className="hint">左クリックでコピー、右クリックで定型文登録などの操作ができます。</p>

          {history.length > 0 && (
            <div className="history-search">
              <input
                value={historyQuery}
                onChange={(e) => setHistoryQuery(e.target.value)}
                placeholder="履歴を検索"
              />
            </div>
          )}

          {history.length === 0 ? (
            <div className="panel">
              <p>クリップボード履歴はまだありません。テキストをコピーすると自動的に記録されます。</p>
            </div>
          ) : filteredHistory.length === 0 ? (
            <div className="panel">
              <p>「{historyQuery}」に一致する履歴が見つかりません。</p>
            </div>
          ) : (
            <ul className="clip-list">
              {filteredHistory.map((h) => (
                <li
                  key={h.id}
                  className={`clip-item${copiedId === h.id ? ' clip-item--copied' : ''}`}
                  onClick={() => handleCopy(h.id, h.text)}
                  onContextMenu={(e) => handleHistoryContextMenu(e, h)}
                >
                  <div className="clip-item-text">{truncate(h.text)}</div>
                  {copiedId === h.id && <span className="clip-copied-badge">コピーしました</span>}
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {subTab === 'templates' && (
        <div className="folder-browser" onContextMenu={handleAreaContextMenu}>
          {breadcrumb.length > 0 && (
            <div className="breadcrumb">
              <button onClick={() => setCurrentFolderId(null)}>home</button>
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

          {subfolders.length > 0 && (
            <ul className="folder-cards">
              {folderDrag.orderedItems.map((f) => {
                const isEditingFolder = renamingFolderId === f.id || deletingFolderId === f.id
                const drag = isEditingFolder ? null : folderDrag.getHandlers(f)
                return (
                <li
                  key={f.id}
                  className={`folder-card${drag ? ` ${drag.className}` : ''}`}
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
                  {renamingFolderId === f.id ? (
                    <div className="row inline-form">
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
                    </div>
                  ) : deletingFolderId === f.id ? (
                    <div className="row inline-form">
                      <span className="hint">「{f.name}」を削除しますか?(中身は上の階層に移動されます)</span>
                      <button className="danger" onClick={() => confirmDeleteFolder(f.id)}>
                        削除する
                      </button>
                      <button onClick={() => setDeletingFolderId(null)}>キャンセル</button>
                    </div>
                  ) : (
                    <button className="folder-card-name" onClick={() => setCurrentFolderId(f.id)}>
                      📁 {f.name}
                    </button>
                  )}

                  {folderPreview.activeId === f.id && renamingFolderId !== f.id && deletingFolderId !== f.id && (
                    <div
                      className="folder-preview-flyout"
                      onMouseEnter={folderPreview.cancelHide}
                      onMouseLeave={folderPreview.scheduleHide}
                    >
                      <FolderPreviewFlyout
                        folders={templateFolders}
                        items={templates}
                        folderId={f.id}
                        kind="clipboard"
                        depth={1}
                        getItemFolderId={(t) => t.folderId ?? null}
                        onNavigate={setCurrentFolderId}
                        renderItem={(t) => (
                          <div
                            key={t.id}
                            className={`folder-preview-item clip-item${copiedId === t.id ? ' clip-item--copied' : ''}`}
                            onClick={() => handleCopy(t.id, t.text)}
                            onContextMenu={(e) => handleTemplateContextMenu(e, t)}
                          >
                            {t.label && <div className="clip-item-label">{t.label}</div>}
                            <div className="clip-item-text">{truncate(t.text)}</div>
                            {copiedId === t.id && <span className="clip-copied-badge">コピーしました</span>}
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

          {creating && (
            <div className="panel clip-edit-form" onContextMenu={(e) => e.stopPropagation()}>
              <div className="field">
                <label>ラベル(任意)</label>
                <input value={newLabel} onChange={(e) => setNewLabel(e.target.value)} placeholder="例: 挨拶文" />
              </div>
              <div className="field">
                <label>本文</label>
                <textarea value={newText} onChange={(e) => setNewText(e.target.value)} rows={4} />
              </div>
              <div className="row">
                <button className="primary" onClick={handleCreateTemplate} disabled={!newText.trim()}>
                  保存
                </button>
                <button onClick={() => setCreating(false)}>キャンセル</button>
              </div>
            </div>
          )}

          {visibleTemplates.length === 0 && !creating && subfolders.length === 0 ? (
            <div className="panel">
              <p>定型文はまだありません。</p>
              <p>右クリックして「新規定型文を作成」、または履歴を右クリックして登録できます。</p>
            </div>
          ) : (
            <ul className="clip-list">
              {templateDrag.orderedItems.map((t) => {
                const isEditingTemplate = editingId === t.id || deletingTemplateId === t.id
                const drag = isEditingTemplate ? null : templateDrag.getHandlers(t)
                return editingId === t.id ? (
                  <li key={t.id} className="panel clip-edit-form">
                    <div className="field">
                      <label>ラベル(任意)</label>
                      <input value={editLabel} onChange={(e) => setEditLabel(e.target.value)} />
                    </div>
                    <div className="field">
                      <label>本文</label>
                      <textarea value={editText} onChange={(e) => setEditText(e.target.value)} rows={4} />
                    </div>
                    <div className="row">
                      <button className="primary" onClick={handleSaveEdit} disabled={!editText.trim()}>
                        保存
                      </button>
                      <button onClick={() => setEditingId(null)}>キャンセル</button>
                    </div>
                  </li>
                ) : deletingTemplateId === t.id ? (
                  <li key={t.id} className="row inline-form">
                    <span className="hint">削除しますか?</span>
                    <button className="danger" onClick={() => handleDeleteTemplate(t.id)}>
                      削除する
                    </button>
                    <button onClick={() => setDeletingTemplateId(null)}>キャンセル</button>
                  </li>
                ) : (
                  <li
                    key={t.id}
                    className={`clip-item${copiedId === t.id ? ' clip-item--copied' : ''}${drag ? ` ${drag.className}` : ''}`}
                    onClick={() => handleCopy(t.id, t.text)}
                    onContextMenu={(e) => handleTemplateContextMenu(e, t)}
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
                    {t.label && <div className="clip-item-label">{t.label}</div>}
                    <div className="clip-item-text">{truncate(t.text)}</div>
                    {copiedId === t.id && <span className="clip-copied-badge">コピーしました</span>}
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
