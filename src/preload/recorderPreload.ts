import { contextBridge, ipcRenderer } from 'electron'

/**
 * Web対象として埋め込む WebContentsView 専用のpreload。
 * ページ内に注入する記録用スクリプトが、この bridge 経由でイベントをmainプロセスへ送る。
 */
contextBridge.exposeInMainWorld('__autoTestToolBridge', {
  send: (payload: unknown): void => {
    ipcRenderer.send('recorder:event', payload)
  }
})
