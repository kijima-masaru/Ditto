import { useEffect, useState } from 'react'
import type { ClipboardHistoryEntry, ClipboardTemplate } from '../../../shared/types'

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
  const [copiedId, setCopiedId] = useState<string | null>(null)

  const [creating, setCreating] = useState(false)
  const [newText, setNewText] = useState('')
  const [newLabel, setNewLabel] = useState('')

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editText, setEditText] = useState('')
  const [editLabel, setEditLabel] = useState('')

  const [clearingHistory, setClearingHistory] = useState(false)
  const [deletingTemplateId, setDeletingTemplateId] = useState<string | null>(null)

  const reload = async (): Promise<void> => {
    const [h, t] = await Promise.all([window.api.listClipboardHistory(), window.api.listClipboardTemplates()])
    setHistory(h)
    setTemplates(t)
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
    await window.api.createClipboardTemplate(newText.trim(), newLabel.trim() || undefined)
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

  return (
    <div>
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

          {templates.length === 0 && !creating ? (
            <div className="panel">
              <p>定型文はまだありません。「新規作成」、または履歴を右クリックして登録できます。</p>
            </div>
          ) : (
            <ul className="clip-list">
              {templates.map((t) =>
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
