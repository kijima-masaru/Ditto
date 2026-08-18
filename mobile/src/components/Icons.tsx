import { StyleSheet, View } from 'react-native'

/**
 * アイコンをViewの組み合わせで描く。絵文字(⚙️や🔗)はcolorが効かず接続状態を色で
 * 表現できないため、またアイコンライブラリ(@expo/vector-icons等)を足すと
 * フォント読み込みのためのネイティブ依存が増えるため、自前で描いている。
 */

interface IconProps {
  /** 線の色。接続アイコンは接続状態に応じて呼び出し側が変える */
  color: string
  /** 描画領域の一辺(px) */
  size?: number
}

/** 接続アイコン。鎖の輪が2つ繋がった形 */
export function LinkIcon({ color, size = 20 }: IconProps): React.JSX.Element {
  const w = size * 0.55
  const h = size * 0.32
  const border = Math.max(1.5, size * 0.1)
  return (
    <View style={[styles.row, { width: size, height: size }]}>
      <View
        style={{
          width: w,
          height: h,
          borderWidth: border,
          borderColor: color,
          borderRadius: h / 2,
          // 輪を重ねて「繋がっている」ように見せる
          marginRight: -w * 0.28
        }}
      />
      <View
        style={{
          width: w,
          height: h,
          borderWidth: border,
          borderColor: color,
          borderRadius: h / 2
        }}
      />
    </View>
  )
}

/** 設定アイコン(歯車)。中央の輪と、その周囲に90度ずつ配置した歯 */
export function GearIcon({ color, size = 20 }: IconProps): React.JSX.Element {
  const ring = size * 0.58
  const border = Math.max(1.5, size * 0.1)
  const toothW = size * 0.16
  const toothH = size * 0.2
  const offset = ring / 2 + toothH * 0.28
  const teeth = [
    { top: -offset, left: 0 },
    { top: offset, left: 0 },
    { top: 0, left: -offset },
    { top: 0, left: offset }
  ]
  return (
    <View style={[styles.center, { width: size, height: size }]}>
      {teeth.map((t, i) => (
        <View
          key={i}
          style={[
            styles.tooth,
            {
              width: i < 2 ? toothW : toothH,
              height: i < 2 ? toothH : toothW,
              backgroundColor: color,
              transform: [{ translateY: t.top }, { translateX: t.left }]
            }
          ]}
        />
      ))}
      <View
        style={{
          width: ring,
          height: ring,
          borderRadius: ring / 2,
          borderWidth: border,
          borderColor: color
        }}
      />
    </View>
  )
}

/** 閉じるアイコン(×)。2本の線を45度ずつ傾けて交差させる */
export function CloseIcon({ color, size = 18 }: IconProps): React.JSX.Element {
  const border = Math.max(1.5, size * 0.11)
  const bar = { position: 'absolute' as const, width: size, height: border, backgroundColor: color, borderRadius: border }
  return (
    <View style={[styles.center, { width: size, height: size }]}>
      <View style={[bar, { transform: [{ rotate: '45deg' }] }]} />
      <View style={[bar, { transform: [{ rotate: '-45deg' }] }]} />
    </View>
  )
}

/** 追加アイコン(+)。未割り当てスロットに表示する */
export function PlusIcon({ color, size = 18 }: IconProps): React.JSX.Element {
  const border = Math.max(1.5, size * 0.11)
  const bar = { position: 'absolute' as const, width: size, height: border, backgroundColor: color, borderRadius: border }
  return (
    <View style={[styles.center, { width: size, height: size }]}>
      <View style={bar} />
      <View style={[bar, { transform: [{ rotate: '90deg' }] }]} />
    </View>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  center: { alignItems: 'center', justifyContent: 'center' },
  tooth: { position: 'absolute', borderRadius: 1 }
})
