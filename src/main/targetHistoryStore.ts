import { app } from 'electron'
import { randomUUID } from 'crypto'
import fs from 'fs/promises'
import path from 'path'
import type { TargetHistoryEntry, TargetKind } from '../shared/types'

const MAX_HISTORY = 50

function historyFilePath(): string {
  return path.join(app.getPath('userData'), 'target-history.json')
}

export async function listHistory(): Promise<TargetHistoryEntry[]> {
  try {
    const raw = await fs.readFile(historyFilePath(), 'utf-8')
    return JSON.parse(raw) as TargetHistoryEntry[]
  } catch {
    return []
  }
}

export interface RecordTargetHistoryInput {
  kind: TargetKind
  label: string
  url?: string
  exePath?: string
  exeArgs?: string
}

/**
 * 同じ対象(URL/実行ファイルパスが一致)が既に履歴にあれば、ラベル・使用日時のみ更新して
 * 先頭に移動する。無ければ新規追加する。
 */
export async function recordEntry(input: RecordTargetHistoryInput): Promise<TargetHistoryEntry> {
  const history = await listHistory()
  const matchKey = input.kind === 'web' ? input.url : input.exePath
  const existingIndex = history.findIndex((h) =>
    h.kind === input.kind && (input.kind === 'web' ? h.url === matchKey : h.exePath === matchKey)
  )

  const entry: TargetHistoryEntry = {
    id: existingIndex >= 0 ? history[existingIndex].id : randomUUID(),
    kind: input.kind,
    label: input.label,
    url: input.url,
    exePath: input.exePath,
    exeArgs: input.exeArgs,
    lastUsedAt: new Date().toISOString()
  }

  if (existingIndex >= 0) history.splice(existingIndex, 1)
  const trimmed = [entry, ...history].slice(0, MAX_HISTORY)
  await fs.writeFile(historyFilePath(), JSON.stringify(trimmed, null, 2), 'utf-8')
  return entry
}
