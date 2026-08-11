import { contextBridge, ipcRenderer } from 'electron'
import {
  IPC,
  type RecordedStep,
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

  runPlayback: (testCase: TestCase, speed: number): Promise<PlaybackResult> =>
    ipcRenderer.invoke(IPC.playbackRun, testCase, speed),
  abortPlayback: (): Promise<void> => ipcRenderer.invoke(IPC.playbackAbort),
  onPlaybackProgress: (cb: (progress: PlaybackProgress) => void): (() => void) => {
    const listener = (_e: unknown, progress: PlaybackProgress): void => cb(progress)
    ipcRenderer.on(IPC.playbackProgress, listener)
    return () => ipcRenderer.removeListener(IPC.playbackProgress, listener)
  }
}

contextBridge.exposeInMainWorld('api', api)

export type Api = typeof api
