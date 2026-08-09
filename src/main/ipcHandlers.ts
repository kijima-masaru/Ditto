import { ipcMain, dialog, BrowserWindow } from 'electron'
import { IPC, type RecordedStep, type TestCase } from '../shared/types'
import * as store from './store'
import { DesktopRecorderEngine, DesktopPlayerEngine } from './engines/desktopEngine'

const recorder = new DesktopRecorderEngine()
const player = new DesktopPlayerEngine()

let recording = false
let recordedSteps: RecordedStep[] = []

export function registerIpcHandlers(getWindow: () => BrowserWindow | null): void {
  ipcMain.handle(IPC.listTests, async () => store.listTests())

  ipcMain.handle(IPC.saveTest, async (_e, testCase: Parameters<typeof store.saveTest>[0]) =>
    store.saveTest(testCase)
  )

  ipcMain.handle(IPC.deleteTest, async (_e, id: string) => store.deleteTest(id))

  ipcMain.handle(IPC.renameTest, async (_e, id: string, name: string) => store.renameTest(id, name))

  ipcMain.handle(IPC.pickExecutable, async () => {
    const win = getWindow()
    if (!win) return null
    const result = await dialog.showOpenDialog(win, {
      title: '対象アプリの実行ファイルを選択',
      properties: ['openFile'],
      filters: [{ name: 'Executable', extensions: ['exe'] }]
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  ipcMain.handle(IPC.recordingStart, async (_e, target: string, targetArgs?: string) => {
    recordedSteps = []
    const win = getWindow()
    await recorder.start(target, targetArgs, (step) => {
      recordedSteps.push(step)
      win?.webContents.send(IPC.recordingStep, step)
    })
    recording = true
  })

  ipcMain.handle(IPC.recordingStop, async () => {
    if (!recording) return recordedSteps
    await recorder.stop()
    const steps = recordedSteps
    recording = false
    recordedSteps = []
    return steps
  })

  ipcMain.handle(IPC.playbackRun, async (_e, testCase: TestCase) => {
    const win = getWindow()
    return player.run(testCase, (progress) => {
      win?.webContents.send(IPC.playbackProgress, progress)
    })
  })

  ipcMain.handle(IPC.playbackAbort, async () => {
    await player.abort()
  })
}
