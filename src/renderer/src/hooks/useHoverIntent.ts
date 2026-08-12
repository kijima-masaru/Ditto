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

/**
 * カーソルを乗せてから一定時間経過したら対象をアクティブにし、外れてから一定時間
 * 経過したら解除する(通過しただけで一瞬表示・消滅する点滅を防ぐ)。フライアウト自体に
 * カーソルを移した場合は呼び出し側でcancelHideを呼ぶことで、消えずに操作を続けられる。
 */
export function useHoverIntent(showDelayMs = 300, hideDelayMs = 200): HoverIntent {
  const [activeId, setActiveId] = useState<string | null>(null)
  const showTimer = useRef<number | null>(null)
  const hideTimer = useRef<number | null>(null)

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
    hideTimer.current = window.setTimeout(() => setActiveId(null), hideDelayMs)
  }, [cancelShow, hideDelayMs])

  return { activeId, scheduleShow, scheduleHide, cancelHide }
}
