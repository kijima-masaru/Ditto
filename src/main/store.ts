import { app } from 'electron'
import { randomUUID } from 'crypto'
import fs from 'fs/promises'
import path from 'path'
import type { TestCase } from '../shared/types'

function testsDir(): string {
  return path.join(app.getPath('userData'), 'tests')
}

async function ensureDir(): Promise<void> {
  await fs.mkdir(testsDir(), { recursive: true })
}

function filePathFor(id: string): string {
  return path.join(testsDir(), `${id}.json`)
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
    updatedAt: now
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
