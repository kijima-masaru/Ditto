/**
 * Ditto Remote のWebSocketメッセージ型。PC側(src/main/remoteServer.ts, src/shared/types.ts)
 * のRemoteClientMessage/RemoteServerMessageと1対1で対応させる。mobile/はPC側と別の
 * npmプロジェクトのため型定義は共有せずここに複製する(型がずれた場合は通信が
 * decrypt-failed等で弾かれるため、変更時は両側を合わせて更新すること)。
 */

export type RemoteClientMessage =
  | { v: 1; type: 'pair'; code: string; deviceName: string }
  | { v: 1; type: 'auth'; counter: number }
  | { v: 1; type: 'listItems'; counter: number }
  | { v: 1; type: 'triggerTemplate'; templateId: string; requestId: string; counter: number }
  | { v: 1; type: 'triggerMacro'; macroId: string; requestId: string; confirmed: true; counter: number }

export type RemoteServerMessage =
  | { v: 1; type: 'pairPending' }
  | { v: 1; type: 'paired'; deviceId: string; sessionKey: string }
  | {
      v: 1
      type: 'pairRejected'
      reason: 'invalid-or-expired-code' | 'denied-by-user' | 'timeout' | 'rate-limited'
    }
  | { v: 1; type: 'authOk'; deviceName: string }
  | {
      v: 1
      type: 'authFailed'
      reason: 'unknown-device' | 'decrypt-failed' | 'revoked' | 'rate-limited' | 'stale-counter'
    }
  | { v: 1; type: 'items'; templates: RemoteTemplateItem[]; macros: RemoteMacroItem[] }
  | { v: 1; type: 'triggerResult'; requestId: string; ok: boolean; message?: string }
  | { v: 1; type: 'error'; message: string }

export interface RemoteTemplateItem {
  id: string
  label: string
  preview: string
}

export interface RemoteMacroItem {
  id: string
  name: string
  stepCount: number
}

export interface EncryptedEnvelope {
  deviceId: string
  iv: string
  tag: string
  data: string
}

/** ペアリングQRコードの中身({ips, port, code}をJSON化したもの) */
export interface PairingQrPayload {
  ips: string[]
  port: number
  code: string
}
