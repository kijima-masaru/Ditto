import * as SecureStore from 'expo-secure-store'

/**
 * ペアリング済みの認証情報(デバイスID・セッション鍵・接続先)をOSの安全な保管領域
 * (AndroidはKeystore、iOSはKeychain)で暗号化して端末に保存する(expo-secure-store)。
 * セッション鍵はDitto Remoteの唯一の秘密であり、これを保持している限り再ペアリング
 * なしに再接続できる
 */

const STORAGE_KEY = 'ditto_remote_credentials'

/**
 * iOSのKeychainは既定(WHEN_UNLOCKED)だと暗号化バックアップ経由で別の端末に復元されるため、
 * 機種変更や復元でセッション鍵ごとPCの操作権限が移ってしまう。この鍵は保存した端末だけで
 * 使えればよいので、端末外に持ち出されない THIS_DEVICE_ONLY を指定する
 * (このオプションはiOS専用で、Android側の挙動には影響しない)。
 */
const OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY
}

export interface StoredCredentials {
  deviceId: string
  sessionKeyBase64: string
  host: string
  port: number
}

export async function saveCredentials(creds: StoredCredentials): Promise<void> {
  await SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify(creds), OPTIONS)
}

export async function loadCredentials(): Promise<StoredCredentials | null> {
  const raw = await SecureStore.getItemAsync(STORAGE_KEY, OPTIONS)
  if (!raw) return null
  try {
    return JSON.parse(raw) as StoredCredentials
  } catch {
    return null
  }
}

export async function clearCredentials(): Promise<void> {
  await SecureStore.deleteItemAsync(STORAGE_KEY, OPTIONS)
}
