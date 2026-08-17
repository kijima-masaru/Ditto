import { useEffect, useState } from 'react'
import { ActivityIndicator, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native'
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera'
import type { RemoteClient } from '../lib/wsClient'
import type { PairingQrPayload } from '../lib/protocol'

/**
 * ペアリング画面。以下3通りのいずれかでPC側のDitto Remoteに接続要求を送る。
 *  - QRコードスキャン(expo-camera)。QRの中身はPC設定画面で表示される
 *    {ips, port, code}のJSON(remoteServer.tsのgetPairingInfo参照)
 *  - IP/ポート/コードの手入力(同一Wi-Fi)
 *  - USB接続。`adb reverse tcp:58211 tcp:58211`でPCのlocalhost:58211をスマホ側の
 *    localhostへトンネルする前提で、host=127.0.0.1固定・コードのみ入力する。
 *    PC側のremoteServer.tsは通常の同一LAN接続と区別せず扱えるため変更不要
 */

interface Props {
  client: RemoteClient
  errorMessage: string | null
  onErrorDismiss: () => void
}

type Mode = 'scan' | 'manual' | 'usb'

const DEFAULT_PORT = '58211'
const USB_HOST = '127.0.0.1'

export default function PairingScreen({ client, errorMessage, onErrorDismiss }: Props): React.JSX.Element {
  const [permission, requestPermission] = useCameraPermissions()
  const [mode, setMode] = useState<Mode>('scan')
  const [scanned, setScanned] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [host, setHost] = useState('')
  const [port, setPort] = useState(DEFAULT_PORT)
  const [code, setCode] = useState('')
  const [usbCode, setUsbCode] = useState('')
  const [deviceName, setDeviceName] = useState('Androidスマホ')

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
      await client.startPairing(targetHost, targetPort, targetCode, deviceName.trim() || 'Androidスマホ')
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

  const handleUsbSubmit = (): void => {
    if (usbCode.trim().length !== 6) return
    void startPairing(USB_HOST, Number(DEFAULT_PORT), usbCode.trim())
  }

  if (connecting) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#5a4fe0" />
        <Text style={styles.statusText}>PC側の承認を待っています...</Text>
        <Text style={styles.hintText}>PC側で表示される確認ダイアログで「許可」を押してください</Text>
      </View>
    )
  }

  return (
    <View style={styles.container}>
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
        <TouchableOpacity
          style={[styles.modeButton, mode === 'usb' && styles.modeButtonActive]}
          onPress={() => setMode('usb')}
        >
          <Text style={mode === 'usb' ? styles.modeButtonTextActive : styles.modeButtonText}>USB接続</Text>
        </TouchableOpacity>
      </View>

      <TextInput
        style={styles.input}
        placeholder="端末名(例: 自分のPixel)"
        placeholderTextColor="#888"
        value={deviceName}
        onChangeText={setDeviceName}
      />

      {mode === 'scan' && (
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
      )}

      {mode === 'manual' && (
        <View style={styles.form}>
          <TextInput
            style={styles.input}
            placeholder="PCのIPアドレス(例: 192.168.1.23)"
            placeholderTextColor="#888"
            value={host}
            onChangeText={setHost}
            autoCapitalize="none"
          />
          <TextInput
            style={styles.input}
            placeholder="ポート番号"
            placeholderTextColor="#888"
            value={port}
            onChangeText={setPort}
            keyboardType="number-pad"
          />
          <TextInput
            style={styles.input}
            placeholder="6桁コード"
            placeholderTextColor="#888"
            value={code}
            onChangeText={setCode}
            keyboardType="number-pad"
            maxLength={6}
          />
          <TouchableOpacity style={styles.primaryButton} onPress={handleManualSubmit}>
            <Text style={styles.primaryButtonText}>連携する</Text>
          </TouchableOpacity>
        </View>
      )}

      {mode === 'usb' && (
        <View style={styles.form}>
          <Text style={styles.hintText}>
            USBケーブルでPCに接続し、PC側で以下を実行してから連携してください:{'\n'}
            {'adb reverse tcp:58211 tcp:58211'}
          </Text>
          <TextInput
            style={[styles.input, styles.usbCodeInput]}
            placeholder="6桁コード"
            placeholderTextColor="#888"
            value={usbCode}
            onChangeText={setUsbCode}
            keyboardType="number-pad"
            maxLength={6}
          />
          <TouchableOpacity style={styles.primaryButton} onPress={handleUsbSubmit}>
            <Text style={styles.primaryButtonText}>連携する</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#15161f', padding: 20, paddingTop: 60 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 20 },
  title: { color: '#e9eaf3', fontSize: 24, fontWeight: '700' },
  subtitle: { color: '#9ba0bd', fontSize: 14, marginTop: 4, marginBottom: 16 },
  statusText: { color: '#e9eaf3', fontSize: 16, marginTop: 12 },
  hintText: { color: '#9ba0bd', fontSize: 13, textAlign: 'center' },
  errorBanner: { backgroundColor: '#3a1b1b', borderRadius: 8, padding: 10, marginBottom: 12 },
  errorText: { color: '#f27a7a', fontSize: 13 },
  usbCodeInput: { marginTop: 16 },
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
