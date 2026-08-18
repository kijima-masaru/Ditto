import { useState } from 'react'
import { FlatList, Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import type { RemoteMacroItem, RemoteTemplateItem } from '../lib/protocol'
import { MAX_BUTTONS, resizeLayout, setSlot, type ButtonLayout, type ButtonSlot } from '../lib/buttonConfig'
import { CloseIcon } from './Icons'
import { colors } from '../theme'

/**
 * 設定モード。ボタンの個数と、各ボタンに割り当てる定型文・マクロを決める。
 * 候補はPCから受け取ったitems(ピン留めで絞らず全件)をそのまま使う。
 */

interface Props {
  visible: boolean
  layout: ButtonLayout
  templates: RemoteTemplateItem[]
  macros: RemoteMacroItem[]
  connected: boolean
  onChange: (layout: ButtonLayout) => void
  onClose: () => void
  onForget: () => void
}

export default function SettingsModal({
  visible,
  layout,
  templates,
  macros,
  connected,
  onChange,
  onClose,
  onForget
}: Props): React.JSX.Element {
  /** 割り当て先を選んでいるスロットの番号。nullならピッカーを閉じている */
  const [pickingIndex, setPickingIndex] = useState<number | null>(null)

  const candidates: ButtonSlot[] = [
    ...templates.map((t): ButtonSlot => ({ kind: 'template', id: t.id, label: t.label })),
    ...macros.map((m): ButtonSlot => ({ kind: 'macro', id: m.id, label: m.name }))
  ]

  const handlePick = (slot: ButtonSlot | null): void => {
    if (pickingIndex === null) return
    onChange(setSlot(layout, pickingIndex, slot))
    setPickingIndex(null)
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.root}>
        <View style={styles.header}>
          <Text style={styles.title}>設定</Text>
          <TouchableOpacity onPress={onClose} hitSlop={12}>
            <CloseIcon color={colors.textSecondary} />
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={styles.body}>
          <Text style={styles.sectionTitle}>ボタンの数</Text>
          <View style={styles.countRow}>
            {Array.from({ length: MAX_BUTTONS }, (_, i) => i + 1).map((n) => (
              <TouchableOpacity
                key={n}
                style={[styles.countChip, layout.count === n && styles.countChipActive]}
                onPress={() => onChange(resizeLayout(layout, n))}
              >
                <Text style={layout.count === n ? styles.countTextActive : styles.countText}>{n}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={styles.note}>
            減らすと後ろのボタンから外れます。ボタンの大きさと間隔は個数と画面サイズから自動調整されます。
          </Text>

          <Text style={styles.sectionTitle}>各ボタンの割り当て</Text>
          {!connected && (
            <Text style={styles.note}>
              PCと未接続のため、割り当て候補を取得できません。接続してから設定してください。
            </Text>
          )}
          {layout.slots.map((slot, index) => (
            <TouchableOpacity key={index} style={styles.slotRow} onPress={() => setPickingIndex(index)}>
              <Text style={styles.slotIndex}>{index + 1}</Text>
              <View style={styles.slotBody}>
                {slot ? (
                  <>
                    <Text style={styles.slotLabel} numberOfLines={1}>
                      {slot.label || '(名称なし)'}
                    </Text>
                    <Text style={styles.slotKind}>{slot.kind === 'macro' ? 'マクロ' : '定型文'}</Text>
                  </>
                ) : (
                  <Text style={styles.slotEmpty}>未設定</Text>
                )}
              </View>
              <Text style={styles.chevron}>›</Text>
            </TouchableOpacity>
          ))}

          <TouchableOpacity style={styles.dangerButton} onPress={onForget}>
            <Text style={styles.dangerText}>PCとの連携を解除する</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>

      <Modal
        visible={pickingIndex !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setPickingIndex(null)}
      >
        <View style={styles.scrim}>
          <View style={styles.pickerPanel}>
            <View style={styles.header}>
              <Text style={styles.title}>{(pickingIndex ?? 0) + 1}番目のボタン</Text>
              <TouchableOpacity onPress={() => setPickingIndex(null)} hitSlop={12}>
                <CloseIcon color={colors.textSecondary} />
              </TouchableOpacity>
            </View>
            <FlatList
              data={candidates}
              keyExtractor={(item) => `${item.kind}-${item.id}`}
              ListHeaderComponent={
                <TouchableOpacity style={styles.candidateRow} onPress={() => handlePick(null)}>
                  <Text style={styles.slotEmpty}>未設定にする</Text>
                </TouchableOpacity>
              }
              ListEmptyComponent={
                <Text style={styles.note}>
                  PC側に定型文・マクロが登録されていないか、まだ取得できていません。
                </Text>
              }
              renderItem={({ item }) => (
                <TouchableOpacity style={styles.candidateRow} onPress={() => handlePick(item)}>
                  <Text style={styles.candidateLabel} numberOfLines={1}>
                    {item.label || '(名称なし)'}
                  </Text>
                  <Text style={[styles.badge, item.kind === 'macro' ? styles.badgeMacro : styles.badgeTemplate]}>
                    {item.kind === 'macro' ? 'マクロ' : '定型文'}
                  </Text>
                </TouchableOpacity>
              )}
            />
          </View>
        </View>
      </Modal>
    </Modal>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg, paddingTop: 48 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12
  },
  title: { color: colors.text, fontSize: 17, fontWeight: '600' },
  body: { paddingHorizontal: 16, paddingBottom: 40 },
  sectionTitle: { color: colors.textSecondary, fontSize: 13, fontWeight: '600', marginTop: 18, marginBottom: 10 },
  countRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  countChip: {
    width: 44,
    height: 40,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.panel,
    alignItems: 'center',
    justifyContent: 'center'
  },
  countChipActive: { backgroundColor: colors.accentBg, borderColor: colors.accent },
  countText: { color: colors.textSecondary, fontSize: 14 },
  countTextActive: { color: colors.text, fontSize: 14, fontWeight: '700' },
  note: { color: colors.textMuted, fontSize: 12, lineHeight: 18, marginTop: 10 },
  slotRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    marginBottom: 8,
    gap: 12
  },
  slotIndex: { color: colors.textMuted, fontSize: 13, width: 20 },
  slotBody: { flex: 1 },
  slotLabel: { color: colors.text, fontSize: 14 },
  slotKind: { color: colors.textMuted, fontSize: 11, marginTop: 2 },
  slotEmpty: { color: colors.textMuted, fontSize: 14 },
  chevron: { color: colors.textMuted, fontSize: 20 },
  dangerButton: {
    marginTop: 28,
    borderWidth: 1,
    borderColor: colors.dangerBorder,
    backgroundColor: colors.dangerBg,
    borderRadius: 10,
    paddingVertical: 13,
    alignItems: 'center'
  },
  dangerText: { color: colors.danger, fontSize: 14 },
  scrim: { flex: 1, backgroundColor: colors.scrim, justifyContent: 'center', padding: 20 },
  pickerPanel: {
    backgroundColor: colors.header,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    paddingTop: 16,
    paddingBottom: 8,
    maxHeight: '75%'
  },
  candidateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 13,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    gap: 10
  },
  candidateLabel: { color: colors.text, fontSize: 14, flex: 1 },
  badge: { fontSize: 11, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 4, overflow: 'hidden' },
  badgeTemplate: { color: colors.textSecondary, backgroundColor: colors.panel },
  badgeMacro: { color: colors.success, backgroundColor: colors.successBg }
})
