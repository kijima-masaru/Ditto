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

  private openSocket(): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://${this.host}:${this.port}/ws`)
      ws.onopen = () => {
        this.ws = ws
        resolve()
      }
      ws.onerror = () => reject(new Error('WebSocket接続に失敗しました'))
      ws.onmessage = (event) => {
        void this.handleRawMessage(String(event.data))
      }
      ws.onclose = () => {
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
    this.ws?.close()
    this.ws = null
  }

  /** 失効・ログアウト操作。保存済み認証情報も削除する */
  async forget(): Promise<void> {
    this.disconnect()
    this.sessionKey = null
    this.deviceId = null
    await clearCredentials()
  }
}
