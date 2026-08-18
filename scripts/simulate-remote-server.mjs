#!/usr/bin/env node
/**
 * Ditto Remote(スマホ連携)のPC側サーバー(src/main/remoteServer.ts)を、Windows機が無い
 * 環境でも検証できるようにするための開発用モックサーバー。simulate-remote-client.mjsの
 * ちょうど逆で、あちらが「スマホの代わり」なのに対しこちらは「Ditto本体の代わり」を務める。
 *
 * 本体(Electron)はwin32.tsがトップレベルで`koffi.load('user32.dll')`を呼ぶためmacOS/Linuxでは
 * 起動できない。一方でモバイル側の検証に必要なのはWebSocket+AES-256-GCMのプロトコルだけなので、
 * remoteServer.ts / remoteCrypto.ts / rateLimiter.tsのプロトコル部分だけをElectron非依存で再実装する。
 *
 * 実機のDittoとの違い(意図的に置き換えている点):
 *  - ペアリング承認ダイアログ → このターミナルでの y/n 入力
 *  - safeStorageによるセッション鍵の暗号化保存 → 平文JSON(.remote-server-state.json)
 *  - 定型文入力(SendInput)・マクロ再生 → 標準出力へのログ表示のみ
 *  - 定型文/マクロの一覧 → 固定のダミー項目(mock-remote-items.jsonで差し替え可)
 * したがって「本物のPC側実装との相互運用」までは保証しない。プロトコル互換の範囲での検証用。
 *
 * 使い方:
 *   node scripts/simulate-remote-server.mjs [--auto-approve|--auto-deny] [--port 58211]
 *
 * 起動するとペアリングコードとQRコードを表示する。以後は対話コマンドで操作する:
 *   code            新しい6桁コード(+QR)を発行する
 *   list            ペアリング済みデバイス一覧
 *   revoke <番号>   デバイスを失効させる(接続中なら即切断)
 *   items           現在返しているダミー項目を表示する
 *   fail            トリガーの応答をok:false(失敗)に切り替える/戻す
 *   busy            マクロ実行を「PC側で録画または再生が実行中です」で拒否する/戻す
 *   quit            終了
 */

import http from 'http'
import { createInterface } from 'readline'
import { networkInterfaces } from 'os'
import { createCipheriv, createDecipheriv, randomBytes, randomInt, randomUUID } from 'crypto'
import { readFile, writeFile } from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'
import { WebSocketServer } from 'ws'
import QRCode from 'qrcode'

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const STATE_PATH = path.join(SCRIPT_DIR, '.remote-server-state.json')
const ITEMS_PATH = path.join(SCRIPT_DIR, 'mock-remote-items.json')

// --- remoteServer.ts と同じ定数 ---
const DEFAULT_PORT = 58211
const PAIRING_CODE_TTL_MS = 2 * 60_000
const PAIR_APPROVAL_TIMEOUT_MS = 60_000
const REQUEST_ID_CACHE_TTL_MS = 5 * 60_000
// --- remoteCrypto.ts と同じ定数 ---
const AES_ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 12
const AUTH_TAG_LENGTH = 16
// --- rateLimiter.ts と同じ定数 ---
const MAX_FAILURES = 5
const BLOCK_MS = 60_000

const args = process.argv.slice(2)
const AUTO_APPROVE = args.includes('--auto-approve')
const AUTO_DENY = args.includes('--auto-deny')
const portArgIndex = args.indexOf('--port')
const PORT = portArgIndex >= 0 ? Number(args[portArgIndex + 1]) : DEFAULT_PORT

/**
 * pinnedは本物のremoteServer.tsと同じ意味。itemsはピン留めで絞らず全件返し、
 * スマホ側は「まだボタンを設定していないときの自動配置」にpinnedのものだけを使う。
 * ここでは両方の挙動を試せるよう、pinned:trueとfalseを混ぜてある
 */
const DEFAULT_ITEMS = {
  templates: [
    { id: 'tpl-mock-1', label: 'メールの署名', preview: '株式会社サンプル 木島\nkijima@example.com', pinned: true },
    { id: 'tpl-mock-2', label: '長文テスト(日本語)', preview: 'これは日本語を含む定型文の入力テストです。', pinned: true },
    { id: 'tpl-mock-3', label: 'ASCIIテスト', preview: 'Hello from Ditto Remote', pinned: false }
  ],
  macros: [
    { id: 'macro-mock-1', name: 'ログイン手順', stepCount: 12, pinned: true },
    { id: 'macro-mock-2', name: '日次チェック', stepCount: 34, pinned: false }
  ]
}

