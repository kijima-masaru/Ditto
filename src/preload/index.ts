import { contextBridge, ipcRenderer } from 'electron'
import {
  IPC,
  type AppSettings,
  type AutoMaskCategory,
  type CaptureInfo,
  type ClipboardFormatRule,
  type ClipboardHistoryEntry,
  type ClipboardPiiProtectionMode,
  type ClipboardTemplate,
  type ClipboardTemplateFolder,
  type CommandPalettePerSectionCategory,
  type ContextMenuItem,
  type HotkeyBinding,
  type HotkeyCombo,
  type NavigationTarget,
  type Note,
  type NoteEditorAppearance,
  type NoteFolder,
  type NoteFileInfo,
  type NoteVersion,
  type NoteVersionContent,
  type PairedDevice,
  type RecordedStep,
  type RecordingFrameBounds,
  type RecordingFrameFooterAction,
  type PlaybackProgress,
  type PlaybackResult,
  type TargetHistoryEntry,
  type PreviewKind,
  type MacroCase,
  type MacroFolder,
  type MacroTarget,
  type ThemeMode,
  type UpdateStatus
} from '../shared/types'

const api = {
  listMacros: (): Promise<MacroCase[]> => ipcRenderer.invoke(IPC.listMacros),
  saveMacro: (macroCase: Omit<MacroCase, 'id' | 'createdAt' | 'updatedAt' | 'order'> & { id?: string }): Promise<MacroCase> =>
    ipcRenderer.invoke(IPC.saveMacro, macroCase),
  deleteMacro: (id: string): Promise<void> => ipcRenderer.invoke(IPC.deleteMacro, id),
  renameMacro: (id: string, name: string): Promise<MacroCase> => ipcRenderer.invoke(IPC.renameMacro, id, name),
  moveMacro: (id: string, folderId: string | null): Promise<MacroCase> =>
    ipcRenderer.invoke(IPC.moveMacro, id, folderId),
  setMacroPinned: (id: string, pinned: boolean): Promise<MacroCase> =>
    ipcRenderer.invoke(IPC.setMacroPinned, id, pinned),
  reorderMacros: (orderedIds: string[]): Promise<void> => ipcRenderer.invoke(IPC.reorderMacros, orderedIds),
  reorderPinnedMacros: (orderedIds: string[]): Promise<void> =>
    ipcRenderer.invoke(IPC.reorderPinnedMacros, orderedIds),
  addTemplateStepToMacro: (
    macroId: string,
    targetId: string,
    templateId: string,
    templateLabel: string
  ): Promise<MacroCase> =>
    ipcRenderer.invoke(IPC.addTemplateStepToMacro, macroId, targetId, templateId, templateLabel),

  listFolders: (): Promise<MacroFolder[]> => ipcRenderer.invoke(IPC.listFolders),
  createFolder: (name: string, parentId: string | null): Promise<MacroFolder> =>
    ipcRenderer.invoke(IPC.createFolder, name, parentId),
  renameFolder: (id: string, name: string): Promise<void> => ipcRenderer.invoke(IPC.renameFolder, id, name),
  deleteFolder: (id: string): Promise<void> => ipcRenderer.invoke(IPC.deleteFolder, id),
  reorderFolders: (orderedIds: string[]): Promise<void> => ipcRenderer.invoke(IPC.reorderFolders, orderedIds),

  pickExecutable: (): Promise<string | null> => ipcRenderer.invoke(IPC.pickExecutable),

  startRecording: (targets: MacroTarget[]): Promise<void> => ipcRenderer.invoke(IPC.recordingStart, targets),
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

  runPlayback: (macroCase: MacroCase): Promise<PlaybackResult> => ipcRenderer.invoke(IPC.playbackRun, macroCase),
  abortPlayback: (): Promise<void> => ipcRenderer.invoke(IPC.playbackAbort),
  setPlaybackPaused: (paused: boolean): Promise<void> => ipcRenderer.invoke(IPC.playbackSetPaused, paused),
  setPlaybackSpeed: (speed: number): Promise<void> => ipcRenderer.invoke(IPC.playbackSetSpeed, speed),
  setMacroPlaybackSpeed: (id: string, speed: number): Promise<void> =>
    ipcRenderer.invoke(IPC.macroSetPlaybackSpeed, id, speed),
  setStopHotkey: (combo: HotkeyCombo): Promise<void> => ipcRenderer.invoke(IPC.setStopHotkey, combo),
  clearStopHotkey: (): Promise<void> => ipcRenderer.invoke(IPC.clearStopHotkey),
  onStopHotkeyTriggered: (cb: () => void): (() => void) => {
    const listener = (): void => cb()
    ipcRenderer.on(IPC.stopHotkeyTriggered, listener)
    return () => ipcRenderer.removeListener(IPC.stopHotkeyTriggered, listener)
  },
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
  startScreenRecordingSession: (macroName: string): Promise<string> =>
    ipcRenderer.invoke(IPC.screenRecordingStart, macroName),
  appendScreenRecordingChunk: (chunk: Uint8Array): Promise<void> =>
    ipcRenderer.invoke(IPC.screenRecordingAppendChunk, chunk),
  finishScreenRecordingSession: (): Promise<string | null> => ipcRenderer.invoke(IPC.screenRecordingFinish),
  openRecordingFolder: (filePath: string): Promise<void> =>
    ipcRenderer.invoke(IPC.screenRecordingOpenFolder, filePath),
  saveScreenshot: (bytes: Uint8Array, fileName?: string): Promise<string> =>
    ipcRenderer.invoke(IPC.screenshotSave, bytes, fileName),

  listClipboardHistory: (): Promise<ClipboardHistoryEntry[]> => ipcRenderer.invoke(IPC.listClipboardHistory),
  deleteClipboardHistoryEntry: (id: string): Promise<void> =>
    ipcRenderer.invoke(IPC.deleteClipboardHistoryEntry, id),
  clearClipboardHistory: (): Promise<void> => ipcRenderer.invoke(IPC.clearClipboardHistory),
  // --- メモ ---
  listNotes: (): Promise<Note[]> => ipcRenderer.invoke(IPC.listNotes),
  searchNotes: (query: string): Promise<string[]> => ipcRenderer.invoke(IPC.searchNotes, query),
  getNoteBody: (id: string): Promise<string> => ipcRenderer.invoke(IPC.getNoteBody, id),
  getNoteHtml: (id: string): Promise<string | null> => ipcRenderer.invoke(IPC.getNoteHtml, id),
  notesDirUrl: (): Promise<string> => ipcRenderer.invoke(IPC.notesDirUrl),
  saveNoteImage: (noteId: string, dataUrl: string): Promise<string | null> =>
    ipcRenderer.invoke(IPC.saveNoteImage, noteId, dataUrl),
  importNoteFromFile: (folderId: string | null): Promise<Note | null> =>
    ipcRenderer.invoke(IPC.importNoteFromFile, folderId),
  saveNoteToFile: (id: string): Promise<string | null> => ipcRenderer.invoke(IPC.saveNoteToFile, id),
  exportNoteToFile: (id: string): Promise<Note | null> => ipcRenderer.invoke(IPC.exportNoteToFile, id),
  setNoteFileInfo: (id: string, file: NoteFileInfo | null): Promise<Note | undefined> =>
    ipcRenderer.invoke(IPC.setNoteFileInfo, id, file),
  insertTextToLastApp: (text: string): Promise<boolean> => ipcRenderer.invoke(IPC.insertTextToLastApp, text),
  applyFormatRulesToText: (text: string, ruleIds?: string[]): Promise<string> =>
    ipcRenderer.invoke(IPC.applyFormatRulesToText, text, ruleIds),
  addNoteStepToMacro: (macroId: string, targetId: string, noteId: string, noteLabel: string): Promise<MacroCase> =>
    ipcRenderer.invoke(IPC.addNoteStepToMacro, macroId, targetId, noteId, noteLabel),
  listNoteVersions: (id: string): Promise<NoteVersion[]> => ipcRenderer.invoke(IPC.listNoteVersions, id),
  getNoteVersion: (id: string, versionId: string): Promise<NoteVersionContent | null> =>
    ipcRenderer.invoke(IPC.getNoteVersion, id, versionId),
  createNote: (folderId: string | null, body?: string): Promise<Note> =>
    ipcRenderer.invoke(IPC.createNote, folderId, body),
  updateNoteBody: (
    id: string,
    body: string,
    html?: string | null,
    forceVersion?: boolean
  ): Promise<Note | undefined> => ipcRenderer.invoke(IPC.updateNoteBody, id, body, html, forceVersion),
  renameNote: (id: string, title: string): Promise<Note | undefined> => ipcRenderer.invoke(IPC.renameNote, id, title),
  deleteNote: (id: string): Promise<void> => ipcRenderer.invoke(IPC.deleteNote, id),
  moveNote: (id: string, folderId: string | null): Promise<void> => ipcRenderer.invoke(IPC.moveNote, id, folderId),
  reorderNotes: (orderedIds: string[]): Promise<void> => ipcRenderer.invoke(IPC.reorderNotes, orderedIds),
  listNoteFolders: (): Promise<NoteFolder[]> => ipcRenderer.invoke(IPC.listNoteFolders),
  createNoteFolder: (name: string, parentId: string | null): Promise<NoteFolder> =>
    ipcRenderer.invoke(IPC.createNoteFolder, name, parentId),
  renameNoteFolder: (id: string, name: string): Promise<void> => ipcRenderer.invoke(IPC.renameNoteFolder, id, name),
  reorderNoteFolders: (orderedIds: string[]): Promise<void> => ipcRenderer.invoke(IPC.reorderNoteFolders, orderedIds),
  deleteNoteFolder: (id: string): Promise<void> => ipcRenderer.invoke(IPC.deleteNoteFolder, id),
  appendToNote: (id: string, text: string): Promise<Note | undefined> =>
    ipcRenderer.invoke(IPC.appendToNote, id, text),
  setNotePinned: (id: string, pinned: boolean): Promise<void> => ipcRenderer.invoke(IPC.setNotePinned, id, pinned),
  reorderPinnedNotes: (orderedIds: string[]): Promise<void> => ipcRenderer.invoke(IPC.reorderPinnedNotes, orderedIds),
  openNoteEditor: (id: string): Promise<void> => ipcRenderer.invoke(IPC.openNoteEditor, id),
  /** 編集ウィンドウ側で使う: 今どのメモを表示しているかをmainへ伝える */
  notifyNoteEditorShowing: (id: string): Promise<void> => ipcRenderer.invoke(IPC.noteEditorShowing, id),
  /** 編集ウィンドウ側で使う: 開いているメモへの追記が届いた(本文はこのウィンドウが持っている) */
  onAppendToOpenNote: (cb: (text: string) => void): (() => void) => {
    const listener = (_e: unknown, text: string): void => cb(text)
    ipcRenderer.on(IPC.appendToOpenNote, listener)
    return () => ipcRenderer.removeListener(IPC.appendToOpenNote, listener)
  },
  setNoteEditorAppearance: (appearance: NoteEditorAppearance): Promise<AppSettings> =>
    ipcRenderer.invoke(IPC.setNoteEditorAppearance, appearance),
  openNoteViaCommandPalette: (noteId: string): Promise<void> =>
    ipcRenderer.invoke(IPC.commandPaletteOpenNote, noteId),
  /** 編集ウィンドウ側で使う: main -> このウィンドウへ、表示対象のメモIDが差し替えられた */
  onOpenNoteInEditor: (cb: (noteId: string) => void): (() => void) => {
    const listener = (_e: unknown, noteId: string): void => cb(noteId)
    ipcRenderer.on(IPC.openNoteInEditor, listener)
    return () => ipcRenderer.removeListener(IPC.openNoteInEditor, listener)
  },
  /** メインウィンドウ側で使う: 編集ウィンドウでメモが保存されたので一覧を読み直す */
  onNotesChanged: (cb: () => void): (() => void) => {
    const listener = (): void => cb()
    ipcRenderer.on(IPC.notesChanged, listener)
    return () => ipcRenderer.removeListener(IPC.notesChanged, listener)
  },

  listClipboardTemplates: (): Promise<ClipboardTemplate[]> => ipcRenderer.invoke(IPC.listClipboardTemplates),
  createClipboardTemplate: (
    text: string,
    label?: string,
    folderId?: string | null,
    trigger?: string
  ): Promise<ClipboardTemplate> => ipcRenderer.invoke(IPC.createClipboardTemplate, text, label, folderId, trigger),
  updateClipboardTemplate: (id: string, text: string, label?: string, trigger?: string): Promise<void> =>
    ipcRenderer.invoke(IPC.updateClipboardTemplate, id, text, label, trigger),
  deleteClipboardTemplate: (id: string): Promise<void> => ipcRenderer.invoke(IPC.deleteClipboardTemplate, id),
  moveClipboardTemplate: (id: string, folderId: string | null): Promise<void> =>
    ipcRenderer.invoke(IPC.moveClipboardTemplate, id, folderId),
  setClipboardTemplatePinned: (id: string, pinned: boolean): Promise<void> =>
    ipcRenderer.invoke(IPC.setClipboardTemplatePinned, id, pinned),
  reorderClipboardTemplates: (orderedIds: string[]): Promise<void> =>
    ipcRenderer.invoke(IPC.reorderClipboardTemplates, orderedIds),
  reorderPinnedClipboardTemplates: (orderedIds: string[]): Promise<void> =>
    ipcRenderer.invoke(IPC.reorderPinnedClipboardTemplates, orderedIds),

  listClipboardTemplateFolders: (): Promise<ClipboardTemplateFolder[]> =>
    ipcRenderer.invoke(IPC.listClipboardTemplateFolders),
  createClipboardTemplateFolder: (name: string, parentId: string | null): Promise<ClipboardTemplateFolder> =>
    ipcRenderer.invoke(IPC.createClipboardTemplateFolder, name, parentId),
  renameClipboardTemplateFolder: (id: string, name: string): Promise<void> =>
    ipcRenderer.invoke(IPC.renameClipboardTemplateFolder, id, name),
  reorderClipboardTemplateFolders: (orderedIds: string[]): Promise<void> =>
    ipcRenderer.invoke(IPC.reorderClipboardTemplateFolders, orderedIds),
  deleteClipboardTemplateFolder: (id: string): Promise<void> =>
    ipcRenderer.invoke(IPC.deleteClipboardTemplateFolder, id),

  listClipboardFormatRules: (): Promise<ClipboardFormatRule[]> => ipcRenderer.invoke(IPC.listClipboardFormatRules),
  createClipboardFormatRule: (find: string, isRegex: boolean, replace: string, label?: string): Promise<ClipboardFormatRule> =>
    ipcRenderer.invoke(IPC.createClipboardFormatRule, find, isRegex, replace, label),
  updateClipboardFormatRule: (
    id: string,
    fields: { find: string; isRegex: boolean; replace: string; label?: string }
  ): Promise<void> => ipcRenderer.invoke(IPC.updateClipboardFormatRule, id, fields),
  setClipboardFormatRuleEnabled: (id: string, enabled: boolean): Promise<void> =>
    ipcRenderer.invoke(IPC.setClipboardFormatRuleEnabled, id, enabled),
  deleteClipboardFormatRule: (id: string): Promise<void> => ipcRenderer.invoke(IPC.deleteClipboardFormatRule, id),
  reorderClipboardFormatRules: (orderedIds: string[]): Promise<void> =>
    ipcRenderer.invoke(IPC.reorderClipboardFormatRules, orderedIds),

  copyToClipboard: (text: string): Promise<void> => ipcRenderer.invoke(IPC.copyToClipboard, text),
  copyTemplateToClipboard: (templateId: string): Promise<void> =>
    ipcRenderer.invoke(IPC.copyTemplateToClipboard, templateId),
  copyImageToClipboard: (dataUrl: string): Promise<void> => ipcRenderer.invoke(IPC.copyImageToClipboard, dataUrl),
  showClipboardHistoryMenu: (entryId: string, text: string): Promise<void> =>
    ipcRenderer.invoke(IPC.showClipboardHistoryMenu, entryId, text),
  showClipboardImageHistoryMenu: (entryId: string): Promise<void> =>
    ipcRenderer.invoke(IPC.showClipboardImageHistoryMenu, entryId),
  onClipboardDataChanged: (cb: () => void): (() => void) => {
    const listener = (): void => cb()
    ipcRenderer.on(IPC.clipboardDataChanged, listener)
    return () => ipcRenderer.removeListener(IPC.clipboardDataChanged, listener)
  },

  showContextMenu: (items: ContextMenuItem[]): Promise<string | null> =>
    ipcRenderer.invoke(IPC.showContextMenu, items),

  getSettings: (): Promise<AppSettings> => ipcRenderer.invoke(IPC.getSettings),
  setHotkeyBindings: (hotkeyBindings: HotkeyBinding[]): Promise<AppSettings> =>
    ipcRenderer.invoke(IPC.setHotkeyBindings, hotkeyBindings),
  setTheme: (theme: ThemeMode): Promise<AppSettings> => ipcRenderer.invoke(IPC.setTheme, theme),
  setWindowSizeLocked: (locked: boolean): Promise<AppSettings> =>
    ipcRenderer.invoke(IPC.setWindowSizeLocked, locked),
  setFixedWindowSize: (size: { width: number; height: number }): Promise<AppSettings> =>
    ipcRenderer.invoke(IPC.setFixedWindowSize, size),
  setAlwaysOnTop: (alwaysOnTop: boolean): Promise<AppSettings> =>
    ipcRenderer.invoke(IPC.setAlwaysOnTop, alwaysOnTop),
  setTextExpansionEnabled: (enabled: boolean): Promise<AppSettings> =>
    ipcRenderer.invoke(IPC.setTextExpansionEnabled, enabled),
  setCommandPaletteHotkey: (hotkey: HotkeyCombo): Promise<AppSettings> =>
    ipcRenderer.invoke(IPC.setCommandPaletteHotkey, hotkey),
  setCommandPaletteMaxPerSection: (category: CommandPalettePerSectionCategory, value: number): Promise<AppSettings> =>
    ipcRenderer.invoke(IPC.setCommandPaletteMaxPerSection, category, value),
  setAutoMaskEnabled: (enabled: boolean): Promise<AppSettings> => ipcRenderer.invoke(IPC.setAutoMaskEnabled, enabled),
  setAutoMaskSensitiveInfo: (category: AutoMaskCategory, enabled: boolean): Promise<AppSettings> =>
    ipcRenderer.invoke(IPC.setAutoMaskSensitiveInfo, category, enabled),
  setClipboardPiiProtectionEnabled: (enabled: boolean): Promise<AppSettings> =>
    ipcRenderer.invoke(IPC.setClipboardPiiProtectionEnabled, enabled),
  setClipboardPiiProtectionCategory: (category: AutoMaskCategory, enabled: boolean): Promise<AppSettings> =>
    ipcRenderer.invoke(IPC.setClipboardPiiProtectionCategory, category, enabled),
  setClipboardPiiProtectionMode: (mode: ClipboardPiiProtectionMode): Promise<AppSettings> =>
    ipcRenderer.invoke(IPC.setClipboardPiiProtectionMode, mode),
  readDebugLog: (): Promise<string> => ipcRenderer.invoke(IPC.readDebugLog),
  openDebugLogFolder: (): Promise<void> => ipcRenderer.invoke(IPC.openDebugLogFolder),
  getAppVersion: (): Promise<string> => ipcRenderer.invoke(IPC.getAppVersion),
  checkForUpdates: (): Promise<void> => ipcRenderer.invoke(IPC.checkForUpdates),
  onUpdateStatus: (cb: (status: UpdateStatus) => void): (() => void) => {
    const listener = (_e: unknown, status: UpdateStatus): void => cb(status)
    ipcRenderer.on(IPC.updateStatus, listener)
    return () => ipcRenderer.removeListener(IPC.updateStatus, listener)
  },
  startHotkeyCapture: (): Promise<void> => ipcRenderer.invoke(IPC.startHotkeyCapture),
  cancelHotkeyCapture: (): Promise<void> => ipcRenderer.invoke(IPC.cancelHotkeyCapture),
  onHotkeyCapturePreview: (cb: (label: string) => void): (() => void) => {
    const listener = (_e: unknown, label: string): void => cb(label)
    ipcRenderer.on(IPC.hotkeyCapturePreview, listener)
    return () => ipcRenderer.removeListener(IPC.hotkeyCapturePreview, listener)
  },
  onHotkeyCaptureResult: (cb: (combo: HotkeyCombo) => void): (() => void) => {
    const listener = (_e: unknown, combo: HotkeyCombo): void => cb(combo)
    ipcRenderer.on(IPC.hotkeyCaptureResult, listener)
    return () => ipcRenderer.removeListener(IPC.hotkeyCaptureResult, listener)
  },

  listTargetHistory: (): Promise<TargetHistoryEntry[]> => ipcRenderer.invoke(IPC.listTargetHistory),
  recordTargetHistory: (entry: {
    kind: TargetHistoryEntry['kind']
    label: string
    url?: string
    exePath?: string
    exeArgs?: string
  }): Promise<TargetHistoryEntry> => ipcRenderer.invoke(IPC.recordTargetHistory, entry),

  setRecordingFrameFooterState: (state: 'idle' | 'recording' | 'paused'): Promise<void> =>
    ipcRenderer.invoke(IPC.setRecordingFrameFooterState, state),
  onRecordingFrameFooterAction: (cb: (action: RecordingFrameFooterAction) => void): (() => void) => {
    const listener = (_e: unknown, action: RecordingFrameFooterAction): void => cb(action)
    ipcRenderer.on(IPC.recordingFrameFooterAction, listener)
    return () => ipcRenderer.removeListener(IPC.recordingFrameFooterAction, listener)
  },
  onRecordingFrameVisibilityChanged: (cb: (visible: boolean) => void): (() => void) => {
    const listener = (_e: unknown, visible: boolean): void => cb(visible)
    ipcRenderer.on(IPC.recordingFrameVisibilityChanged, listener)
    return () => ipcRenderer.removeListener(IPC.recordingFrameVisibilityChanged, listener)
  },

  openPreviewWindow: (payload: {
    kind: PreviewKind
    folderId: string
    depth: number
    rowTop: number
  }): Promise<void> => ipcRenderer.invoke(IPC.openPreviewWindow, payload),
  scheduleClosePreviewWindow: (depth: number): void => ipcRenderer.send(IPC.scheduleClosePreviewWindow, depth),
  isCursorOverPreviewWindow: (): Promise<boolean> => ipcRenderer.invoke(IPC.isCursorOverPreviewWindow),
  navigateToFolder: (kind: PreviewKind, folderId: string): void =>
    ipcRenderer.send(IPC.navigateToFolder, { kind, folderId }),
  onNavigateToFolder: (cb: (payload: { kind: PreviewKind; folderId: string }) => void): (() => void) => {
    const listener = (_e: unknown, payload: { kind: PreviewKind; folderId: string }): void => cb(payload)
    ipcRenderer.on(IPC.navigateToFolderPush, listener)
    return () => ipcRenderer.removeListener(IPC.navigateToFolderPush, listener)
  },
  onNavigateToHotkeyTarget: (cb: (payload: NavigationTarget) => void): (() => void) => {
    const listener = (_e: unknown, payload: NavigationTarget): void => cb(payload)
    ipcRenderer.on(IPC.navigateToHotkeyTarget, listener)
    return () => ipcRenderer.removeListener(IPC.navigateToHotkeyTarget, listener)
  },

  openScreenshotEditor: (dataUrl: string): Promise<void> => ipcRenderer.invoke(IPC.openScreenshotEditor, dataUrl),
  onScreenshotEditorImage: (cb: (dataUrl: string) => void): (() => void) => {
    const listener = (_e: unknown, dataUrl: string): void => cb(dataUrl)
    ipcRenderer.on(IPC.screenshotEditorImage, listener)
    return () => ipcRenderer.removeListener(IPC.screenshotEditorImage, listener)
  },
  notifyScreenshotSaved: (path: string): void => ipcRenderer.send(IPC.notifyScreenshotSaved, path),
  onScreenshotEditorSaved: (cb: (path: string) => void): (() => void) => {
    const listener = (_e: unknown, path: string): void => cb(path)
    ipcRenderer.on(IPC.screenshotEditorSaved, listener)
    return () => ipcRenderer.removeListener(IPC.screenshotEditorSaved, listener)
  },

  onCommandPaletteShown: (cb: () => void): (() => void) => {
    const listener = (): void => cb()
    ipcRenderer.on(IPC.commandPaletteShown, listener)
    return () => ipcRenderer.removeListener(IPC.commandPaletteShown, listener)
  },
  resizeCommandPalette: (height: number): void => ipcRenderer.send(IPC.commandPaletteResize, height),
  hideCommandPalette: (): void => ipcRenderer.send(IPC.hideCommandPalette),
  insertViaCommandPalette: (text: string): Promise<void> =>
    ipcRenderer.invoke(IPC.commandPaletteInsertText, text),
  insertTemplateViaCommandPalette: (templateId: string): Promise<void> =>
    ipcRenderer.invoke(IPC.commandPaletteInsertTemplate, templateId),
  openMacroViaCommandPalette: (macroId: string): Promise<void> =>
    ipcRenderer.invoke(IPC.commandPaletteOpenMacro, macroId),
  onOpenMacroForPlayback: (cb: (macroId: string) => void): (() => void) => {
    const listener = (_e: unknown, macroId: string): void => cb(macroId)
    ipcRenderer.on(IPC.openMacroForPlayback, listener)
    return () => ipcRenderer.removeListener(IPC.openMacroForPlayback, listener)
  },

  getRemotePairingInfo: (): Promise<{ urls: string[]; port: number; code: string; expiresAtMs: number; qrDataUrl: string }> =>
    ipcRenderer.invoke(IPC.getRemotePairingInfo),
  listPairedRemoteDevices: (): Promise<PairedDevice[]> => ipcRenderer.invoke(IPC.listPairedRemoteDevices),
  revokeRemoteDevice: (deviceId: string): Promise<PairedDevice[]> =>
    ipcRenderer.invoke(IPC.revokeRemoteDevice, deviceId),
  onRemoteDeviceEvent: (cb: () => void): (() => void) => {
    const listener = (): void => cb()
    ipcRenderer.on(IPC.remoteDeviceEvent, listener)
    return () => ipcRenderer.removeListener(IPC.remoteDeviceEvent, listener)
  }
}

contextBridge.exposeInMainWorld('api', api)

export type Api = typeof api
