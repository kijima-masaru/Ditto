import type { NoteVersion } from '../../../shared/types'

/**
 * メモの編集履歴(版)の一覧。自動保存が走るたびに全部を残すわけではなく、
 * 前の版から時間が空いた時とCtrl+Sなどの明示保存の時だけ積まれる(notesStore参照)。
 * 「戻す」を押した時点の内容も版として残るため、戻した後にやり直すこともできる
 */

interface Props {
  versions: NoteVersion[]
  onRestore: (version: NoteVersion) => void
  onClose: () => void
}

function formatSavedAt(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  const pad = (n: number): string => String(n).padStart(2, '0')
  const sameDay = new Date().toDateString() === date.toDateString()
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`
  if (sameDay) return `今日 ${time}`
  return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${time}`
}

export default function NoteEditorVersions(props: Props): React.JSX.Element {
  const { versions, onRestore, onClose } = props
  return (
    <div className="note-versions">
      <div className="note-versions-header">
        <span>編集履歴</span>
        <button type="button" className="note-versions-close" onClick={onClose} title="閉じる">
          ✕
        </button>
      </div>
      {versions.length === 0 ? (
        <div className="note-versions-empty">まだ履歴はありません。しばらく書き進めると自動で残ります。</div>
      ) : (
        <ul className="note-versions-list">
          {versions.map((version) => (
            <li key={version.id} className="note-versions-item">
              <div className="note-versions-meta">
                <span className="note-versions-time">{formatSavedAt(version.savedAt)}</span>
                <span className="note-versions-length">{version.length}文字</span>
              </div>
              <div className="note-versions-preview">{version.preview || '(空)'}</div>
              <button type="button" className="note-versions-restore" onClick={() => onRestore(version)}>
                この内容に戻す
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
