/**
 * Ditto Remote(スマホ連携)の認証・ペアリング試行に対する簡易レートリミッタ。
 * 同一IPからの失敗(コード不一致・トークン不一致・ユーザーによる明示拒否)を数え、
 * 一定回数を超えたら一時的にブロックする。LAN内の個人利用アプリという規模を踏まえ、
 * メモリ内管理のみとし(再起動でリセットされる)、永続化やガベージコレクションは行わない
 */

interface Bucket {
  failures: number
  blockedUntil: number // epoch ms。0なら未ブロック
}

const MAX_FAILURES = 5
const BLOCK_MS = 60_000

const buckets = new Map<string, Bucket>()

export function isBlocked(ip: string): boolean {
  const b = buckets.get(ip)
  if (!b) return false
  if (b.blockedUntil !== 0 && Date.now() < b.blockedUntil) return true
  if (b.blockedUntil !== 0 && Date.now() >= b.blockedUntil) buckets.delete(ip)
  return false
}

export function recordFailure(ip: string): void {
  const b = buckets.get(ip) ?? { failures: 0, blockedUntil: 0 }
  b.failures += 1
  if (b.failures >= MAX_FAILURES) b.blockedUntil = Date.now() + BLOCK_MS
  buckets.set(ip, b)
}

export function recordSuccess(ip: string): void {
  buckets.delete(ip)
}