// --- 暗号処理(remoteCrypto.ts と同一) ---

function encryptPayload(payload, sessionKey) {
  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv(AES_ALGORITHM, sessionKey, iv, { authTagLength: AUTH_TAG_LENGTH })
  const plaintext = Buffer.from(JSON.stringify(payload), 'utf-8')
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()])
  return {
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: encrypted.toString('base64')
  }
}

function decryptPayload(envelope, sessionKey) {
  const decipher = createDecipheriv(AES_ALGORITHM, sessionKey, Buffer.from(envelope.iv, 'base64'), {
    authTagLength: AUTH_TAG_LENGTH
  })
  decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'))
  const decrypted = Buffer.concat([decipher.update(Buffer.from(envelope.data, 'base64')), decipher.final()])
  return JSON.parse(decrypted.toString('utf-8'))
}

function generatePairingCode() {
  return randomInt(0, 1_000_000).toString().padStart(6, '0')
}

// --- レートリミッタ(rateLimiter.ts と同一) ---

const buckets = new Map()

function isBlocked(ip) {
  const b = buckets.get(ip)
  if (!b) return false
  if (b.blockedUntil !== 0 && Date.now() < b.blockedUntil) return true
  if (b.blockedUntil !== 0 && Date.now() >= b.blockedUntil) buckets.delete(ip)
  return false
}

function recordFailure(ip) {
  const b = buckets.get(ip) ?? { failures: 0, blockedUntil: 0 }
  b.failures += 1
  if (b.failures >= MAX_FAILURES) b.blockedUntil = Date.now() + BLOCK_MS
  buckets.set(ip, b)
}

function recordSuccess(ip) {
  buckets.delete(ip)
}

// --- 状態 ---

/** ペアリング済みデバイス。実機はsafeStorageで暗号化するが、ここは検証用なので平文で持つ */
let pairedDevices = []
let currentCode = null
let items = DEFAULT_ITEMS
let failTriggers = false
let busy = false
/** deviceId -> 生存中のWebSocket。失効時の即時切断・再接続時の掃除に使う */
const liveConnections = new Map()
/** deviceId -> 直近に受理したcounter。実機同様プロセス生存中のみメモリ保持する */
const deviceCounters = new Map()
/** requestId -> 期限(ms)。リトライによる多重実行を防ぐ */
const seenRequestIds = new Map()
/** ペアリング承認の待ち受け(同時に1件だけ) */
let pendingApproval = null

function log(...parts) {
  const t = new Date().toTimeString().slice(0, 8)
  console.log(`[${t}]`, ...parts)
}

async function loadState() {
  try {
    const raw = await readFile(STATE_PATH, 'utf-8')
    pairedDevices = JSON.parse(raw).pairedDevices ?? []
  } catch {
    pairedDevices = []
  }
}

async function saveState() {
  await writeFile(STATE_PATH, JSON.stringify({ pairedDevices }, null, 2), 'utf-8')
}

async function loadItems() {
  try {
    items = JSON.parse(await readFile(ITEMS_PATH, 'utf-8'))
    log(`ダミー項目を ${path.basename(ITEMS_PATH)} から読み込みました`)
  } catch {
    items = DEFAULT_ITEMS
  }
}

function listLanIPv4Addresses() {
  // 実機(remoteServer.ts)はVPN・仮想化アダプタらしき名前を除外する。macOSでは
  // utun(VPN)・awdl/llw(AirDrop等)・bridge(仮想ネットワーク)が同様に紛らわしいため足している
  const virtualPattern = /vmware|virtualbox|wsl|tailscale|hyper-v|vethernet|utun|awdl|llw|bridge/i
  const results = []
  for (const [name, addrs] of Object.entries(networkInterfaces())) {
    if (!addrs || virtualPattern.test(name)) continue
    for (const addr of addrs) {
      if (addr.family === 'IPv4' && !addr.internal) results.push(addr.address)
    }
  }
  return results
}

