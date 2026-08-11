import { useEffect, useState } from 'react'
import type { UpdateStatus } from '../../../shared/types'

export default function UpdateBanner(): React.JSX.Element {
  const [version, setVersion] = useState('')
  const [status, setStatus] = useState<UpdateStatus>({ state: 'idle' })

  useEffect(() => {
    window.api.getAppVersion().then(setVersion)
    const unsubscribe = window.api.onUpdateStatus(setStatus)
    return () => unsubscribe()
  }, [])

  const handleCheck = (): void => {
    void window.api.checkForUpdate()
  }

  const handleInstall = (): void => {
    void window.api.installUpdate()
  }

  return (
    <div className="update-banner">
      <span className="update-version">v{version}</span>

      {status.state === 'checking' && <span className="update-message">アップデートを確認中...</span>}
      {status.state === 'available' && (
        <span className="update-message">新しいバージョン v{status.version} をダウンロード中...</span>
      )}
      {status.state === 'downloading' && (
        <span className="update-message">ダウンロード中... {status.percent}%</span>
      )}
      {status.state === 'downloaded' && (
        <span className="update-message update-message--ready">
          v{status.version} の準備ができました
          <button className="update-install-button" onClick={handleInstall}>
            再起動してインストール
          </button>
        </span>
      )}
      {status.state === 'error' && <span className="update-message update-message--error">アップデート確認に失敗しました</span>}

      {(status.state === 'idle' || status.state === 'not-available') && (
        <button className="update-check-button" onClick={handleCheck}>
          アップデートを確認
        </button>
      )}
    </div>
  )
}
