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

// 歯車(設定)アイコンの歯の配置角度。45度ずつ8方向に配置する
const GEAR_TOOTH_ANGLES = [0, 45, 90, 135, 180, 225, 270, 315]

/**
 * ヘッダーの設定ボタンで使う歯車アイコン。
 *
 * 以前は⚙(U+2699)の文字をそのまま表示していたが、字形がフォントの行送り内で
 * 上寄りに描画されるためボタンの中で上下にずれてしまい、その分を打ち消すための
 * オフセット量もフォント依存で安定しなかった。歯もリングも .gear-icon の中心を
 * 基準に配置することで、フォントに依存せず上下左右とも正確に中央へ描画される。
 */
export function GearIcon(): React.JSX.Element {
  return (
    <span className="gear-icon">
      {GEAR_TOOTH_ANGLES.map((deg) => (
        <span
          key={deg}
          className="gear-icon-tooth"
          style={{ transform: `translate(-50%, -50%) rotate(${deg}deg) translateY(-6.5px)` }}
        />
      ))}
      <span className="gear-icon-ring" />
    </span>
  )
}
