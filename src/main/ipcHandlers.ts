import {
  app,
  ipcMain,
  dialog,
  desktopCapturer,
  shell,
  clipboard,
  nativeImage,
  Menu,
  type BrowserWindow,
  type MenuItemConstructorOptions
} from 'electron'
import {
  IPC,
  type AutoMaskCategory,
  type ClipboardPiiProtectionMode,
  type CommandPalettePerSectionCategory,
  type ContextMenuItem,
  type HotkeyBinding,
  type HotkeyCombo,
  type ThemeMode,
  type MacroCase,
  type MacroTarget,
  type NoteEditorAppearance,
  type NoteFileInfo
} from '../shared/types'
import path from 'path'
import * as store from './store'
import type { TargetManager } from './targetManager'
import * as recordingFrame from './recordingFrame'
import * as clickHighlight from './clickHighlight'
import * as screenCapture from './screenCapture'
import * as clipboardStore from './clipboardStore'
import * as notesStore from './notesStore'
import { NOTE_FILE_FILTERS, readTextFile, writeTextFile } from './noteFile'
import { insertToLastApp } from './lastForegroundApp'
import { applyFormatRules } from './clipboardFormat'
import * as noteEditorWindow from './noteEditorWindow'
import * as clipboardTransforms from './clipboardTransforms'
import { resolveTemplateText } from './templateVariables'
import * as settingsStore from './settingsStore'
import * as targetHistoryStore from './targetHistoryStore'
import {
  setHotkeyBindingsRuntime,
  startHotkeyCapture,
  cancelHotkeyCapture,
  setStopHotkey,
  clearStopHotkey
} from './hotkey'
import * as textExpansion from './textExpansion'
import * as debugLog from './debugLog'
import { checkForUpdates } from './autoUpdater'
import * as remoteServer from './remoteServer'

