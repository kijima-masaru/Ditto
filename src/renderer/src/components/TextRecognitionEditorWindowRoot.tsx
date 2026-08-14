import { useEffect, useState } from 'react'
import TextRecognitionEditor from './TextRecognitionEditor'

/**
 * テキスト認識(OCR)結果の確認・編集専用の別ウィンドウのルート。
 * メインウィンドウと同じrenderer bundleを`?textRecognitionEditor=1`付きで読み込むことで
 * 実現している(textRecognitionWindow.ts参照)。認識結果はmain側のOCR処理完了後にIPCで届く。
 */
export default function TextRecognitionEditorWindowRoot(): React.JSX.Element {
  const [text, setText] = useState<string | null>(null)

  useEffect(() => {
    // Ditto本体のテーマ設定に関わらず、確認画面は常にダークカラーで表示する
    document.documentElement.setAttribute('data-theme', 'dark')
  }, [])

  useEffect(() => {
    return window.api.onTextRecognitionEditorText((value) => setText(value))
  }, [])

  return (
    <TextRecognitionEditor
      text={text}
      onCancel={() => window.close()}
      onSaved={() => window.close()}
    />
  )
}
