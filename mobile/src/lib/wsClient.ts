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

/**
 * counterを何個ずつ先行して予約(永続化)するか。1メッセージごとにSecureStoreへ
 * 書き込むのは重いため、ブロック単位で予約しておき、使い切ったら次を予約する。
 * 予約済みの番号を使い切らずにアプリが落ちた場合は番号が飛ぶだけで実害はない
 */
const COUNTER_BLOCK = 1000

/** 自動再接続の待ち時間。試行のたびに倍化し、上限で頭打ちにする */
const RECONNECT_BASE_DELAY_MS = 1000
const RECONNECT_MAX_DELAY_MS = 30_000

export class RemoteClient {
  private ws: WebSocket | null = null
  private sessionKey: AESEncryptionKey | null = null
  private sessionKeyBase64: string | null = null
  private deviceId: string | null = null
  private counter = 0
  /** 永続化済みのcounter上限。これに達したら次のブロックを予約する */
  private counterCeiling = 0
  private host = ''
  private port = 0
  // ペアリング/認証が一度成立した後だけ自動再接続する。連携解除やデバイス失効の後に
  // 再接続を試み続けないよう、forget()/disconnect()で false に戻す
  private shouldReconnect = false
  private reconnectAttempt = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
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
        this.scheduleReconnect()
      }
    })
  }

  /**
   * 切断を検知したら指数バックオフで再接続を試みる。PC側のDittoを再起動した場合や
   * 一時的にネットワークが切れた場合に、アプリを手動で立ち上げ直さずに復帰できる。
   * タイマーが既にある場合は何もしない(openSocketの失敗とoncloseが両方走っても
   * 二重にスケジュールしないため)
   */
  private scheduleReconnect(): void {
    if (!this.shouldReconnect || this.reconnectTimer) return
    const delay = Math.min(RECONNECT_BASE_DELAY_MS * 2 ** this.reconnectAttempt, RECONNECT_MAX_DELAY_MS)
    this.reconnectAttempt += 1
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      if (!this.shouldReconnect) return
      this.connectWithSavedCredentials().catch(() => this.scheduleReconnect())
    }, delay)
  }

  private cancelReconnect(): void {
    this.shouldReconnect = false
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
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
        // 保存済み認証情報での再接続はhandlePaired()を通らないため、認証成立をここで拾って
        // 'connecting'のままになっている状態表示を'connected'へ進める
        if (msg.type === 'authOk') {
          this.setStatus('connected')
          this.reconnectAttempt = 0 // 次に切れたときは待たずに1秒から再開する
        }
        // 失効・未登録の端末は何度繋ぎ直しても通らないため、再接続を諦める
        // (App.tsx側でforget()が呼ばれ、ペアリング画面へ戻る)
        if (msg.type === 'authFailed' && (msg.reason === 'unknown-device' || msg.reason === 'revoked')) {
          this.cancelReconnect()
        }
        this.events.onServerMessage?.(msg)
      } catch {
        // 改ざん・鍵不一致は無視する
      }
      return
    }

    this.events.onServerMessage?.(parsed as RemoteServerMessage)
  }

  // 切断中は黙って捨てず例外にする。無反応だと操作が成功したのか失敗したのかが
  // 画面から判別できないため(呼び出し側でユーザーに通知する)
  private sendRaw(obj: unknown): void {
    if (!this.ws) throw new Error('PCと接続されていません')
    this.ws.send(JSON.stringify(obj))
  }

  /** counterのブロックを予約し、認証情報とあわせて永続化する */
  private async reserveCounterBlock(from: number): Promise<void> {
    if (!this.deviceId || !this.sessionKeyBase64) return
    this.counterCeiling = from + COUNTER_BLOCK
    await saveCredentials({
      deviceId: this.deviceId,
      sessionKeyBase64: this.sessionKeyBase64,
      host: this.host,
      port: this.port,
      counter: this.counterCeiling
    })
  }

  private async nextCounter(): Promise<number> {
    this.counter += 1
    if (this.counter >= this.counterCeiling) await this.reserveCounterBlock(this.counter)
    return this.counter
  }

  private async sendEncrypted(payload: OutgoingPayload): Promise<void> {
    if (!this.sessionKey || !this.deviceId) throw new Error('ペアリングされていません')
    const counter = await this.nextCounter()
    const message = { v: 1, counter, ...payload } as RemoteClientMessage
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
    this.sessionKeyBase64 = sessionKeyBase64
    this.sessionKey = await importSessionKey(sessionKeyBase64)
    // ペアリング成立時はPC側もdeviceCountersを0にリセットするため、ここも0から始めてよい
    this.counter = 0
    await this.reserveCounterBlock(0)
    this.shouldReconnect = true
    this.reconnectAttempt = 0
    this.setStatus('connected')
  }

  /** 端末に保存済みの認証情報があれば、それで再接続する。保存が無ければfalseを返す */
  async connectWithSavedCredentials(): Promise<boolean> {
    const creds = await loadCredentials()
    if (!creds) return false
    this.host = creds.host
    this.port = creds.port
    this.deviceId = creds.deviceId
    this.sessionKeyBase64 = creds.sessionKeyBase64
    this.sessionKey = await importSessionKey(creds.sessionKeyBase64)
    // 保存値は前回のセッションで予約済みだった上限。ここから再開すれば、前回実際に
    // 送ったどのcounterよりも必ず大きくなるためPC側のリプレイ判定に弾かれない
    this.counter = creds.counter ?? 0
    await this.reserveCounterBlock(this.counter)
    // 認証情報がある時点で再接続の対象。openSocketが失敗してもoncloseや
    // 呼び出し側のcatchからscheduleReconnect()に入れるよう、接続前に立てておく
    this.shouldReconnect = true
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
    this.cancelReconnect()
    this.ws?.close()
    this.ws = null
  }

  /** 失効・ログアウト操作。保存済み認証情報も削除する */
  async forget(): Promise<void> {
    this.disconnect()
    this.sessionKey = null
    this.sessionKeyBase64 = null
    this.deviceId = null
    this.counter = 0
    this.counterCeiling = 0
    await clearCredentials()
  }
}