export function registerIpcHandlers(getWindow: () => BrowserWindow | null, manager: TargetManager): void {
  /**
   * メモへ追記する。対象のメモを編集ウィンドウが開いている場合は、ファイルを直接
   * 書き換えず開いているウィンドウ側に追記させる(理由はnoteEditorWindow.appendIfOpen参照)
   */
  const appendTextToNote = async (id: string, text: string): Promise<void> => {
    if (noteEditorWindow.appendIfOpen(id, text)) return
    await notesStore.appendToNote(id, text)
    notifyNotesChanged()
  }

  /** 編集ウィンドウでの保存をメインウィンドウのメモ一覧へ反映させる */
  const notifyNotesChanged = (): void => {
    const w = getWindow()
    if (w && !w.isDestroyed()) w.webContents.send(IPC.notesChanged)
  }

  ipcMain.handle(IPC.listMacros, async () => store.listMacros())

  ipcMain.handle(IPC.saveMacro, async (_e, macroCase: Parameters<typeof store.saveMacro>[0]) =>
    store.saveMacro(macroCase)
  )

  ipcMain.handle(IPC.deleteMacro, async (_e, id: string) => store.deleteMacro(id))

  ipcMain.handle(IPC.renameMacro, async (_e, id: string, name: string) => store.renameMacro(id, name))

  ipcMain.handle(IPC.moveMacro, async (_e, id: string, folderId: string | null) => store.moveMacro(id, folderId))

  ipcMain.handle(IPC.setMacroPinned, async (_e, id: string, pinned: boolean) => store.setPinned(id, pinned))

  ipcMain.handle(IPC.reorderMacros, async (_e, orderedIds: string[]) => store.reorderMacros(orderedIds))

  ipcMain.handle(IPC.reorderPinnedMacros, async (_e, orderedIds: string[]) => store.reorderPinnedMacros(orderedIds))

  ipcMain.handle(
    IPC.addTemplateStepToMacro,
    async (_e, macroId: string, targetId: string, templateId: string, templateLabel: string) =>
      store.addTemplateStep(macroId, targetId, templateId, templateLabel)
  )

  ipcMain.handle(IPC.listFolders, async () => store.listFolders())

  ipcMain.handle(IPC.createFolder, async (_e, name: string, parentId: string | null) =>
    store.createFolder(name, parentId)
  )

  ipcMain.handle(IPC.renameFolder, async (_e, id: string, name: string) => store.renameFolder(id, name))

  ipcMain.handle(IPC.deleteFolder, async (_e, id: string) => store.deleteFolder(id))

  ipcMain.handle(IPC.reorderFolders, async (_e, orderedIds: string[]) => store.reorderFolders(orderedIds))

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

  ipcMain.handle(IPC.recordingStart, async (_e, targets: MacroTarget[]) => {
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

  // 進捗はメインウィンドウ固定ではなく、再生を開始した当のウィンドウへ返す
  // (コマンドパレット経由の再生専用ウィンドウからも実行されるため。macroPlaybackWindow.ts参照)
  ipcMain.handle(IPC.playbackRun, async (e, macroCase: MacroCase) => {
    const sender = e.sender
    const result = await manager.runPlayback(macroCase, (progress) => {
      if (!sender.isDestroyed()) sender.send(IPC.playbackProgress, progress)
    })
    await store.recordRun(macroCase.id, result.finishedAt)
    return result
  })

  ipcMain.handle(IPC.playbackAbort, async () => {
    manager.abort()
  })

  ipcMain.handle(IPC.playbackSetPaused, async (_e, paused: boolean) => {
    manager.setPaused(paused)
  })

  ipcMain.handle(IPC.playbackSetSpeed, async (_e, speed: number) => {
    manager.setSpeed(speed)
  })

  ipcMain.handle(IPC.macroSetPlaybackSpeed, async (_e, id: string, speed: number) => {
    await store.setPlaybackSpeed(id, speed)
  })

  // 停止キーの通知も、停止キーを登録した当のウィンドウ(再生・記録画面を表示している
  // ウィンドウ)へ返す
  ipcMain.handle(IPC.setStopHotkey, async (e, combo: HotkeyCombo) => {
    const sender = e.sender
    setStopHotkey(combo, () => {
      if (!sender.isDestroyed()) sender.send(IPC.stopHotkeyTriggered)
    })
  })

  ipcMain.handle(IPC.clearStopHotkey, async () => {
    clearStopHotkey()
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

  ipcMain.handle(IPC.screenRecordingStart, async (_e, macroName: string) => {
    recordingFrame.setInteractive(false)
    clickHighlight.start()
    return screenCapture.startRecording(macroName)
  })

  ipcMain.handle(IPC.screenRecordingAppendChunk, async (_e, chunk: Uint8Array) => {
    screenCapture.appendChunk(chunk)
  })

  ipcMain.handle(IPC.screenRecordingFinish, async () => {
    recordingFrame.setInteractive(true)
    clickHighlight.stop()
    return screenCapture.finishRecording()
  })

  ipcMain.handle(IPC.screenRecordingOpenFolder, async (_e, filePath: string) => {
    shell.showItemInFolder(filePath)
  })

  ipcMain.handle(IPC.screenshotSave, async (_e, bytes: Uint8Array, fileName?: string) =>
    screenCapture.saveScreenshot(bytes, fileName)
  )

  ipcMain.handle(IPC.listClipboardHistory, async () => clipboardStore.listHistory())

  ipcMain.handle(IPC.deleteClipboardHistoryEntry, async (_e, id: string) => clipboardStore.deleteHistoryEntry(id))

  ipcMain.handle(IPC.clearClipboardHistory, async () => clipboardStore.clearHistory())

  ipcMain.handle(IPC.listClipboardTemplates, async () => clipboardStore.listTemplates())

  ipcMain.handle(
    IPC.createClipboardTemplate,
    async (_e, text: string, label?: string, folderId?: string | null, trigger?: string) => {
      const template = await clipboardStore.createTemplate(text, label, folderId ?? null, trigger)
      await textExpansion.refreshTriggerMap()
      return template
    }
  )

  ipcMain.handle(IPC.updateClipboardTemplate, async (_e, id: string, text: string, label?: string, trigger?: string) => {
    await clipboardStore.updateTemplate(id, text, label, trigger)
    await textExpansion.refreshTriggerMap()
  })

  ipcMain.handle(IPC.deleteClipboardTemplate, async (_e, id: string) => {
    await clipboardStore.deleteTemplate(id)
    await textExpansion.refreshTriggerMap()
  })

  ipcMain.handle(IPC.moveClipboardTemplate, async (_e, id: string, folderId: string | null) =>
    clipboardStore.moveTemplate(id, folderId)
  )

  ipcMain.handle(IPC.setClipboardTemplatePinned, async (_e, id: string, pinned: boolean) =>
    clipboardStore.setTemplatePinned(id, pinned)
  )

  ipcMain.handle(IPC.reorderClipboardTemplates, async (_e, orderedIds: string[]) =>
    clipboardStore.reorderTemplates(orderedIds)
  )

  ipcMain.handle(IPC.reorderPinnedClipboardTemplates, async (_e, orderedIds: string[]) =>
    clipboardStore.reorderPinnedTemplates(orderedIds)
  )

  ipcMain.handle(IPC.listClipboardTemplateFolders, async () => clipboardStore.listTemplateFolders())

  ipcMain.handle(IPC.createClipboardTemplateFolder, async (_e, name: string, parentId: string | null) =>
    clipboardStore.createTemplateFolder(name, parentId)
  )

  ipcMain.handle(IPC.reorderClipboardTemplateFolders, async (_e, orderedIds: string[]) =>
    clipboardStore.reorderTemplateFolders(orderedIds)
  )

  ipcMain.handle(IPC.renameClipboardTemplateFolder, async (_e, id: string, name: string) =>
    clipboardStore.renameTemplateFolder(id, name)
  )

  ipcMain.handle(IPC.deleteClipboardTemplateFolder, async (_e, id: string) =>
    clipboardStore.deleteTemplateFolder(id)
  )

  ipcMain.handle(IPC.listClipboardFormatRules, async () => clipboardStore.listFormatRules())

  ipcMain.handle(IPC.createClipboardFormatRule, async (_e, find: string, isRegex: boolean, replace: string, label?: string) =>
    clipboardStore.createFormatRule(find, isRegex, replace, label)
  )

  ipcMain.handle(
    IPC.updateClipboardFormatRule,
    async (_e, id: string, fields: { find: string; isRegex: boolean; replace: string; label?: string }) =>
      clipboardStore.updateFormatRule(id, fields)
  )

  ipcMain.handle(IPC.setClipboardFormatRuleEnabled, async (_e, id: string, enabled: boolean) =>
    clipboardStore.setFormatRuleEnabled(id, enabled)
  )

  ipcMain.handle(IPC.deleteClipboardFormatRule, async (_e, id: string) => clipboardStore.deleteFormatRule(id))

  ipcMain.handle(IPC.reorderClipboardFormatRules, async (_e, orderedIds: string[]) =>
    clipboardStore.reorderFormatRules(orderedIds)
  )

  ipcMain.handle(IPC.copyToClipboard, async (_e, text: string) => {
    clipboard.writeText(text)
  })

  ipcMain.handle(IPC.copyTemplateToClipboard, async (_e, templateId: string) => {
    const resolved = await resolveTemplateText(templateId)
    clipboard.writeText(resolved)
  })

  ipcMain.handle(IPC.copyImageToClipboard, async (_e, dataUrl: string) => {
    clipboard.writeImage(nativeImage.createFromDataURL(dataUrl))
  })

  ipcMain.handle(IPC.showClipboardHistoryMenu, async (_e, entryId: string, text: string) => {
    const w = getWindow()
    const setClipboard = (transform: (t: string) => string): void => clipboard.writeText(transform(text))
    // 「メモに追記」の候補。最近更新したものから10件までに絞る
    const recentNotes = (await notesStore.listNotes())
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, 10)
    const menu = Menu.buildFromTemplate([
      {
        label: '定型文に登録',
        click: async () => {
          await clipboardStore.createTemplate(text)
          w?.webContents.send(IPC.clipboardDataChanged)
        }
      },
      {
        label: 'メモに追記',
        // 調査中にコピーした内容をそのままメモへ貯めていけるようにする。
        // メモが多い場合に選びにくくならないよう、最近更新した順に絞って出す
        submenu: [
          {
            label: '新しいメモを作成',
            click: async () => {
              const note = await notesStore.createNote(null, text)
              w?.webContents.send(IPC.notesChanged)
              noteEditorWindow.open(note.id)
            }
          },
          ...(recentNotes.length > 0 ? [{ type: 'separator' as const }] : []),
          ...recentNotes.map((note) => ({
            label: note.title,
            click: () => void appendTextToNote(note.id, text)
          }))
        ]
      },
      {
        label: 'コピー',
        click: () => clipboard.writeText(text)
      },
      { type: 'separator' },
      {
        label: 'クリップボードにセット(整形)',
        submenu: [
          {
            label: '各行先頭に "> " を挿入',
            click: () => setClipboard((t) => clipboardTransforms.insertLinePrefix(t, '> '))
          },
          {
            label: '各行先頭に "// " を挿入',
            click: () => setClipboard((t) => clipboardTransforms.insertLinePrefix(t, '// '))
          },
          { label: '各行を " で囲む', click: () => setClipboard(clipboardTransforms.wrapLinesInQuotes) },
          { label: '各行先頭に連番(001:)を挿入', click: () => setClipboard(clipboardTransforms.numberLines) }
        ]
      },
      {
        label: 'クリップボードにセット(変換)',
        submenu: [
          { label: '小文字に変換', click: () => setClipboard(clipboardTransforms.toLowerCase) },
          { label: '大文字に変換', click: () => setClipboard(clipboardTransforms.toUpperCase) },
          { label: '全角→半角', click: () => setClipboard(clipboardTransforms.toHalfWidth) },
          { label: '半角→全角', click: () => setClipboard(clipboardTransforms.toFullWidth) },
          { label: 'TAB→空白', click: () => setClipboard(clipboardTransforms.tabToSpace) },
          { label: '空白→TAB', click: () => setClipboard(clipboardTransforms.spaceToTab) },
          { label: '改行コードを削除', click: () => setClipboard(clipboardTransforms.removeLineBreaks) }
        ]
      },
      { type: 'separator' },
      {
        label: '履歴から削除',
        click: async () => {
          await clipboardStore.deleteHistoryEntry(entryId)
          w?.webContents.send(IPC.clipboardDataChanged)
        }
      }
    ])
    if (w) menu.popup({ window: w })
  })

  // 画像エントリはテキスト整形・定型文登録が意味を持たないため、専用の縮小メニューを出す
  ipcMain.handle(IPC.showClipboardImageHistoryMenu, async (_e, entryId: string) => {
    const w = getWindow()
    const menu = Menu.buildFromTemplate([
      {
        label: 'コピー',
        click: async () => {
          const history = await clipboardStore.listHistory()
          const entry = history.find((h) => h.id === entryId)
          if (entry?.imageDataUrl) clipboard.writeImage(nativeImage.createFromDataURL(entry.imageDataUrl))
        }
      },
      { type: 'separator' },
      {
        label: '履歴から削除',
        click: async () => {
          await clipboardStore.deleteHistoryEntry(entryId)
          w?.webContents.send(IPC.clipboardDataChanged)
        }
      }
    ])
    if (w) menu.popup({ window: w })
  })

  ipcMain.handle(IPC.showContextMenu, async (_e, items: ContextMenuItem[]) => {
    const w = getWindow()
    return new Promise<string | null>((resolve) => {
      let resolved = false
      const build = (list: ContextMenuItem[]): MenuItemConstructorOptions[] =>
        list.map((item) => {
          if (item.type === 'separator') return { type: 'separator' }
          if (item.submenu) {
            return { label: item.label, enabled: item.enabled !== false, submenu: build(item.submenu) }
          }
          return {
            label: item.label,
            enabled: item.enabled !== false,
            click: () => {
              resolved = true
              resolve(item.id)
            }
          }
        })
      const menu = Menu.buildFromTemplate(build(items))
      menu.popup({
        window: w ?? undefined,
        callback: () => {
          if (!resolved) resolve(null)
        }
      })
    })
  })

  ipcMain.handle(IPC.getSettings, async () => settingsStore.getSettings())

  ipcMain.handle(IPC.setHotkeyBindings, async (_e, hotkeyBindings: HotkeyBinding[]) => {
    const settings = await settingsStore.setHotkeyBindings(hotkeyBindings)
    setHotkeyBindingsRuntime(hotkeyBindings)
    return settings
  })

  ipcMain.handle(IPC.setTheme, async (_e, theme: ThemeMode) => settingsStore.setTheme(theme))

  ipcMain.handle(IPC.setWindowSizeLocked, async (_e, locked: boolean) => {
    const w = getWindow()
    // 固定に切り替えた時点のウィンドウサイズを、そのまま固定サイズとして自動反映する
    if (locked && w) {
      const [width, height] = w.getSize()
      await settingsStore.setFixedWindowSize({ width, height })
    }
    const settings = await settingsStore.setWindowSizeLocked(locked)
    w?.setResizable(!locked)
    w?.setMaximizable(!locked)
    return settings
  })

  ipcMain.handle(IPC.setFixedWindowSize, async (_e, size: { width: number; height: number }) => {
    const settings = await settingsStore.setFixedWindowSize(size)
    const w = getWindow()
    if (w && settings.windowSizeLocked) w.setSize(size.width, size.height)
    return settings
  })

  ipcMain.handle(IPC.setAlwaysOnTop, async (_e, alwaysOnTop: boolean) => {
    const settings = await settingsStore.setAlwaysOnTop(alwaysOnTop)
    getWindow()?.setAlwaysOnTop(alwaysOnTop)
    return settings
  })

  ipcMain.handle(IPC.setTextExpansionEnabled, async (_e, enabled: boolean) => {
    const settings = await settingsStore.setTextExpansionEnabled(enabled)
    textExpansion.setEnabled(enabled)
    return settings
  })

  ipcMain.handle(IPC.setClipboardItemLines, async (_e, lines: 1 | 2) =>
    settingsStore.setClipboardItemLines(lines)
  )

  ipcMain.handle(IPC.setAutoMaskEnabled, async (_e, enabled: boolean) => {
    return settingsStore.setAutoMaskEnabled(enabled)
  })

  ipcMain.handle(IPC.setAutoMaskSensitiveInfo, async (_e, category: AutoMaskCategory, enabled: boolean) => {
    return settingsStore.setAutoMaskCategory(category, enabled)
  })

  ipcMain.handle(
    IPC.setCommandPaletteMaxPerSection,
    async (_e, category: CommandPalettePerSectionCategory, value: number) => {
      return settingsStore.setCommandPaletteMaxPerSection(category, value)
    }
  )

  ipcMain.handle(IPC.setClipboardPiiProtectionEnabled, async (_e, enabled: boolean) => {
    return settingsStore.setClipboardPiiProtectionEnabled(enabled)
  })

  ipcMain.handle(IPC.setClipboardPiiProtectionCategory, async (_e, category: AutoMaskCategory, enabled: boolean) => {
    return settingsStore.setClipboardPiiProtectionCategory(category, enabled)
  })

  ipcMain.handle(IPC.setClipboardPiiProtectionMode, async (_e, mode: ClipboardPiiProtectionMode) => {
    return settingsStore.setClipboardPiiProtectionMode(mode)
  })

  // Ditto Remote(スマホ連携)。ペアリング情報の生成・デバイス管理はremoteServer.ts側で
  // 状態を持つため、ここでは薄い窓口としてそちらの関数を呼ぶだけにする
  ipcMain.handle(IPC.getRemotePairingInfo, async () => remoteServer.getPairingInfo())

  ipcMain.handle(IPC.listPairedRemoteDevices, async () => remoteServer.listPairedDevices())

  ipcMain.handle(IPC.revokeRemoteDevice, async (_e, deviceId: string) => remoteServer.revokeDevice(deviceId))

  ipcMain.handle(IPC.readDebugLog, async () => debugLog.readLog())

  ipcMain.handle(IPC.openDebugLogFolder, async () => debugLog.openLogFolder())

  // --- メモ(自分で書いて育てるテキスト) ---

  ipcMain.handle(IPC.listNotes, async () => notesStore.listNotes())

  ipcMain.handle(IPC.searchNotes, async (_e, query: string) => notesStore.searchNotes(query))

  ipcMain.handle(IPC.getNoteBody, async (_e, id: string) => notesStore.getNoteBody(id))

  ipcMain.handle(IPC.getNoteHtml, async (_e, id: string) => notesStore.getNoteHtml(id))

  ipcMain.handle(IPC.notesDirUrl, async () => notesStore.notesDirUrl())

  ipcMain.handle(IPC.duplicateNote, async (_e, id: string) => {
    const copy = await notesStore.duplicateNote(id)
    notifyNotesChanged()
    return copy
  })

  /**
   * メモの本文全体をクリップボードへ入れる。装飾を付けている場合はHTML形式も一緒に
   * 書き込み、WordやExcelへ貼り付けた時に書式ごと持っていけるようにする
   * (テキストしか受け取らない相手にはプレーンテキストの方が渡る)
   */
  ipcMain.handle(IPC.copyNoteToClipboard, async (_e, id: string) => {
    const body = await notesStore.getNoteBody(id)
    const html = await notesStore.getNoteHtml(id)
    if (html) clipboard.write({ text: body, html })
    else clipboard.writeText(body)
    return body.length
  })

  ipcMain.handle(IPC.saveNoteImage, async (_e, noteId: string, dataUrl: string) =>
    notesStore.saveNoteImage(noteId, dataUrl)
  )

  /**
   * テキストファイルを選んで新しいメモとして取り込む。文字コードと改行コードは
   * 判別した結果をメモに覚えさせ、上書き保存の時に同じ形へ戻せるようにする
   */
  ipcMain.handle(IPC.importNoteFromFile, async (_e, folderId: string | null) => {
    const parent = noteEditorWindow.getWindow() ?? getWindow()
    const result = parent
      ? await dialog.showOpenDialog(parent, {
          title: 'メモとして読み込むファイルを選択',
          properties: ['openFile'],
          filters: NOTE_FILE_FILTERS
        })
      : await dialog.showOpenDialog({ properties: ['openFile'], filters: NOTE_FILE_FILTERS })
    if (result.canceled || result.filePaths.length === 0) return null
    const filePath = result.filePaths[0]
    const file = await readTextFile(filePath)
    const note = await notesStore.createNote(folderId ?? null, file.text)
    // ファイル名をそのままメモの名前にする(本文1行目からの自動生成より分かりやすいため)
    await notesStore.renameNote(note.id, path.basename(filePath))
    const updated = await notesStore.setNoteFile(note.id, {
      path: filePath,
      encoding: file.encoding,
      newline: file.newline
    })
    notifyNotesChanged()
    return updated ?? note
  })

  /** 取り込み元のファイルへ上書き保存する。結び付いていなければnullを返す */
  ipcMain.handle(IPC.saveNoteToFile, async (_e, id: string) => {
    const note = (await notesStore.listNotes()).find((n) => n.id === id)
    if (!note?.file) return null
    const body = await notesStore.getNoteBody(id)
    await writeTextFile(note.file.path, body, note.file.encoding, note.file.newline)
    return note.file.path
  })

  /** 名前を付けてファイルへ保存し、以後の上書き保存先としても覚える */
  ipcMain.handle(IPC.exportNoteToFile, async (_e, id: string) => {
    const note = (await notesStore.listNotes()).find((n) => n.id === id)
    if (!note) return null
    const parent = noteEditorWindow.getWindow() ?? getWindow()
    const options = {
      title: 'メモをファイルとして保存',
      defaultPath: note.file?.path ?? `${note.title.replace(/[\\/:*?"<>|]/g, '_')}.txt`,
      filters: NOTE_FILE_FILTERS
    }
    const result = parent ? await dialog.showSaveDialog(parent, options) : await dialog.showSaveDialog(options)
    if (result.canceled || !result.filePath) return null
    const body = await notesStore.getNoteBody(id)
    const encoding = note.file?.encoding ?? 'utf8'
    const newline = note.file?.newline ?? 'crlf'
    await writeTextFile(result.filePath, body, encoding, newline)
    const updated = await notesStore.setNoteFile(id, { path: result.filePath, encoding, newline })
    notifyNotesChanged()
    return updated
  })

  /** 文字コード・改行コードだけを変更する(次の保存から反映される) */
  ipcMain.handle(IPC.setNoteFileInfo, async (_e, id: string, file: NoteFileInfo | null) => {
    const updated = await notesStore.setNoteFile(id, file ?? undefined)
    notifyNotesChanged()
    return updated
  })

  /** メモの選択範囲を、直前に使っていたアプリへそのまま入力する */
  ipcMain.handle(IPC.insertTextToLastApp, async (_e, text: string) => insertToLastApp(text))

  /** 登録済みの整形ルールを任意のテキストへ適用する(メモの選択範囲へ当てるために使う) */
  ipcMain.handle(IPC.applyFormatRulesToText, async (_e, text: string, ruleIds?: string[]) => {
    const rules = await clipboardStore.listFormatRules()
    const target = ruleIds && ruleIds.length > 0 ? rules.filter((r) => ruleIds.includes(r.id)) : rules.filter((r) => r.enabled)
    return applyFormatRules(text, target)
  })

  ipcMain.handle(
    IPC.addNoteStepToMacro,
    async (_e, macroId: string, targetId: string, noteId: string, noteLabel: string) =>
      store.addNoteStep(macroId, targetId, noteId, noteLabel)
  )

  ipcMain.handle(IPC.listNoteVersions, async (_e, id: string) => notesStore.listNoteVersions(id))

  ipcMain.handle(IPC.getNoteVersion, async (_e, id: string, versionId: string) =>
    notesStore.getNoteVersion(id, versionId)
  )

  ipcMain.handle(IPC.createNote, async (_e, folderId: string | null, body?: string) =>
    notesStore.createNote(folderId, body ?? '')
  )

  // 編集ウィンドウからの自動保存。保存のたびにメインウィンドウの一覧へ反映させる
  ipcMain.handle(
    IPC.updateNoteBody,
    async (_e, id: string, body: string, html?: string | null, forceVersion?: boolean) => {
      const note = await notesStore.updateNoteBody(id, body, html, forceVersion === true)
      notifyNotesChanged()
      return note
    }
  )

  ipcMain.handle(IPC.renameNote, async (_e, id: string, title: string) => {
    const note = await notesStore.renameNote(id, title)
    notifyNotesChanged()
    return note
  })

  ipcMain.handle(IPC.deleteNote, async (_e, id: string) => notesStore.deleteNote(id))

  ipcMain.handle(IPC.moveNote, async (_e, id: string, folderId: string | null) => notesStore.moveNote(id, folderId))

  ipcMain.handle(IPC.reorderNotes, async (_e, orderedIds: string[]) => notesStore.reorderNotes(orderedIds))

  ipcMain.handle(IPC.listNoteFolders, async () => notesStore.listNoteFolders())

  ipcMain.handle(IPC.createNoteFolder, async (_e, name: string, parentId: string | null) =>
    notesStore.createNoteFolder(name, parentId)
  )

  ipcMain.handle(IPC.renameNoteFolder, async (_e, id: string, name: string) => notesStore.renameNoteFolder(id, name))

  ipcMain.handle(IPC.reorderNoteFolders, async (_e, orderedIds: string[]) =>
    notesStore.reorderNoteFolders(orderedIds)
  )

  ipcMain.handle(IPC.deleteNoteFolder, async (_e, id: string) => notesStore.deleteNoteFolder(id))

  ipcMain.handle(IPC.appendToNote, async (_e, id: string, text: string) => appendTextToNote(id, text))

  ipcMain.handle(IPC.noteEditorShowing, async (_e, id: string) => noteEditorWindow.setShowingNote(id))

  ipcMain.handle(IPC.setNoteEditorAppearance, async (_e, appearance: NoteEditorAppearance) =>
    settingsStore.setNoteEditorAppearance(appearance)
  )

  ipcMain.handle(IPC.setNotePinned, async (_e, id: string, pinned: boolean) => notesStore.setNotePinned(id, pinned))

  ipcMain.handle(IPC.reorderPinnedNotes, async (_e, orderedIds: string[]) => notesStore.reorderPinnedNotes(orderedIds))

  ipcMain.handle(IPC.openNoteEditor, async (_e, id: string) => noteEditorWindow.open(id))

  ipcMain.handle(IPC.getAppVersion, async () => app.getVersion())

  ipcMain.handle(IPC.checkForUpdates, async () => checkForUpdates())

  // キャプチャ結果も、キャプチャを開始した当のウィンドウへ返す(停止キーの入力欄は
  // メインウィンドウだけでなく再生専用ウィンドウにも表示されるため)
  ipcMain.handle(IPC.startHotkeyCapture, async (e) => {
    const sender = e.sender
    startHotkeyCapture(
      (label) => {
        if (!sender.isDestroyed()) sender.send(IPC.hotkeyCapturePreview, label)
      },
      (combo) => {
        if (!sender.isDestroyed()) sender.send(IPC.hotkeyCaptureResult, combo)
      }
    )
  })

  ipcMain.handle(IPC.cancelHotkeyCapture, async () => {
    cancelHotkeyCapture()
  })

  ipcMain.handle(IPC.listTargetHistory, async () => targetHistoryStore.listHistory())

  ipcMain.handle(IPC.recordTargetHistory, async (_e, entry: targetHistoryStore.RecordTargetHistoryInput) =>
    targetHistoryStore.recordEntry(entry)
  )

  ipcMain.handle(IPC.setRecordingFrameFooterState, async (_e, state: 'idle' | 'recording' | 'paused') => {
    recordingFrame.setFooterState(state)
  })

  recordingFrame.onFooterAction((action) => {
    getWindow()?.webContents.send(IPC.recordingFrameFooterAction, action)
  })

  recordingFrame.onVisibilityChange((visible) => {
    getWindow()?.webContents.send(IPC.recordingFrameVisibilityChanged, visible)
  })
}
