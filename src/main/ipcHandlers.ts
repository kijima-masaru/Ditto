import { ipcMain, dialog, desktopCapturer, shell, type BrowserWindow } from 'electron'
import { IPC, type TestCase, type TestTarget } from '../shared/types'
import * as store from './store'
import { TargetManager } from './targetManager'
import * as recordingFrame from './recordingFrame'
import * as screenCapture from './screenCapture'

export function registerIpcHandlers(getWindow: () => BrowserWindow | null): void {
  const manager = new TargetManager()

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

  ipcMain.handle(IPC.recordingStart, async (_e, targets: TestTarget[]) => {
    const w = getWindow()
    await manager.startRecording(targets, (step) => {
      w?.webContents.send(IPC.recordingStep, step)
    })
  })

  ipcMain.handle(IPC.recordingSetActiveTarget, async (_e, targetId: string) => {
    await manager.setActiveTarget(targetId)
  })

  ipcMain.handle(IPC.recordingSetPaused, async (_e, paused: boolean) => {
    manager.setPaused(paused)
  })

  ipcMain.handle(IPC.recordingStop, async () => manager.stopRecording())

  ipcMain.handle(IPC.playbackRun, async (_e, testCase: TestCase) => {
    const w = getWindow()
    const result = await manager.runPlayback(testCase, (progress) => {
      w?.webContents.send(IPC.playbackProgress, progress)
    })
    await store.recordRun(testCase.id, result.finishedAt)
    return result
  })

  ipcMain.handle(IPC.playbackAbort, async () => {
    manager.abort()
  })

  ipcMain.handle(IPC.recordingFrameShow, async () => {
    recordingFrame.show()
  })

  ipcMain.handle(IPC.recordingFrameHide, async () => {
    recordingFrame.hide()
  })

  ipcMain.handle(IPC.recordingFrameIsVisible, async () => recordingFrame.isVisible())

  ipcMain.handle(IPC.recordingFrameGetBounds, async () => recordingFrame.getBounds())

  ipcMain.handle(IPC.recordingFrameSetSize, async (_e, width: number, height: number) =>
    recordingFrame.setSize(width, height)
  )

  ipcMain.handle(IPC.recordingFrameGetCaptureInfo, async () => recordingFrame.getCaptureInfo())

  ipcMain.handle(IPC.getDesktopSources, async () => {
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: 0, height: 0 }
    })
    return sources.map((s) => ({ id: s.id, displayId: s.display_id }))
  })

  ipcMain.handle(IPC.screenRecordingStart, async (_e, testName: string) => {
    recordingFrame.setInteractive(false)
    return screenCapture.startRecording(testName)
  })

  ipcMain.handle(IPC.screenRecordingAppendChunk, async (_e, chunk: Uint8Array) => {
    screenCapture.appendChunk(chunk)
  })

  ipcMain.handle(IPC.screenRecordingFinish, async () => {
    recordingFrame.setInteractive(true)
    return screenCapture.finishRecording()
  })

  ipcMain.handle(IPC.screenRecordingOpenFolder, async (_e, filePath: string) => {
    shell.showItemInFolder(filePath)
  })
}
