import { ipcMain, dialog, type BrowserWindow } from 'electron'
import { IPC, type TestCase, type TestTarget, type ViewportRect } from '../shared/types'
import * as store from './store'
import { TargetManager } from './targetManager'

export function registerIpcHandlers(getWindow: () => BrowserWindow | null): void {
  const win = getWindow()
  if (!win) throw new Error('メインウィンドウが初期化されていません')
  const manager = new TargetManager(win)

  ipcMain.handle(IPC.listTests, async () => store.listTests())

  ipcMain.handle(IPC.saveTest, async (_e, testCase: Parameters<typeof store.saveTest>[0]) =>
    store.saveTest(testCase)
  )

  ipcMain.handle(IPC.deleteTest, async (_e, id: string) => store.deleteTest(id))

  ipcMain.handle(IPC.renameTest, async (_e, id: string, name: string) => store.renameTest(id, name))

  ipcMain.handle(IPC.pickExecutable, async () => {
    const w = getWindow()
    if (!w) return null
    const result = await dialog.showOpenDialog(w, {
      title: '対象アプリの実行ファイルを選択',
      properties: ['openFile'],
      filters: [{ name: 'Executable', extensions: ['exe'] }]
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  ipcMain.handle(IPC.viewportUpdate, async (_e, viewport: ViewportRect) => {
    manager.updateViewport(viewport)
  })

  ipcMain.handle(IPC.recordingStart, async (_e, targets: TestTarget[]) => {
    const w = getWindow()
    await manager.startRecording(targets, (step) => {
      w?.webContents.send(IPC.recordingStep, step)
    })
  })

  ipcMain.handle(IPC.recordingSetActiveTarget, async (_e, targetId: string) => {
    await manager.setActiveTarget(targetId)
  })

  ipcMain.handle(IPC.recordingStop, async () => manager.stopRecording())

  ipcMain.handle(IPC.playbackRun, async (_e, testCase: TestCase, speed: number) => {
    const w = getWindow()
    return manager.runPlayback(testCase, speed, (progress) => {
      w?.webContents.send(IPC.playbackProgress, progress)
    })
  })

  ipcMain.handle(IPC.playbackAbort, async () => {
    manager.abort()
  })
}
