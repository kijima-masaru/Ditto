import { useEffect, useRef, useState } from 'react'
import type {
  ClipboardTemplate,
  ClipboardTemplateFolder,
  PreviewKind,
  MacroCase,
  MacroFolder
} from '../../../shared/types'
import FolderPreviewFlyout from './FolderPreviewFlyout'

interface FolderData {
  folders: (MacroFolder | ClipboardTemplateFolder)[]
  items: (MacroCase | ClipboardTemplate)[]
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
      // 一覧の行数設定も引き継ぐ(本体の一覧と見え方を揃えるため)
      document.documentElement.style.setProperty('--clip-item-lines', String(s.clipboardItemLines))
      document.documentElement.setAttribute('data-clip-lines', String(s.clipboardItemLines))
    })
  }, [])

  useEffect(() => {
    if (kind === 'clipboard') {
      Promise.all([window.api.listClipboardTemplateFolders(), window.api.listClipboardTemplates()]).then(
        ([folders, items]) => setData({ folders, items })
      )
    } else {
      Promise.all([window.api.listFolders(), window.api.listMacros()]).then(([folders, items]) =>
        setData({ folders, items })
      )
    }
  }, [kind])

  const handleNavigate = (id: string): void => {
    window.api.navigateToFolder(kind, id)
  }

  // この別ウィンドウはネストしたフォルダプレビュー専用で、kind==='clipboard'側の
  // itemは常にClipboardTemplateのため、{{date}}/{{seq}}/{{clipboard}}等の動的変数を
  // main側でその場で解決するcopyTemplateToClipboardを使う(idのみ渡す)
  const handleCopy = (id: string): void => {
    window.api.copyTemplateToClipboard(id)
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
              onClick={() => handleCopy(it.id)}
            >
              {(it as ClipboardTemplate).label && (
                <div className="clip-item-label">{(it as ClipboardTemplate).label}</div>
              )}
              <div className="clip-item-text">{truncate((it as ClipboardTemplate).text)}</div>
              {copiedId === it.id && <span className="clip-copied-badge">コピーしました</span>}
            </div>
          ) : (
            <div key={it.id} className="folder-preview-item macro-name-item">
              {(it as MacroCase).name}
            </div>
          )
        }
      />
    </div>
  )
}
