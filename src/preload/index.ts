import { contextBridge, ipcRenderer } from 'electron'
import {
  IPC,
  type CaptureInfo,
  type RecordedStep,
  type RecordingFrameBounds,
  type PlaybackProgress,
  type PlaybackResult,
  type TestCase,
  type TestTarget
} from '../shared/types'

const api = {
  listTests: (): Promise<TestCase[]> => ipcRenderer.invoke(IPC.listTests),
  saveTest: (testCase: Omit<TestCase, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }): Promise<TestCase> =>
    ipcRenderer.invoke(IPC.saveTest, testCase),
  deleteTest: (id: string): Promise<void> => ipcRenderer.invoke(IPC.deleteTest, id),
  renameTest: (id: string, name: string): Promise<TestCase> => ipcRenderer.invoke(IPC.renameTest, id, name),

  pickExecutable: (): Promise<string | null> => ipcRenderer.invoke(IPC.pickExecutable),

  startRecording: (targets: TestTarget[]): Promise<void> => ipcRenderer.invoke(IPC.recordingStart, targets),
  setActiveTarget: (targetId: string): Promise<void> =>
    ipcRenderer.invoke(IPC.recordingSetActiveTarget, targetId),
  setRecordingPaused: (paused: boolean): Promise<void> =>
    ipcRenderer.invoke(IPC.recordingSetPaused, paused),
  stopRecording: (): Promise<RecordedStep[]> => ipcRenderer.invoke(IPC.recordingStop),
  onRecordingStep: (cb: (step: RecordedStep) => void): (() => void) => {
    const listener = (_e: unknown, step: RecordedStep): void => cb(step)
    ipcRenderer.on(IPC.recordingStep, listener)
    return () => ipcRenderer.removeListener(IPC.recordingStep, listener)
  },

  runPlayback: (testCase: TestCase): Promise<PlaybackResult> => ipcRenderer.invoke(IPC.playbackRun, testCase),
  abortPlayback: (): Promise<void> => ipcRenderer.invoke(IPC.playbackAbort),
  onPlaybackProgress: (cb: (progress: PlaybackProgress) => void): (() => void) => {
    const listener = (_e: unknown, progress: PlaybackProgress): void => cb(progress)
    ipcRenderer.on(IPC.playbackProgress, listener)
    return () => ipcRenderer.removeListener(IPC.playbackProgress, listener)
  },

  showRecordingFrame: (): Promise<void> => ipcRenderer.invoke(IPC.recordingFrameShow),
  hideRecordingFrame: (): Promise<void> => ipcRenderer.invoke(IPC.recordingFrameHide),
  isRecordingFrameVisible: (): Promise<boolean> => ipcRenderer.invoke(IPC.recordingFrameIsVisible),
  getRecordingFrameBounds: (): Promise<RecordingFrameBounds> => ipcRenderer.invoke(IPC.recordingFrameGetBounds),
  setRecordingFrameSize: (width: number, height: number): Promise<RecordingFrameBounds> =>
    ipcRenderer.invoke(IPC.recordingFrameSetSize, width, height),
  getRecordingFrameCaptureInfo: (): Promise<CaptureInfo> => ipcRenderer.invoke(IPC.recordingFrameGetCaptureInfo),

  getDesktopSources: (): Promise<{ id: string; displayId: string }[]> => ipcRenderer.invoke(IPC.getDesktopSources),
  startScreenRecordingSession: (testName: string): Promise<string> =>
    ipcRenderer.invoke(IPC.screenRecordingStart, testName),
  appendScreenRecordingChunk: (chunk: Uint8Array): Promise<void> =>
    ipcRenderer.invoke(IPC.screenRecordingAppendChunk, chunk),
  finishScreenRecordingSession: (): Promise<string | null> => ipcRenderer.invoke(IPC.screenRecordingFinish),
  openRecordingFolder: (filePath: string): Promise<void> =>
    ipcRenderer.invoke(IPC.screenRecordingOpenFolder, filePath)
}

contextBridge.exposeInMainWorld('api', api)

export type Api = typeof api
