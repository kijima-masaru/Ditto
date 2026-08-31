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

/**
 * コマンドパレットへの固定を示すピン。
 *
 * 以前は📌の絵文字をそのまま置いていたが、絵文字はカラーフォントで描かれるため
 * colorプロパティが効かず、暗いテーマではCSSのfilterで白く塗り替える回避策が要った。
 * 字形も大きさもOSとフォントの更新で変わるため、他のアイコンと揃わない。
 * currentColorで描くことで、置いた場所の文字色にそのまま従う。
 */
export function PinIcon(): React.JSX.Element {
  return (
    <span className="pin-icon" aria-hidden="true">
      <span className="pin-icon-head" />
      <span className="pin-icon-neck" />
      <span className="pin-icon-tip" />
    </span>
  )
}

/** フォルダ。上辺の左側に小さなつまみ(タブ)を出した形にする */
export function FolderIcon(): React.JSX.Element {
  return (
    <span className="folder-icon" aria-hidden="true">
      <span className="folder-icon-tab" />
      <span className="folder-icon-body" />
    </span>
  )
}

/** 録画マーク。外側のリングと中の点で「録画」を表す(◎の代わり) */
export function RecordIcon(): React.JSX.Element {
  return (
    <span className="record-icon" aria-hidden="true">
      <span className="record-icon-dot" />
    </span>
  )
}

/** 閉じる。2本の棒を交差させる(✕の字形はフォントによって太さも大きさも変わるため) */
export function CloseIcon(): React.JSX.Element {
  return (
    <span className="close-icon" aria-hidden="true">
      <span className="close-icon-bar" />
      <span className="close-icon-bar" />
    </span>
  )
}

/**
 * 「その他の操作」を表す3つの点。一覧の各行に常設し、押すと右クリックと同じメニューを開く。
 *
 * 削除・ピン留め・フォルダ移動・定型文への登録といった操作は右クリックの中にしか無く、
 * その案内は一覧が空のときにしか出ていなかった(1件でも入ると消える)。
 * 見えている入口をここで作る。冒頭のコメントのとおり、塗りつぶしはCSSボックスで描く。
 *
 * このボタンを置く側では tabIndex={-1} を付けている。一覧はroving tabindexで
 * 「Tabの止まり場は一覧全体で1つ」に保っており(useListKeyboard.ts参照)、
 * 行ごとにボタンが順路へ入ると100件の一覧でTabを100回押すことになるため。
 * キーボードからは Shift+F10 で同じメニューが開く
 */
export function MoreIcon(): React.JSX.Element {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2, flexShrink: 0 }}>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          style={{ display: 'inline-block', width: 3, height: 3, borderRadius: '50%', background: 'currentColor' }}
        />
      ))}
    </span>
  )
}
