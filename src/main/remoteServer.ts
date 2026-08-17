import { randomUUID } from 'crypto'
import http from 'http'
import { networkInterfaces } from 'os'
import { dialog, Notification, safeStorage, type BrowserWindow } from 'electron'
import { toDataURL } from 'qrcode'
import { WebSocket, WebSocketServer, type RawData } from 'ws'
import {
  IPC,
  type MacroCase,
  type PairedDevice,
  type PlaybackProgress,
  type RemoteClientMessage,
  type RemoteMacroItem,
  type RemoteServerMessage,
  type RemoteTemplateItem
} from '../shared/types'
import * as settingsStore from './settingsStore'
import * as clipboardStore from './clipboardStore'
import * as store from './store'
import { resolveTemplateText } from './templateVariables'
import { injectText } from './textInjector'
import type { TargetManager } from './targetManager'
import * as remoteCrypto from './remoteCrypto'
import * as rateLimiter from './rateLimiter'
import log from './logger'

/**
 * Ditto Remote(スマホ連携)。同一LAN内のAndroidアプリから、PC側の定型文入力・
 * マクロ実行をワンタップでトリガーできるようにするローカルサーバー。TLSは使わず
 * (ネイティブアプリ側での動的な自己署名証明書ピンニングが煩雑なため)、ペアリング時に
 * 一度だけ渡すセッション鍵でメッセージ本文をAES-256-GCM暗号化する(remoteCrypto.ts参照)。
 * この鍵を正しく使って復号できること自体が以後の認証を兼ねる。
 */

const PORT = 58211
const PAIRING_CODE_TTL_MS = 2 * 60_000
const PAIR_APPROVAL_TIMEOUT_MS = 60_000
const REQUEST_ID_CACHE_TTL_MS = 5 * 60_000

interface CurrentPairingCode {
  code: string
  expiresAt: number
}

let httpServer: http.Server | null = null
let wss: WebSocketServer | null = null
let currentCode: CurrentPairingCode | null = null
let getMainWindow: (() => BrowserWindow | null) | null = null

/** ペアリング成立・デバイス失効のたびに設定画面へ一覧の再取得を促す */
function notifyDeviceListChanged(): void {
  getMainWindow?.()?.webContents.send(IPC.remoteDeviceEvent)
}

// deviceId -> 現在の生存WebSocket接続(認証成立後のみ)。デバイス失効時の即時切断や、
// 同一デバイスからの再接続時に古い接続を閉じるために使う
const liveConnections = new Map<string, WebSocket>()
// deviceId -> 直近に受理したcounter値。リプレイ攻撃(古いメッセージの再送)を防ぐため、
// 再接続をまたいでアプリのプロセス生存中は保持する
const deviceCounters = new Map<string, number>()
// requestId -> 期限(ms)。通信リトライによる同一操作の多重実行を防ぐ
const seenRequestIds = new Map<string, number>()

// dialog.showMessageBox によるペアリング承認ダイアログは同時に1つだけ出す
let pairingChain: Promise<void> = Promise.resolve()

function pruneSeenRequestIds(): void {
  const now = Date.now()
  for (const [id, expiresAt] of seenRequestIds) {
    if (expiresAt < now) seenRequestIds.delete(id)
  }
}

function isDuplicateRequest(requestId: string): boolean {
  pruneSeenRequestIds()
  if (seenRequestIds.has(requestId)) return true
  seenRequestIds.set(requestId, Date.now() + REQUEST_ID_CACHE_TTL_MS)
  return false
}

function sendPlain(ws: WebSocket, message: RemoteServerMessage): void {
  if (ws.readyState !== ws.OPEN) return
  ws.send(JSON.stringify(message))
}

function sendEncrypted(ws: WebSocket, deviceId: string, message: RemoteServerMessage, sessionKey: Buffer): void {
  if (ws.readyState !== ws.OPEN) return
  const envelope = { deviceId, ...remoteCrypto.encryptPayload(message, sessionKey) }
  ws.send(JSON.stringify(envelope))
}

// 仮想アダプタ(VPN/WSL/仮想化ソフト等)らしき名前のNICはQR表示候補から除外する
const VIRTUAL_NIC_NAME_PATTERN = /vmware|virtualbox|wsl|tailscale|hyper-v|vethernet/i

function listLanIPv4Addresses(): string[] {
  const ifaces = networkInterfaces()
  const results: string[] = []
  for (const [name, addrs] of Object.entries(ifaces)) {
    if (!addrs || VIRTUAL_NIC_NAME_PATTERN.test(name)) continue
    for (const addr of addrs) {
      if (addr.family === 'IPv4' && !addr.internal) results.push(addr.address)
    }
  }
  return results
}

