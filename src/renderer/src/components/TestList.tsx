import { useEffect, useState } from 'react'
import type { TestCase, TestFolder } from '../../../shared/types'
import { flattenFolders, folderBreadcrumb } from '../folderTree'

interface Props {
  onRun: (testCase: TestCase) => void
}

function formatDate(iso?: string): string {
  if (!iso) return '未実行'
  return new Date(iso).toLocaleString('ja-JP')
}

export default function TestList({ onRun }: Props): React.JSX.Element {
  const [tests, setTests] = useState<TestCase[]>([])
  const [folders, setFolders] = useState<TestFolder[]>([])
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [movingTestId, setMovingTestId] = useState<string | null>(null)

  const [renamingTestId, setRenamingTestId] = useState<string | null>(null)
  const [renameTestInput, setRenameTestInput] = useState('')
  const [deletingTestId, setDeletingTestId] = useState<string | null>(null)

  const [creatingFolder, setCreatingFolder] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const [renamingFolderId, setRenamingFolderId] = useState<string | null>(null)
  const [renameFolderInput, setRenameFolderInput] = useState('')
  const [deletingFolderId, setDeletingFolderId] = useState<string | null>(null)

  const reload = async (): Promise<void> => {
    setLoading(true)
    const [testList, folderList] = await Promise.all([window.api.listTests(), window.api.listFolders()])
    setTests(testList)
    setFolders(folderList)
    setLoading(false)
  }

  useEffect(() => {
    reload()
  }, [])

  const startRenameTest = (t: TestCase): void => {
    setRenamingTestId(t.id)
    setRenameTestInput(t.name)
  }

  const saveRenameTest = async (): Promise<void> => {
    if (!renamingTestId || !renameTestInput.trim()) return
    await window.api.renameTest(renamingTestId, renameTestInput.trim())
    setRenamingTestId(null)
    reload()
  }

  const confirmDeleteTest = async (id: string): Promise<void> => {
    await window.api.deleteTest(id)
    setDeletingTestId(null)
    reload()
  }

  const handleMove = async (t: TestCase, folderId: string | null): Promise<void> => {
    await window.api.moveTest(t.id, folderId)
    setMovingTestId(null)
    reload()
  }

  const saveCreateFolder = async (): Promise<void> => {
    if (!newFolderName.trim()) return
    await window.api.createFolder(newFolderName.trim(), currentFolderId)
    setNewFolderName('')
    setCreatingFolder(false)
    reload()
  }

  const startRenameFolder = (f: TestFolder): void => {
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

  if (loading) return <div className="panel">読み込み中...</div>

  const subfolders = folders.filter((f) => f.parentId === currentFolderId)
  const visibleTests = tests.filter((t) => (t.folderId ?? null) === currentFolderId)

  const breadcrumb = folderBreadcrumb(folders, currentFolderId)

  const flatFolders = flattenFolders(folders)

  return (
    <div>
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

      {subfolders.length === 0 && visibleTests.length === 0 && !creatingFolder ? (
        <div className="panel">
          <p>
            {currentFolderId
              ? 'このフォルダにはテストがありません。'
              : '保存されたテストはまだありません。「テスト作成」からテストを記録してください。'}
          </p>
        </div>
      ) : (
        <>
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

          {visibleTests.length > 0 && (
            <ul className="test-cards">
              {visibleTests.map((t) => (
                <li key={t.id} className="test-card">
                  <div className="test-card-title">{t.name}</div>
                  <div className="test-card-badges">
                    {t.targets.map((target) => (
                      <span key={target.id} className="badge">
                        {target.kind === 'web' ? 'WEB' : 'APP'} {target.label}
                      </span>
                    ))}
                  </div>
                  <div className="test-card-meta">
                    <span>{t.steps.length}ステップ</span>
                    <span>実行: {formatDate(t.lastRunAt)}</span>
                    <span>更新: {formatDate(t.updatedAt)}</span>
                  </div>

                  {renamingTestId === t.id ? (
                    <div className="row inline-form">
                      <input
                        value={renameTestInput}
                        onChange={(e) => setRenameTestInput(e.target.value)}
                        autoFocus
                        onKeyDown={(e) => e.key === 'Enter' && saveRenameTest()}
                      />
                      <button className="primary" onClick={saveRenameTest} disabled={!renameTestInput.trim()}>
                        保存
                      </button>
                      <button onClick={() => setRenamingTestId(null)}>キャンセル</button>
                    </div>
                  ) : deletingTestId === t.id ? (
                    <div className="row inline-form">
                      <span className="hint">「{t.name}」を削除しますか?</span>
                      <button className="danger" onClick={() => confirmDeleteTest(t.id)}>
                        削除する
                      </button>
                      <button onClick={() => setDeletingTestId(null)}>キャンセル</button>
                    </div>
                  ) : (
                    <div className="test-card-actions">
                      <button className="primary" onClick={() => onRun(t)}>
                        実行
                      </button>
                      <button onClick={() => startRenameTest(t)}>名前変更</button>
                      <button onClick={() => setMovingTestId(movingTestId === t.id ? null : t.id)}>移動</button>
                      <button className="danger" onClick={() => setDeletingTestId(t.id)}>
                        削除
                      </button>
                    </div>
                  )}

                  {movingTestId === t.id && (
                    <div className="move-picker">
                      <select
                        defaultValue={t.folderId ?? ''}
                        onChange={(e) => handleMove(t, e.target.value || null)}
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
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  )
}
