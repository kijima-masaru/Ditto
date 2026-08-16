import { app } from 'electron'
import { randomUUID } from 'crypto'
import fs from 'fs/promises'
import path from 'path'
import {
  TEMPLATE_TRIGGER_PATTERN,
  type ClipboardFormatRule,
  type ClipboardHistoryEntry,
  type ClipboardTemplate,
  type ClipboardTemplateFolder
} from '../shared/types'

const MAX_HISTORY = 200

function historyFilePath(): string {
  return path.join(app.getPath('userData'), 'clipboard-history.json')
}

function templatesFilePath(): string {
  return path.join(app.getPath('userData'), 'clipboard-templates.json')
}

function templateFoldersFilePath(): string {
  return path.join(app.getPath('userData'), 'clipboard-template-folders.json')
}

function formatRulesFilePath(): string {
  return path.join(app.getPath('userData'), 'clipboard-format-rules.json')
}

async function readJson<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(filePath, 'utf-8')
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

// v1.24.10までは type フィールドが存在せず、全エントリがテキストだった。
// 旧形式のデータを読み込んだ場合はtype:'text'を補って扱う
function normalizeEntry(e: Partial<ClipboardHistoryEntry> & { id: string; copiedAt: string }): ClipboardHistoryEntry {
  return {
    id: e.id,
    type: e.type ?? 'text',
    text: e.text ?? '',
    imageDataUrl: e.imageDataUrl,
    copiedAt: e.copiedAt
  }
}

export async function listHistory(): Promise<ClipboardHistoryEntry[]> {
  const raw = await readJson<ClipboardHistoryEntry[]>(historyFilePath(), [])
  return raw.map(normalizeEntry)
}

async function writeHistory(history: ClipboardHistoryEntry[]): Promise<void> {
  await fs.writeFile(historyFilePath(), JSON.stringify(history, null, 2), 'utf-8')
}

export async function appendHistory(text: string): Promise<ClipboardHistoryEntry> {
  const history = await listHistory()
  const entry: ClipboardHistoryEntry = { id: randomUUID(), type: 'text', text, copiedAt: new Date().toISOString() }
  const trimmed = [entry, ...history].slice(0, MAX_HISTORY)
  await writeHistory(trimmed)
  return entry
}

/** 画像がコピーされた際、まずOCR結果なしで即座に履歴へ追加する(OCRは数秒かかるため後追いで反映する) */
export async function appendImageHistory(imageDataUrl: string): Promise<ClipboardHistoryEntry> {
  const history = await listHistory()
  const entry: ClipboardHistoryEntry = {
    id: randomUUID(),
    type: 'image',
    text: '',
    imageDataUrl,
    copiedAt: new Date().toISOString()
  }
  const trimmed = [entry, ...history].slice(0, MAX_HISTORY)
  await writeHistory(trimmed)
  return entry
}

export async function deleteHistoryEntry(id: string): Promise<void> {
  const history = await listHistory()
  await writeHistory(history.filter((h) => h.id !== id))
}

export async function clearHistory(): Promise<void> {
  await fs.writeFile(historyFilePath(), JSON.stringify([], null, 2), 'utf-8')
}

async function readTemplates(): Promise<ClipboardTemplate[]> {
  const templates = await readJson<ClipboardTemplate[]>(templatesFilePath(), [])
  // orderが未設定の既存データ(旧バージョン)は配列の並びのまま採番する
  let needsBackfill = false
  templates.forEach((t, i) => {
    if (typeof t.order !== 'number') {
      t.order = i
      needsBackfill = true
    }
  })
  if (needsBackfill) await fs.writeFile(templatesFilePath(), JSON.stringify(templates, null, 2), 'utf-8')
  return templates
}

export async function listTemplates(): Promise<ClipboardTemplate[]> {
  const templates = await readTemplates()
  return templates.sort((a, b) => a.order - b.order)
}

function normalizeTrigger(trigger?: string): string | undefined {
  const trimmed = trigger?.trim().toLowerCase()
  return trimmed ? trimmed : undefined
}

/** トリガー文字列が使用可能(文字種OK・他の定型文と重複なし)であることを確認する。違反時は例外を投げる */
async function assertTriggerAvailable(trigger: string | undefined, excludeId?: string): Promise<void> {
  if (!trigger) return
  if (!TEMPLATE_TRIGGER_PATTERN.test(trigger)) {
    throw new Error('トリガーは半角英数字と ; : . / , - _ の組み合わせ(2〜20文字)で入力してください')
  }
  const templates = await readTemplates()
  const conflict = templates.find((t) => t.id !== excludeId && normalizeTrigger(t.trigger) === trigger)
  if (conflict) {
    const conflictName = conflict.label || conflict.text.slice(0, 20)
    throw new Error(`トリガー「${trigger}」は既に「${conflictName}」で使われています`)
  }
}

