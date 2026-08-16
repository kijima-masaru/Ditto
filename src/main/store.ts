import { app } from 'electron'
import { randomUUID } from 'crypto'
import fs from 'fs/promises'
import path from 'path'
import type { MacroCase, MacroFolder } from '../shared/types'

// 保存先フォルダ名は旧機能名("テスト")の頃からの"tests"のまま固定し、既存インストールで
// 保存済みのマクロを引き継ぐ(app.setName('auto-test-tool')と同じ理由)
function macrosDir(): string {
  return path.join(app.getPath('userData'), 'tests')
}

async function ensureDir(): Promise<void> {
  await fs.mkdir(macrosDir(), { recursive: true })
}

function filePathFor(id: string): string {
  return path.join(macrosDir(), `${id}.json`)
}

function foldersFilePath(): string {
  return path.join(app.getPath('userData'), 'folders.json')
}

async function readFolders(): Promise<MacroFolder[]> {
  let folders: MacroFolder[]
  try {
    const raw = await fs.readFile(foldersFilePath(), 'utf-8')
    folders = JSON.parse(raw) as MacroFolder[]
  } catch {
    return []
  }
  // orderが未設定の既存データ(旧バージョン)は配列の並びのまま採番する
  let needsBackfill = false
  folders.forEach((f, i) => {
    if (typeof f.order !== 'number') {
      f.order = i
      needsBackfill = true
    }
  })
  if (needsBackfill) await writeFolders(folders)
  return folders
}

async function writeFolders(folders: MacroFolder[]): Promise<void> {
  await fs.writeFile(foldersFilePath(), JSON.stringify(folders, null, 2), 'utf-8')
}

export async function listMacros(): Promise<MacroCase[]> {
  await ensureDir()
  const files = await fs.readdir(macrosDir())
  const jsonFiles = files.filter((f) => f.endsWith('.json'))
  const macros = await Promise.all(
    jsonFiles.map(async (f) => {
      const raw = await fs.readFile(path.join(macrosDir(), f), 'utf-8')
      return JSON.parse(raw) as MacroCase
    })
  )
  // orderが未設定の既存データ(旧バージョン)は更新日時の降順を維持したまま並び順として採番する
  let needsBackfill = false
  macros.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  macros.forEach((t, i) => {
    if (typeof t.order !== 'number') {
      t.order = i
      needsBackfill = true
    }
  })
  if (needsBackfill) {
    await Promise.all(macros.map((t) => fs.writeFile(filePathFor(t.id), JSON.stringify(t, null, 2), 'utf-8')))
  }
  return macros.sort((a, b) => a.order - b.order)
}

export async function saveMacro(
  input: Omit<MacroCase, 'id' | 'createdAt' | 'updatedAt' | 'order'> & { id?: string }
): Promise<MacroCase> {
  await ensureDir()
  const now = new Date().toISOString()
  let existing: MacroCase | null = null
  if (input.id) {
    try {
      const raw = await fs.readFile(filePathFor(input.id), 'utf-8')
      existing = JSON.parse(raw) as MacroCase
    } catch {
      existing = null
    }
  }
  const order = existing?.order ?? (await nextOrder())
  const macroCase: MacroCase = {
    id: existing?.id ?? input.id ?? randomUUID(),
    name: input.name,
    targets: input.targets,
    steps: input.steps,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    folderId: input.folderId ?? existing?.folderId ?? null,
    order
  }
  await fs.writeFile(filePathFor(macroCase.id), JSON.stringify(macroCase, null, 2), 'utf-8')
  return macroCase
}

async function nextOrder(): Promise<number> {
  const macros = await listMacros()
  return macros.length === 0 ? 0 : Math.max(...macros.map((t) => t.order)) + 1
}

