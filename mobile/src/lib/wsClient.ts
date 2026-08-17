import { Platform } from 'react-native'
import type { AESEncryptionKey } from 'expo-crypto'
import { decryptPayload, encryptPayload, importSessionKey } from './crypto'
import type { EncryptedEnvelope, RemoteClientMessage, RemoteServerMessage } from './protocol'
import { clearCredentials, loadCredentials, saveCredentials } from './secureStorage'

/**
 * Ditto Remoteの接続状態を管理するクライアント。ペアリング(平文)・認証/操作(暗号化)の
 * どちらもこのクラスを通して行う。PC側(src/main/remoteServer.ts)と同じワイヤーフォーマット
 * (pairのみ平文、それ以外は{deviceId, iv, tag, data}の暗号化封筒)を扱う。
 */

export type ConnectionStatus = 'disconnected' | 'connecting' | 'pairing' | 'connected' | 'error'

/**
 * iOS 14以降のローカルネットワークプライバシーでは、LAN内アドレスへ接続しようとした時点で
 * 初めて許可ダイアログが出る。ダイアログが表示されている間の接続はOSにブロックされるため、
 * 「初回だけ必ず失敗し、ユーザーが許可を押したあとの再試行で成功する」という挙動になる。
 * そのためiOSでは接続失敗を即エラーにせず、ユーザーがダイアログを操作する時間だけ間隔を
 * 空けて数回やり直す(Androidにこの制限は無いので従来どおり1回で判定する)。
 * 併せて、ブロックがエラーではなく無反応として現れた場合にも再試行できるよう接続に
 * タイムアウトを設ける。
 */
const IOS_LOCAL_NETWORK_RETRIES = 4
const IOS_LOCAL_NETWORK_RETRY_INTERVAL_MS = 1500
const IOS_CONNECT_TIMEOUT_MS = 5000

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

// 'v'/'counter'はsendEncrypted内で付与するため、呼び出し側はそれ以外のフィールドだけ渡す。
// 通常のOmitはUnion型に対して分配されずおかしな型になるため、分配的Omitを自前定義する
type DistributiveOmit<T, K extends string | number | symbol> = T extends unknown ? Omit<T, K & keyof T> : never
type OutgoingPayload = DistributiveOmit<RemoteClientMessage, 'v' | 'counter'>

interface RemoteClientEvents {
  onStatusChange?: (status: ConnectionStatus) => void
  onServerMessage?: (msg: RemoteServerMessage) => void
}

export class RemoteClient {
  private ws: WebSocket | null = null
  private sessionKey: AESEncryptionKey | null = null
  private deviceId: string | null = null
  private counter = 0
  private host = ''
  private port = 0
  private readonly events: RemoteClientEvents

  constructor(events: RemoteClientEvents = {}) {
    this.events = events
  }

  private setStatus(status: ConnectionStatus): void {
    this.events.onStatusChange?.(status)
  }

  private async openSocket(): Promise<void> {
    try {
      if (Platform.OS === 'ios') {
        await this.openSocketWithLocalNetworkRetry()
      } else {
        await this.openSocketOnce()
      }
    } catch (error) {
      this.setStatus('disconnected')
      throw error
    }
  }

  /** iOSのローカルネットワーク許可ダイアログを挟んでも繋がるよう、間隔を空けて再試行する */
  private async openSocketWithLocalNetworkRetry(): Promise<void> {
    let lastError: unknown = null
    for (let attempt = 0; attempt <= IOS_LOCAL_NETWORK_RETRIES; attempt += 1) {
      if (attempt > 0) await delay(IOS_LOCAL_NETWORK_RETRY_INTERVAL_MS)
      try {
        await this.openSocketOnce(IOS_CONNECT_TIMEOUT_MS)
        return
      } catch (error) {
        lastError = error
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new Error('WebSocket接続に失敗しました(ローカルネットワークの許可を確認してください)')
  }

  private openSocketOnce(timeoutMs?: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://${this.host}:${this.port}/ws`)
      let settled = false
      const timer =
        timeoutMs === undefined
          ? null
          : setTimeout(() => {
              if (settled) return
              settled = true
              ws.close()
              reject(new Error('WebSocket接続がタイムアウトしました'))
            }, timeoutMs)
      const settle = (): void => {
        settled = true
        if (timer !== null) clearTimeout(timer)
      }

      ws.onopen = () => {
        // タイムアウト後に遅れて開いたソケットは使わず閉じる(再試行側が新しく開いている)
        if (settled) {
          ws.close()
          return
        }
        settle()
        this.ws = ws
        resolve()
      }
      ws.onerror = () => {
        if (settled) return
        settle()
        reject(new Error('WebSocket接続に失敗しました'))
      }
      ws.onmessage = (event) => {
        void this.handleRawMessage(String(event.data))
      }
      ws.onclose = () => {
        // 再試行で見捨てたソケットのcloseで、生きている接続を切断扱いにしないよう確認する
        if (this.ws !== ws) return
        this.ws = null
        this.setStatus('disconnected')
      }
    })
  }

