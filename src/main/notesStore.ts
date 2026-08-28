import { app } from 'electron'
import { randomUUID } from 'crypto'
import fs from 'fs/promises'
import path from 'path'
import type { Note, NoteFolder } from '../shared/types'

/**
 * メモの保存を担当する。
 *
 * 一覧用のメタ情報(notes.json)と本文(notes/<id>.txt)を分けているのは、
 * 一覧を開くたびに全メモの本文を読まずに済ませるため。本文をプレーンテキストの
 * 個別ファイルにしているのは、万一Dittoが壊れてもエクスプローラから開いて
 * 中身を救出できるようにするため。
 */

/** 一覧に出す本文抜粋の長さ */
const PREVIEW_LENGTH = 200
/** 本文1行目から自動生成する名前の長さ */
const TITLE_LENGTH = 60
const UNTITLED = '無題のメモ'

function notesFilePath(): string {
  return path.join(app.getPath('userData'), 'notes.json')
}

function noteFoldersFilePath(): string {
  return path.join(app.getPath('userData'), 'note-folders.json')
}

function notesDir(): string {
  return path.join(app.getPath('userData'), 'notes')
}

function noteBodyPath(id: string): string {
  return path.join(notesDir(), `${id}.txt`)
}

/** 直前の本文を1世代だけ残すバックアップ。自動保存で内容を失った時の救済用 */
function noteBackupPath(id: string): string {
  return path.join(notesDir(), `${id}.bak`)
}

async function readJson<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(filePath, 'utf-8')
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

async function writeNotes(notes: Note[]): Promise<void> {
  await fs.writeFile(notesFilePath(), JSON.stringify(notes, null, 2), 'utf-8')
}

async function writeFolders(folders: NoteFolder[]): Promise<void> {
  await fs.writeFile(noteFoldersFilePath(), JSON.stringify(folders, null, 2), 'utf-8')
}

/** 本文の1行目から一覧用の名前を作る。空のメモは「無題のメモ」とする */
function deriveTitle(body: string): string {
  const firstLine = body.split(/\r\n|\r|\n/).find((line) => line.trim().length > 0)
  if (!firstLine) return UNTITLED
  const trimmed = firstLine.trim()
  return trimmed.length > TITLE_LENGTH ? `${trimmed.slice(0, TITLE_LENGTH)}…` : trimmed
}

function derivePreview(body: string): string {
  const oneLine = body.replace(/\s+/g, ' ').trim()
  return oneLine.slice(0, PREVIEW_LENGTH)
}

export async function listNotes(): Promise<Note[]> {
  const notes = await readJson<Note[]>(notesFilePath(), [])
  return notes.sort((a, b) => a.order - b.order)
}

export async function getNoteBody(id: string): Promise<string> {
  try {
    return await fs.readFile(noteBodyPath(id), 'utf-8')
  } catch {
    // ファイルがまだ無い(作成直後で一度も保存していない)場合は空として扱う
    return ''
  }
}

/**
 * 本文を書き込む。自動保存で頻繁に呼ばれるため、内容を失わないよう
 * 「直前の内容をバックアップ → 一時ファイルへ書く → 置き換える」の順で行う。
 * 書き込みの途中で中断されても、本体のファイルが壊れた状態にはならない。
 */
async function writeBody(id: string, body: string): Promise<void> {
  await fs.mkdir(notesDir(), { recursive: true })
  const target = noteBodyPath(id)
  try {
    await fs.copyFile(target, noteBackupPath(id))
  } catch {
    // 初回保存でまだ本体が無い場合はバックアップも不要
  }
  const tmp = `${target}.tmp`
  await fs.writeFile(tmp, body, 'utf-8')
  await fs.rename(tmp, target)
}

export async function createNote(folderId: string | null = null, body = ''): Promise<Note> {
  const notes = await listNotes()
  const order = notes.length === 0 ? 0 : Math.max(...notes.map((n) => n.order)) + 1
  const now = new Date().toISOString()
  const note: Note = {
    id: randomUUID(),
    title: deriveTitle(body),
    preview: derivePreview(body),
    folderId,
    order,
    createdAt: now,
    updatedAt: now
  }
  await writeBody(note.id, body)
  await writeNotes([...notes, note])
  return note
}

/** 本文を保存し、一覧用のメタ情報(名前・抜粋・更新日時)を更新する */
export async function updateNoteBody(id: string, body: string): Promise<Note | undefined> {
  const notes = await listNotes()
  const note = notes.find((n) => n.id === id)
  if (!note) return undefined
  await writeBody(id, body)
  if (!note.titleManual) note.title = deriveTitle(body)
  note.preview = derivePreview(body)
  note.updatedAt = new Date().toISOString()
  await writeNotes(notes)
  return note
}

/**
 * 名前を変更する。空文字を渡すと「利用者が付けた名前」を解除し、
 * 本文の1行目から自動生成する状態へ戻す
 */
