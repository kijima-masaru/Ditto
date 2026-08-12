import { app } from 'electron'
import { randomUUID } from 'crypto'
import fs from 'fs/promises'
import path from 'path'
import type { ClipboardHistoryEntry, ClipboardTemplate, ClipboardTemplateFolder } from '../shared/types'

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

async function readJson<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(filePath, 'utf-8')
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

export async function listHistory(): Promise<ClipboardHistoryEntry[]> {
  return readJson<ClipboardHistoryEntry[]>(historyFilePath(), [])
}

export async function appendHistory(text: string): Promise<ClipboardHistoryEntry> {
  const history = await listHistory()
  const entry: ClipboardHistoryEntry = { id: randomUUID(), text, copiedAt: new Date().toISOString() }
  const trimmed = [entry, ...history].slice(0, MAX_HISTORY)
  await fs.writeFile(historyFilePath(), JSON.stringify(trimmed, null, 2), 'utf-8')
  return entry
}

export async function deleteHistoryEntry(id: string): Promise<void> {
  const history = await listHistory()
  await fs.writeFile(historyFilePath(), JSON.stringify(history.filter((h) => h.id !== id), null, 2), 'utf-8')
}

export async function clearHistory(): Promise<void> {
  await fs.writeFile(historyFilePath(), JSON.stringify([], null, 2), 'utf-8')
}

export async function listTemplates(): Promise<ClipboardTemplate[]> {
  return readJson<ClipboardTemplate[]>(templatesFilePath(), [])
}

export async function createTemplate(
  text: string,
  label?: string,
  folderId: string | null = null
): Promise<ClipboardTemplate> {
  const templates = await listTemplates()
  const template: ClipboardTemplate = {
    id: randomUUID(),
    text,
    label,
    createdAt: new Date().toISOString(),
    folderId
  }
  await fs.writeFile(templatesFilePath(), JSON.stringify([template, ...templates], null, 2), 'utf-8')
  return template
}

export async function updateTemplate(id: string, text: string, label?: string): Promise<void> {
  const templates = await listTemplates()
  const template = templates.find((t) => t.id === id)
  if (template) {
    template.text = text
    template.label = label
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

export async function listTemplateFolders(): Promise<ClipboardTemplateFolder[]> {
  return readJson<ClipboardTemplateFolder[]>(templateFoldersFilePath(), [])
}

export async function createTemplateFolder(
  name: string,
  parentId: string | null
): Promise<ClipboardTemplateFolder> {
  const folders = await listTemplateFolders()
  const folder: ClipboardTemplateFolder = { id: randomUUID(), name, parentId }
  await fs.writeFile(templateFoldersFilePath(), JSON.stringify([...folders, folder], null, 2), 'utf-8')
  return folder
}

export async function renameTemplateFolder(id: string, name: string): Promise<void> {
  const folders = await listTemplateFolders()
  const folder = folders.find((f) => f.id === id)
  if (folder) folder.name = name
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