async function getDeviceSessionKey(deviceId: string): Promise<{ device: PairedDevice; sessionKey: Buffer } | null> {
  const settings = await settingsStore.getSettings()
  const device = settings.pairedDevices.find((d) => d.id === deviceId)
  if (!device) return null
  if (!safeStorage.isEncryptionAvailable()) {
    log.error('[remoteServer] safeStorage is not available on this OS; Ditto Remote device auth cannot proceed')
    return null
  }
  try {
    const decrypted = safeStorage.decryptString(Buffer.from(device.sessionKeyEncrypted, 'base64'))
    return { device, sessionKey: remoteCrypto.sessionKeyFromBase64(decrypted) }
  } catch {
    return null
  }
}

async function touchLastSeen(deviceId: string): Promise<void> {
  const settings = await settingsStore.getSettings()
  const next = settings.pairedDevices.map((d) =>
    d.id === deviceId ? { ...d, lastSeenAt: new Date().toISOString() } : d
  )
  await settingsStore.setPairedDevices(next)
}

// --- ペアリング情報(main -> 設定画面) ---

export async function getPairingInfo(): Promise<{
  urls: string[]
  port: number
  code: string
  expiresAtMs: number
  qrDataUrl: string
}> {
  const code = remoteCrypto.generatePairingCode()
  currentCode = { code, expiresAt: Date.now() + PAIRING_CODE_TTL_MS }
  const urls = listLanIPv4Addresses()
  const payload = JSON.stringify({ ips: urls, port: PORT, code })
  const qrDataUrl = await toDataURL(payload)
  return { urls, port: PORT, code, expiresAtMs: currentCode.expiresAt, qrDataUrl }
}

export async function listPairedDevices(): Promise<PairedDevice[]> {
  const settings = await settingsStore.getSettings()
  return settings.pairedDevices
}

export async function revokeDevice(deviceId: string): Promise<PairedDevice[]> {
  const settings = await settingsStore.getSettings()
  const next = settings.pairedDevices.filter((d) => d.id !== deviceId)
  await settingsStore.setPairedDevices(next)
  deviceCounters.delete(deviceId)
  const ws = liveConnections.get(deviceId)
  if (ws) {
    ws.close(4001, 'revoked')
    liveConnections.delete(deviceId)
  }
  notifyDeviceListChanged()
  return next
}

// --- ペアリング処理 ---

function handlePairMessage(
  ws: WebSocket,
  msg: Extract<RemoteClientMessage, { type: 'pair' }>,
  ip: string
): Promise<void> {
  const run = pairingChain.then(() => handlePairMessageInner(ws, msg, ip))
  pairingChain = run.catch(() => {})
  return run
}

async function handlePairMessageInner(
  ws: WebSocket,
  msg: Extract<RemoteClientMessage, { type: 'pair' }>,
  ip: string
): Promise<void> {
  if (rateLimiter.isBlocked(ip)) {
    return sendPlain(ws, { v: 1, type: 'pairRejected', reason: 'rate-limited' })
  }
  if (!currentCode || currentCode.code !== msg.code || Date.now() > currentCode.expiresAt) {
    rateLimiter.recordFailure(ip)
    return sendPlain(ws, { v: 1, type: 'pairRejected', reason: 'invalid-or-expired-code' })
  }
  currentCode = null // ワンタイム。使用後は即失効させ、同じコードでの二重ペアリングを防ぐ

  sendPlain(ws, { v: 1, type: 'pairPending' })

  let closedWhileWaiting = false
  const onClose = (): void => {
    closedWhileWaiting = true
  }
  ws.once('close', onClose)

  const deviceName = msg.deviceName.slice(0, 40) || '不明なデバイス'
  const dialogOptions = {
    type: 'question' as const,
    buttons: ['許可', '拒否'],
    defaultId: 0,
    cancelId: 1,
    title: 'Ditto Remote 連携リクエスト',
    message: `"${deviceName}" がこのPCとの連携を要求しています。\n許可しますか?`
  }
  // 親ウィンドウを指定しないとダイアログが背面に隠れて気付かれにくいため、
  // メインウィンドウを前面化してから、その子ウィンドウとして表示する
  const parentWindow = getMainWindow?.() ?? null
  parentWindow?.show()
  parentWindow?.focus()
  const approvalPromise = parentWindow
    ? dialog.showMessageBox(parentWindow, dialogOptions)
    : dialog.showMessageBox(dialogOptions)
  const timeoutPromise = new Promise<'timeout'>((resolve) => {
    setTimeout(() => resolve('timeout'), PAIR_APPROVAL_TIMEOUT_MS)
  })

  const result = await Promise.race([approvalPromise, timeoutPromise])
  ws.removeListener('close', onClose)

  if (result === 'timeout') {
    if (!closedWhileWaiting && ws.readyState === ws.OPEN) {
      sendPlain(ws, { v: 1, type: 'pairRejected', reason: 'timeout' })
    }
    return
  }

  if (closedWhileWaiting || ws.readyState !== ws.OPEN) return // 相手が既に離脱していれば何もしない

  if (result.response !== 0) {
    rateLimiter.recordFailure(ip) // 明示的な拒否も連打対策として失敗カウントする
    return sendPlain(ws, { v: 1, type: 'pairRejected', reason: 'denied-by-user' })
  }

  if (!safeStorage.isEncryptionAvailable()) {
    log.error('[remoteServer] safeStorage unavailable; cannot persist paired device')
    return sendPlain(ws, { v: 1, type: 'error', message: 'このPCではDitto Remoteのセキュア保存が利用できません' })
  }

  const deviceId = randomUUID()
  const sessionKey = remoteCrypto.generateSessionKey()
  const sessionKeyEncrypted = safeStorage
    .encryptString(remoteCrypto.sessionKeyToBase64(sessionKey))
    .toString('base64')
  const device: PairedDevice = {
    id: deviceId,
    name: deviceName,
    sessionKeyEncrypted,
    pairedAt: new Date().toISOString(),
    lastSeenAt: new Date().toISOString()
  }
  const settings = await settingsStore.getSettings()
  await settingsStore.setPairedDevices([...settings.pairedDevices, device])
  rateLimiter.recordSuccess(ip)
  deviceCounters.set(deviceId, 0)
  liveConnections.set(deviceId, ws)
  sendPlain(ws, { v: 1, type: 'paired', deviceId, sessionKey: remoteCrypto.sessionKeyToBase64(sessionKey) })
  notifyDeviceListChanged()
}

