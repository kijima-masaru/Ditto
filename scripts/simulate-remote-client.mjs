#!/usr/bin/env node
/**
 * Ditto Remote(スマホ連携)のPC側プロトコルを、実機Androidアプリが無くても検証するための
 * 開発用シミュレータ。remoteServer.ts(src/main/remoteServer.ts)が実装するペアリング・
 * 認証・暗号化メッセージのやり取りを、Androidアプリの代わりにNodeから直接叩く。
 *
 * 使い方:
 *   node scripts/simulate-remote-client.mjs pair <6桁コード> [デバイス名]
 *     Ditto設定画面の「スマホ連携」で表示したコードを渡してペアリングする。
 *     成功するとデバイスID・セッション鍵を scripts/.remote-client-state.json に保存する。
 *
 *   node scripts/simulate-remote-client.mjs auth
 *   node scripts/simulate-remote-client.mjs list
 *   node scripts/simulate-remote-client.mjs trigger-template <templateId>
 *   node scripts/simulate-remote-client.mjs trigger-macro <macroId>
 *     保存済みの状態を使って、各操作を1回送信し結果を表示する。
 */

import { WebSocket } from 'ws'
import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'crypto'
import { readFile, writeFile } from 'fs/promises'
import { fileURLToPath } from 'url'
import path from 'path'

const HOST = process.env.DITTO_REMOTE_HOST ?? '127.0.0.1'
const PORT = Number(process.env.DITTO_REMOTE_PORT ?? 58211)
const STATE_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), '.remote-client-state.json')

const AES_ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 12
const AUTH_TAG_LENGTH = 16

function encryptPayload(payload, sessionKey) {
  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv(AES_ALGORITHM, sessionKey, iv, { authTagLength: AUTH_TAG_LENGTH })
  const plaintext = Buffer.from(JSON.stringify(payload), 'utf-8')
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()])
  const tag = cipher.getAuthTag()
  return { iv: iv.toString('base64'), tag: tag.toString('base64'), data: encrypted.toString('base64') }
}

function decryptPayload(envelope, sessionKey) {
  const iv = Buffer.from(envelope.iv, 'base64')
  const tag = Buffer.from(envelope.tag, 'base64')
  const data = Buffer.from(envelope.data, 'base64')
  const decipher = createDecipheriv(AES_ALGORITHM, sessionKey, iv, { authTagLength: AUTH_TAG_LENGTH })
  decipher.setAuthTag(tag)
  const decrypted = Buffer.concat([decipher.update(data), decipher.final()])
  return JSON.parse(decrypted.toString('utf-8'))
}

async function loadState() {
  try {
    return JSON.parse(await readFile(STATE_PATH, 'utf-8'))
  } catch {
    return null
  }
}

async function saveState(state) {
  await writeFile(STATE_PATH, JSON.stringify(state, null, 2), 'utf-8')
}

function connect() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://${HOST}:${PORT}/ws`)
    ws.once('open', () => resolve(ws))
    ws.once('error', reject)
  })
}

function waitForMessage(ws, timeoutMs = 15_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout waiting for server response')), timeoutMs)
    ws.once('message', (raw) => {
      clearTimeout(timer)
      resolve(JSON.parse(raw.toString()))
    })
  })
}

async function cmdPair(code, deviceName) {
  if (!code) throw new Error('使い方: pair <6桁コード> [デバイス名]')
  const ws = await connect()
  ws.send(JSON.stringify({ v: 1, type: 'pair', code, deviceName: deviceName ?? 'シミュレータ端末' }))

  // pairPending -> paired/pairRejected の順で届く想定。pairPendingは読み飛ばす
  let msg = await waitForMessage(ws)
  console.log('<-', msg)
  if (msg.type === 'pairPending') {
    console.log('(PC側の承認ダイアログで「許可」を押してください。60秒待ちます…)')
    msg = await waitForMessage(ws, 65_000)
    console.log('<-', msg)
  }

  if (msg.type === 'paired') {
    await saveState({ deviceId: msg.deviceId, sessionKey: msg.sessionKey, counter: 0 })
    console.log('ペアリング成功。状態を保存しました:', STATE_PATH)
  } else {
    console.log('ペアリングは完了しませんでした')
  }
  ws.close()
}

async function sendAuthenticated(payloadWithoutCounterAndV) {
  const state = await loadState()
  if (!state) throw new Error('先に pair コマンドでペアリングしてください')
  const sessionKey = Buffer.from(state.sessionKey, 'base64')
  const counter = state.counter + 1

  const ws = await connect()
  const payload = { v: 1, counter, ...payloadWithoutCounterAndV }
  const envelope = { deviceId: state.deviceId, ...encryptPayload(payload, sessionKey) }
  ws.send(JSON.stringify(envelope))

  const raw = await waitForMessage(ws)
  ws.close()
  state.counter = counter
  await saveState(state)

  // authFailed等は平文、それ以外は暗号化封筒で返る
  if ('iv' in raw && 'tag' in raw && 'data' in raw) {
    return decryptPayload(raw, sessionKey)
  }
  return raw
}

async function cmdAuth() {
  console.log('<-', await sendAuthenticated({ type: 'auth' }))
}

async function cmdList() {
  console.log('<-', await sendAuthenticated({ type: 'listItems' }))
}

async function cmdTriggerTemplate(templateId) {
  if (!templateId) throw new Error('使い方: trigger-template <templateId>')
  console.log('<-', await sendAuthenticated({ type: 'triggerTemplate', templateId, requestId: randomUUID() }))
}

async function cmdTriggerMacro(macroId) {
  if (!macroId) throw new Error('使い方: trigger-macro <macroId>')
  console.log(
    '<-',
    await sendAuthenticated({ type: 'triggerMacro', macroId, requestId: randomUUID(), confirmed: true })
  )
}

const [, , command, ...args] = process.argv

try {
  switch (command) {
    case 'pair':
      await cmdPair(args[0], args[1])
      break
    case 'auth':
      await cmdAuth()
      break
    case 'list':
      await cmdList()
      break
    case 'trigger-template':
      await cmdTriggerTemplate(args[0])
      break
    case 'trigger-macro':
      await cmdTriggerMacro(args[0])
      break
    default:
      console.error('使い方: node scripts/simulate-remote-client.mjs <pair|auth|list|trigger-template|trigger-macro> [...]')
      process.exit(1)
  }
} catch (err) {
  console.error('エラー:', err instanceof Error ? err.message : err)
  process.exit(1)
}
