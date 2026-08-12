import { useEffect, useState } from 'react'
import type { ContextMenuItem, TestCase, TestFolder } from '../../../shared/types'
import { flattenFolders, folderBreadcrumb } from '../folderTree'

interface Props {
  onRun: (testCase: TestCase) => void
  onCreateTest: () => void
}

function buildMoveSubmenu(flatFolders: { folder: TestFolder; depth: number }[]): ContextMenuItem[] {
  const items: ContextMenuItem[] = [{ id: 'move:root', label: 'home' }]
  for (const { folder, depth } of flatFolders) {
    items.push({ id: `move:${folder.id}`, label: `${'　'.repeat(depth)}${folder.name}` })
  }
  return items
}

export default function TestList({ onRun, onCreateTest }: Props): React.JSX.Element {
  const [tests, setTests] = useState<TestCase[]>([])
  const [folders, setFolders] = useState<TestFolder[]>([])
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

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

  const handleMoveTest = async (id: string, folderId: string | null): Promise<void> => {
    await window.api.moveTest(id, folderId)
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

  const flatFolders = flattenFolders(folders)
  const breadcrumb = folderBreadcrumb(folders, currentFolderId)
  const currentFolder = folders.find((f) => f.id === currentFolderId) ?? null

  const handleAreaContextMenu = async (e: React.MouseEvent): Promise<void> => {
    e.preventDefault()
    const items: ContextMenuItem[] = [
      { id: 'create-folder', label: '新規フォルダを作成' },
      { id: 'create-test', label: '新規テストを作成' }
    ]
    if (currentFolderId !== null) {
      items.push({ id: 'sep1', type: 'separator' })
      items.push({ id: 'go-up', label: '上の階層に戻る' })
    }
    const result = await window.api.showContextMenu(items)
    if (result === 'create-folder') {
      setCreatingFolder(true)
      setNewFolderName('')
    } else if (result === 'create-test') {
      onCreateTest()
    } else if (result === 'go-up') {
      setCurrentFolderId(currentFolder?.parentId ?? null)
    }
  }

  const handleFolderContextMenu = async (e: React.MouseEvent, f: TestFolder): Promise<void> => {
    e.preventDefault()
    e.stopPropagation()
    const result = await window.api.showContextMenu([
      { id: 'rename', label: '名前変更' },
      { id: 'delete', label: '削除' }
    ])
    if (result === 'rename') startRenameFolder(f)
    else if (result === 'delete') setDeletingFolderId(f.id)
  }

  const handleTestContextMenu = async (e: React.MouseEvent, t: TestCase): Promise<void> => {
    e.preventDefault()
    e.stopPropagation()
    const result = await window.api.showContextMenu([
      { id: 'run', label: '実行' },
      { id: 'rename', label: '名前変更' },
      { id: 'move', label: '移動', submenu: buildMoveSubmenu(flatFolders) },
      { id: 'sep', type: 'separator' },
      { id: 'delete', label: '削除' }
    ])
    if (result === 'run') onRun(t)
    else if (result === 'rename') startRenameTest(t)
    else if (result === 'delete') setDeletingTestId(t.id)
    else if (result?.startsWith('move:')) {
      const dest = result.slice('move:'.length)
      handleMoveTest(t.id, dest === 'root' ? null : dest)
    }
  }

  if (loading) return <div className="panel">読み込み中...</div>

  const subfolders = folders.filter((f) => f.parentId === currentFolderId)
  const visibleTests = tests.filter((t) => (t.folderId ?? null) === currentFolderId)

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

      {subfolders.length === 0 && visibleTests.length === 0 && !creatingFolder ? (
        <div className="panel">
          {currentFolderId ? (
            <p>このフォルダにはテストがありません。</p>
          ) : (
            <>
              <p>保存されたテストケースはまだありません。</p>
              <p>右クリックして「新規テストを作成」から記録してください。</p>
            </>
          )}
        </div>
      ) : (
        <>
          {subfolders.length > 0 && (
            <ul className="folder-cards">
              {subfolders.map((f) => (
                <li key={f.id} className="folder-card" onContextMenu={(e) => handleFolderContextMenu(e, f)}>
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
                </li>
              ))}
            </ul>
          )}

          {visibleTests.length > 0 && (
            <ul className="test-name-list">
              {visibleTests.map((t) => (
                <li key={t.id}>
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
                    <div className="test-name-item" onContextMenu={(e) => handleTestContextMenu(e, t)}>
                      {t.name}
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
