import { useEffect } from 'react'
import type { PreviewKind } from '../../../shared/types'
import { useHoverIntent } from '../hooks/useHoverIntent'

interface FolderLike {
  id: string
  name: string
  parentId: string | null
}

interface FolderPreviewFlyoutProps<F extends FolderLike, I> {
  folders: F[]
  items: I[]
  folderId: string
  /** サブフォルダをさらにネストして開く際、別ウィンドウにどちらのデータを渡すか */
  kind: PreviewKind
  /** 現在表示しているのが何階層目のプレビューか(このフライアウト自身の階層) */
  depth: number
  getItemFolderId: (item: I) => string | null
  onNavigate: (folderId: string) => void
  renderItem: (item: I) => React.ReactNode
}

/**
 * フォルダカードにカーソルを乗せた時に出す中身プレビュー。
 *
 * 中にさらにサブフォルダがある場合、その中身は「メインウィンドウの中に重ねて表示」
 * ではなく、メインウィンドウの外側に連鎖する別ウィンドウ(previewWindow.ts)として表示
 * する。メインウィンドウは幅が狭く(300〜360px)、1階層目のプレビューが既にウィンドウ
 * 右端いっぱいに開いているため、ウィンドウ内でこれ以上ネストして開くスペースが物理的に
 * ないことによる。
 */
export default function FolderPreviewFlyout<F extends FolderLike, I>(
  props: FolderPreviewFlyoutProps<F, I>
): React.JSX.Element {
  const { folders, items, folderId, kind, depth, getItemFolderId, onNavigate, renderItem } = props
  const subfolders = folders.filter((f) => f.parentId === folderId)
  const previewItems = items.filter((it) => (getItemFolderId(it) ?? null) === folderId)

  if (subfolders.length === 0 && previewItems.length === 0) {
    return <p className="hint folder-preview-empty">このフォルダは空です。</p>
  }

  return (
    <>
      {subfolders.map((sf) => (
        <FolderPreviewRow key={sf.id} folder={sf} kind={kind} depth={depth} onNavigate={onNavigate} />
      ))}
      {previewItems.map((it) => renderItem(it))}
    </>
  )
}

function FolderPreviewRow({
  folder,
  kind,
  depth,
  onNavigate
}: {
  folder: FolderLike
  kind: PreviewKind
  depth: number
  onNavigate: (folderId: string) => void
}): React.JSX.Element {
  const hover = useHoverIntent()
  const isOpen = hover.activeId === folder.id

  useEffect(() => {
    if (!isOpen) return undefined
    window.api.openPreviewWindow({ kind, folderId: folder.id, depth: depth + 1 })
    return () => {
      window.api.scheduleClosePreviewWindow(depth + 1)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, folder.id])

  return (
    <div
      className="folder-preview-row"
      onMouseEnter={() => hover.scheduleShow(folder.id)}
      onMouseLeave={hover.scheduleHide}
    >
      <button className="folder-preview-item folder-preview-folder" onClick={() => onNavigate(folder.id)}>
        📁 {folder.name}
      </button>
    </div>
  )
}
