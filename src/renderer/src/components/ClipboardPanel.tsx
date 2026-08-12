import { useEffect, useState } from 'react'
import type { ClipboardHistoryEntry, ClipboardTemplate, ClipboardTemplateFolder } from '../../../shared/types'
import { flattenFolders, folderBreadcrumb } from '../folderTree'

type SubTab = 'history' | 'templates'

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString('ja-JP')
}

function truncate(text: string, max = 80): string {
  const oneLine = text.replace(/\s+/g, ' ').trim()
  return oneLine.length > max ? `${oneLine.slice(0, max)}…` : oneLine
}

export default function ClipboardPanel(): React.JSX.Element {
  const [subTab, setSubTab] = useState<SubTab>('history')
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

  const [clearingHistory, setClearingHistory] = useState(false)
  const [deletingTemplateId, setDeletingTemplateId] = useState<string | null>(null)
  const [movingTemplateId, setMovingTemplateId] = useState<string | null>(null)

  const [creatingFolder, setCreatingFolder] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const [renamingFolderId, setRenamingFolderId] = useState<string | null>(null)
  const [renameFolderInput, setRenameFolderInput] = useState('')
  const [deletingFolderId, setDeletingFolderId] = useState<string | null>(null)

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

  const handleCopy = async (id: string, text: string): Promise<void> => {
    await window.api.copyToClipboard(text)
    setCopiedId(id)
    window.setTimeout(() => setCopiedId((cur) => (cur === id ? null : cur)), 1200)
  }

  const handleHistoryContextMenu = (e: React.MouseEvent, entry: ClipboardHistoryEntry): void => {
    e.preventDefault()
    window.api.showClipboardHistoryMenu(entry.id, entry.text)
  }

  const handleDeleteHistory = async (id: string): Promise<void> => {
    await window.api.deleteClipboardHistoryEntry(id)
    reload()
  }

  const handleClearHistory = async (): Promise<void> => {
    await window.api.clearClipboardHistory()
    setClearingHistory(false)
    reload()
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
    setMovingTemplateId(null)
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

  const subfolders = templateFolders.filter((f) => f.parentId === currentFolderId)
  const visibleTemplates = templates.filter((t) => (t.folderId ?? null) === currentFolderId)
  const breadcrumb = folderBreadcrumb(templateFolders, currentFolderId)
  const flatFolders = flattenFolders(templateFolders)

  return (
    <div>
      <div className="clipboard-subtabs">
        <button
          className={subTab === 'history' ? 'active' : ''}
          onClick={() => setSubTab('history')}
        >
          履歴
        </button>
        <button
          className={subTab === 'templates' ? 'active' : ''}
          onClick={() => setSubTab('templates')}
        >
          定型文
        </button>
      </div>

      {subTab === 'history' && (
        <>
          <div className="row clipboard-toolbar">
            <span className="hint">左クリックでコピー、右クリックで定型文登録などの操作ができます。</span>
            {history.length > 0 &&
              (clearingHistory ? (
                <>
                  <span className="hint">履歴をすべて削除しますか?</span>
                  <button className="danger" onClick={handleClearHistory}>
                    削除する
                  </button>
                  <button onClick={() => setClearingHistory(false)}>キャンセル</button>
                </>
              ) : (
                <button className="danger" onClick={() => setClearingHistory(true)}>
                  履歴をクリア
                </button>
              ))}
          </div>

          {history.length === 0 ? (
            <div className="panel">
              <p>クリップボード履歴はまだありません。テキストをコピーすると自動的に記録されます。</p>
            </div>
          ) : (
            <ul className="clip-list">
              {history.map((h) => (
                <li
                  key={h.id}
                  className={`clip-item${copiedId === h.id ? ' clip-item--copied' : ''}`}
                  onClick={() => handleCopy(h.id, h.text)}
                  onContextMenu={(e) => handleHistoryContextMenu(e, h)}
                >
                  <div className="clip-item-text">{truncate(h.text)}</div>
                  <div className="clip-item-meta">
                    <span>{formatTime(h.copiedAt)}</span>
                    <button
                      className="danger clip-item-delete"
                      onClick={(e) => {
                        e.stopPropagation()
                        handleDeleteHistory(h.id)
                      }}
                    >
                      削除
                    </button>
                  </div>
                  {copiedId === h.id && <span className="clip-copied-badge">コピーしました</span>}
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {subTab === 'templates' && (
        <>
          <div className="breadcrumb">
            {currentFolderId === null ? (
              <span className="breadcrumb-current">ルート</span>
            ) : (
              <button onClick={() => setCurrentFolderId(null)}>ルート</button>
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
            <button
              className="new-folder-btn"
              onClick={() => {
                setCreatingFolder((v) => !v)
                setNewFolderName('')
              }}
            >
              + 新規フォルダ
            </button>
          </div>

          {creatingFolder && (
            <div className="row inline-form">
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
              {subfolders.map((f) => (
                <li key={f.id} className="folder-card">
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
                    <>
                      <button className="folder-card-name" onClick={() => setCurrentFolderId(f.id)}>
                        📁 {f.name}
                      </button>
                      <div className="folder-card-actions">
                        <button onClick={() => startRenameFolder(f)}>名前変更</button>
                        <button className="danger" onClick={() => setDeletingFolderId(f.id)}>
                          削除
                        </button>
                      </div>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}

          <div className="row clipboard-toolbar">
            <button className="primary" onClick={() => setCreating((v) => !v)}>
              {creating ? 'キャンセル' : '+ 新規作成'}
            </button>
          </div>

          {creating && (
            <div className="panel clip-edit-form">
              <div className="field">
                <label>ラベル(任意)</label>
                <input value={newLabel} onChange={(e) => setNewLabel(e.target.value)} placeholder="例: 挨拶文" />
              </div>
              <div className="field">
                <label>本文</label>
                <textarea value={newText} onChange={(e) => setNewText(e.target.value)} rows={4} />
              </div>
              <button className="primary" onClick={handleCreateTemplate} disabled={!newText.trim()}>
                保存
              </button>
            </div>
          )}

          {visibleTemplates.length === 0 && !creating && subfolders.length === 0 ? (
            <div className="panel">
              <p>定型文はまだありません。「新規作成」、または履歴を右クリックして登録できます。</p>
            </div>
          ) : (
            <ul className="clip-list">
              {visibleTemplates.map((t) =>
                editingId === t.id ? (
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
                ) : (
                  <li
                    key={t.id}
                    className={`clip-item${copiedId === t.id ? ' clip-item--copied' : ''}`}
                    onClick={() => handleCopy(t.id, t.text)}
                  >
                    {t.label && <div className="clip-item-label">{t.label}</div>}
                    <div className="clip-item-text">{truncate(t.text)}</div>
                    {deletingTemplateId === t.id ? (
                      <div className="clip-item-meta">
                        <span>削除しますか?</span>
                        <button
                          className="danger"
                          onClick={(e) => {
                            e.stopPropagation()
                            handleDeleteTemplate(t.id)
                          }}
                        >
                          削除する
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            setDeletingTemplateId(null)
                          }}
                        >
                          キャンセル
                        </button>
                      </div>
                    ) : (
                      <div className="clip-item-meta">
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            startEdit(t)
                          }}
                        >
                          編集
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            setMovingTemplateId(movingTemplateId === t.id ? null : t.id)
                          }}
                        >
                          移動
                        </button>
                        <button
                          className="danger"
                          onClick={(e) => {
                            e.stopPropagation()
                            setDeletingTemplateId(t.id)
                          }}
                        >
                          削除
                        </button>
                      </div>
                    )}
                    {movingTemplateId === t.id && (
                      <div className="move-picker" onClick={(e) => e.stopPropagation()}>
                        <select
                          defaultValue={t.folderId ?? ''}
                          onChange={(e) => handleMoveTemplate(t.id, e.target.value || null)}
                        >
                          <option value="">ルート</option>
                          {flatFolders.map(({ folder, depth }) => (
                            <option key={folder.id} value={folder.id}>
                              {'　'.repeat(depth)}
                              {folder.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                    {copiedId === t.id && <span className="clip-copied-badge">コピーしました</span>}
                  </li>
                )
              )}
            </ul>
          )}
        </>
      )}
    </div>
  )
}