  private async handleRawMessage(raw: string): Promise<void> {
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      return
    }
    if (!parsed || typeof parsed !== 'object') return

    if ('iv' in parsed && 'tag' in parsed && 'data' in parsed) {
      if (!this.sessionKey) return // 鍵が無い状態で暗号化メッセージは復号しようがない
      try {
        const msg = await decryptPayload<RemoteServerMessage>(parsed as EncryptedEnvelope, this.sessionKey)
        this.events.onServerMessage?.(msg)
      } catch {
        // 改ざん・鍵不一致は無視する
      }
      return
    }

    this.events.onServerMessage?.(parsed as RemoteServerMessage)
  }

  private sendRaw(obj: unknown): void {
    this.ws?.send(JSON.stringify(obj))
  }

  private async sendEncrypted(payload: OutgoingPayload): Promise<void> {
    if (!this.sessionKey || !this.deviceId) throw new Error('ペアリングされていません')
    this.counter += 1
    const message = { v: 1, counter: this.counter, ...payload } as RemoteClientMessage
    const parts = await encryptPayload(message, this.sessionKey)
    const envelope: EncryptedEnvelope = { deviceId: this.deviceId, ...parts }
    this.sendRaw(envelope)
  }

  /** 新規ペアリング開始。QRコード/手入力で得たcodeを送る。結果はonServerMessageで受け取る
   *  ('pairPending' -> 'paired'|'pairRejected')。'paired'受信後はhandlePaired()を呼ぶこと */
  async startPairing(host: string, port: number, code: string, deviceName: string): Promise<void> {
    this.host = host
    this.port = port
    this.setStatus('connecting')
    await this.openSocket()
    this.setStatus('pairing')
    this.sendRaw({ v: 1, type: 'pair', code, deviceName })
  }

  /** 'paired'メッセージを受け取った後に呼び、以後の暗号化通信を有効化しつつ端末に保存する */
  async handlePaired(deviceId: string, sessionKeyBase64: string): Promise<void> {
    this.deviceId = deviceId
    this.sessionKey = await importSessionKey(sessionKeyBase64)
    this.counter = 0
    await saveCredentials({ deviceId, sessionKeyBase64, host: this.host, port: this.port })
    this.setStatus('connected')
  }

  /** 端末に保存済みの認証情報があれば、それで再接続する。保存が無ければfalseを返す */
  async connectWithSavedCredentials(): Promise<boolean> {
    const creds = await loadCredentials()
    if (!creds) return false
    this.host = creds.host
    this.port = creds.port
    this.deviceId = creds.deviceId
    this.sessionKey = await importSessionKey(creds.sessionKeyBase64)
    this.counter = 0
    this.setStatus('connecting')
    await this.openSocket()
    await this.sendEncrypted({ type: 'auth' })
    return true
  }

  async requestItems(): Promise<void> {
    await this.sendEncrypted({ type: 'listItems' })
  }

  async triggerTemplate(templateId: string, requestId: string): Promise<void> {
    await this.sendEncrypted({ type: 'triggerTemplate', templateId, requestId })
  }

  async triggerMacro(macroId: string, requestId: string): Promise<void> {
    await this.sendEncrypted({ type: 'triggerMacro', macroId, requestId, confirmed: true })
  }

  disconnect(): void {
    // this.wsを先に外してから閉じる。onclose側は「自分が現役のソケットか」で判定するため、
    // ここで明示的に切断済みへ倒しておく(onclose任せにすると通知されない)
    const ws = this.ws
    this.ws = null
    ws?.close()
    this.setStatus('disconnected')
  }

  /** 失効・ログアウト操作。保存済み認証情報も削除する */
  async forget(): Promise<void> {
    this.disconnect()
    this.sessionKey = null
    this.deviceId = null
    await clearCredentials()
  }
}
