import { useEffect, useState } from 'react'
import type {
  ClipboardFormatRule,
  ClipboardHistoryEntry,
  ClipboardTemplate,
  ClipboardTemplateFolder,
  ContextMenuItem
} from '../../../shared/types'
import { flattenFolders, folderBreadcrumb } from '../folderTree'
import { useHoverIntent } from '../hooks/useHoverIntent'
import { useDragReorder } from '../hooks/useDragReorder'
import FolderPreviewFlyout from './FolderPreviewFlyout'

type SubTab = 'history' | 'templates' | 'rules'

function truncate(text: string, max = 80): string {
  const oneLine = text.replace(/\s+/g, ' ').trim()
  return oneLine.length > max ? `${oneLine.slice(0, max)}…` : oneLine
}

// 定型文の本文に埋め込める動的変数(main/templateVariables.tsで解決する記法と対応)
const TEMPLATE_VARIABLES: { token: string; desc: string }[] = [
  { token: '{{date}}', desc: '今日の日付' },
  { token: '{{seq}}', desc: '使うたびに増える連番' },
  { token: '{{clipboard}}', desc: '直前のクリップボード内容' }
]

/** 本文入力欄の下に表示する、動的変数を挿入するためのボタン列 */
function TemplateVariableHint({ onInsert }: { onInsert: (token: string) => void }): React.JSX.Element {
  return (
    <div className="template-variable-hint">
      <span className="hint">動的変数(コピー・入力の直前に置き換わります): </span>
      {TEMPLATE_VARIABLES.map((v) => (
        <button
          key={v.token}
          type="button"
          className="variable-chip"
          title={v.desc}
          onClick={() => onInsert(v.token)}
        >
          {v.token}
        </button>
      ))}
    </div>
  )
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

interface Props {
  initialFolderId?: string | null
  initialSubTab?: SubTab
}

export default function ClipboardPanel({ initialFolderId = null, initialSubTab = 'history' }: Props): React.JSX.Element {
  const [subTab, setSubTab] = useState<SubTab>(initialSubTab)
  const [historyQuery, setHistoryQuery] = useState('')
  const [history, setHistory] = useState<ClipboardHistoryEntry[]>([])
  const [templates, setTemplates] = useState<ClipboardTemplate[]>([])
  const [templateFolders, setTemplateFolders] = useState<ClipboardTemplateFolder[]>([])
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(initialFolderId)
  const [copiedId, setCopiedId] = useState<string | null>(null)

  const [creating, setCreating] = useState(false)
  const [newText, setNewText] = useState('')
  const [newLabel, setNewLabel] = useState('')
  const [newTrigger, setNewTrigger] = useState('')
  const [createError, setCreateError] = useState<string | null>(null)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editText, setEditText] = useState('')
  const [editLabel, setEditLabel] = useState('')
  const [editTrigger, setEditTrigger] = useState('')
  const [editError, setEditError] = useState<string | null>(null)

  const [deletingTemplateId, setDeletingTemplateId] = useState<string | null>(null)

  const [creatingFolder, setCreatingFolder] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const [renamingFolderId, setRenamingFolderId] = useState<string | null>(null)
  const [renameFolderInput, setRenameFolderInput] = useState('')
  const [deletingFolderId, setDeletingFolderId] = useState<string | null>(null)

  const [formatRules, setFormatRules] = useState<ClipboardFormatRule[]>([])
  const [creatingRule, setCreatingRule] = useState(false)
  const [newRuleLabel, setNewRuleLabel] = useState('')
  const [newRuleFind, setNewRuleFind] = useState('')
  const [newRuleReplace, setNewRuleReplace] = useState('')
  const [newRuleIsRegex, setNewRuleIsRegex] = useState(false)
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null)
  const [editRuleLabel, setEditRuleLabel] = useState('')
  const [editRuleFind, setEditRuleFind] = useState('')
  const [editRuleReplace, setEditRuleReplace] = useState('')
  const [editRuleIsRegex, setEditRuleIsRegex] = useState(false)
  const [deletingRuleId, setDeletingRuleId] = useState<string | null>(null)

  const folderPreview = useHoverIntent(300, 200, { respectPreviewWindows: true })

  const reload = async (): Promise<void> => {
    const [h, t, f, r] = await Promise.all([
      window.api.listClipboardHistory(),
      window.api.listClipboardTemplates(),
      window.api.listClipboardTemplateFolders(),
      window.api.listClipboardFormatRules()
    ])
    setHistory(h)
    setTemplates(t)
    setTemplateFolders(f)
    setFormatRules(r)
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

  // 定型文専用のコピー処理。{{date}}/{{seq}}/{{clipboard}}等の動的変数をmain側で
  // その場で解決してからコピーする(handleCopyは履歴の生テキスト等にも使う汎用処理のため、
  // 定型文の本文をそのまま渡すと変数記法が展開されずコピーされてしまう)
  const handleCopyTemplate = async (id: string): Promise<void> => {
    await window.api.copyTemplateToClipboard(id)
    setCopiedId(id)
    window.setTimeout(() => setCopiedId((cur) => (cur === id ? null : cur)), 1200)
  }

  const handleCopyImage = async (id: string, imageDataUrl: string): Promise<void> => {
    if (!imageDataUrl) return
    await window.api.copyImageToClipboard(imageDataUrl)
    setCopiedId(id)
    window.setTimeout(() => setCopiedId((cur) => (cur === id ? null : cur)), 1200)
  }

  const handleHistoryClick = (entry: ClipboardHistoryEntry): void => {
    if (entry.type === 'image') handleCopyImage(entry.id, entry.imageDataUrl ?? '')
    else handleCopy(entry.id, entry.text)
  }

  const handleHistoryContextMenu = (e: React.MouseEvent, entry: ClipboardHistoryEntry): void => {
    e.preventDefault()
    if (entry.type === 'image') window.api.showClipboardImageHistoryMenu(entry.id)
    else window.api.showClipboardHistoryMenu(entry.id, entry.text)
  }

  const handleCreateTemplate = async (): Promise<void> => {
    if (!newText.trim()) return
    setCreateError(null)
    try {
      await window.api.createClipboardTemplate(
        newText.trim(),
        newLabel.trim() || undefined,
        currentFolderId,
        newTrigger.trim() || undefined
      )
      setNewText('')
      setNewLabel('')
      setNewTrigger('')
      setCreating(false)
      reload()
    } catch (e) {
      setCreateError((e as Error).message)
    }
  }

  const startEdit = (t: ClipboardTemplate): void => {
    // フォルダのホバープレビュー上の定型文を編集する場合、そのフォルダを開いていない
    // 状態でeditingIdだけ設定しても編集フォームは表示されない(表示中の一覧に
    // 含まれないため)。対象の定型文が属するフォルダへ遷移してから編集状態にする
    setCurrentFolderId(t.folderId ?? null)
    setEditingId(t.id)
    setEditText(t.text)
    setEditLabel(t.label ?? '')
    setEditTrigger(t.trigger ?? '')
    setEditError(null)
  }

  const handleSaveEdit = async (): Promise<void> => {
    if (!editingId || !editText.trim()) return
    setEditError(null)
    try {
      await window.api.updateClipboardTemplate(
        editingId,
        editText.trim(),
        editLabel.trim() || undefined,
        editTrigger.trim() || undefined
      )
      setEditingId(null)
      reload()
    } catch (e) {
      setEditError((e as Error).message)
    }
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

  const handleCreateRule = async (): Promise<void> => {
    if (!newRuleFind) return
    await window.api.createClipboardFormatRule(newRuleFind, newRuleIsRegex, newRuleReplace, newRuleLabel.trim() || undefined)
    setNewRuleLabel('')
    setNewRuleFind('')
    setNewRuleReplace('')
    setNewRuleIsRegex(false)
    setCreatingRule(false)
    reload()
  }

  const startEditRule = (r: ClipboardFormatRule): void => {
    setEditingRuleId(r.id)
    setEditRuleLabel(r.label ?? '')
    setEditRuleFind(r.find)
    setEditRuleReplace(r.replace)
    setEditRuleIsRegex(r.isRegex)
  }

  const handleSaveEditRule = async (): Promise<void> => {
    if (!editingRuleId || !editRuleFind) return
    await window.api.updateClipboardFormatRule(editingRuleId, {
      find: editRuleFind,
      isRegex: editRuleIsRegex,
      replace: editRuleReplace,
      label: editRuleLabel.trim() || undefined
    })
    setEditingRuleId(null)
    reload()
  }

  const handleToggleRuleEnabled = async (r: ClipboardFormatRule, enabled: boolean): Promise<void> => {
    await window.api.setClipboardFormatRuleEnabled(r.id, enabled)
    reload()
  }

  const handleDeleteRule = async (id: string): Promise<void> => {
    await window.api.deleteClipboardFormatRule(id)
    setDeletingRuleId(null)
    reload()
  }

  const handleReorderRules = async (orderedIds: string[]): Promise<void> => {
    await window.api.reorderClipboardFormatRules(orderedIds)
    reload()
  }

  // 画像エントリはテキストを持たないため、検索はテキストエントリのみを対象にする
  const trimmedHistoryQuery = historyQuery.trim().toLowerCase()
  const filteredHistory = trimmedHistoryQuery
    ? history.filter((h) => h.type === 'text' && h.text.toLowerCase().includes(trimmedHistoryQuery))
    : history

  const subfolders = templateFolders.filter((f) => f.parentId === currentFolderId)
  const visibleTemplates = templates.filter((t) => (t.folderId ?? null) === currentFolderId)
  const breadcrumb = folderBreadcrumb(templateFolders, currentFolderId)
  const flatFolders = flattenFolders(templateFolders)
  const currentFolder = templateFolders.find((f) => f.id === currentFolderId) ?? null
  const folderDrag = useDragReorder(subfolders, (f) => f.id, handleReorderFolders)
  const templateDrag = useDragReorder(visibleTemplates, (t) => t.id, handleReorderTemplates)
  const ruleDrag = useDragReorder(formatRules, (r) => r.id, handleReorderRules)

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
      setNewTrigger('')
      setCreateError(null)
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
      setNewTrigger('')
      setCreateError(null)
    } else if (result === 'rename') startRenameFolder(f)
    else if (result === 'delete') setDeletingFolderId(f.id)
    else if (result === 'move-up' || result === 'move-down') {
      const next = swapOrder(ids, f.id, result === 'move-up' ? 'up' : 'down')
      if (next) handleReorderFolders(next)
    }
  }

  const handleTogglePinTemplate = async (t: ClipboardTemplate): Promise<void> => {
    await window.api.setClipboardTemplatePinned(t.id, !t.pinned)
    reload()
  }

  const handleTemplateContextMenu = async (e: React.MouseEvent, t: ClipboardTemplate): Promise<void> => {
    e.preventDefault()
    e.stopPropagation()
    const ids = visibleTemplates.map((vt) => vt.id)
    const index = ids.indexOf(t.id)
    const result = await window.api.showContextMenu([
      { id: 'edit', label: '編集' },
      { id: 'pin', label: t.pinned ? 'コマンドパレットの固定を解除' : 'コマンドパレットに固定' },
      { id: 'move', label: '移動', submenu: buildMoveSubmenu(flatFolders) },
      { id: 'move-up', label: '上に移動', enabled: index > 0 },
      { id: 'move-down', label: '下に移動', enabled: index < ids.length - 1 },
      { id: 'sep', type: 'separator' },
      { id: 'delete', label: '削除' }
    ])
    if (result === 'edit') startEdit(t)
    else if (result === 'pin') void handleTogglePinTemplate(t)
    else if (result === 'delete') setDeletingTemplateId(t.id)
    else if (result?.startsWith('move:')) {
      const dest = result.slice('move:'.length)
      handleMoveTemplate(t.id, dest === 'root' ? null : dest)
    } else if (result === 'move-up' || result === 'move-down') {
      const next = swapOrder(ids, t.id, result === 'move-up' ? 'up' : 'down')
      if (next) handleReorderTemplates(next)
    }
  }

  const handleRuleAreaContextMenu = async (e: React.MouseEvent): Promise<void> => {
    e.preventDefault()
    const result = await window.api.showContextMenu([{ id: 'create-rule', label: '新規ルールを作成' }])
    if (result === 'create-rule') {
      setCreatingRule(true)
      setNewRuleLabel('')
      setNewRuleFind('')
      setNewRuleReplace('')
      setNewRuleIsRegex(false)
    }
  }

  const handleRuleContextMenu = async (e: React.MouseEvent, r: ClipboardFormatRule): Promise<void> => {
    e.preventDefault()
    e.stopPropagation()
    const ids = formatRules.map((fr) => fr.id)
    const index = ids.indexOf(r.id)
    const result = await window.api.showContextMenu([
      { id: 'edit', label: '編集' },
      { id: 'move-up', label: '上に移動', enabled: index > 0 },
      { id: 'move-down', label: '下に移動', enabled: index < ids.length - 1 },
      { id: 'sep', type: 'separator' },
      { id: 'delete', label: '削除' }
    ])
    if (result === 'edit') startEditRule(r)
    else if (result === 'delete') setDeletingRuleId(r.id)
    else if (result === 'move-up' || result === 'move-down') {
      const next = swapOrder(ids, r.id, result === 'move-up' ? 'up' : 'down')
      if (next) handleReorderRules(next)
    }
  }

  return (
    <div className="clipboard-panel">
      <div className="clipboard-subtabs">
        <button className={subTab === 'history' ? 'active' : ''} onClick={() => setSubTab('history')}>
          履歴
        </button>
        <button className={subTab === 'templates' ? 'active' : ''} onClick={() => setSubTab('templates')}>
          定型文
        </button>
      </div>

      {subTab === 'history' && (
        <>
          <div className="clipboard-history-toolbar">
            <input
              value={historyQuery}
              onChange={(e) => setHistoryQuery(e.target.value)}
              placeholder="履歴を検索"
            />
            <button className="subtab-icon-btn" onClick={() => setSubTab('rules')} title="整形ルール">
              ✎
            </button>
          </div>

          {history.length === 0 ? (
            <div className="panel">
              <p>
                クリップボード履歴はまだありません。
                <br />
                テキストや画像をコピーすると自動的に記録されます。
              </p>
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
                  onClick={() => handleHistoryClick(h)}
                  onContextMenu={(e) => handleHistoryContextMenu(e, h)}
                >
                  {h.type === 'image' ? (
                    <div className="clip-item-image-row">
                      <img className="clip-item-thumb" src={h.imageDataUrl} alt="" />
                      <div className="clip-item-image-meta">
                        <span className="clip-item-image-label">画像</span>
                      </div>
                    </div>
                  ) : (
                    <div className="clip-item-text">{truncate(h.text)}</div>
                  )}
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
                            onClick={() => handleCopyTemplate(t.id)}
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
                <TemplateVariableHint onInsert={(token) => setNewText((v) => v + token)} />
              </div>
              <div className="field">
                <label>トリガー(任意。設定すると、どのアプリでも直接入力するだけで本文へ自動展開されます)</label>
                <input
                  value={newTrigger}
                  onChange={(e) => setNewTrigger(e.target.value)}
                  placeholder="例: ;greeting"
                />
              </div>
              {createError && <p className="error">{createError}</p>}
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
                      <TemplateVariableHint onInsert={(token) => setEditText((v) => v + token)} />
                    </div>
                    <div className="field">
                      <label>トリガー(任意。設定すると、どのアプリでも直接入力するだけで本文へ自動展開されます)</label>
                      <input
                        value={editTrigger}
                        onChange={(e) => setEditTrigger(e.target.value)}
                        placeholder="例: ;greeting"
                      />
                    </div>
                    {editError && <p className="error">{editError}</p>}
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
                    onClick={() => handleCopyTemplate(t.id)}
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
                    {(t.label || t.trigger || t.pinned) && (
                      <div className="clip-item-header">
                        {t.label && <div className="clip-item-label">{t.label}</div>}
                        {t.trigger && <div className="clip-item-trigger">{t.trigger}</div>}
                        {t.pinned && <span className="clip-item-pin" title="コマンドパレットに固定">📌</span>}
                      </div>
                    )}
                    <div className="clip-item-text">{truncate(t.text)}</div>
                    {copiedId === t.id && <span className="clip-copied-badge">コピーしました</span>}
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}

      {subTab === 'rules' && (
        <div className="folder-browser" onContextMenu={handleRuleAreaContextMenu}>
          <p className="hint hint--emphasis">
            コピーしたテキストへ上から順に自動で適用される置換ルールです。実際にコピーした内容自体が書き換わります。
          </p>

          {creatingRule && (
            <div className="panel clip-edit-form" onContextMenu={(e) => e.stopPropagation()}>
              <div className="field">
                <label>ラベル(任意)</label>
                <input value={newRuleLabel} onChange={(e) => setNewRuleLabel(e.target.value)} placeholder="例: 全角スペースを削除" />
              </div>
              <div className="field">
                <label>検索文字列</label>
                <input value={newRuleFind} onChange={(e) => setNewRuleFind(e.target.value)} autoFocus />
              </div>
              <div className="field-checkbox-row">
                <label>
                  <input type="checkbox" checked={newRuleIsRegex} onChange={(e) => setNewRuleIsRegex(e.target.checked)} />
                  正規表現として扱う
                </label>
              </div>
              <div className="field">
                <label>置換後の文字列(空欄なら削除)</label>
                <input value={newRuleReplace} onChange={(e) => setNewRuleReplace(e.target.value)} />
              </div>
              <div className="row">
                <button className="primary" onClick={handleCreateRule} disabled={!newRuleFind}>
                  保存
                </button>
                <button onClick={() => setCreatingRule(false)}>キャンセル</button>
              </div>
            </div>
          )}

          {formatRules.length === 0 && !creatingRule ? (
            <div className="panel">
              <p>整形ルールはまだありません。</p>
              <p>右クリックして「新規ルールを作成」から追加できます。</p>
            </div>
          ) : (
            <ul className="clip-list">
              {ruleDrag.orderedItems.map((r) => {
                const isEditingRule = editingRuleId === r.id || deletingRuleId === r.id
                const drag = isEditingRule ? null : ruleDrag.getHandlers(r)
                return editingRuleId === r.id ? (
                  <li key={r.id} className="panel clip-edit-form">
                    <div className="field">
                      <label>ラベル(任意)</label>
                      <input value={editRuleLabel} onChange={(e) => setEditRuleLabel(e.target.value)} />
                    </div>
                    <div className="field">
                      <label>検索文字列</label>
                      <input value={editRuleFind} onChange={(e) => setEditRuleFind(e.target.value)} />
                    </div>
                    <div className="field-checkbox-row">
                      <label>
                        <input
                          type="checkbox"
                          checked={editRuleIsRegex}
                          onChange={(e) => setEditRuleIsRegex(e.target.checked)}
                        />
                        正規表現として扱う
                      </label>
                    </div>
                    <div className="field">
                      <label>置換後の文字列(空欄なら削除)</label>
                      <input value={editRuleReplace} onChange={(e) => setEditRuleReplace(e.target.value)} />
                    </div>
                    <div className="row">
                      <button className="primary" onClick={handleSaveEditRule} disabled={!editRuleFind}>
                        保存
                      </button>
                      <button onClick={() => setEditingRuleId(null)}>キャンセル</button>
                    </div>
                  </li>
                ) : deletingRuleId === r.id ? (
                  <li key={r.id} className="row inline-form">
                    <span className="hint">削除しますか?</span>
                    <button className="danger" onClick={() => handleDeleteRule(r.id)}>
                      削除する
                    </button>
                    <button onClick={() => setDeletingRuleId(null)}>キャンセル</button>
                  </li>
                ) : (
                  <li
                    key={r.id}
                    className={`clip-item${drag ? ` ${drag.className}` : ''}`}
                    onContextMenu={(e) => handleRuleContextMenu(e, r)}
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
                    <div className="clip-item-row">
                      <div className="clip-item-rule-summary">
                        {r.label && <div className="clip-item-label">{r.label}</div>}
                        <div className="clip-item-text">
                          {r.isRegex ? `/${r.find}/` : r.find} → {r.replace || '(削除)'}
                        </div>
                      </div>
                      <label className="theme-toggle-switch" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={r.enabled}
                          onChange={(e) => handleToggleRuleEnabled(r, e.target.checked)}
                        />
                        <span className="theme-toggle-slider" />
                      </label>
                    </div>
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
