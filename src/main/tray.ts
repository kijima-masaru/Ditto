import { Menu, Tray, nativeImage } from 'electron'

/** 32x32の青い円アイコン(build/tray-icon-32.pngと同一)をbase64で直接埋め込み、
 *  パッケージ後のパス解決に依存せず常に読み込めるようにする */
const TRAY_ICON_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAA20lEQVR4nM2X4QnEIAyFO4AjuEMWcRVHEDKBuzlCB8gMdxT0kFJRr7YvP94fEd+HiTHZiGWblCUWRyyeWEKWz2t29rwZ08MoEcuno5T3DsH0NhhiiQOmLcV8xl8Ax5XuN8yL9nzWFIBfYHyWHwV4wrwJcXXtT5kXuRaAWRTzkZwwVwB3sn1W8QxgXzQvsjVAAACEGmCkwq1WKgCI6/+F4a2n15J7uvD05FEJWBRUAMBDAE9C+DOEFyIVpRj+GcG/YxUNCbwlU9GUqmjLVQwmKkazWrDhtAWzbDz/AgB2YTzGyDJUAAAAAElFTkSuQmCC'

export function createTray(showWindow: () => void, quitApp: () => void): Tray {
  const icon = nativeImage.createFromDataURL(`data:image/png;base64,${TRAY_ICON_BASE64}`)
  const tray = new Tray(icon)
  tray.setToolTip('Ditto')

  const menu = Menu.buildFromTemplate([
    { label: '表示', click: () => showWindow() },
    { type: 'separator' },
    { label: '終了', click: () => quitApp() }
  ])
  tray.setContextMenu(menu)
  tray.on('click', () => showWindow())

  return tray
}
