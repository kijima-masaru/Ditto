import { useEffect, useState } from 'react'
import type { TestCase } from '../../../shared/types'

interface Props {
  onRun: (testCase: TestCase) => void
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
    <div className="panel">
      <h2>保存済みテスト</h2>
      <table className="test-table">
        <thead>
          <tr>
            <th>名前</th>
            <th>対象</th>
            <th>ステップ数</th>
            <th>更新日時</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {tests.map((t) => (
            <tr key={t.id}>
              <td>{t.name}</td>
              <td>
                {t.targets.map((target) => (
                  <span key={target.id} className="badge" style={{ marginRight: 4 }}>
                    {target.kind === 'web' ? 'WEB' : 'APP'} {target.label}
                  </span>
                ))}
              </td>
              <td>{t.steps.length}</td>
              <td>{new Date(t.updatedAt).toLocaleString('ja-JP')}</td>
              <td className="row">
                <button className="primary" onClick={() => onRun(t)}>
                  実行
                </button>
                <button onClick={() => handleRename(t)}>名前変更</button>
                <button className="danger" onClick={() => handleDelete(t)}>
                  削除
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