async function issuePairingCode() {
  const code = generatePairingCode()
  currentCode = { code, expiresAt: Date.now() + PAIRING_CODE_TTL_MS }
  const ips = listLanIPv4Addresses()
  const payload = JSON.stringify({ ips, port: PORT, code })
  console.log('')
  console.log(await QRCode.toString(payload, { type: 'terminal', small: true }))
  console.log(`  ペアリングコード: ${code}  (有効期限 ${PAIRING_CODE_TTL_MS / 1000}秒)`)
  console.log(`  手入力用: host=${ips[0] ?? '(LAN IPなし)'} port=${PORT}`)
  console.log(`  シミュレータからは host=127.0.0.1 でも到達できます(「USB接続」タブも同じ経路)`)
  console.log('')
}

// --- 送信ヘルパー ---

function sendPlain(ws, message) {
  if (ws.readyState !== ws.OPEN) return
  ws.send(JSON.stringify(message))
}

function sendEncrypted(ws, deviceId, message, sessionKey) {
  if (ws.readyState !== ws.OPEN) return
  ws.send(JSON.stringify({ deviceId, ...encryptPayload(message, sessionKey) }))
}

function isDuplicateRequest(requestId) {
  const now = Date.now()
  for (const [id, expiresAt] of seenRequestIds) {
    if (expiresAt < now) seenRequestIds.delete(id)
  }
  if (seenRequestIds.has(requestId)) return true
  seenRequestIds.set(requestId, now + REQUEST_ID_CACHE_TTL_MS)
  return false
}

// --- ペアリング ---

function askApproval(deviceName, ip) {
  if (AUTO_APPROVE) {
    log(`ペアリング要求を自動承認しました: "${deviceName}" (${ip})`)
    return Promise.resolve(true)
  }
  if (AUTO_DENY) {
    log(`ペアリング要求を自動拒否しました: "${deviceName}" (${ip})`)
    return Promise.resolve(false)
  }
  console.log('')
  console.log(`  ★ "${deviceName}" (${ip}) がこのPCとの連携を要求しています。`)
  console.log(`    許可する場合は y、拒否する場合は n を入力してください(${PAIR_APPROVAL_TIMEOUT_MS / 1000}秒で自動タイムアウト)`)
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pendingApproval = null
      log('承認待ちがタイムアウトしました')
      resolve('timeout')
    }, PAIR_APPROVAL_TIMEOUT_MS)
    pendingApproval = (answer) => {
      clearTimeout(timer)
      pendingApproval = null
      resolve(answer.trim().toLowerCase().startsWith('y'))
    }
  })
}

async function handlePair(ws, msg, ip) {
  if (isBlocked(ip)) {
    log(`ペアリング要求をレート制限で拒否しました (${ip})`)
    return sendPlain(ws, { v: 1, type: 'pairRejected', reason: 'rate-limited' })
  }
  if (!currentCode || currentCode.code !== msg.code || Date.now() > currentCode.expiresAt) {
    recordFailure(ip)
    log(`コード不一致または期限切れ: 受信=${msg.code}`)
    return sendPlain(ws, { v: 1, type: 'pairRejected', reason: 'invalid-or-expired-code' })
  }
  currentCode = null // ワンタイム

  sendPlain(ws, { v: 1, type: 'pairPending' })

  let closedWhileWaiting = false
  const onClose = () => {
    closedWhileWaiting = true
  }
  ws.once('close', onClose)

  const deviceName = String(msg.deviceName ?? '').slice(0, 40) || '不明なデバイス'
  const approved = await askApproval(deviceName, ip)
  ws.removeListener('close', onClose)

  if (approved === 'timeout') {
    if (!closedWhileWaiting && ws.readyState === ws.OPEN) {
      sendPlain(ws, { v: 1, type: 'pairRejected', reason: 'timeout' })
    }
    return
  }
  if (closedWhileWaiting || ws.readyState !== ws.OPEN) return
  if (!approved) {
    recordFailure(ip)
    return sendPlain(ws, { v: 1, type: 'pairRejected', reason: 'denied-by-user' })
  }

  const deviceId = randomUUID()
  const sessionKey = randomBytes(32)
  pairedDevices.push({
    id: deviceId,
    name: deviceName,
    sessionKeyBase64: sessionKey.toString('base64'),
    pairedAt: new Date().toISOString(),
    lastSeenAt: new Date().toISOString()
  })
  await saveState()
  recordSuccess(ip)
  deviceCounters.set(deviceId, 0)
  liveConnections.set(deviceId, ws)
  sendPlain(ws, { v: 1, type: 'paired', deviceId, sessionKey: sessionKey.toString('base64') })
  log(`ペアリング成立: "${deviceName}" deviceId=${deviceId}`)
}

