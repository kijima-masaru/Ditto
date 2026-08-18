import { useState } from 'react'
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View, type LayoutRectangle } from 'react-native'
import * as Crypto from 'expo-crypto'
import type { RemoteClient, ConnectionStatus } from '../lib/wsClient'
import type { RemoteMacroItem, RemoteTemplateItem } from '../lib/protocol'
import type { LayoutConfig } from '../lib/layoutStorage'
import { computeGridMetrics, resolveSlots, type GridItem } from '../lib/gridLayout'
import SettingsPanel from '../components/SettingsPanel'
import { colors } from '../theme'

/**
 * ホーム画面。パネルの中に「ヘッダー行(未定の表示領域・接続・設定)」と「ボタングリッド」を
 * 積む。グリッドは個数と実際に使える領域から1マスの大きさと間隔を毎回計算するため、
 * ボタン数を変えても端末が変わってもレイアウトが破綻しない(gridLayout.ts参照)。
 */

interface Props {
  client: RemoteClient
  status: ConnectionStatus
  templates: RemoteTemplateItem[]
  macros: RemoteMacroItem[]
  layout: LayoutConfig | null
  onChangeLayout: (layout: LayoutConfig | null) => void
  onRefresh: () => void
  onForget: () => void
  onOpenConnect: () => void
}

const STATUS_LABEL: Record<ConnectionStatus, string> = {
  disconnected: '未接続',
  connecting: '接続中...',
  pairing: 'ペアリング中...',
  connected: '接続済み',
  error: 'エラー'
}

// アイコンは画像を持たずに文字で描く。歯車(U+2699)は既定だと絵文字として色付きで
// 描画される環境があるため、U+FE0E(text presentation selector)を付けて字形にし、
// 他のUIと同じ色を当てられるようにしている
const ICON_CONNECT = '⇄'
const ICON_SETTINGS = '⚙\uFE0E'