// --- 認証済みメッセージ処理 ---

async function buildItemsMessage(): Promise<Extract<RemoteServerMessage, { type: 'items' }>> {
  const [templates, macros] = await Promise.all([clipboardStore.listTemplates(), store.listMacros()])
  const templateItems: RemoteTemplateItem[] = templates
    .filter((t) => t.pinned)
    .map((t) => ({ id: t.id, label: t.label || t.text.slice(0, 40), preview: t.text.slice(0, 80) }))
  const macroItems: RemoteMacroItem[] = macros
    .filter((m) => m.pinned)
    .map((m) => ({ id: m.id, name: m.name, stepCount: m.steps.length }))
  return { v: 1, type: 'items', templates: templateItems, macros: macroItems }
}

async function handleTriggerTemplate(
  deviceId: string,
  ws: WebSocket,
  sessionKey: Buffer,
  msg: Extract<RemoteClientMessage, { type: 'triggerTemplate' }>
): Promise<void> {
  if (isDuplicateRequest(msg.requestId)) return
  try {
    const resolved = await resolveTemplateText(msg.templateId)
    await injectText(resolved)
    sendEncrypted(ws, deviceId, { v: 1, type: 'triggerResult', requestId: msg.requestId, ok: true }, sessionKey)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    sendEncrypted(ws, deviceId, { v: 1, type: 'triggerResult', requestId: msg.requestId, ok: false, message }, sessionKey)
  }
}

async function handleTriggerMacro(
  deviceId: string,
  ws: WebSocket,
  sessionKey: Buffer,
  msg: Extract<RemoteClientMessage, { type: 'triggerMacro' }>,
  manager: TargetManager,
  getWindow: () => BrowserWindow | null
): Promise<void> {
  if (isDuplicateRequest(msg.requestId)) return

  const macros = await store.listMacros()
  const macroCase = macros.find((m) => m.id === msg.macroId)
  if (!macroCase) {
    return sendEncrypted(
      ws,
      deviceId,
      { v: 1, type: 'triggerResult', requestId: msg.requestId, ok: false, message: 'マクロが見つかりません' },
      sessionKey
    )
  }

  if (manager.getStatus() !== 'idle') {
    return sendEncrypted(
      ws,
      deviceId,
      { v: 1, type: 'triggerResult', requestId: msg.requestId, ok: false, message: 'PC側で録画または再生が実行中です' },
      sessionKey
    )
  }

  new Notification({
    title: 'Ditto Remote',
    body: `スマホからマクロ「${macroCase.name}」が実行されました`
  }).show()

  const w = getWindow()
  const result = await runMacroForRemote(manager, macroCase, w)
  await store.recordRun(macroCase.id, result.finishedAt)
  sendEncrypted(
    ws,
    deviceId,
    { v: 1, type: 'triggerResult', requestId: msg.requestId, ok: result.success },
    sessionKey
  )
}

