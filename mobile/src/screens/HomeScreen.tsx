import { useState } from 'react'
import { LayoutChangeEvent, Platform, Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import * as Crypto from 'expo-crypto'
import type { RemoteClient, ConnectionStatus } from '../lib/wsClient'
import type { RemoteMacroItem, RemoteTemplateItem } from '../lib/protocol'
import { GRID_COLUMNS, type ButtonLayout } from '../lib/buttonConfig'
import { GearIcon, LinkIcon, PlusIcon } from '../components/Icons'
import { colors } from '../theme'

/**
 * ホーム画面。設定したボタンをグリッドに並べ、タップ(マクロは長押し)で
 * PC側の定型文入力・マクロ実行をリモートで起こす「テンキー」本体。
 *
 * ボタンの大きさと間隔は固定値を持たず、実際に描画された領域のサイズとボタン数から
 * 毎回算出する。端末の画面サイズが違ってもボタン数を変えても、常に画面を使い切った
 * 正方形のボタンが並ぶようにするため。
 */

interface Props {
  client: RemoteClient
  status: ConnectionStatus
  layout: ButtonLayout
  templates: RemoteTemplateItem[]
  macros: RemoteMacroItem[]
  onOpenConnect: () => void
  onOpenSettings: () => void
}

/** ボタン下に置く名称の高さ。セルの高さを決める計算で使う */
const LABEL_HEIGHT = 20

interface GridMetrics {
  size: number
  gap: number
  columns: number
}

/**
 * 描画領域(width x height)にcount個の正方形ボタンを、名称の分の高さも確保しつつ
 * 詰め込むときの一辺と間隔を求める。幅と高さのどちらが先に頭打ちになっても
 * はみ出さないよう、両方から出した候補の小さい方を採用する
 */
function computeGrid(width: number, height: number, count: number): GridMetrics {
  const columns = Math.min(GRID_COLUMNS, Math.max(1, count))
  const rows = Math.ceil(count / columns)
  // 間隔は画面幅に比例させる。狭い端末で間隔が支配的にならないよう上下限を設ける
  const gap = Math.max(6, Math.min(14, Math.round(width * 0.03)))
  const fromWidth = (width - gap * (columns - 1)) / columns
  const fromHeight = (height - gap * (rows - 1) - rows * LABEL_HEIGHT) / rows
  const size = Math.max(0, Math.floor(Math.min(fromWidth, fromHeight)))
  return { size, gap, columns }
}

export default function HomeScreen({
  client,
  status,
  layout,
  templates,
  macros,
  onOpenConnect,
  onOpenSettings
}: Props): React.JSX.Element {
  const [pendingIndex, setPendingIndex] = useState<number | null>(null)
  const [area, setArea] = useState<{ width: number; height: number } | null>(null)
  const connected = status === 'connected'

  const handleArea = (e: LayoutChangeEvent): void => {
    const { width, height } = e.nativeEvent.layout
    setArea({ width, height })
  }

  /** PCから受け取った最新の名称を優先し、未接続なら保存時のキャッシュを使う */
  const resolveLabel = (slot: NonNullable<ButtonLayout['slots'][number]>): string => {
    if (slot.kind === 'template') {
      return templates.find((t) => t.id === slot.id)?.label ?? slot.label
    }
    return macros.find((m) => m.id === slot.id)?.name ?? slot.label
  }

  const activate = async (index: number): Promise<void> => {
    const slot = layout.slots[index]
    if (!slot || pendingIndex !== null || !connected) return
    setPendingIndex(index)
    try {
      const requestId = Crypto.randomUUID()
      if (slot.kind === 'template') {
        await client.triggerTemplate(slot.id, requestId)
      } else {
        await client.triggerMacro(slot.id, requestId)
      }
    } catch {
      // 送信できなかった場合は未接続表示に変わるため、ここでは何も出さない
    } finally {
      setTimeout(() => setPendingIndex(null), 600)
    }
  }

  const metrics = area ? computeGrid(area.width, area.height, layout.count) : null

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        {/* 用途が決まるまでの予約領域。空でも場所を確保しておく */}
        <View style={styles.headerPlaceholder} />
        <TouchableOpacity style={styles.iconButton} onPress={onOpenConnect} hitSlop={6}>
          <LinkIcon color={connected ? colors.success : colors.textMuted} size={22} />
        </TouchableOpacity>
        <TouchableOpacity style={styles.iconButton} onPress={onOpenSettings} hitSlop={6}>
          <GearIcon color={colors.textSecondary} size={22} />
        </TouchableOpacity>
      </View>

      {/* onLayoutが返すのはpaddingを含んだ外側のサイズなので、余白の内側に測定用の
          Viewを挟んでコンテンツ領域そのものを測る。外側で測るとpadding分だけ
          ボタンが大きく算出され、3列目が入りきらず折り返してしまう */}
      <View style={styles.gridArea}>
        <View style={styles.gridInner} onLayout={handleArea}>
          {metrics && metrics.size > 0 && (
          <View style={[styles.grid, { gap: metrics.gap }]}>
            {layout.slots.map((slot, index) => {
              const label = slot ? resolveLabel(slot) : ''
              const isMacro = slot?.kind === 'macro'
              const disabled = !slot || !connected || pendingIndex !== null
              return (
                <View key={index} style={{ width: metrics.size }}>
                  <Pressable
                    style={[
                      styles.button,
                      {
                        width: metrics.size,
                        height: metrics.size,
                        // borderStyleはスタイル配列から出し入れすると再描画されないことが
                        // あるため(未割り当て→割り当て済みにしても破線のまま残る)、
                        // どちらの状態でも必ず値を指定する
                        borderStyle: slot ? 'solid' : 'dashed'
                      },
                      isMacro && styles.buttonMacro,
                      !slot && styles.buttonEmpty,
                      (pendingIndex === index || (slot && !connected)) && styles.buttonDimmed
                    ]}
                    onPress={() => slot?.kind === 'template' && void activate(index)}
                    onLongPress={() => slot?.kind === 'macro' && void activate(index)}
                    delayLongPress={500}
                    disabled={disabled}
                  >
                    {!slot && <PlusIcon color={colors.textMuted} size={Math.min(22, metrics.size * 0.3)} />}
                    {isMacro && <Text style={styles.macroHint}>長押し</Text>}
                  </Pressable>
                  <Text style={styles.buttonLabel} numberOfLines={1}>
                    {slot ? label || '(名称なし)' : ''}
                  </Text>
                </View>
              )
            })}
            </View>
          )}
        </View>
      </View>
    </View>
  )
}