export async function renameNote(id: string, title: string): Promise<Note | undefined> {
  const notes = await listNotes()
  const note = notes.find((n) => n.id === id)
  if (!note) return undefined
  const trimmed = title.trim()
  if (trimmed) {
    note.title = trimmed
    note.titleManual = true
  } else {
    note.titleManual = false
    note.title = deriveTitle(await getNoteBody(id))
  }
  note.updatedAt = new Date().toISOString()
  await writeNotes(notes)
  return note
}

/**
 * メモの末尾へ追記する。クリップボード履歴から「メモに追記」した場合に使う。
 * 既存の本文が空でなければ改行で区切ってから追記する
 */
export async function appendToNote(id: string, text: string): Promise<Note | undefined> {
  const current = await getNoteBody(id)
  const separator = current.length === 0 || current.endsWith('\n') ? '' : '\n'
  return updateNoteBody(id, `${current}${separator}${text}`)
}

/** コマンドパレットの初期表示(未入力時)にこのメモを出すかどうかを切り替える */
export async function setNotePinned(id: string, pinned: boolean): Promise<void> {
  const notes = await listNotes()
  const note = notes.find((n) => n.id === id)
  if (note) note.pinned = pinned
  await writeNotes(notes)
}

/** コマンドパレット内でのピン留め項目同士の並び替え(フォルダ内並び順とは別管理) */
export async function reorderPinnedNotes(orderedIds: string[]): Promise<void> {
  const notes = await listNotes()
  orderedIds.forEach((id, index) => {
    const note = notes.find((n) => n.id === id)
    if (note) note.pinnedOrder = index
  })
  await writeNotes(notes)
}

export async function deleteNote(id: string): Promise<void> {
  const notes = await listNotes()
  await writeNotes(notes.filter((n) => n.id !== id))
  for (const file of [noteBodyPath(id), noteBackupPath(id)]) {
    try {
      await fs.unlink(file)
    } catch {
      // 元から無い場合は無視する
    }
  }
}

export async function moveNote(id: string, folderId: string | null): Promise<void> {
  const notes = await listNotes()
  const note = notes.find((n) => n.id === id)
  if (note) note.folderId = folderId
  await writeNotes(notes)
}

/** 指定した順序(同じフォルダ内でのドラッグ&ドロップ結果)通りにorderを振り直す */
export async function reorderNotes(orderedIds: string[]): Promise<void> {
  const notes = await listNotes()
  orderedIds.forEach((id, index) => {
    const note = notes.find((n) => n.id === id)
    if (note) note.order = index
  })
  await writeNotes(notes)
}

/**
 * 名前と本文を対象に検索し、一致したメモのidを返す。メモは数百件程度を想定しており、
 * 検索のたびに本文を読んでも実用上問題にならないため、索引は持たない
 */
export async function searchNotes(query: string): Promise<string[]> {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const notes = await listNotes()
  const hits: string[] = []
  for (const note of notes) {
    if (note.title.toLowerCase().includes(q)) {
      hits.push(note.id)
      continue
    }
    const body = await getNoteBody(note.id)
    if (body.toLowerCase().includes(q)) hits.push(note.id)
  }
  return hits
}

export async function listNoteFolders(): Promise<NoteFolder[]> {
  const folders = await readJson<NoteFolder[]>(noteFoldersFilePath(), [])
  return folders.sort((a, b) => a.order - b.order)
}

export async function createNoteFolder(name: string, parentId: string | null): Promise<NoteFolder> {
  const folders = await listNoteFolders()
  const order = folders.length === 0 ? 0 : Math.max(...folders.map((f) => f.order)) + 1
  const folder: NoteFolder = { id: randomUUID(), name, parentId, order }
  await writeFolders([...folders, folder])
  return folder
}

export async function renameNoteFolder(id: string, name: string): Promise<void> {
  const folders = await listNoteFolders()
  const folder = folders.find((f) => f.id === id)
  if (folder) folder.name = name
  await writeFolders(folders)
}

/** 指定した順序(同じ階層内でのドラッグ&ドロップ結果)通りにorderを振り直す */
export async function reorderNoteFolders(orderedIds: string[]): Promise<void> {
  const folders = await listNoteFolders()
  orderedIds.forEach((id, index) => {
    const folder = folders.find((f) => f.id === id)
    if (folder) folder.order = index
  })
  await writeFolders(folders)
}

/** フォルダを削除する。中身(サブフォルダ・メモ)を失わないよう、削除するフォルダの親へ引き上げる */
export async function deleteNoteFolder(id: string): Promise<void> {
  const folders = await listNoteFolders()
  const target = folders.find((f) => f.id === id)
  if (!target) return
  const parentId = target.parentId

  for (const f of folders) {
    if (f.parentId === id) f.parentId = parentId
  }
  await writeFolders(folders.filter((f) => f.id !== id))

  const notes = await listNotes()
  let changed = false
  for (const n of notes) {
    if ((n.folderId ?? null) === id) {
      n.folderId = parentId
      changed = true
    }
  }
  if (changed) await writeNotes(notes)
}
