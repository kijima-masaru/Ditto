import { app } from 'electron'
import { createWriteStream, type WriteStream } from 'fs'
import { mkdir, writeFile } from 'fs/promises'
import path from 'path'

/**
 * 画面録画の書き出しセッション。実際のキャプチャ・エンコード(MediaRecorder)はrenderer側で行い、
 * ここではrendererから届く映像チャンクをファイルへ逐次書き込むだけを担当する。
 * (大きな録画データを最後に一括転送するとメモリを圧迫するため、都度チャンク単位で書き出す)
 */
let writeStream: WriteStream | null = null
let currentFilePath: string | null = null

function sanitizeFileName(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|]/g, '_').trim()
  return cleaned.length > 0 ? cleaned : 'test'
}

export async function startRecording(testName: string): Promise<string> {
  const dir = path.join(app.getPath('videos'), 'Ditto')
  await mkdir(dir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const filePath = path.join(dir, `${sanitizeFileName(testName)}-${stamp}.webm`)
  writeStream = createWriteStream(filePath)
  currentFilePath = filePath
  return filePath
}

export function appendChunk(chunk: Uint8Array): void {
  writeStream?.write(Buffer.from(chunk))
}

export async function finishRecording(): Promise<string | null> {
  if (!writeStream) return currentFilePath
  const stream = writeStream
  const filePath = currentFilePath
  writeStream = null
  currentFilePath = null
  await new Promise<void>((resolve) => stream.end(resolve))
  return filePath
}

/** 録画枠のスクリーンショット(注釈編集済みのPNG)を保存する。動画とは別にPictures配下に保存する */
export async function saveScreenshot(bytes: Uint8Array): Promise<string> {
  const dir = path.join(app.getPath('pictures'), 'Ditto')
  await mkdir(dir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const filePath = path.join(dir, `screenshot-${stamp}.png`)
  await writeFile(filePath, bytes)
  return filePath
}
