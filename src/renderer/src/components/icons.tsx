/** 録画・再生画面の操作ボタン(開始/一時停止)で共通して使う小さなアイコン。
 * SVGのrect/pathによる塗りつぶしは、このアプリの実行環境で意図したCSS px通りの
 * 大きさに描画されない不具合が確認された(例: 24単位viewBox中16単位幅のrectを
 * 指定しても実際は半分程度の見た目にしかならない。rect/pathいずれでも発生し、
 * 色のコントラストにも依存しなかったため、SVGの塗りつぶし描画特有の問題と判断)。
 * そのため塗りつぶし系のアイコンは、素のCSSボックス(background/border)で
 * 描画することで指定したピクセルサイズ通りに表示させている */

export function PlayIcon(): React.JSX.Element {
  return (
    <span
      style={{
        display: 'inline-block',
        width: 0,
        height: 0,
        borderTop: '6px solid transparent',
        borderBottom: '6px solid transparent',
        borderLeft: '10px solid currentColor',
        flexShrink: 0
      }}
    />
  )
}

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
