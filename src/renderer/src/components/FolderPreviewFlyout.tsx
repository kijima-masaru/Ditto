import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useHoverIntent } from '../hooks/useHoverIntent'

interface FolderLike {
  id: string
  name: string
  parentId: string | null
}

/** App.cssの.folder-preview-flyout--nestedのwidthと一致させる値 */
const NESTED_FLYOUT_WIDTH = 240

interface FolderPreviewFlyoutProps<F extends FolderLike, I> {
  folders: F[]
  items: I[]
  folderId: string
  getItemFolderId: (item: I) => string | null
  onNavigate: (folderId: string) => void
  renderItem: (item: I) => React.ReactNode
}

/**
 * フォルダカードにカーソルを乗せた時に出す中身プレビュー。中にさらにサブフォルダが
 * あれば、それにカーソルを乗せることで再帰的にネストしたプレビューを表示できる。
 */
export default function FolderPreviewFlyout<F extends FolderLike, I>(
  props: FolderPreviewFlyoutProps<F, I>
): React.JSX.Element {
  const { folders, items, folderId, getItemFolderId, renderItem } = props
  const subfolders = folders.filter((f) => f.parentId === folderId)
  const previewItems = items.filter((it) => (getItemFolderId(it) ?? null) === folderId)

  if (subfolders.length === 0 && previewItems.length === 0) {
    return <p className="hint folder-preview-empty">このフォルダは空です。</p>
  }

  return (
    <>
      {subfolders.map((sf) => (
        <FolderPreviewRow key={sf.id} folder={sf} {...props} />
      ))}
      {previewItems.map((it) => renderItem(it))}
    </>
  )
}

function FolderPreviewRow<F extends FolderLike, I>({
  folder,
  ...rest
}: { folder: F } & FolderPreviewFlyoutProps<F, I>): React.JSX.Element {
  const hover = useHoverIntent()
  const rowRef = useRef<HTMLDivElement>(null)
  const [nestedPos, setNestedPos] = useState<{ top: number; left: number } | null>(null)

  const isOpen = hover.activeId === folder.id

  const handleMouseEnter = (): void => {
    // 祖先の.folder-preview-flyoutはoverflow:autoでスクロールする箱なので、CSSのleft:100%
    // で子孫として配置すると箱の外にはみ出す部分がクリップされてしまう。
    // position:fixedで画面基準の座標に配置することでクリップを回避する
    const rect = rowRef.current?.getBoundingClientRect()
    if (rect) {
      // このアプリのウィンドウはサイドバー的に幅が狭く(300〜360px程度)、行の右側に
      // 単純に開くとウィンドウの外にはみ出して見えなくなることがある。
      // 右に入らなければ左側に、それも入らなければ親フライアウトに重ねてでも
      // ウィンドウ内に収まる位置へずらす
      let left = rect.right + 6
      if (left + NESTED_FLYOUT_WIDTH > window.innerWidth) {
        left = rect.left - NESTED_FLYOUT_WIDTH - 6
      }
      left = Math.min(Math.max(left, 4), window.innerWidth - NESTED_FLYOUT_WIDTH - 4)
      const top = Math.min(Math.max(rect.top, 4), window.innerHeight - 60)
      setNestedPos({ top, left })
    }
    hover.scheduleShow(folder.id)
  }

  return (
    <div ref={rowRef} className="folder-preview-row" onMouseEnter={handleMouseEnter} onMouseLeave={hover.scheduleHide}>
      <button className="folder-preview-item folder-preview-folder" onClick={() => rest.onNavigate(folder.id)}>
        📁 {folder.name}
      </button>
      {isOpen &&
        nestedPos != null &&
        createPortal(
          <div
            className="folder-preview-flyout folder-preview-flyout--nested"
            style={{ top: nestedPos.top, left: nestedPos.left }}
            onMouseEnter={hover.cancelHide}
            onMouseLeave={hover.scheduleHide}
          >
            <FolderPreviewFlyout {...rest} folderId={folder.id} />
          </div>,
          document.body
        )}
    </div>
  )
}
