import { useCallback, useEffect, useRef, useState } from 'react'
import { StatusBar } from 'expo-status-bar'
import { SafeAreaView, StyleSheet } from 'react-native'
import { RemoteClient, type ConnectionStatus } from './src/lib/wsClient'
import type { RemoteMacroItem, RemoteServerMessage, RemoteTemplateItem } from './src/lib/protocol'
import { clearLayout, loadLayout, saveLayout, type LayoutConfig } from './src/lib/layoutStorage'
import HomeScreen from './src/screens/HomeScreen'
import ConnectModal from './src/components/ConnectModal'
import { colors } from './src/theme'

/**
 * Ditto Remoteのルート。画面はホーム(ボタングリッド)1枚だけで、ペアリングはヘッダーの
 * 接続アイコンから開くモーダルで行う。WebSocket接続(RemoteClient)は1つだけ生成して共有する。
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
  const [paired, setPaired] = useState(false)
  const [checkingSavedCredentials, setCheckingSavedCredentials] = useState(true)
  const [pairError, setPairError] = useState<string | null>(null)
  const [connectOpen, setConnectOpen] = useState(false)
  const [templates, setTemplates] = useState<RemoteTemplateItem[]>([])
  const [macros, setMacros] = useState<RemoteMacroItem[]>([])
  // nullは自動配置(PC側のピン留めをそのまま並べる)。設定モードでカスタマイズすると値が入る
  const [layout, setLayout] = useState<LayoutConfig | null>(null)

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
          setConnectOpen(false) // 成立したらモーダルは用済み
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
        setPairError(authFailedMessage(msg.reason))
        if (msg.reason === 'unknown-device' || msg.reason === 'revoked') {
          void c.forget()
          setConnectOpen(true) // 再ペアリングが要るので接続モーダルを出す
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
  }, [])

  useEffect(() => {
    client
      .current!.connectWithSavedCredentials()
      .then((restored) => {
        // 認証情報が無い=初回起動。何もせずに空のグリッドを見せても操作しようがないため接続へ促す
        if (!restored) setConnectOpen(true)
        return restored
      })
      .catch(() => false)
      .finally(() => setCheckingSavedCredentials(false))
  }, [])

  const handleForget = useCallback((): void => {
    void client.current!.forget().then(() => {
      setPaired(false)
      setTemplates([])
      setMacros([])
      setConnectOpen(true)
    })
  }, [])

  const handleRefresh = useCallback((): void => {
    void client.current!.requestItems()
  }, [])

  const handleChangeLayout = useCallback((next: LayoutConfig | null): void => {
    setLayout(next)
    // 保存の失敗(secure-storeの容量超過など)で操作が巻き戻ると分かりにくいため、
    // 画面の状態は先に更新し、永続化は後追いで行う
    void (next ? saveLayout(next) : clearLayout())
  }, [])

  if (checkingSavedCredentials) {
    return <SafeAreaView style={styles.root} />
  }

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar style="light" />
      <HomeScreen
        client={client.current}
        status={status}
        templates={templates}
        macros={macros}
        layout={layout}
        onChangeLayout={handleChangeLayout}
        onRefresh={handleRefresh}
        onForget={handleForget}
        onOpenConnect={() => setConnectOpen(true)}
      />
      <ConnectModal
        visible={connectOpen}
        client={client.current}
        errorMessage={pairError}
        onErrorDismiss={() => setPairError(null)}
        onClose={() => setConnectOpen(false)}
      />
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg }
})
