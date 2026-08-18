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

// SVGのrect/pathによる塗りつぶしは、このアプリの実行環境で意図したCSS px通りの
// 大きさに描画されない不具合が確認された(例: 24単位viewBox中16単位幅のrectを
// 指定しても実際は半分程度の見た目にしかならない。rect/pathいずれでも発生し、
// 色のコントラストにも依存しなかったため、SVGの塗りつぶし描画特有の問題と判断)。
// 塗りつぶし系のアイコン(一時停止バー・停止四角)は、素のCSSボックス(background)で
// 描画することで指定したピクセルサイズ通りに表示させている
export function PauseIcon(): React.JSX.Element {
  return (
    <span style={{ display: 'inline-flex', gap: 3, flexShrink: 0 }}>
      <span style={{ display: 'inline-block', width: 4, height: 11, background: 'currentColor' }} />
      <span style={{ display: 'inline-block', width: 4, height: 11, background: 'currentColor' }} />
    </span>
  )
}

export function StopIcon(): React.JSX.Element {
  return <span style={{ display: 'inline-block', width: 11, height: 11, background: 'currentColor', flexShrink: 0 }} />
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