/** iOS側はApp.tsxのSafeAreaViewが上端を空けるため、こちらでは重ねて取らない */
const TOP_PADDING = Platform.OS === 'ios' ? 8 : 40

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, paddingTop: TOP_PADDING },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingBottom: 12,
    gap: 8
  },
  headerPlaceholder: {
    flex: 1,
    height: 42,
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8
  },
  iconButton: {
    width: 42,
    height: 42,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.panel,
    alignItems: 'center',
    justifyContent: 'center'
  },
  gridArea: {
    flex: 1,
    backgroundColor: colors.panelAlt,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    margin: 14,
    marginTop: 0,
    padding: 12
  },
  // ボタンが少ないときは幅で大きさが決まるため下側に余白が残る。上寄せのままだと
  // 中途半端に見えるので、余白を上下に均等に分けて中央に置く
  gridInner: { flex: 1, justifyContent: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-start' },
  button: {
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center'
  },
  buttonMacro: { borderColor: colors.success },
  buttonEmpty: { backgroundColor: 'transparent', borderColor: colors.border },
  buttonDimmed: { opacity: 0.45 },
  macroHint: { color: colors.success, fontSize: 10 },
  buttonLabel: {
    height: LABEL_HEIGHT,
    lineHeight: LABEL_HEIGHT,
    color: colors.textSecondary,
    fontSize: 11,
    textAlign: 'center'
  }
})
