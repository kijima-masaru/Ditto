import { useEffect, useRef, useState } from 'react'
import type {
  ClipboardTemplate,
  ClipboardTemplateFolder,
  PreviewKind,
  TestCase,
  TestFolder
} from '../../../shared/types'
import FolderPreviewFlyout from './FolderPreviewFlyout'

interface FolderData {
  folders: (TestFolder | ClipboardTemplateFolder)[]
  items: (TestCase | ClipboardTemplate)[]
}

function truncate(text: string, max = 80): string {
  const oneLine = text.replace(/\s+/g, ' ').trim()
  return oneLine.length > max ? `${oneLine.slice(0, max)}…` : oneLine
}

/**
 * ネストしたフォルダプレビュー専用の別ウィンドウのルート。
 * メインウィンドウと同じrenderer bundleを`?preview=1&kind=...&folder=...&depth=...`付きで
 * 読み込むことで実現している(previewWindow.ts参照)。中身はFolderPreviewFlyoutをそのまま
 * 再利用し、さらにサブフォルダがあれば同じ仕組みで次のウィンドウを右側に連鎖させる。
 */
export default function PreviewWindowRoot(): React.JSX.Element {
  const params = new URLSearchParams(window.location.search)
  const kind = (params.get('kind') as PreviewKind) ?? 'clipboard'
  const folderId = params.get('folder') ?? ''
  const depth = Number(params.get('depth') ?? '2')

  const [data, setData] = useState<FolderData | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const copiedTimer = useRef<number | null>(null)

  useEffect(() => {
    // メインウィンドウとは別のBrowserWindowなのでdata-theme属性を独自に引き継ぐ必要がある。
    // 引き継がないと常にライトテーマ(既定値)になり、メインウィンドウと色が食い違ってしまう
    window.api.getSettings().then((s) => {
      document.documentElement.setAttribute('data-theme', s.theme)
    })
  }, [])

  useEffect(() => {
    if (kind === 'clipboard') {
      Promise.all([window.api.listClipboardTemplateFolders(), window.api.listClipboardTemplates()]).then(
        ([folders, items]) => setData({ folders, items })
      )
    } else {
      Promise.all([window.api.listFolders(), window.api.listTests()]).then(([folders, items]) =>
        setData({ folders, items })
      )
    }
  }, [kind])

  useEffect(() => {
    // このウィンドウ自身にカーソルが入っている間は、自分自身(depth)から先を
    // 閉じないようにする。出た時は自分自身を起点に閉じる予約をする
    const onEnter = (): void => window.api.cancelClosePreviewWindow()
    const onLeave = (): void => window.api.scheduleClosePreviewWindow(depth)
    document.body.addEventListener('mouseenter', onEnter)
    document.body.addEventListener('mouseleave', onLeave)
    return () => {
      document.body.removeEventListener('mouseenter', onEnter)
      document.body.removeEventListener('mouseleave', onLeave)
    }
  }, [depth])

  const handleNavigate = (id: string): void => {
    window.api.navigateToFolder(kind, id)
  }

  const handleCopy = (id: string, text: string): void => {
    window.api.copyToClipboard(text)
    setCopiedId(id)
    if (copiedTimer.current) window.clearTimeout(copiedTimer.current)
    copiedTimer.current = window.setTimeout(() => setCopiedId(null), 1200)
  }

  if (!data) return <div className="preview-window-root hint">読み込み中...</div>

  return (
    <div className="preview-window-root">
      <FolderPreviewFlyout
        folders={data.folders}
        items={data.items}
        folderId={folderId}
        kind={kind}
        depth={depth}
        getItemFolderId={(it) => it.folderId ?? null}
        onNavigate={handleNavigate}
        renderItem={(it) =>
          kind === 'clipboard' ? (
            <div
              key={it.id}
              className={`folder-preview-item clip-item${copiedId === it.id ? ' clip-item--copied' : ''}`}
              onClick={() => handleCopy(it.id, (it as ClipboardTemplate).text)}
            >
              {(it as ClipboardTemplate).label && (
                <div className="clip-item-label">{(it as ClipboardTemplate).label}</div>
              )}
              <div className="clip-item-text">{truncate((it as ClipboardTemplate).text)}</div>
              {copiedId === it.id && <span className="clip-copied-badge">コピーしました</span>}
            </div>
          ) : (
            <div key={it.id} className="folder-preview-item test-name-item">
              {(it as TestCase).name}
            </div>
          )
        }
      />
    </div>
  )
}
