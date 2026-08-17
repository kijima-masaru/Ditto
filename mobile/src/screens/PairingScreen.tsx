import { useState } from 'react'
import {
  ActivityIndicator,
  KeyboardAvoidingView,
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
import { SCREEN_TOP_PADDING } from '../lib/layout'

/**
 * ペアリング画面。QRコードスキャン(expo-camera)か、IP/ポート/コードの手入力の
 * どちらかでPC側のDitto Remoteに接続要求を送る。QRの中身はPC設定画面で表示される
 * {ips, port, code}のJSON(remoteServer.tsのgetPairingInfo参照)。
 */

interface Props {
  client: RemoteClient
  errorMessage: string | null
  onErrorDismiss: () => void
}

type Mode = 'scan' | 'manual'

// PC側のペアリング済み一覧に出る名前なので、実際の端末に合った既定値にする
const DEFAULT_DEVICE_NAME = Platform.OS === 'ios' ? 'iPhone' : 'Androidスマホ'
const DEVICE_NAME_PLACEHOLDER =
  Platform.OS === 'ios' ? '端末名(例: 自分のiPhone)' : '端末名(例: 自分のPixel)'

export default function PairingScreen({ client, errorMessage, onErrorDismiss }: Props): React.JSX.Element {
  const [permission, requestPermission] = useCameraPermissions()
  const [mode, setMode] = useState<Mode>('scan')
  const [scanned, setScanned] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [host, setHost] = useState('')
  const [port, setPort] = useState('58211')
  const [code, setCode] = useState('')
  const [deviceName, setDeviceName] = useState(DEFAULT_DEVICE_NAME)

  const startPairing = async (targetHost: string, targetPort: number, targetCode: string): Promise<void> => {
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

  const handleManualSubmit = (): void => {
    const portNumber = Number(port)
    if (!host.trim() || !Number.isFinite(portNumber) || code.trim().length !== 6) return
    void startPairing(host.trim(), portNumber, code.trim())
  }

  if (connecting) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#5a4fe0" />
        <Text style={styles.statusText}>PC側の承認を待っています...</Text>
        <Text style={styles.hintText}>PC側で表示される確認ダイアログで「許可」を押してください</Text>
        {Platform.OS === 'ios' && (
          <Text style={styles.hintText}>
            この端末で「ローカルネットワーク上のデバイスの検索」の確認が出た場合も「許可」を押してください
          </Text>
        )}
      </View>
    )
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      // iOSはキーボードが画面に重なり「連携する」ボタンを覆ってしまう(かつ数字キーパッドには
      // 閉じるキーが無い)ため、キーボード分だけ画面を押し上げる。Androidはウィンドウ自体が
      // リサイズされるので従来どおり何もしない
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <Text style={styles.title}>Ditto Remote</Text>
      <Text style={styles.subtitle}>PCとペアリングしてください</Text>

      {errorMessage && (
        <TouchableOpacity style={styles.errorBanner} onPress={onErrorDismiss}>
          <Text style={styles.errorText}>{errorMessage}(タップして閉じる)</Text>
        </TouchableOpacity>
      )}

      <View style={styles.modeSwitch}>
        <TouchableOpacity
          style={[styles.modeButton, mode === 'scan' && styles.modeButtonActive]}
          onPress={() => setMode('scan')}
        >
          <Text style={mode === 'scan' ? styles.modeButtonTextActive : styles.modeButtonText}>QRスキャン</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.modeButton, mode === 'manual' && styles.modeButtonActive]}
          onPress={() => setMode('manual')}
        >
          <Text style={mode === 'manual' ? styles.modeButtonTextActive : styles.modeButtonText}>手入力</Text>
        </TouchableOpacity>
      </View>

      <TextInput
        style={styles.input}
        placeholder={DEVICE_NAME_PLACEHOLDER}
        placeholderTextColor="#888"
        value={deviceName}
        onChangeText={setDeviceName}
        returnKeyType="done"
        keyboardAppearance="dark"
      />

      {mode === 'scan' ? (
        <View style={styles.cameraWrap}>
          {!permission ? (
            <ActivityIndicator />
          ) : !permission.granted ? (
            <View style={styles.center}>
              <Text style={styles.hintText}>QRコードを読み取るにはカメラの許可が必要です</Text>
              <TouchableOpacity style={styles.primaryButton} onPress={requestPermission}>
                <Text style={styles.primaryButtonText}>カメラを許可する</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <CameraView
              style={styles.camera}
              facing="back"
              barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
              onBarcodeScanned={scanned ? undefined : handleBarcodeScanned}
            />
          )}
        </View>
      ) : (
        <View style={styles.form}>
          <TextInput
            style={styles.input}
            placeholder="PCのIPアドレス(例: 192.168.1.23)"
            placeholderTextColor="#888"
            value={host}
            onChangeText={setHost}
            autoCapitalize="none"
            keyboardType={Platform.OS === 'ios' ? 'numbers-and-punctuation' : 'default'}
            returnKeyType="done"
            keyboardAppearance="dark"
          />
          <TextInput
            style={styles.input}
            placeholder="ポート番号"
            placeholderTextColor="#888"
            value={port}
            onChangeText={setPort}
            keyboardType="number-pad"
            keyboardAppearance="dark"
          />
          <TextInput
            style={styles.input}
            placeholder="6桁コード"
            placeholderTextColor="#888"
            value={code}
            onChangeText={setCode}
            keyboardType="number-pad"
            maxLength={6}
            keyboardAppearance="dark"
          />
          <TouchableOpacity style={styles.primaryButton} onPress={handleManualSubmit}>
            <Text style={styles.primaryButtonText}>連携する</Text>
          </TouchableOpacity>
        </View>
      )}
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#15161f', padding: 20, paddingTop: SCREEN_TOP_PADDING },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 20 },
  title: { color: '#e9eaf3', fontSize: 24, fontWeight: '700' },
  subtitle: { color: '#9ba0bd', fontSize: 14, marginTop: 4, marginBottom: 16 },
  statusText: { color: '#e9eaf3', fontSize: 16, marginTop: 12 },
  hintText: { color: '#9ba0bd', fontSize: 13, textAlign: 'center' },
  errorBanner: { backgroundColor: '#3a1b1b', borderRadius: 8, padding: 10, marginBottom: 12 },
  errorText: { color: '#f27a7a', fontSize: 13 },
  modeSwitch: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  modeButton: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: '#1d1f2b',
    borderWidth: 1,
    borderColor: '#363a56',
    alignItems: 'center'
  },
  modeButtonActive: { backgroundColor: '#2a2555', borderColor: '#8b83ff' },
  modeButtonText: { color: '#9ba0bd', fontSize: 14 },
  modeButtonTextActive: { color: '#b3aeff', fontSize: 14, fontWeight: '600' },
  input: {
    backgroundColor: '#1d1f2b',
    borderWidth: 1,
    borderColor: '#363a56',
    borderRadius: 8,
    color: '#e9eaf3',
    padding: 12,
    fontSize: 14,
    marginBottom: 10
  },
  cameraWrap: { flex: 1, borderRadius: 12, overflow: 'hidden' },
  camera: { flex: 1 },
  form: { gap: 4 },
  primaryButton: {
    backgroundColor: '#5a4fe0',
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 6
  },
  primaryButtonText: { color: '#fff', fontSize: 15, fontWeight: '600' }
})
