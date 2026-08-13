import { useEffect, useState } from 'react'
import ScreenshotEditor from './ScreenshotEditor'

/**
 * スクリーンショット確認・注釈編集専用の別ウィンドウのルート。
 * メインウィンドウと同じrenderer bundleを`?screenshotEditor=1`付きで読み込むことで
 * 実現している(screenshotEditorWindow.ts参照)。撮影した画像はメインウィンドウの
 * <canvas>で作られたdata URLをIPCで受け取る。
 */
export default function ScreenshotEditorWindowRoot(): React.JSX.Element {
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null)

  useEffect(() => {
    // Ditto本体のテーマ設定に関わらず、スクリーンショット確認画面は常にダークカラーで表示する
    document.documentElement.setAttribute('data-theme', 'dark')
  }, [])

  useEffect(() => {
    return window.api.onScreenshotEditorImage((dataUrl) => setImageDataUrl(dataUrl))
  }, [])

  if (!imageDataUrl) {
    return <div className="screenshot-editor-page screenshot-editor-loading">読み込み中...</div>
  }

  return (
    <ScreenshotEditor
      imageDataUrl={imageDataUrl}
      onCancel={() => window.close()}
      onSaved={(path) => {
        window.api.notifyScreenshotSaved(path)
        window.close()
      }}
    />
  )
}
