import { useCallback, useRef, useState } from 'react'

export interface HoverIntent {
  /** 現在プレビュー表示中の対象id(何も表示していなければnull) */
  activeId: string | null
  /** 一定時間カーソルが乗ったままならidをアクティブにする */
  scheduleShow: (id: string) => void
  scheduleHide: () => void
  /** フライアウト自体にカーソルが移った時など、非表示予約を取り消す */
  cancelHide: () => void
}

export interface HoverIntentOptions {
  /**
   * trueの場合、非表示にする直前に「カーソルが今、ネストしたフォルダプレビューの
   * 別ウィンドウ(previewWindow.ts)の上にあるか」を確認し、あれば非表示にせず
   * 少し後で再確認する。
   *
   * フォルダ一覧の1階層目プレビュー(このフックで表示するフライアウト)の中の
   * サブフォルダをさらにホバーすると、その中身は別ウィンドウとして開く。カーソルが
   * その別ウィンドウへ移動すると、DOM的には1階層目フライアウトから「離れた」ことに
   * なり通常のmouseleaveで閉じてしまう。実際には別ウィンドウ側でまだ操作中なので、
   * 閉じる前に確認することでこれを防ぐ。
   */
  respectPreviewWindows?: boolean
}

/**
 * カーソルを乗せてから一定時間経過したら対象をアクティブにし、外れてから一定時間
 * 経過したら解除する(通過しただけで一瞬表示・消滅する点滅を防ぐ)。フライアウト自体に
 * カーソルを移した場合は呼び出し側でcancelHideを呼ぶことで、消えずに操作を続けられる。
 */
export function useHoverIntent(
  showDelayMs = 300,
  hideDelayMs = 200,
  options: HoverIntentOptions = {}
): HoverIntent {
  const [activeId, setActiveId] = useState<string | null>(null)
  const showTimer = useRef<number | null>(null)
  const hideTimer = useRef<number | null>(null)
  const respectPreviewWindows = options.respectPreviewWindows ?? false

  const cancelShow = useCallback(() => {
    if (showTimer.current !== null) {
      window.clearTimeout(showTimer.current)
      showTimer.current = null
    }
  }, [])

  const cancelHide = useCallback(() => {
    if (hideTimer.current !== null) {
      window.clearTimeout(hideTimer.current)
      hideTimer.current = null
    }
  }, [])

  const scheduleShow = useCallback(
    (id: string) => {
      cancelHide()
      cancelShow()
      showTimer.current = window.setTimeout(() => setActiveId(id), showDelayMs)
    },
    [cancelHide, cancelShow, showDelayMs]
  )

  const scheduleHide = useCallback(() => {
    cancelShow()
    const check = async (): Promise<void> => {
      if (respectPreviewWindows && (await window.api.isCursorOverPreviewWindow())) {
        hideTimer.current = window.setTimeout(check, hideDelayMs)
        return
      }
      hideTimer.current = null
      setActiveId(null)
    }
    hideTimer.current = window.setTimeout(check, hideDelayMs)
  }, [cancelShow, hideDelayMs, respectPreviewWindows])

  return { activeId, scheduleShow, scheduleHide, cancelHide }
}
