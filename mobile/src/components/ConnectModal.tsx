import { useEffect, useState } from 'react'
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View
} from 'react-native'
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera'
import type { RemoteClient } from '../lib/wsClient'
import type { PairingQrPayload } from '../lib/protocol'
import { CloseIcon } from './Icons'
import { colors } from '../theme'

/**
 * 接続モーダル。ヘッダーの接続アイコンから開く。接続手段は以下の2つ。
 *  - QRコード読み取り(expo-camera)。QRの中身はPC設定画面で表示される
 *    {ips, port, code}のJSON(remoteServer.tsのgetPairingInfo参照)で、
 *    接続先ホストもここから取れるため入力は不要
 *  - コード入力。QRが使えない場合の手段。接続先が分からないと繋げないため
 *    IPアドレスも一緒に入力してもらう
 *
 * 以前あった「USB接続」タブ(host=127.0.0.1固定)は廃止した。IP欄に127.0.0.1と
 * 入れれば同じことができるため。Androidエミュレータで`adb reverse`を張った場合や
 * iOSシミュレータからMacのlocalhostへ繋ぐ場合はそのように入力する
 */

interface Props {
  visible: boolean
  client: RemoteClient
  errorMessage: string | null
  onErrorDismiss: () => void
  onClose: () => void
}

type Mode = 'scan' | 'code'

const DEFAULT_PORT = 58211
/** PC側のペアリング済み一覧にそのまま表示されるため、プラットフォームに合った既定値にする */
const DEFAULT_DEVICE_NAME = Platform.OS === 'ios' ? 'iPhone' : 'Androidスマホ'

