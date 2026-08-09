import type { ViewportRect } from '../../shared/types'

function measure(el: HTMLElement): ViewportRect {
  const rect = el.getBoundingClientRect()
  return {
    x: rect.left,
    y: rect.top,
    width: rect.width,
    height: rect.height,
    scaleFactor: window.devicePixelRatio || 1
  }
}

/** ビューポート要素の現在位置・サイズをmainプロセスへ通知する(埋め込み表示の位置合わせに使う) */
export async function reportViewport(el: HTMLElement): Promise<void> {
  await window.api.updateViewport(measure(el))
}

/** リサイズ時に自動で位置を再通知する。停止用のクリーンアップ関数を返す */
export function watchViewport(el: HTMLElement): () => void {
  const report = (): void => {
    void reportViewport(el)
  }
  const ro = new ResizeObserver(report)
  ro.observe(el)
  window.addEventListener('resize', report)
  return () => {
    ro.disconnect()
    window.removeEventListener('resize', report)
  }
}
