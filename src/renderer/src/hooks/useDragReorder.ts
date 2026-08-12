import { useState } from 'react'

export interface DragReorderHandlers {
  draggable: true
  onDragStart: (e: React.DragEvent) => void
  onDragOver: (e: React.DragEvent) => void
  onDrop: (e: React.DragEvent) => void
  onDragEnd: () => void
  className: string
}

/**
 * リストのドラッグ&ドロップ並び替えを扱う。ドラッグ中の項目と、現在ドロップ先候補に
 * なっている項目の上半分/下半分どちらに乗っているかを見て、挿入位置を決める。
 * 実際の並べ替え結果(orderedIds)は呼び出し側に渡すだけで、永続化は呼び出し側が行う。
 */
export function useDragReorder<T>(
  items: T[],
  getId: (item: T) => string,
  onReorder: (orderedIds: string[]) => void
): { getHandlers: (item: T) => DragReorderHandlers } {
  const [draggedId, setDraggedId] = useState<string | null>(null)
  const [overState, setOverState] = useState<{ id: string; position: 'before' | 'after' } | null>(null)

  const getHandlers = (item: T): DragReorderHandlers => {
    const id = getId(item)
    return {
      draggable: true,
      onDragStart: (e) => {
        setDraggedId(id)
        e.dataTransfer.effectAllowed = 'move'
      },
      onDragOver: (e) => {
        if (!draggedId || draggedId === id) return
        e.preventDefault()
        const rect = e.currentTarget.getBoundingClientRect()
        const position = e.clientY - rect.top > rect.height / 2 ? 'after' : 'before'
        setOverState((prev) => (prev?.id === id && prev.position === position ? prev : { id, position }))
      },
      onDrop: (e) => {
        e.preventDefault()
        if (draggedId && draggedId !== id && overState?.id === id) {
          const ids = items.map(getId)
          const fromIndex = ids.indexOf(draggedId)
          if (fromIndex !== -1) {
            ids.splice(fromIndex, 1)
            let toIndex = ids.indexOf(id)
            if (overState.position === 'after') toIndex += 1
            ids.splice(toIndex, 0, draggedId)
            onReorder(ids)
          }
        }
        setDraggedId(null)
        setOverState(null)
      },
      onDragEnd: () => {
        setDraggedId(null)
        setOverState(null)
      },
      className: [
        draggedId === id ? 'drag-item-dragging' : '',
        overState?.id === id ? `drag-item-over-${overState.position}` : ''
      ]
        .filter(Boolean)
        .join(' ')
    }
  }

  return { getHandlers }
}
