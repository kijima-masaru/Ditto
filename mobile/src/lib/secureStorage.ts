import * as SecureStore from 'expo-secure-store'

/**
 * ペアリング済みの認証情報(デバイスID・セッション鍵・接続先)を暗号化して端末に保存する
 * (expo-secure-store。裏で使うのはAndroidならKeystore、iOSならKeychain)。セッション鍵は
 * Ditto Remoteの唯一の秘密であり、これを保持している限り再ペアリングなしに再接続できる
 */

const STORAGE_KEY = 'ditto_remote_credentials'

/**
 * iOSのKeychainは既定(WHEN_UNLOCKED)だとバックアップ復元時に別の端末へ移行される。
 * セッション鍵が移行先の端末に渡ると、PC側から見て失効させたつもりのない端末が
 * 増えることになるため、この端末限定にする。Androidでは無視されるオプション
 */
const KEYCHAIN_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY
}

export interface StoredCredentials {
  deviceId: string
  sessionKeyBase64: string
  host: string
  port: number
  /**
   * 次回接続時に使い始めるcounterの下限。PC側(remoteServer.tsのdeviceCounters)は
   * 再接続をまたいでcounterの単調増加を要求するため、アプリを再起動しても以前送った
   * どの値よりも大きい値から再開できるようにここへ保存しておく。書き込み回数を抑える
   * ため、送信のたびではなくブロック単位(wsClient.tsのCOUNTER_BLOCK)で先に予約する
   */
  counter?: number
}

export async function saveCredentials(creds: StoredCredentials): Promise<void> {
  await SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify(creds), KEYCHAIN_OPTIONS)
}

export async function loadCredentials(): Promise<StoredCredentials | null> {
  const raw = await SecureStore.getItemAsync(STORAGE_KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw) as StoredCredentials
  } catch {
    return null
  }
}

export async function clearCredentials(): Promise<void> {
  await SecureStore.deleteItemAsync(STORAGE_KEY)
}
