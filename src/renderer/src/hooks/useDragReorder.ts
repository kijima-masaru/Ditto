import { useRef, useState } from 'react'

export interface DragReorderHandlers {
  draggable: true
  onDragStart: (e: React.DragEvent) => void
  onDragEnter: (e: React.DragEvent) => void
  onDragOver: (e: React.DragEvent) => void
  onDrop: (e: React.DragEvent) => void
  onDragEnd: () => void
  className: string
}

/**
 * リストのドラッグ&ドロップ並び替えを扱う。ドラッグ中の項目と、現在ドロップ先候補に
 * なっている項目の上半分/下半分どちらに乗っているかを見て、挿入位置を決める。
 * 実際の並べ替え結果(orderedIds)は呼び出し側に渡すだけで、永続化は呼び出し側が行う。
 *
 * ドラッグ中の状態はrefで持つ(Stateにすると、直前のonDragOverで更新した値が
 * onDropのクロージャにまだ反映されていない=Reactの再レンダー未コミット、という
 * タイミングで発生する取りこぼしが起きるため。refなら常に最新値を読める)。
 * 見た目の更新(ドラッグ中/ドロップ先候補のハイライト)のためだけにStateで再レンダーを起こす。
 */
export function useDragReorder<T>(
  items: T[],
  getId: (item: T) => string,
  onReorder: (orderedIds: string[]) => void
): { getHandlers: (item: T) => DragReorderHandlers } {
  const draggedIdRef = useRef<string | null>(null)
  const overRef = useRef<{ id: string; position: 'before' | 'after' } | null>(null)
  const [, setRenderTick] = useState(0)
  const requestRerender = (): void => setRenderTick((t) => t + 1)

  const computePosition = (e: React.DragEvent): 'before' | 'after' => {
    const rect = e.currentTarget.getBoundingClientRect()
    return e.clientY - rect.top > rect.height / 2 ? 'after' : 'before'
  }

  const getHandlers = (item: T): DragReorderHandlers => {
    const id = getId(item)
    return {
      draggable: true,
      onDragStart: (e) => {
        draggedIdRef.current = id
        overRef.current = null
        e.dataTransfer.effectAllowed = 'move'
        // 一部のブラウザ/Electron環境では、dataTransferに何もセットしないとdrop自体が
        // 発火しないことがあるため、識別用に値をセットしておく
        e.dataTransfer.setData('text/plain', id)
        requestRerender()
      },
      onDragEnter: (e) => {
        if (!draggedIdRef.current || draggedIdRef.current === id) return
        e.preventDefault()
      },
      onDragOver: (e) => {
        if (!draggedIdRef.current || draggedIdRef.current === id) return
        // dropを発火させるにはdragover側で必ずpreventDefaultする必要がある。
        // 条件分岐の後にしか呼ばないと、判定漏れのタイミングでdropが無効なターゲット
        // 扱いになり「反応が悪い/移動しない」の原因になっていた
        e.preventDefault()
        const position = computePosition(e)
        if (overRef.current?.id !== id || overRef.current.position !== position) {
          overRef.current = { id, position }
          requestRerender()
        }
      },
      onDrop: (e) => {
        e.preventDefault()
        e.stopPropagation()
        const draggedId = draggedIdRef.current
        const over = overRef.current ?? { id, position: computePosition(e) }
        if (draggedId && draggedId !== id && over.id === id) {
          const ids = items.map(getId)
          const fromIndex = ids.indexOf(draggedId)
          if (fromIndex !== -1) {
            ids.splice(fromIndex, 1)
            let toIndex = ids.indexOf(id)
            if (over.position === 'after') toIndex += 1
            ids.splice(toIndex, 0, draggedId)
            onReorder(ids)
          }
        }
        draggedIdRef.current = null
        overRef.current = null
        requestRerender()
      },
      onDragEnd: () => {
        draggedIdRef.current = null
        overRef.current = null
        requestRerender()
      },
      className: [
        draggedIdRef.current === id ? 'drag-item-dragging' : '',
        overRef.current?.id === id ? `drag-item-over-${overRef.current.position}` : ''
      ]
        .filter(Boolean)
        .join(' ')
    }
  }

  return { getHandlers }
}
