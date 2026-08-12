import { app } from 'electron'
import { randomUUID } from 'crypto'
import fs from 'fs/promises'
import path from 'path'
import type { TestCase, TestFolder } from '../shared/types'

function testsDir(): string {
  return path.join(app.getPath('userData'), 'tests')
}

async function ensureDir(): Promise<void> {
  await fs.mkdir(testsDir(), { recursive: true })
}

function filePathFor(id: string): string {
  return path.join(testsDir(), `${id}.json`)
}

function foldersFilePath(): string {
  return path.join(app.getPath('userData'), 'folders.json')
}

async function readFolders(): Promise<TestFolder[]> {
  try {
    const raw = await fs.readFile(foldersFilePath(), 'utf-8')
    return JSON.parse(raw) as TestFolder[]
  } catch {
    return []
  }
}

async function writeFolders(folders: TestFolder[]): Promise<void> {
  await fs.writeFile(foldersFilePath(), JSON.stringify(folders, null, 2), 'utf-8')
}

export async function listTests(): Promise<TestCase[]> {
  await ensureDir()
  const files = await fs.readdir(testsDir())
  const jsonFiles = files.filter((f) => f.endsWith('.json'))
  const tests = await Promise.all(
    jsonFiles.map(async (f) => {
      const raw = await fs.readFile(path.join(testsDir(), f), 'utf-8')
      return JSON.parse(raw) as TestCase
    })
  )
  return tests.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

export async function saveTest(input: Omit<TestCase, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }): Promise<TestCase> {
  await ensureDir()
  const now = new Date().toISOString()
  let existing: TestCase | null = null
  if (input.id) {
    try {
      const raw = await fs.readFile(filePathFor(input.id), 'utf-8')
      existing = JSON.parse(raw) as TestCase
    } catch {
      existing = null
    }
  }
  const testCase: TestCase = {
    id: existing?.id ?? input.id ?? randomUUID(),
    name: input.name,
    targets: input.targets,
    steps: input.steps,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    folderId: input.folderId ?? existing?.folderId ?? null
  }
  await fs.writeFile(filePathFor(testCase.id), JSON.stringify(testCase, null, 2), 'utf-8')
  return testCase
}

export async function deleteTest(id: string): Promise<void> {
  await fs.rm(filePathFor(id), { force: true })
}

export async function renameTest(id: string, name: string): Promise<TestCase> {
  const raw = await fs.readFile(filePathFor(id), 'utf-8')
  const testCase = JSON.parse(raw) as TestCase
  testCase.name = name
  testCase.updatedAt = new Date().toISOString()
  await fs.writeFile(filePathFor(id), JSON.stringify(testCase, null, 2), 'utf-8')
  return testCase
}

/** テストを実行した日時を記録する(更新日時 updatedAt とは別に、最終実行日時として保持する) */
export async function recordRun(id: string, runAt: string): Promise<void> {
  try {
    const raw = await fs.readFile(filePathFor(id), 'utf-8')
    const testCase = JSON.parse(raw) as TestCase
    testCase.lastRunAt = runAt
    await fs.writeFile(filePathFor(id), JSON.stringify(testCase, null, 2), 'utf-8')
  } catch {
    // テストが既に削除されている場合などは無視する
  }
}

/** テストの所属フォルダを変更する(nullでルート直下に戻す) */
export async function moveTest(id: string, folderId: string | null): Promise<TestCase> {
  const raw = await fs.readFile(filePathFor(id), 'utf-8')
  const testCase = JSON.parse(raw) as TestCase
  testCase.folderId = folderId
  await fs.writeFile(filePathFor(id), JSON.stringify(testCase, null, 2), 'utf-8')
  return testCase
}

export async function listFolders(): Promise<TestFolder[]> {
  return readFolders()
}

export async function createFolder(name: string, parentId: string | null): Promise<TestFolder> {
  const folders = await readFolders()
  const folder: TestFolder = { id: randomUUID(), name, parentId }
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

/** フォルダを削除する。中身(サブフォルダ・テスト)を失わないよう、削除するフォルダの親へ引き上げる */
export async function deleteFolder(id: string): Promise<void> {
  const folders = await readFolders()
  const target = folders.find((f) => f.id === id)
  if (!target) return
  const parentId = target.parentId

  for (const f of folders) {
    if (f.parentId === id) f.parentId = parentId
  }
  await writeFolders(folders.filter((f) => f.id !== id))

  const tests = await listTests()
  await Promise.all(
    tests
      .filter((t) => (t.folderId ?? null) === id)
      .map(async (t) => {
        t.folderId = parentId
        await fs.writeFile(filePathFor(t.id), JSON.stringify(t, null, 2), 'utf-8')
      })
  )
}
