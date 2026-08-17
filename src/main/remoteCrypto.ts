import { createCipheriv, createDecipheriv, randomBytes, randomInt } from 'crypto'

// deviceIdの付与はremoteServer.ts側の責務のため、ここでは{iv, tag, data}のみを扱う
type CipherEnvelope = { iv: string; tag: string; data: string }

/**
 * Ditto Remote(スマホ連携)の暗号ユーティリティ。
 * PC-アプリ間はTLSを使わず(ネイティブアプリ側で動的な自己署名証明書をピンニングする
 * 実装が煩雑なため)、ペアリング応答でのみ渡すセッション鍵を使ってメッセージ本文を
 * AES-256-GCMでアプリケーション層暗号化する。この鍵を持っている(=正しく復号できる)
 * こと自体が認証を兼ねるため、別途トークンは持たない。モバイル側はexpo-cryptoの
 * AES APIで同じ{iv, tag, data}形式を扱う。
 */

const AES_ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 12
const AUTH_TAG_LENGTH = 16

/** ペアリング用のワンタイム6桁コード */
export function generatePairingCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, '0')
}

/** AES-256-GCM用のセッション鍵(ペアリング時に1度だけ生成し、以後は再送しない) */
export function generateSessionKey(): Buffer {
  return randomBytes(32)
}

export function sessionKeyToBase64(key: Buffer): string {
  return key.toString('base64')
}

export function sessionKeyFromBase64(value: string): Buffer {
  return Buffer.from(value, 'base64')
}

/** JSONにシリアライズしてAES-256-GCMで暗号化する。IVは毎回ランダムに生成する */
export function encryptPayload(payload: unknown, sessionKey: Buffer): CipherEnvelope {
  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv(AES_ALGORITHM, sessionKey, iv, { authTagLength: AUTH_TAG_LENGTH })
  const plaintext = Buffer.from(JSON.stringify(payload), 'utf-8')
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()])
  const tag = cipher.getAuthTag()
  return {
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    data: encrypted.toString('base64')
  }
}

/** encryptPayload()で作った封筒を復号し、JSONとしてパースする。改ざん・鍵不一致の場合は例外を投げる */
export function decryptPayload<T = unknown>(envelope: CipherEnvelope, sessionKey: Buffer): T {
  const iv = Buffer.from(envelope.iv, 'base64')
  const tag = Buffer.from(envelope.tag, 'base64')
  const data = Buffer.from(envelope.data, 'base64')
  const decipher = createDecipheriv(AES_ALGORITHM, sessionKey, iv, { authTagLength: AUTH_TAG_LENGTH })
  decipher.setAuthTag(tag)
  const decrypted = Buffer.concat([decipher.update(data), decipher.final()])
  return JSON.parse(decrypted.toString('utf-8')) as T
}
