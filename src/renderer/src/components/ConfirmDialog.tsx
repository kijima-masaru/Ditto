interface Props {
  message: string
  confirmLabel?: string
  onConfirm: () => void
  onCancel: () => void
}

/** 削除等の確認を行う共通モーダル。window.confirm()はこのアプリ(Electron)では
 *  応答しないため使えず、独自にオーバーレイで実装する */
export default function ConfirmDialog({ message, confirmLabel = '削除する', onConfirm, onCancel }: Props): React.JSX.Element {
  return (
    <div className="confirm-dialog-backdrop" onClick={onCancel}>
      <div className="confirm-dialog" onClick={(e) => e.stopPropagation()}>
        <p className="confirm-dialog-message">{message}</p>
        <div className="row confirm-dialog-actions">
          <button className="danger" onClick={onConfirm}>
            {confirmLabel}
          </button>
          <button onClick={onCancel}>キャンセル</button>
        </div>
      </div>
    </div>
  )
}