// --- 認証済みメッセージ ---

function templateText(templateId) {
  const t = items.templates.find((x) => x.id === templateId)
  return t ? (t.text ?? t.preview) : null
}

async function handleEnvelope(ws, ip, envelope) {
  if (isBlocked(ip)) {
    return sendPlain(ws, { v: 1, type: 'authFailed', reason: 'rate-limited' })
  }
  const device = pairedDevices.find((d) => d.id === envelope.deviceId)
  if (!device) {
    recordFailure(ip)
    log(`未知のデバイスからのメッセージ: ${envelope.deviceId}`)
    return sendPlain(ws, { v: 1, type: 'authFailed', reason: 'unknown-device' })
  }
  const sessionKey = Buffer.from(device.sessionKeyBase64, 'base64')

  let message
  try {
    message = decryptPayload(envelope, sessionKey)
  } catch {
    recordFailure(ip)
    log(`復号に失敗しました (deviceId=${device.id})`)
    return sendPlain(ws, { v: 1, type: 'authFailed', reason: 'decrypt-failed' })
  }

  recordSuccess(ip)
  liveConnections.set(device.id, ws)

  if ('counter' in message) {
    const lastCounter = deviceCounters.get(device.id) ?? 0
    if (message.counter <= lastCounter) {
      log(`counterの巻き戻しを検出: 受信=${message.counter} 直近=${lastCounter}`)
      return sendEncrypted(ws, device.id, { v: 1, type: 'authFailed', reason: 'stale-counter' }, sessionKey)
    }
    deviceCounters.set(device.id, message.counter)
  }

  device.lastSeenAt = new Date().toISOString()
  void saveState()

  switch (message.type) {
    case 'auth':
      log(`auth 受信 (counter=${message.counter}) → authOk を返します`)
      sendEncrypted(ws, device.id, { v: 1, type: 'authOk', deviceName: device.name }, sessionKey)
      break
    case 'listItems':
      log(`listItems 受信 → 定型文${items.templates.length}件 / マクロ${items.macros.length}件を返します`)
      sendEncrypted(
        ws,
        device.id,
        {
          v: 1,
          type: 'items',
          // textは本文の実体でプロトコルには含めないため、明示した項目だけを送る
          templates: items.templates.map((t) => ({
            id: t.id,
            label: t.label,
            preview: t.preview,
            pinned: t.pinned === true
          })),
          macros: items.macros
        },
        sessionKey
      )
      break
    case 'triggerTemplate': {
      if (isDuplicateRequest(message.requestId)) {
        log(`重複したrequestIdのため無視しました: ${message.requestId}`)
        break
      }
      const text = templateText(message.templateId)
      if (text === null) {
        sendEncrypted(
          ws,
          device.id,
          { v: 1, type: 'triggerResult', requestId: message.requestId, ok: false, message: '定型文が見つかりません' },
          sessionKey
        )
        break
      }
      if (failTriggers) {
        log(`定型文トリガーを失敗として返します(failモード)`)
        sendEncrypted(
          ws,
          device.id,
          { v: 1, type: 'triggerResult', requestId: message.requestId, ok: false, message: 'テスト用の擬似エラー' },
          sessionKey
        )
        break
      }
      console.log('')
      console.log(`  >>> PC側に入力されるテキスト <<<`)
      console.log(text)
      console.log('')
      sendEncrypted(ws, device.id, { v: 1, type: 'triggerResult', requestId: message.requestId, ok: true }, sessionKey)
      break
    }
    case 'triggerMacro': {
      if (isDuplicateRequest(message.requestId)) {
        log(`重複したrequestIdのため無視しました: ${message.requestId}`)
        break
      }
      const macro = items.macros.find((m) => m.id === message.macroId)
      if (!macro) {
        sendEncrypted(
          ws,
          device.id,
          { v: 1, type: 'triggerResult', requestId: message.requestId, ok: false, message: 'マクロが見つかりません' },
          sessionKey
        )
        break
      }
      if (busy) {
        log(`マクロ実行をbusyとして拒否しました`)
        sendEncrypted(
          ws,
          device.id,
          {
            v: 1,
            type: 'triggerResult',
            requestId: message.requestId,
            ok: false,
            message: 'PC側で録画または再生が実行中です'
          },
          sessionKey
        )
        break
      }
      log(`通知: スマホからマクロ「${macro.name}」が実行されました (${macro.stepCount}ステップ)`)
      // 実機は再生完了まで応答を返さないため、それらしい待ち時間を挟む
      await new Promise((r) => setTimeout(r, Math.min(macro.stepCount * 50, 3000)))
      sendEncrypted(
        ws,
        device.id,
        { v: 1, type: 'triggerResult', requestId: message.requestId, ok: !failTriggers },
        sessionKey
      )
      log(`マクロ「${macro.name}」の実行結果を返しました (ok=${!failTriggers})`)
      break
    }
    default:
      log(`未知のメッセージ種別: ${message.type}`)
  }
}

