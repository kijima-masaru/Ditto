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

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

function bytesToBase64(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i]
    const b1 = bytes[i + 1] ?? 0
    const b2 = bytes[i + 2] ?? 0
    out += BASE64_ALPHABET[b0 >> 2]
    out += BASE64_ALPHABET[((b0 & 0x03) << 4) | (b1 >> 4)]
    out += i + 1 < bytes.length ? BASE64_ALPHABET[((b1 & 0x0f) << 2) | (b2 >> 6)] : '='
    out += i + 2 < bytes.length ? BASE64_ALPHABET[b2 & 0x3f] : '='
  }
  return out
}

/**
 * expo-cryptoのAES APIは、encodingを位置引数で取るiv()/tag()はbase64文字列を返すが、
 * optionsオブジェクトで受け取るciphertext()はAndroidネイティブ実装がencodingを無視して
 * Uint8Arrayを返す(型定義上はPromise<string>なのでtscでは検出できない)。そのまま
 * JSON.stringifyすると{"0":60,...}というobjectになりPC側の復号が必ず失敗するため、
 * 文字列とバイト列のどちらが返ってきてもbase64文字列に正規化する
 */
function toBase64(value: string | Uint8Array): string {
  return typeof value === 'string' ? value : bytesToBase64(value)
}

/**
 * AESSealedData.fromPartsは型定義上base64文字列を受け付けるが、Androidネイティブ実装は
 * tagにStringを渡すと "Cannot convert '...' to a Kotlin type" で落ちる。3引数目が
 * BinaryInput(tag)とnumber(tagLength)のオーバーロードになっている都合と思われる。
 * 曖昧さを避けるため、封筒の各要素は自前でバイト列に戻してから渡す
 */
function base64ToBytes(value: string): Uint8Array {
  const clean = value.replace(/=+$/, '')
  const bytes = new Uint8Array((clean.length * 3) >> 2)
  let bits = 0
  let acc = 0
  let out = 0
  for (let i = 0; i < clean.length; i++) {
    const idx = BASE64_ALPHABET.indexOf(clean[i])
    if (idx < 0) continue
    acc = (acc << 6) | idx
    bits += 6
    if (bits >= 8) {
      bits -= 8
      bytes[out++] = (acc >> bits) & 0xff
    }
  }
  return bytes
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
    // 戻り値の実体はstringとは限らないため、型定義を信じずに正規化する(toBase64のコメント参照)
    sealed.ciphertext({ includeTag: false, encoding: 'base64' }) as Promise<string | Uint8Array>
  ])
  return { iv: toBase64(iv), tag: toBase64(tag), data: toBase64(data) }
}

export async function decryptPayload<T = unknown>(envelope: EncryptedEnvelopeParts, key: AESEncryptionKey): Promise<T> {
  const sealed = AESSealedData.fromParts(
    base64ToBytes(envelope.iv),
    base64ToBytes(envelope.data),
    base64ToBytes(envelope.tag)
  )
  const decryptedBytes = await aesDecryptAsync(sealed, key, { output: 'bytes' })
  const json = new TextDecoder().decode(decryptedBytes as Uint8Array)
  return JSON.parse(json) as T
}