export default function ConnectModal({
  visible,
  client,
  errorMessage,
  onErrorDismiss,
  onClose
}: Props): React.JSX.Element {
  const [permission, requestPermission] = useCameraPermissions()
  const [mode, setMode] = useState<Mode>('scan')
  const [scanned, setScanned] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [host, setHost] = useState('')
  const [code, setCode] = useState('')
  const [deviceName, setDeviceName] = useState(DEFAULT_DEVICE_NAME)

  // client.startPairing()は「pairメッセージを送信し終えた」時点で解決するため、PC側に
  // 拒否された場合はここでは何も起きない。拒否はApp.tsxがerrorMessageとして渡してくるので、
  // それを合図に待機表示を解除する。これが無いと承認待ちスピナーから永久に戻れない
  useEffect(() => {
    if (errorMessage) {
      setConnecting(false)
      setScanned(false)
    }
  }, [errorMessage])

  const startPairing = async (targetHost: string, targetPort: number, targetCode: string): Promise<void> => {
    onErrorDismiss() // 前回のエラーを消しておかないと、上のeffectが即座に待機表示を解除してしまう
    setConnecting(true)
    try {
      await client.startPairing(targetHost, targetPort, targetCode, deviceName.trim() || DEFAULT_DEVICE_NAME)
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

  const canSubmitCode = host.trim().length > 0 && code.trim().length === 6

  const handleCodeSubmit = (): void => {
    if (!canSubmitCode) return
    void startPairing(host.trim(), DEFAULT_PORT, code.trim())
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.scrim}>
        <KeyboardAvoidingView
          style={styles.panel}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={styles.header}>
            <Text style={styles.title}>PCと接続</Text>
            <TouchableOpacity onPress={onClose} hitSlop={12}>
              <CloseIcon color={colors.textSecondary} />
            </TouchableOpacity>
          </View>

          {connecting ? (
            <View style={styles.center}>
              <ActivityIndicator size="large" color={colors.accent} />
              <Text style={styles.statusText}>PC側の承認を待っています...</Text>
              <Text style={styles.hintText}>PC側で表示される確認ダイアログで「許可」を押してください</Text>
            </View>
          ) : (
            <>
              {errorMessage && (
                <TouchableOpacity style={styles.errorBanner} onPress={onErrorDismiss}>
                  <Text style={styles.errorText}>{errorMessage}(タップして閉じる)</Text>
                </TouchableOpacity>
              )}

              <TouchableOpacity
                style={[styles.modeButton, mode === 'scan' && styles.modeButtonActive]}
                onPress={() => setMode('scan')}
              >
                <Text style={mode === 'scan' ? styles.modeTextActive : styles.modeText}>QRコード読み取り</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.modeButton, mode === 'code' && styles.modeButtonActive]}
                onPress={() => setMode('code')}
              >
                <Text style={mode === 'code' ? styles.modeTextActive : styles.modeText}>コード入力</Text>
              </TouchableOpacity>

              <View style={styles.content}>
                {mode === 'scan' ? (
                  permission?.granted ? (
                    <CameraView
                      style={styles.camera}
                      facing="back"
                      barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
                      onBarcodeScanned={handleBarcodeScanned}
                    />
                  ) : (
                    <View style={styles.center}>
                      <Text style={styles.hintText}>QRコードを読み取るにはカメラの許可が必要です</Text>
                      <TouchableOpacity style={styles.primaryButton} onPress={() => void requestPermission()}>
                        <Text style={styles.primaryButtonText}>カメラを許可する</Text>
                      </TouchableOpacity>
                    </View>
                  )
                ) : (
                  <View style={styles.form}>
                    <Text style={styles.label}>PCのIPアドレス</Text>
                    <TextInput
                      style={styles.input}
                      value={host}
                      onChangeText={setHost}
                      placeholder="例: 192.168.1.23"
                      placeholderTextColor={colors.textMuted}
                      autoCapitalize="none"
                      keyboardType="numbers-and-punctuation"
                    />
                    <Text style={styles.label}>6桁コード</Text>
                    <TextInput
                      style={styles.input}
                      value={code}
                      onChangeText={setCode}
                      placeholder="000000"
                      placeholderTextColor={colors.textMuted}
                      keyboardType="number-pad"
                      maxLength={6}
                    />
                    <Text style={styles.label}>この端末の名前</Text>
                    <TextInput
                      style={styles.input}
                      value={deviceName}
                      onChangeText={setDeviceName}
                      placeholderTextColor={colors.textMuted}
                    />
                    <TouchableOpacity
                      style={[styles.primaryButton, !canSubmitCode && styles.primaryButtonDisabled]}
                      onPress={handleCodeSubmit}
                      disabled={!canSubmitCode}
                    >
                      <Text style={styles.primaryButtonText}>接続する</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            </>
          )}
        </KeyboardAvoidingView>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: colors.scrim, justifyContent: 'center', padding: 20 },
  panel: {
    backgroundColor: colors.header,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    maxHeight: '88%'
  },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  title: { color: colors.text, fontSize: 17, fontWeight: '600' },
  modeButton: {
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingVertical: 13,
    alignItems: 'center',
    marginBottom: 10
  },
  modeButtonActive: { backgroundColor: colors.accentBg, borderColor: colors.accent },
  modeText: { color: colors.textSecondary, fontSize: 14 },
  modeTextActive: { color: colors.text, fontSize: 14, fontWeight: '600' },
  content: { minHeight: 260, marginTop: 4 },
  camera: { flex: 1, minHeight: 260, borderRadius: 10, overflow: 'hidden' },
  form: { gap: 6 },
  label: { color: colors.textMuted, fontSize: 12, marginTop: 4 },
  input: {
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: colors.text,
    fontSize: 15
  },
  primaryButton: {
    backgroundColor: colors.accent,
    borderRadius: 10,
    paddingVertical: 13,
    alignItems: 'center',
    marginTop: 14
  },
  primaryButtonDisabled: { backgroundColor: colors.accentDisabled },
  primaryButtonText: { color: colors.accentText, fontSize: 15, fontWeight: '600' },
  center: { minHeight: 260, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 16 },
  statusText: { color: colors.text, fontSize: 15 },
  hintText: { color: colors.textMuted, fontSize: 12, textAlign: 'center', lineHeight: 18 },
  errorBanner: {
    backgroundColor: colors.dangerBg,
    borderWidth: 1,
    borderColor: colors.dangerBorder,
    borderRadius: 8,
    padding: 10,
    marginBottom: 10
  },
  errorText: { color: colors.danger, fontSize: 12, lineHeight: 18 }
})