async function runMacroForRemote(
  manager: TargetManager,
  macroCase: MacroCase,
  w: BrowserWindow | null
): Promise<{ success: boolean; finishedAt: string }> {
  const result = await manager.runPlayback(macroCase, (progress: PlaybackProgress) => {
    // PC側のメインウィンドウが開いていれば、そちらにも進捗を反映する(通常のUI再生と同じ体験)
    w?.webContents.send(IPC.playbackProgress, progress)
  })
  return result
}

// --- WebSocket接続ハンドリング ---

function initWebSocketServer(manager: TargetManager, getWindow: () => BrowserWindow | null): void {
  if (!wss) return
  wss.on('connection', (ws: WebSocket, req: http.IncomingMessage) => {
    const ip = req.socket.remoteAddress ?? 'unknown'

    ws.on('message', (raw: RawData) => {
      void handleMessage(ws, ip, raw.toString(), manager, getWindow)
    })

    ws.on('close', () => {
      for (const [deviceId, conn] of liveConnections) {
        if (conn === ws) liveConnections.delete(deviceId)
      }
    })
  })
}

async function handleMessage(
  ws: WebSocket,
  ip: string,
  raw: string,
  manager: TargetManager,
  getWindow: () => BrowserWindow | null
): Promise<void> {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return
  }
  if (!parsed || typeof parsed !== 'object') return

  // 'pair' のみ平文。envelopeはdeviceId/iv/tag/dataを持つ
  if ('type' in parsed && (parsed as { type: unknown }).type === 'pair') {
    await handlePairMessage(ws, parsed as Extract<RemoteClientMessage, { type: 'pair' }>, ip)
    return
  }

  if (!('deviceId' in parsed) || !('iv' in parsed) || !('tag' in parsed) || !('data' in parsed)) return
  const envelope = parsed as { deviceId: string; iv: string; tag: string; data: string }

  if (rateLimiter.isBlocked(ip)) {
    return sendPlain(ws, { v: 1, type: 'authFailed', reason: 'rate-limited' })
  }

  const found = await getDeviceSessionKey(envelope.deviceId)
  if (!found) {
    rateLimiter.recordFailure(ip)
    return sendPlain(ws, { v: 1, type: 'authFailed', reason: 'unknown-device' })
  }
  const { device, sessionKey } = found

  let message: RemoteClientMessage
  try {
    message = remoteCrypto.decryptPayload<RemoteClientMessage>(envelope, sessionKey)
  } catch {
    rateLimiter.recordFailure(ip)
    return sendPlain(ws, { v: 1, type: 'authFailed', reason: 'decrypt-failed' })
  }

  // 復号(GCM認証タグの検証)に成功した時点でこのデバイス本人であることが確認できている
  rateLimiter.recordSuccess(ip)
  liveConnections.set(device.id, ws)

  if ('counter' in message) {
    const lastCounter = deviceCounters.get(device.id) ?? 0
    if (message.counter <= lastCounter) {
      // リプレイとみなして処理はしないが、無応答で返すとアプリ側が原因不明のまま
      // ハングするため、明示的にauthFailedを返す。正規のアプリはこれを受けて
      // counterを取り直した上で再接続できる
      return sendEncrypted(ws, device.id, { v: 1, type: 'authFailed', reason: 'stale-counter' }, sessionKey)
    }
    deviceCounters.set(device.id, message.counter)
  }

  void touchLastSeen(device.id)

  switch (message.type) {
    case 'auth':
      sendEncrypted(ws, device.id, { v: 1, type: 'authOk', deviceName: device.name }, sessionKey)
      break
    case 'listItems': {
      const items = await buildItemsMessage()
      sendEncrypted(ws, device.id, items, sessionKey)
      break
    }
    case 'triggerTemplate':
      await handleTriggerTemplate(device.id, ws, sessionKey, message)
      break
    case 'triggerMacro':
      await handleTriggerMacro(device.id, ws, sessionKey, message, manager, getWindow)
      break
  }
}

// --- 起動・停止 ---

export function initRemoteServer(getWindow: () => BrowserWindow | null, manager: TargetManager): { stop(): void } {
  getMainWindow = getWindow
  httpServer = http.createServer((_req, res) => {
    // クライアントはブラウザではなくネイティブアプリのため、静的ページ配信は行わない
    res.writeHead(404)
    res.end()
  })
  wss = new WebSocketServer({ server: httpServer, path: '/ws' })
  initWebSocketServer(manager, getWindow)

  httpServer.on('error', (err) => {
    log.error('[remoteServer] failed to start:', err)
  })
  httpServer.listen(PORT, '0.0.0.0', () => {
    log.info(`[remoteServer] Ditto Remote listening on port ${PORT}`)
  })

  return {
    stop(): void {
      for (const ws of liveConnections.values()) ws.close(1001, 'server-shutdown')
      liveConnections.clear()
      wss?.close()
      httpServer?.close()
      wss = null
      httpServer = null
    }
  }
}