export default function HomeScreen({
  client,
  status,
  templates,
  macros,
  layout,
  onChangeLayout,
  onRefresh,
  onForget,
  onOpenConnect
}: Props): React.JSX.Element {
  const [refreshing, setRefreshing] = useState(false)
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [settingsMode, setSettingsMode] = useState(false)
  const [gridBox, setGridBox] = useState<LayoutRectangle | null>(null)

  const connected = status === 'connected'
  const slots = resolveSlots(layout, templates, macros)

  const handleRefresh = (): void => {
    setRefreshing(true)
    onRefresh()
    setTimeout(() => setRefreshing(false), 500)
  }

  const activate = async (item: GridItem): Promise<void> => {
    if (pendingId) return
    setPendingId(item.id)
    try {
      const requestId = Crypto.randomUUID()
      if (item.kind === 'template') {
        await client.triggerTemplate(item.id, requestId)
      } else {
        await client.triggerMacro(item.id, requestId)
      }
      setErrorMessage(null)
    } catch {
      // 接続済み表示のまま切断された直後など、送信時に初めて失敗が分かる場合がある
      setErrorMessage('送信できませんでした。PCとの接続を確認しています...')
    } finally {
      setTimeout(() => setPendingId(null), 600)
    }
  }

  const metrics = gridBox ? computeGridMetrics(gridBox.width, gridBox.height, slots.length) : null

  return (
    <View style={styles.container}>
      <View style={styles.panel}>
        <View style={styles.headerRow}>
          {/* 用途が未定の領域。ひとまず接続状態を出しておく(何を置くか決まったら差し替える) */}
          <View style={styles.headerPlaceholder}>
            <View style={[styles.statusDot, connected ? styles.statusDotOk : styles.statusDotBad]} />
            <Text style={styles.statusText} numberOfLines={1}>
              {STATUS_LABEL[status]}
            </Text>
          </View>
          <Pressable
            style={[styles.iconButton, connected && styles.iconButtonConnected]}
            onPress={onOpenConnect}
            accessibilityLabel="接続"
            hitSlop={6}
          >
            <Text style={[styles.iconText, connected && styles.iconTextConnected]}>{ICON_CONNECT}</Text>
          </Pressable>
          <Pressable
            style={[styles.iconButton, settingsMode && styles.iconButtonActive]}
            onPress={() => setSettingsMode((v) => !v)}
            accessibilityLabel="設定"
            hitSlop={6}
          >
            <Text style={[styles.iconText, settingsMode && styles.iconTextActive]}>{ICON_SETTINGS}</Text>
          </Pressable>
        </View>

        {settingsMode ? (
          <View style={styles.settingsArea}>
            <SettingsPanel
              layout={layout}
              currentItems={slots}
              templates={templates}
              macros={macros}
              connected={connected}
              onApply={onChangeLayout}
              onClose={() => setSettingsMode(false)}
              onForget={onForget}
            />
          </View>
        ) : (
          <>
            {!connected && (
              <View style={styles.banner}>
                <Text style={styles.bannerText}>
                  PCと未接続です。自動で再接続を試みています。接続アイコンからペアリングもできます。
                </Text>
              </View>
            )}
            {connected && errorMessage && (
              <View style={styles.banner}>
                <Text style={styles.bannerText}>{errorMessage}</Text>
              </View>
            )}

            <View style={styles.gridArea} onLayout={(e) => setGridBox(e.nativeEvent.layout)}>
              {gridBox && metrics && (
                <ScrollView
                  style={{ height: gridBox.height }}
                  contentContainerStyle={[styles.gridScroll, { minHeight: gridBox.height, rowGap: metrics.gap }]}
                  refreshControl={
                    <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={colors.textMuted} />
                  }
                >
                  {Array.from({ length: metrics.rows }, (_, row) => (
                    <View key={row} style={[styles.gridRow, { columnGap: metrics.gap }]}>
                      {slots.slice(row * metrics.columns, row * metrics.columns + metrics.columns).map((item, col) => {
                        const key = item ? `${item.kind}-${item.id}` : `empty-${row}-${col}`
                        const disabled = !item || !connected || pendingId !== null
                        return (
                          <View key={key} style={{ width: metrics.cellSize }}>
                            <Pressable
                              style={[
                                styles.cell,
                                { width: metrics.cellSize, height: metrics.cellSize },
                                item?.kind === 'macro' && styles.cellMacro,
                                !item && styles.cellEmpty,
                                (disabled || pendingId === item?.id) && styles.cellDisabled
                              ]}
                              onPress={() => item?.kind === 'template' && void activate(item)}
                              onLongPress={() => item?.kind === 'macro' && void activate(item)}
                              delayLongPress={500}
                              disabled={disabled}
                            >
                              {item?.kind === 'macro' && <Text style={styles.macroBadge}>⚡</Text>}
                            </Pressable>
                            <Text
                              style={[
                                styles.cellLabel,
                                { fontSize: metrics.labelFontSize, height: metrics.labelHeight },
                                !item && styles.cellLabelEmpty
                              ]}
                              numberOfLines={1}
                            >
                              {item ? item.label : '名称'}
                            </Text>
                          </View>
                        )
                      })}
                    </View>
                  ))}
                </ScrollView>
              )}
            </View>
          </>
        )}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, padding: 12 },
  panel: {
    flex: 1,
    backgroundColor: colors.panel,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12
  },
  headerRow: { flexDirection: 'row', alignItems: 'stretch', gap: 8, marginBottom: 12 },
  headerPlaceholder: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 46,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: colors.panelAlt,
    borderWidth: 1,
    borderColor: colors.border
  },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusDotOk: { backgroundColor: colors.success },
  statusDotBad: { backgroundColor: colors.warning },
  statusText: { color: colors.textSecondary, fontSize: 13 },
  iconButton: {
    width: 46,
    minHeight: 46,
    borderRadius: 10,
    backgroundColor: colors.buttonBg,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center'
  },
  iconButtonConnected: { borderColor: colors.success },
  iconButtonActive: { backgroundColor: colors.accentBg, borderColor: colors.accent },
  iconText: { color: colors.textSecondary, fontSize: 20 },
  iconTextConnected: { color: colors.success },
  iconTextActive: { color: colors.accentHover },
  banner: {
    backgroundColor: colors.warningBg,
    borderColor: colors.warning,
    borderWidth: 1,
    borderRadius: 10,
    padding: 9,
    marginBottom: 10
  },
  bannerText: { color: colors.warning, fontSize: 12, lineHeight: 17 },
  gridArea: { flex: 1 },
  gridScroll: { justifyContent: 'center' },
  gridRow: { flexDirection: 'row', justifyContent: 'center' },
  settingsArea: { flex: 1 },
  cell: {
    backgroundColor: colors.buttonBg,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center'
  },
  cellMacro: { backgroundColor: colors.accentBg, borderColor: colors.accent },
  cellEmpty: { backgroundColor: colors.panelAlt, borderColor: colors.border, borderStyle: 'dashed' },
  cellDisabled: { opacity: 0.45 },
  macroBadge: { fontSize: 18 },
  cellLabel: { color: colors.textSecondary, textAlign: 'center', marginTop: 4 },
  cellLabelEmpty: { color: colors.textMuted }
})
