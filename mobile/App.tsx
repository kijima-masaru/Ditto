import { useCallback, useEffect, useRef, useState } from 'react'
import { StatusBar } from 'expo-status-bar'
import { SafeAreaView, StyleSheet } from 'react-native'
import { RemoteClient, type ConnectionStatus } from './src/lib/wsClient'
import type { RemoteMacroItem, RemoteServerMessage, RemoteTemplateItem } from './src/lib/protocol'
import PairingScreen from './src/screens/PairingScreen'
import HomeScreen from './src/screens/HomeScreen'

/**
 * Ditto Remoteのルート。ペアリング済みかどうかでPairingScreen/HomeScreenを出し分ける。
 * WebSocket接続(RemoteClient)は1つだけ生成し、両画面で共有する。
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

export default function App(): React.JSX.Element {
  const [status, setStatus] = useState<ConnectionStatus>('disconnected')
  const [paired, setPaired] = useState(false)
  const [checkingSavedCredentials, setCheckingSavedCredentials] = useState(true)
  const [pairError, setPairError] = useState<string | null>(null)
  const [templates, setTemplates] = useState<RemoteTemplateItem[]>([])
  const [macros, setMacros] = useState<RemoteMacroItem[]>([])

  // RemoteClientのイベントハンドラはコンストラクタに一度だけ渡すため、useCallbackで
  // 参照を固定した上でuseRefの遅延初期化パターンでインスタンスを1つだけ生成する。
  // このコールバックが実際に呼ばれるのは常にRemoteClient生成後(WebSocketイベント経由)
  // のため、client.current は呼び出し時点で必ず non-null になる
  const handleServerMessage = useCallback((msg: RemoteServerMessage): void => {
    const c = client.current!
    switch (msg.type) {
      case 'paired':
        void c.handlePaired(msg.deviceId, msg.sessionKey).then(() => {
          setPaired(true)
          setPairError(null)
          void c.requestItems()
        })
        break
      case 'pairRejected':
        setPairError(pairRejectedMessage(msg.reason))
        break
      case 'authOk':
        setPaired(true)
        void c.requestItems()
        break
      case 'authFailed':
        setPaired(false)
        if (msg.reason === 'unknown-device' || msg.reason === 'revoked') {
          void c.forget()
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
    client
      .current!.connectWithSavedCredentials()
      .catch(() => false)
      .finally(() => setCheckingSavedCredentials(false))
  }, [])

  const handleForget = useCallback((): void => {
    void client.current!.forget().then(() => {
      setPaired(false)
      setTemplates([])
      setMacros([])
    })
  }, [])

  const handleRefresh = useCallback((): void => {
    void client.current!.requestItems()
  }, [])

  if (checkingSavedCredentials) {
    return <SafeAreaView style={styles.root} />
  }

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar style="light" />
      {paired ? (
        <HomeScreen
          client={client.current}
          status={status}
          templates={templates}
          macros={macros}
          onRefresh={handleRefresh}
          onForget={handleForget}
        />
      ) : (
        <PairingScreen client={client.current} errorMessage={pairError} onErrorDismiss={() => setPairError(null)} />
      )}
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#15161f' }
})
