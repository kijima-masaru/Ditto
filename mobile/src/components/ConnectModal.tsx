import { useEffect, useState } from 'react'
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from 'react-native'
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera'
import type { RemoteClient } from '../lib/wsClient'
import type { PairingQrPayload } from '../lib/protocol'
import { colors } from '../theme'

/**
 * 接続モーダル。ヘッダーの接続アイコンから開き、PC側のDitto Remoteへペアリング要求を出す。
 * 手段はQRコード読み取りとコード入力の2つ(USB接続(`adb reverse`)は将来必要になったら戻す)。
 *
 * コード入力にPCのIPアドレスを併記しているのは、6桁コードだけでは接続先が分からないため。
 * QRの中身({ips, port, code})にはIPが含まれるので、QRで読めばIPの入力は要らない。
 */

interface Props {
  visible: boolean
  client: RemoteClient
  /** ペアリング拒否などのエラー。App.tsxがpairRejected/authFailedから組み立てて渡す */
  errorMessage: string | null
  onErrorDismiss: () => void
  onClose: () => void
}

const DEFAULT_PORT = '58211'

export default function ConnectModal({ visible, client, errorMessage, onErrorDismiss, onClose }: Props): React.JSX.Element {
  const [permission, requestPermission] = useCameraPermissions()
  const [scanned, setScanned] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [host, setHost] = useState('')
  const [port, setPort] = useState(DEFAULT_PORT)
  const [code, setCode] = useState('')
  const [deviceName, setDeviceName] = useState(Platform.OS === 'ios' ? 'iPhone' : 'Androidスマホ')

  // client.startPairing()は「pairメッセージを送信し終えた」時点で解決するため、PC側に
  // 拒否された場合はここでは何も起きない。拒否はApp.tsxがerrorMessageとして渡してくるので、
  // それを合図に待機表示を解除する。これが無いと承認待ちスピナーから永久に戻れない
  useEffect(() => {
    if (errorMessage) {
      setConnecting(false)
      setScanned(false)
    }
  }, [errorMessage])

  // 閉じて開き直したときに前回の待機状態が残らないようにする
  useEffect(() => {
    if (!visible) {
      setConnecting(false)
      setScanned(false)
    }
  }, [visible])

  const startPairing = async (targetHost: string, targetPort: number, targetCode: string): Promise<void> => {
    onErrorDismiss() // 前回のエラーを消しておかないと、上のeffectが即座に待機表示を解除してしまう
    setConnecting(true)
    try {
      await client.startPairing(targetHost, targetPort, targetCode, deviceName.trim() || 'スマホ')
    } catch {
      setConnecting(false)
      setScanned(false)
    }
  }

  const handleBarcodeScanned = (result: BarcodeScanningResult): void => {
    if (scanned || connecting) return
    setScanned(true)
    try {
      const payload = JSON.parse(result.data) as PairingQrPayload
      const targetHost = payload.ips[0]
      if (!targetHost || !payload.port || !payload.code) throw new Error('invalid qr')
      void startPairing(targetHost, payload.port, payload.code)
    } catch {
      setScanned(false)
    }
  }

  const handleCodeSubmit = (): void => {
    const portNumber = Number(port)
    if (!host.trim() || !Number.isFinite(portNumber) || code.trim().length !== 6) return
    void startPairing(host.trim(), portNumber, code.trim())
  }

  const codeSubmitDisabled = !host.trim() || code.trim().length !== 6

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.centerer}>
          <View style={styles.panel}>
            <View style={styles.header}>
              <Text style={styles.title}>PCと接続</Text>
              <Pressable onPress={onClose} hitSlop={10} accessibilityLabel="閉じる">
                <Text style={styles.close}>✕</Text>
              </Pressable>
            </View>

            {connecting ? (
              <View style={styles.waiting}>
                <ActivityIndicator size="large" color={colors.accent} />
                <Text style={styles.waitingText}>PC側の承認を待っています...</Text>
                <Text style={styles.hint}>PC側で表示される確認ダイアログで「許可」を押してください</Text>
              </View>
            ) : (
              <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
                {errorMessage && (
                  <Pressable style={styles.errorBanner} onPress={onErrorDismiss}>
                    <Text style={styles.errorText}>{errorMessage}(タップして閉じる)</Text>
                  </Pressable>
                )}

                <Text style={styles.sectionTitle}>QRコード読み取り</Text>
                <Text style={styles.hint}>PC側の設定画面 →「スマホ連携」→「ペアリングコードを表示」</Text>
                <View style={styles.cameraBox}>
                  {!permission ? (
                    <ActivityIndicator color={colors.textMuted} />
                  ) : !permission.granted ? (
                    <View style={styles.cameraPlaceholder}>
                      <Text style={styles.hint}>QRコードを読み取るにはカメラの許可が必要です</Text>
                      <Pressable style={styles.secondaryButton} onPress={requestPermission}>
                        <Text style={styles.secondaryButtonText}>カメラを許可する</Text>
                      </Pressable>
                    </View>
                  ) : (
                    <CameraView
                      style={StyleSheet.absoluteFill}
                      facing="back"
                      barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
                      onBarcodeScanned={scanned ? undefined : handleBarcodeScanned}
                    />
                  )}
                </View>

                <Text style={styles.sectionTitle}>コード入力</Text>
                <View style={styles.row}>
                  <TextInput
                    style={[styles.input, styles.rowGrow]}
                    placeholder="PCのIPアドレス(例: 192.168.1.23)"
                    placeholderTextColor={colors.textMuted}
                    value={host}
                    onChangeText={setHost}
                    autoCapitalize="none"
                    keyboardType="numbers-and-punctuation"
                  />
                  <TextInput
                    style={[styles.input, styles.portInput]}
                    placeholder="ポート"
                    placeholderTextColor={colors.textMuted}
                    value={port}
                    onChangeText={setPort}
                    keyboardType="number-pad"
                  />
                </View>
                <TextInput
                  style={styles.input}
                  placeholder="6桁コード"
                  placeholderTextColor={colors.textMuted}
                  value={code}
                  onChangeText={setCode}
                  keyboardType="number-pad"
                  maxLength={6}
                />
                <TextInput
                  style={styles.input}
                  placeholder="端末名(PC側の一覧に表示されます)"
                  placeholderTextColor={colors.textMuted}
                  value={deviceName}
                  onChangeText={setDeviceName}
                />
                <Pressable
                  style={[styles.primaryButton, codeSubmitDisabled && styles.primaryButtonDisabled]}
                  onPress={handleCodeSubmit}
                  disabled={codeSubmitDisabled}
                >
                  <Text style={styles.primaryButtonText}>連携する</Text>
                </Pressable>
              </ScrollView>
            )}
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: colors.overlay },
  centerer: { flex: 1, justifyContent: 'center', padding: 16 },
  panel: {
    maxHeight: '90%',
    backgroundColor: colors.headerBg,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16
  },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  title: { color: colors.text, fontSize: 17, fontWeight: '700' },
  close: { color: colors.textSecondary, fontSize: 18 },
  body: { gap: 8, paddingBottom: 4 },
  sectionTitle: { color: colors.textSecondary, fontSize: 13, fontWeight: '600', marginTop: 6 },
  hint: { color: colors.textMuted, fontSize: 12, lineHeight: 17 },
  cameraBox: {
    height: 200,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: colors.panelAlt,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center'
  },
  cameraPlaceholder: { alignItems: 'center', gap: 10, padding: 16 },
  row: { flexDirection: 'row', gap: 8 },
  rowGrow: { flex: 1 },
  portInput: { width: 88 },
  input: {
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    color: colors.text,
    paddingHorizontal: 12,
    paddingVertical: 11,
    fontSize: 14
  },
  primaryButton: {
    backgroundColor: colors.accent,
    borderRadius: 10,
    paddingVertical: 13,
    alignItems: 'center',
    marginTop: 4
  },
  primaryButtonDisabled: { backgroundColor: colors.accentDisabled },
  primaryButtonText: { color: colors.accentText, fontSize: 15, fontWeight: '600' },
  secondaryButton: {
    backgroundColor: colors.buttonBg,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 16
  },
  secondaryButtonText: { color: colors.text, fontSize: 14 },
  waiting: { alignItems: 'center', gap: 10, paddingVertical: 40 },
  waitingText: { color: colors.text, fontSize: 16 },
  errorBanner: {
    backgroundColor: colors.dangerBg,
    borderWidth: 1,
    borderColor: colors.dangerBorder,
    borderRadius: 10,
    padding: 10
  },
  errorText: { color: colors.danger, fontSize: 13 }
})