// --- サーバー起動 ---

const httpServer = http.createServer((_req, res) => {
  res.writeHead(404)
  res.end()
})
const wss = new WebSocketServer({ server: httpServer, path: '/ws' })

wss.on('connection', (ws, req) => {
  const ip = req.socket.remoteAddress ?? 'unknown'
  log(`接続: ${ip}`)

  ws.on('message', (raw) => {
    let parsed
    try {
      parsed = JSON.parse(raw.toString())
    } catch {
      return
    }
    if (!parsed || typeof parsed !== 'object') return

    if (parsed.type === 'pair') {
      void handlePair(ws, parsed, ip)
      return
    }
    if (!('deviceId' in parsed) || !('iv' in parsed) || !('tag' in parsed) || !('data' in parsed)) return
    void handleEnvelope(ws, ip, parsed)
  })

  ws.on('close', () => {
    for (const [deviceId, conn] of liveConnections) {
      if (conn === ws) liveConnections.delete(deviceId)
    }
    log(`切断: ${ip}`)
  })
})

// --- 対話コマンド ---

const rl = createInterface({ input: process.stdin, output: process.stdout, prompt: '' })

function printHelp() {
  console.log('  code / list / revoke <番号> / items / fail / busy / help / quit')
}

async function handleCommand(line) {
  const [cmd, arg] = line.trim().split(/\s+/)
  switch (cmd) {
    case '':
      break
    case 'code':
      await issuePairingCode()
      break
    case 'list':
      if (pairedDevices.length === 0) {
        console.log('  (ペアリング済みデバイスなし)')
        break
      }
      pairedDevices.forEach((d, i) => {
        const live = liveConnections.has(d.id) ? '接続中' : '未接続'
        console.log(`  ${i + 1}. ${d.name} [${live}] id=${d.id} 最終=${d.lastSeenAt}`)
      })
      break
    case 'revoke': {
      const index = Number(arg) - 1
      const device = pairedDevices[index]
      if (!device) {
        console.log('  番号が不正です。list で確認してください')
        break
      }
      pairedDevices = pairedDevices.filter((d) => d.id !== device.id)
      deviceCounters.delete(device.id)
      const ws = liveConnections.get(device.id)
      if (ws) {
        ws.close(4001, 'revoked')
        liveConnections.delete(device.id)
      }
      await saveState()
      log(`失効させました: ${device.name}`)
      break
    }
    case 'items':
      console.log(JSON.stringify(items, null, 2))
      break
    case 'fail':
      failTriggers = !failTriggers
      console.log(`  トリガー失敗モード: ${failTriggers ? 'ON' : 'OFF'}`)
      break
    case 'busy':
      busy = !busy
      console.log(`  busyモード: ${busy ? 'ON' : 'OFF'}`)
      break
    case 'help':
      printHelp()
      break
    case 'quit':
    case 'exit':
      process.exit(0)
      break
    default:
      console.log(`  未知のコマンド: ${cmd}`)
      printHelp()
  }
}

rl.on('line', (line) => {
  if (pendingApproval) {
    pendingApproval(line)
    return
  }
  void handleCommand(line)
})

await loadState()
await loadItems()

httpServer.on('error', (err) => {
  console.error('[simulate-remote-server] 起動に失敗しました:', err.message)
  process.exit(1)
})

httpServer.listen(PORT, '0.0.0.0', async () => {
  log(`Ditto Remote(モック)が ポート${PORT} で待ち受けを開始しました`)
  if (pairedDevices.length > 0) {
    log(`ペアリング済みデバイス ${pairedDevices.length}件を ${path.basename(STATE_PATH)} から読み込みました`)
  }
  await issuePairingCode()
  printHelp()
})
