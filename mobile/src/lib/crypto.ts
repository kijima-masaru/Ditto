import { AESEncryptionKey, AESSealedData, aesDecryptAsync, aesEncryptAsync } from 'expo-crypto'

/**
 * PC側(src/main/remoteCrypto.ts)と同じAES-256-GCMの暗号化封筒{iv, tag, data}(すべてbase64)
 * を扱うためのラッパー。JSONペイロードはUTF-8バイト列にエンコードしてから暗号化する
 * (expo-cryptoのBinaryInputに文字列を渡す場合base64エンコード済みである必要があるため、
 * 生のJSON文字列をそのまま渡さずTextEncoderでバイト列化して渡す)。
 */

export interface EncryptedEnvelopeParts {
  iv: string
  tag: string
  data: string
}

export async function importSessionKey(sessionKeyBase64: string): Promise<AESEncryptionKey> {
  return AESEncryptionKey.import(sessionKeyBase64, 'base64')
}

export async function encryptPayload(payload: unknown, key: AESEncryptionKey): Promise<EncryptedEnvelopeParts> {
  const plaintextBytes = new TextEncoder().encode(JSON.stringify(payload))
  const sealed = await aesEncryptAsync(plaintextBytes, key, { nonce: { length: 12 }, tagLength: 16 })
  const [iv, tag, data] = await Promise.all([
    sealed.iv('base64'),
    sealed.tag('base64'),
    sealed.ciphertext({ includeTag: false, encoding: 'base64' })
  ])
  return { iv, tag, data }
}

export async function decryptPayload<T = unknown>(envelope: EncryptedEnvelopeParts, key: AESEncryptionKey): Promise<T> {
  const sealed = AESSealedData.fromParts(envelope.iv, envelope.data, envelope.tag)
  const decryptedBytes = await aesDecryptAsync(sealed, key, { output: 'bytes' })
  const json = new TextDecoder().decode(decryptedBytes as Uint8Array)
  return JSON.parse(json) as T
}
