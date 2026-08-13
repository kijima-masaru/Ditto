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

  return (
    <div
      className="folder-preview-row"
      onMouseEnter={() => hover.scheduleShow(folder.id)}
      onMouseLeave={hover.scheduleHide}
    >
      <button className="folder-preview-item folder-preview-folder" onClick={() => rest.onNavigate(folder.id)}>
        📁 {folder.name}
      </button>
      {hover.activeId === folder.id && (
        <div
          className="folder-preview-flyout folder-preview-flyout--nested"
          onMouseEnter={hover.cancelHide}
          onMouseLeave={hover.scheduleHide}
        >
          <FolderPreviewFlyout {...rest} folderId={folder.id} />
        </div>
      )}
    </div>
  )
}