/** 指定した順序(同じフォルダ内でのドラッグ&ドロップ結果)通りにorderを振り直す */
export async function reorderMacros(orderedIds: string[]): Promise<void> {
  await Promise.all(
    orderedIds.map(async (id, index) => {
      try {
        const raw = await fs.readFile(filePathFor(id), 'utf-8')
        const macroCase = JSON.parse(raw) as MacroCase
        if (macroCase.order !== index) {
          macroCase.order = index
          await fs.writeFile(filePathFor(id), JSON.stringify(macroCase, null, 2), 'utf-8')
        }
      } catch {
        // 既に削除されたマクロなどは無視する
      }
    })
  )
}

export async function deleteMacro(id: string): Promise<void> {
  await fs.rm(filePathFor(id), { force: true })
}

export async function renameMacro(id: string, name: string): Promise<MacroCase> {
  const raw = await fs.readFile(filePathFor(id), 'utf-8')
  const macroCase = JSON.parse(raw) as MacroCase
  macroCase.name = name
  macroCase.updatedAt = new Date().toISOString()
  await fs.writeFile(filePathFor(id), JSON.stringify(macroCase, null, 2), 'utf-8')
  return macroCase
}

/** マクロを実行した日時を記録する(更新日時 updatedAt とは別に、最終実行日時として保持する) */
export async function recordRun(id: string, runAt: string): Promise<void> {
  try {
    const raw = await fs.readFile(filePathFor(id), 'utf-8')
    const macroCase = JSON.parse(raw) as MacroCase
    macroCase.lastRunAt = runAt
    await fs.writeFile(filePathFor(id), JSON.stringify(macroCase, null, 2), 'utf-8')
  } catch {
    // マクロが既に削除されている場合などは無視する
  }
}

/** マクロの所属フォルダを変更する(nullでルート直下に戻す) */
export async function moveMacro(id: string, folderId: string | null): Promise<MacroCase> {
  const raw = await fs.readFile(filePathFor(id), 'utf-8')
  const macroCase = JSON.parse(raw) as MacroCase
  macroCase.folderId = folderId
  await fs.writeFile(filePathFor(id), JSON.stringify(macroCase, null, 2), 'utf-8')
  return macroCase
}

export async function listFolders(): Promise<MacroFolder[]> {
  const folders = await readFolders()
  return folders.sort((a, b) => a.order - b.order)
}

export async function createFolder(name: string, parentId: string | null): Promise<MacroFolder> {
  const folders = await readFolders()
  const order = folders.length === 0 ? 0 : Math.max(...folders.map((f) => f.order)) + 1
  const folder: MacroFolder = { id: randomUUID(), name, parentId, order }
  folders.push(folder)
  await writeFolders(folders)
  return folder
}

export async function renameFolder(id: string, name: string): Promise<void> {
  const folders = await readFolders()
  const folder = folders.find((f) => f.id === id)
  if (folder) folder.name = name
  await writeFolders(folders)
}

/** 指定した順序(同じ階層内でのドラッグ&ドロップ結果)通りにorderを振り直す */
export async function reorderFolders(orderedIds: string[]): Promise<void> {
  const folders = await readFolders()
  orderedIds.forEach((id, index) => {
    const folder = folders.find((f) => f.id === id)
    if (folder) folder.order = index
  })
  await writeFolders(folders)
}

/** フォルダを削除する。中身(サブフォルダ・マクロ)を失わないよう、削除するフォルダの親へ引き上げる */
export async function deleteFolder(id: string): Promise<void> {
  const folders = await readFolders()
  const target = folders.find((f) => f.id === id)
  if (!target) return
  const parentId = target.parentId

  for (const f of folders) {
    if (f.parentId === id) f.parentId = parentId
  }
  await writeFolders(folders.filter((f) => f.id !== id))

  const macros = await listMacros()
  await Promise.all(
    macros
      .filter((t) => (t.folderId ?? null) === id)
      .map(async (t) => {
        t.folderId = parentId
        await fs.writeFile(filePathFor(t.id), JSON.stringify(t, null, 2), 'utf-8')
      })
  )
}
