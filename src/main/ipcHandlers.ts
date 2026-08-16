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
  type ContextMenuItem,
  type HotkeyBinding,
  type ThemeMode,
  type MacroCase,
  type MacroTarget
} from '../shared/types'
import * as store from './store'
import { TargetManager } from './targetManager'
import * as recordingFrame from './recordingFrame'
import * as clickHighlight from './clickHighlight'
import * as screenCapture from './screenCapture'
import * as clipboardStore from './clipboardStore'
import * as clipboardTransforms from './clipboardTransforms'
import * as settingsStore from './settingsStore'
import * as targetHistoryStore from './targetHistoryStore'
import { setHotkeyBindingsRuntime, startHotkeyCapture, cancelHotkeyCapture } from './hotkey'
import * as textExpansion from './textExpansion'
import * as debugLog from './debugLog'
import { checkForUpdates } from './autoUpdater'

export function registerIpcHandlers(getWindow: () => BrowserWindow | null): void {
  const manager = new TargetManager()

  ipcMain.handle(IPC.listMacros, async () => store.listMacros())

  ipcMain.handle(IPC.saveMacro, async (_e, macroCase: Parameters<typeof store.saveMacro>[0]) =>
    store.saveMacro(macroCase)
  )

  ipcMain.handle(IPC.deleteMacro, async (_e, id: string) => store.deleteMacro(id))

  ipcMain.handle(IPC.renameMacro, async (_e, id: string, name: string) => store.renameMacro(id, name))

  ipcMain.handle(IPC.moveMacro, async (_e, id: string, folderId: string | null) => store.moveMacro(id, folderId))

  ipcMain.handle(IPC.reorderMacros, async (_e, orderedIds: string[]) => store.reorderMacros(orderedIds))

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

  ipcMain.handle(IPC.playbackRun, async (_e, macroCase: MacroCase) => {
    const w = getWindow()
    const result = await manager.runPlayback(macroCase, (progress) => {
      w?.webContents.send(IPC.playbackProgress, progress)
    })
    await store.recordRun(macroCase.id, result.finishedAt)
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

  ipcMain.handle(IPC.reorderClipboardTemplates, async (_e, orderedIds: string[]) =>
    clipboardStore.reorderTemplates(orderedIds)
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

  ipcMain.handle(IPC.copyImageToClipboard, async (_e, dataUrl: string) => {
    clipboard.writeImage(nativeImage.createFromDataURL(dataUrl))
  })

  ipcMain.handle(IPC.showClipboardHistoryMenu, async (_e, entryId: string, text: string) => {
    const w = getWindow()
    const setClipboard = (transform: (t: string) => string): void => clipboard.writeText(transform(text))
    const menu = Menu.buildFromTemplate([
      {
        label: '定型文に登録',
        click: async () => {
          await clipboardStore.createTemplate(text)
          w?.webContents.send(IPC.clipboardDataChanged)
        }
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
    const settings = await settingsStore.setWindowSizeLocked(locked)
    const w = getWindow()
    w?.setResizable(!locked)
    w?.setMaximizable(!locked)
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

  ipcMain.handle(IPC.setAutoMaskEnabled, async (_e, enabled: boolean) => {
    return settingsStore.setAutoMaskEnabled(enabled)
  })

  ipcMain.handle(IPC.setAutoMaskSensitiveInfo, async (_e, category: AutoMaskCategory, enabled: boolean) => {
    return settingsStore.setAutoMaskCategory(category, enabled)
  })

  ipcMain.handle(IPC.setClipboardPiiProtectionEnabled, async (_e, enabled: boolean) => {
    return settingsStore.setClipboardPiiProtectionEnabled(enabled)
  })

  ipcMain.handle(IPC.setClipboardPiiProtectionCategory, async (_e, category: AutoMaskCategory, enabled: boolean) => {
    return settingsStore.setClipboardPiiProtectionCategory(category, enabled)
  })

  ipcMain.handle(IPC.setClipboardPiiProtectionMode, async (_e, mode: ClipboardPiiProtectionMode) => {
    return settingsStore.setClipboardPiiProtectionMode(mode)
  })

  ipcMain.handle(IPC.readDebugLog, async () => debugLog.readLog())

  ipcMain.handle(IPC.openDebugLogFolder, async () => debugLog.openLogFolder())

  ipcMain.handle(IPC.getAppVersion, async () => app.getVersion())

  ipcMain.handle(IPC.checkForUpdates, async () => checkForUpdates())

  ipcMain.handle(IPC.startHotkeyCapture, async () => {
    const w = getWindow()
    startHotkeyCapture(
      (label) => w?.webContents.send(IPC.hotkeyCapturePreview, label),
      (combo) => w?.webContents.send(IPC.hotkeyCaptureResult, combo)
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
