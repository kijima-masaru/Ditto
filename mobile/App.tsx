import { useCallback, useEffect, useRef, useState } from 'react'
import { StatusBar } from 'expo-status-bar'
import { SafeAreaView, StyleSheet } from 'react-native'
import { RemoteClient, type ConnectionStatus } from './src/lib/wsClient'
import type { RemoteMacroItem, RemoteServerMessage, RemoteTemplateItem } from './src/lib/protocol'
import { createDefaultLayout, loadLayout, saveLayout, type ButtonLayout } from './src/lib/buttonConfig'
import HomeScreen from './src/screens/HomeScreen'
import ConnectModal from './src/components/ConnectModal'
import SettingsModal from './src/components/SettingsModal'
import { colors } from './src/theme'

/**
 * Ditto Remoteのルート。ホーム画面(ボタングリッド)を常に表示し、接続と設定は
 * ヘッダーのアイコンから開くモーダルで行う。WebSocket接続(RemoteClient)は
 * 1つだけ生成して各画面で共有する。
 */

function pairRejectedMessage(reason: Extract<RemoteServerMessage, { type: 'pairRejected' }>['reason']): string {
  switch (reason) {
    case 'invalid-or-expired-code':
      return 'コードが正しくないか、期限切れです。PC側で表示し直してください。'
    case 'denied-by-user':
      return 'PC側で連携が拒否されました。'
    case 'timeout':
      return 'PC側での応答がありませんでした。'
    case 'rate-limited':
      return '試行回数が多すぎます。しばらく待ってから再度お試しください。'
  }
}

function authFailedMessage(reason: Extract<RemoteServerMessage, { type: 'authFailed' }>['reason']): string | null {
  switch (reason) {
    case 'unknown-device':
    case 'revoked':
      return 'PC側で連携が解除されました。もう一度ペアリングしてください。'
    case 'decrypt-failed':
      return '通信の復号に失敗しました。もう一度ペアリングしてください。'
    case 'rate-limited':
      return '試行回数が多すぎます。しばらく待ってから再度お試しください。'
    case 'stale-counter':
      // 認証情報自体は有効なので再ペアリングは不要。接続し直せば復帰する
      return '接続順序の不整合を検出しました。アプリを再起動して接続し直してください。'
  }
}

export default function App(): React.JSX.Element {
  const [status, setStatus] = useState<ConnectionStatus>('disconnected')
  const [pairError, setPairError] = useState<string | null>(null)
  const [templates, setTemplates] = useState<RemoteTemplateItem[]>([])
  const [macros, setMacros] = useState<RemoteMacroItem[]>([])
  const [layout, setLayout] = useState<ButtonLayout>(createDefaultLayout)
  const [connectOpen, setConnectOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)

  // RemoteClientのイベントハンドラはコンストラクタに一度だけ渡すため、useCallbackで
  // 参照を固定した上でuseRefの遅延初期化パターンでインスタンスを1つだけ生成する。
  // このコールバックが実際に呼ばれるのは常にRemoteClient生成後(WebSocketイベント経由)
  // のため、client.current は呼び出し時点で必ず non-null になる
  const handleServerMessage = useCallback((msg: RemoteServerMessage): void => {
    const c = client.current!
    switch (msg.type) {
      case 'paired':
        void c.handlePaired(msg.deviceId, msg.sessionKey).then(() => {
          setPairError(null)
          setConnectOpen(false) // 接続できたらモーダルを閉じてホームに戻す
          void c.requestItems()
        })
        break
      case 'pairRejected':
        setPairError(pairRejectedMessage(msg.reason))
        break
      case 'authOk':
        void c.requestItems()
        break
      case 'authFailed':
        setPairError(authFailedMessage(msg.reason))
        if (msg.reason === 'unknown-device' || msg.reason === 'revoked') {
          void c.forget()
          setTemplates([])
          setMacros([])
          setConnectOpen(true) // 再ペアリングが必要なので接続モーダルを開く
        }
        break
      case 'items':
        setTemplates(msg.templates)
        setMacros(msg.macros)
        break
      case 'triggerResult':
      case 'pairPending':
      case 'error':
        break
    }
  }, [])

  const client = useRef<RemoteClient | null>(null)
  if (!client.current) {
    client.current = new RemoteClient({ onStatusChange: setStatus, onServerMessage: handleServerMessage })
  }

  useEffect(() => {
    void loadLayout().then(setLayout)
    client.current!.connectWithSavedCredentials().catch(() => false)
  }, [])

  const handleLayoutChange = useCallback((next: ButtonLayout): void => {
    setLayout(next)
    void saveLayout(next)
  }, [])

  const handleForget = useCallback((): void => {
    void client.current!.forget().then(() => {
      setTemplates([])
      setMacros([])
      setSettingsOpen(false)
      setConnectOpen(true)
    })
  }, [])

  const handleOpenSettings = useCallback((): void => {
    // 割り当て候補を最新にしてから開く
    void client.current!.requestItems().catch(() => undefined)
    setSettingsOpen(true)
  }, [])

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar style="light" />
      <HomeScreen
        client={client.current}
        status={status}
        layout={layout}
        templates={templates}
        macros={macros}
        onOpenConnect={() => setConnectOpen(true)}
        onOpenSettings={handleOpenSettings}
      />
      <ConnectModal
        visible={connectOpen}
        client={client.current}
        errorMessage={pairError}
        onErrorDismiss={() => setPairError(null)}
        onClose={() => setConnectOpen(false)}
      />
      <SettingsModal
        visible={settingsOpen}
        layout={layout}
        templates={templates}
        macros={macros}
        connected={status === 'connected'}
        onChange={handleLayoutChange}
        onClose={() => setSettingsOpen(false)}
        onForget={handleForget}
      />
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg }
})
