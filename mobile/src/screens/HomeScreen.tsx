import { useState } from 'react'
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native'
import * as Crypto from 'expo-crypto'
import type { RemoteClient, ConnectionStatus } from '../lib/wsClient'
import type { RemoteMacroItem, RemoteTemplateItem } from '../lib/protocol'
import { SCREEN_TOP_PADDING } from '../lib/layout'

/**
 * ホーム画面。PC側でピン留めされた定型文・マクロをボタングリッドで表示し、
 * タップ(マクロは長押し確認)でリモートトリガーする「テンキー」本体。
 */

type GridEntry =
  | { kind: 'template'; id: string; label: string; preview: string }
  | { kind: 'macro'; id: string; label: string; stepCount: number }

interface Props {
  client: RemoteClient
  status: ConnectionStatus
  templates: RemoteTemplateItem[]
  macros: RemoteMacroItem[]
  onRefresh: () => void
  onForget: () => void
}

const STATUS_LABEL: Record<ConnectionStatus, string> = {
  disconnected: '未接続',
  connecting: '接続中...',
  pairing: 'ペアリング中...',
  connected: '接続済み',
  error: 'エラー'
}

export default function HomeScreen({ client, status, templates, macros, onRefresh, onForget }: Props): React.JSX.Element {
  const [refreshing, setRefreshing] = useState(false)
  const [pendingId, setPendingId] = useState<string | null>(null)

  const handleRefresh = (): void => {
    setRefreshing(true)
    onRefresh()
    setTimeout(() => setRefreshing(false), 500)
  }

  const entries: GridEntry[] = [
    ...templates.map((t): GridEntry => ({ kind: 'template', id: t.id, label: t.label, preview: t.preview })),
    ...macros.map((m): GridEntry => ({ kind: 'macro', id: m.id, label: m.name, stepCount: m.stepCount }))
  ]

  const activate = async (entry: GridEntry): Promise<void> => {
    if (pendingId) return
    setPendingId(entry.id)
    try {
      const requestId = Crypto.randomUUID()
      if (entry.kind === 'template') {
        await client.triggerTemplate(entry.id, requestId)
      } else {
        await client.triggerMacro(entry.id, requestId)
      }
    } finally {
      setTimeout(() => setPendingId(null), 600)
    }
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.statusRow}>
          <View style={[styles.statusDot, status === 'connected' ? styles.statusDotOk : styles.statusDotBad]} />
          <Text style={styles.statusText}>{STATUS_LABEL[status]}</Text>
        </View>
        <Pressable onPress={onForget} hitSlop={8}>
          <Text style={styles.forgetLink}>連携解除</Text>
        </Pressable>
      </View>

      {entries.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>
            PC側でコマンドパレットに固定した定型文・マクロがここに表示されます。{'\n'}
            下に引っ張って更新できます。
          </Text>
        </View>
      ) : (
        <FlatList
          data={entries}
          keyExtractor={(item) => `${item.kind}-${item.id}`}
          numColumns={3}
          contentContainerStyle={styles.grid}
          refreshControl={
            // tintColorはiOS専用。既定のグレーのスピナーは暗い背景で見えづらいので明示する
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor="#8b83ff"
              colors={['#8b83ff']}
            />
          }
          renderItem={({ item }) => (
            <Pressable
              style={[styles.cell, item.kind === 'macro' && styles.cellMacro, pendingId === item.id && styles.cellPending]}
              onPress={() => item.kind === 'template' && void activate(item)}
              onLongPress={() => item.kind === 'macro' && void activate(item)}
              delayLongPress={500}
              disabled={pendingId !== null}
            >
              {item.kind === 'macro' && <Text style={styles.macroBadge}>⚡</Text>}
              <Text style={styles.cellLabel} numberOfLines={2}>
                {item.label}
              </Text>
              {item.kind === 'macro' && <Text style={styles.cellSub}>長押しで実行</Text>}
            </Pressable>
          )}
        />
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#15161f', paddingTop: SCREEN_TOP_PADDING },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 12
  },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusDotOk: { backgroundColor: '#4fdb9d' },
  statusDotBad: { backgroundColor: '#f2bd5c' },
  statusText: { color: '#9ba0bd', fontSize: 13 },
  forgetLink: { color: '#8b83ff', fontSize: 13 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  emptyText: { color: '#9ba0bd', fontSize: 14, textAlign: 'center', lineHeight: 20 },
  grid: { paddingHorizontal: 8, paddingBottom: 24 },
  cell: {
    flex: 1 / 3,
    margin: 6,
    aspectRatio: 1,
    backgroundColor: '#1d1f2b',
    borderWidth: 1,
    borderColor: '#363a56',
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 8
  },
  cellMacro: { backgroundColor: '#3a2c11', borderColor: '#f2bd5c' },
  cellPending: { opacity: 0.5 },
  macroBadge: { fontSize: 16, marginBottom: 4 },
  cellLabel: { color: '#e9eaf3', fontSize: 12, textAlign: 'center' },
  cellSub: { color: '#f2bd5c', fontSize: 9, marginTop: 4 }
})
