import { useEffect, useState } from 'react'
import type { TestCase } from '../../../shared/types'

interface Props {
  onRun: (testCase: TestCase) => void
}

function formatDate(iso?: string): string {
  if (!iso) return '未実行'
  return new Date(iso).toLocaleString('ja-JP')
}

export default function TestList({ onRun }: Props): React.JSX.Element {
  const [tests, setTests] = useState<TestCase[]>([])
  const [loading, setLoading] = useState(true)

  const reload = async (): Promise<void> => {
    setLoading(true)
    const list = await window.api.listTests()
    setTests(list)
    setLoading(false)
  }

  useEffect(() => {
    reload()
  }, [])

  const handleRename = async (t: TestCase): Promise<void> => {
    const name = window.prompt('新しいテスト名', t.name)
    if (!name || name === t.name) return
    await window.api.renameTest(t.id, name)
    reload()
  }

  const handleDelete = async (t: TestCase): Promise<void> => {
    if (!window.confirm(`「${t.name}」を削除しますか?`)) return
    await window.api.deleteTest(t.id)
    reload()
  }

  if (loading) return <div className="panel">読み込み中...</div>

  if (tests.length === 0) {
    return (
      <div className="panel">
        <p>保存されたテストはまだありません。「新規録画」からテストを記録してください。</p>
      </div>
    )
  }

  return (
    <ul className="test-cards">
      {tests.map((t) => (
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
          <div className="test-card-actions">
            <button className="primary" onClick={() => onRun(t)}>
              実行
            </button>
            <button onClick={() => handleRename(t)}>名前変更</button>
            <button className="danger" onClick={() => handleDelete(t)}>
              削除
            </button>
          </div>
        </li>
      ))}
    </ul>
  )
}
