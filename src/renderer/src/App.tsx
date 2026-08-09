import { useCallback, useState } from 'react'
import type { TestCase, TestTarget } from '../../shared/types'
import TargetSelect from './components/TargetSelect'
import Recording from './components/Recording'
import TestList from './components/TestList'
import Playback from './components/Playback'

type View =
  | { name: 'target-select' }
  | { name: 'recording'; targets: TestTarget[] }
  | { name: 'test-list' }
  | { name: 'playback'; testCase: TestCase }

export default function App(): React.JSX.Element {
  const [view, setView] = useState<View>({ name: 'test-list' })
  const [refreshKey, setRefreshKey] = useState(0)

  const goHome = useCallback(() => {
    setRefreshKey((k) => k + 1)
    setView({ name: 'test-list' })
  }, [])

  const isWorkspace = view.name === 'recording' || view.name === 'playback'

  return (
    <div className="app">
      <header className="app-header">
        <h1>自動テストツール</h1>
        <nav>
          <button
            className={view.name === 'test-list' ? 'active' : ''}
            onClick={() => setView({ name: 'test-list' })}
          >
            テスト一覧
          </button>
          <button
            className={view.name === 'target-select' ? 'active' : ''}
            onClick={() => setView({ name: 'target-select' })}
          >
            新規録画
          </button>
        </nav>
      </header>

      <main className={`app-main${isWorkspace ? ' app-main--workspace' : ''}`}>
        {view.name === 'target-select' && (
          <TargetSelect onStart={(targets) => setView({ name: 'recording', targets })} />
        )}

        {view.name === 'recording' && <Recording targets={view.targets} onDone={goHome} onCancel={goHome} />}

        {view.name === 'test-list' && (
          <TestList key={refreshKey} onRun={(testCase) => setView({ name: 'playback', testCase })} />
        )}

        {view.name === 'playback' && <Playback testCase={view.testCase} onDone={goHome} />}
      </main>
    </div>
  )
}
