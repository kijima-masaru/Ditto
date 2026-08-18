/** 録画・再生画面の操作ボタン(開始/一時停止/停止/キャンセル/戻る)で共通して使う小さなアイコン */

function IconBase({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      {children}
    </svg>
  )
}

export function PlayIcon(): React.JSX.Element {
  return (
    <IconBase>
      <path d="M6 4 L20 12 L6 20 Z" fill="currentColor" stroke="none" />
    </IconBase>
  )
}

export function PauseIcon(): React.JSX.Element {
  return (
    <IconBase>
      <rect x="6" y="4" width="4" height="16" fill="currentColor" stroke="none" />
      <rect x="14" y="4" width="4" height="16" fill="currentColor" stroke="none" />
    </IconBase>
  )
}

export function StopIcon(): React.JSX.Element {
  return (
    <IconBase>
      <rect x="5" y="5" width="14" height="14" fill="currentColor" stroke="none" />
    </IconBase>
  )
}

export function CancelIcon(): React.JSX.Element {
  return (
    <IconBase>
      <path d="M5 5 L19 19 M19 5 L5 19" />
    </IconBase>
  )
}

export function BackIcon(): React.JSX.Element {
  return (
    <IconBase>
      <path d="M15 5 L8 12 L15 19" />
    </IconBase>
  )
}
