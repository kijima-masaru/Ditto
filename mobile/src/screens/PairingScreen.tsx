import { useState } from 'react'
import { ActivityIndicator, Platform, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native'
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
 *    PC側のremoteServer.tsは通常の同一LAN接続と区別せず扱えるため変更不要。
 *    iOSにはadb相当のトンネルが無いため実機では使えないが、iOSシミュレータは
 *    Macのネットワークスタックをそのまま使うので127.0.0.1でPCに直接到達できる
 */

interface Props {
  client: RemoteClient
  errorMessage: string | null
  onErrorDismiss: () => void
}

type Mode = 'scan' | 'manual' | 'usb'

const DEFAULT_PORT = '58211'
const USB_HOST = '127.0.0.1'
/** PC側のペアリング済み一覧にそのまま表示されるため、プラットフォームに合った既定値にする */
const DEFAULT_DEVICE_NAME = Platform.OS === 'ios' ? 'iPhone' : 'Androidスマホ'
/**
 * 直結モードの案内文。Androidは`adb reverse`でトンネルを張る前提。iOSにはadb相当が
 * 無いため実機では使えず、シミュレータがMacのlocalhostへ直接到達できるケース専用になる
 */
const DIRECT_TAB_LABEL = Platform.OS === 'ios' ? '直接接続' : 'USB接続'
const DIRECT_HINT =
  Platform.OS === 'ios'
    ? 'iOSシミュレータからMac上のDittoへ直接接続する場合に使います。実機のiPhoneでは使えないため、「手入力」タブでPCのIPアドレスを指定してください。'
    : `USBケーブルでPCに接続し、PC側で以下を実行してから連携してください:\nadb reverse tcp:58211 tcp:58211`

export default function PairingScreen({ client, errorMessage, onErrorDismiss }: Props): React.JSX.Element {
  const [permission, requestPermission] = useCameraPermissions()
  const [mode, setMode] = useState<Mode>('scan')
  const [scanned, setScanned] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [host, setHost] = useState('')
  const [port, setPort] = useState(DEFAULT_PORT)
  const [code, setCode] = useState('')
  const [usbCode, setUsbCode] = useState('')
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
          <Text style={mode === 'usb' ? styles.modeButtonTextActive : styles.modeButtonText}>{DIRECT_TAB_LABEL}</Text>
        </TouchableOpacity>
      </View>

      <TextInput
        style={styles.input}
        placeholder="端末名(例: 自分のスマホ)"
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
          <Text style={styles.hintText}>{DIRECT_HINT}</Text>
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

/**
 * 上端の余白。AndroidではSafeAreaViewが実質何もしないため画面側で稼ぐ必要があるが、
 * iOSではApp.tsxのSafeAreaViewがセーフエリア分(Dynamic Islandで約59pt)を既に空けており、
 * 同じ60ptを足すと二重取りになるため小さくする
 */
const TOP_PADDING = Platform.OS === 'ios' ? 12 : 60

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#15161f', padding: 20, paddingTop: TOP_PADDING },
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