export async function createTemplate(
  text: string,
  label?: string,
  folderId: string | null = null,
  trigger?: string
): Promise<ClipboardTemplate> {
  const normalizedTrigger = normalizeTrigger(trigger)
  await assertTriggerAvailable(normalizedTrigger)
  const templates = await readTemplates()
  const order = templates.length === 0 ? 0 : Math.max(...templates.map((t) => t.order)) + 1
  const template: ClipboardTemplate = {
    id: randomUUID(),
    text,
    label,
    createdAt: new Date().toISOString(),
    folderId,
    order,
    trigger: normalizedTrigger
  }
  await fs.writeFile(templatesFilePath(), JSON.stringify([...templates, template], null, 2), 'utf-8')
  return template
}

/** 指定した順序(同じフォルダ内でのドラッグ&ドロップ結果)通りにorderを振り直す */
export async function reorderTemplates(orderedIds: string[]): Promise<void> {
  const templates = await readTemplates()
  orderedIds.forEach((id, index) => {
    const template = templates.find((t) => t.id === id)
    if (template) template.order = index
  })
  await fs.writeFile(templatesFilePath(), JSON.stringify(templates, null, 2), 'utf-8')
}

export async function updateTemplate(id: string, text: string, label?: string, trigger?: string): Promise<void> {
  const normalizedTrigger = normalizeTrigger(trigger)
  await assertTriggerAvailable(normalizedTrigger, id)
  const templates = await listTemplates()
  const template = templates.find((t) => t.id === id)
  if (template) {
    template.text = text
    template.label = label
    template.trigger = normalizedTrigger
  }
  await fs.writeFile(templatesFilePath(), JSON.stringify(templates, null, 2), 'utf-8')
}

export async function deleteTemplate(id: string): Promise<void> {
  const templates = await listTemplates()
  await fs.writeFile(templatesFilePath(), JSON.stringify(templates.filter((t) => t.id !== id), null, 2), 'utf-8')
}

export async function moveTemplate(id: string, folderId: string | null): Promise<void> {
  const templates = await listTemplates()
  const template = templates.find((t) => t.id === id)
  if (template) template.folderId = folderId
  await fs.writeFile(templatesFilePath(), JSON.stringify(templates, null, 2), 'utf-8')
}

async function readTemplateFolders(): Promise<ClipboardTemplateFolder[]> {
  const folders = await readJson<ClipboardTemplateFolder[]>(templateFoldersFilePath(), [])
  // orderが未設定の既存データ(旧バージョン)は配列の並びのまま採番する
  let needsBackfill = false
  folders.forEach((f, i) => {
    if (typeof f.order !== 'number') {
      f.order = i
      needsBackfill = true
    }
  })
  if (needsBackfill) await fs.writeFile(templateFoldersFilePath(), JSON.stringify(folders, null, 2), 'utf-8')
  return folders
}

export async function listTemplateFolders(): Promise<ClipboardTemplateFolder[]> {
  const folders = await readTemplateFolders()
  return folders.sort((a, b) => a.order - b.order)
}

export async function createTemplateFolder(
  name: string,
  parentId: string | null
): Promise<ClipboardTemplateFolder> {
  const folders = await readTemplateFolders()
  const order = folders.length === 0 ? 0 : Math.max(...folders.map((f) => f.order)) + 1
  const folder: ClipboardTemplateFolder = { id: randomUUID(), name, parentId, order }
  await fs.writeFile(templateFoldersFilePath(), JSON.stringify([...folders, folder], null, 2), 'utf-8')
  return folder
}

export async function renameTemplateFolder(id: string, name: string): Promise<void> {
  const folders = await readTemplateFolders()
  const folder = folders.find((f) => f.id === id)
  if (folder) folder.name = name
  await fs.writeFile(templateFoldersFilePath(), JSON.stringify(folders, null, 2), 'utf-8')
}

/** 指定した順序(同じ階層内でのドラッグ&ドロップ結果)通りにorderを振り直す */
export async function reorderTemplateFolders(orderedIds: string[]): Promise<void> {
  const folders = await readTemplateFolders()
  orderedIds.forEach((id, index) => {
    const folder = folders.find((f) => f.id === id)
    if (folder) folder.order = index
  })
  await fs.writeFile(templateFoldersFilePath(), JSON.stringify(folders, null, 2), 'utf-8')
}

/** フォルダを削除する。中身(サブフォルダ・定型文)を失わないよう、削除するフォルダの親へ引き上げる */
export async function deleteTemplateFolder(id: string): Promise<void> {
  const folders = await listTemplateFolders()
  const target = folders.find((f) => f.id === id)
  if (!target) return
  const parentId = target.parentId

  for (const f of folders) {
    if (f.parentId === id) f.parentId = parentId
  }
  await fs.writeFile(
    templateFoldersFilePath(),
    JSON.stringify(
      folders.filter((f) => f.id !== id),
      null,
      2
    ),
    'utf-8'
  )

  const templates = await listTemplates()
  let changed = false
  for (const t of templates) {
    if ((t.folderId ?? null) === id) {
      t.folderId = parentId
      changed = true
    }
  }
  if (changed) await fs.writeFile(templatesFilePath(), JSON.stringify(templates, null, 2), 'utf-8')
}

async function readFormatRules(): Promise<ClipboardFormatRule[]> {
  const rules = await readJson<ClipboardFormatRule[]>(formatRulesFilePath(), [])
  // orderが未設定の既存データ(旧バージョン)は配列の並びのまま採番する
  let needsBackfill = false
  rules.forEach((r, i) => {
    if (typeof r.order !== 'number') {
      r.order = i
      needsBackfill = true
    }
  })
  if (needsBackfill) await fs.writeFile(formatRulesFilePath(), JSON.stringify(rules, null, 2), 'utf-8')
  return rules
}

/** enabledなルールのみを、適用順(order昇順)で返す。clipboardWatcherが自動適用する際に使う */
export async function listEnabledFormatRules(): Promise<ClipboardFormatRule[]> {
  const rules = await readFormatRules()
  return rules
    .filter((r) => r.enabled)
    .sort((a, b) => a.order - b.order)
}

/** 設定画面での一覧表示用。enabled/disabled問わず全件を適用順で返す */
export async function listFormatRules(): Promise<ClipboardFormatRule[]> {
  const rules = await readFormatRules()
  return rules.sort((a, b) => a.order - b.order)
}

export async function createFormatRule(
  find: string,
  isRegex: boolean,
  replace: string,
  label?: string
): Promise<ClipboardFormatRule> {
  const rules = await readFormatRules()
  const order = rules.length === 0 ? 0 : Math.max(...rules.map((r) => r.order)) + 1
  const rule: ClipboardFormatRule = { id: randomUUID(), label, find, isRegex, replace, enabled: true, order }
  await fs.writeFile(formatRulesFilePath(), JSON.stringify([...rules, rule], null, 2), 'utf-8')
  return rule
}

export async function updateFormatRule(
  id: string,
  fields: { find: string; isRegex: boolean; replace: string; label?: string }
): Promise<void> {
  const rules = await readFormatRules()
  const rule = rules.find((r) => r.id === id)
  if (rule) {
    rule.find = fields.find
    rule.isRegex = fields.isRegex
    rule.replace = fields.replace
    rule.label = fields.label
  }
  await fs.writeFile(formatRulesFilePath(), JSON.stringify(rules, null, 2), 'utf-8')
}

export async function setFormatRuleEnabled(id: string, enabled: boolean): Promise<void> {
  const rules = await readFormatRules()
  const rule = rules.find((r) => r.id === id)
  if (rule) rule.enabled = enabled
  await fs.writeFile(formatRulesFilePath(), JSON.stringify(rules, null, 2), 'utf-8')
}

export async function deleteFormatRule(id: string): Promise<void> {
  const rules = await readFormatRules()
  await fs.writeFile(formatRulesFilePath(), JSON.stringify(rules.filter((r) => r.id !== id), null, 2), 'utf-8')
}

/** 指定した順序(ドラッグ&ドロップ結果)通りにorderを振り直す */
export async function reorderFormatRules(orderedIds: string[]): Promise<void> {
  const rules = await readFormatRules()
  orderedIds.forEach((id, index) => {
    const rule = rules.find((r) => r.id === id)
    if (rule) rule.order = index
  })
  await fs.writeFile(formatRulesFilePath(), JSON.stringify(rules, null, 2), 'utf-8')
}
