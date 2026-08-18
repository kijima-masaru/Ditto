import { useState } from 'react'
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import {
  MAX_BUTTONS,
  MIN_BUTTONS,
  clampCount,
  resizeSlots,
  type LayoutConfig,
  type SlotAssignment
} from '../lib/layoutStorage'
import type { GridItem } from '../lib/gridLayout'
import type { RemoteMacroItem, RemoteTemplateItem } from '../lib/protocol'
import { colors } from '../theme'

/**
 * 設定モード。歯車アイコンから入り、ボタン数と各マスに割り当てる定型文・マクロを変える。
 *
 * 「自動」はPC側でコマンドパレットに固定した項目をそのまま並べるモードで、カスタマイズ前の
 * 既定。ボタン数を触るか割り当てを触った時点で自動を抜け、その内容が端末に保存される。
 */

interface Props {
  layout: LayoutConfig | null
  /** いま画面に出ているマスの中身。自動モードから手動へ切り替えるときの初期値に使う */
  currentItems: (GridItem | null)[]
  templates: RemoteTemplateItem[]
  macros: RemoteMacroItem[]
  connected: boolean
  onApply: (layout: LayoutConfig | null) => void
  onClose: () => void
  onForget: () => void
}

function labelFor(
  assignment: SlotAssignment | null,
  templates: RemoteTemplateItem[],
  macros: RemoteMacroItem[]
): { text: string; muted: boolean } {
  if (!assignment) return { text: '未割り当て', muted: true }
  if (assignment.kind === 'template') {
    const t = templates.find((x) => x.id === assignment.id)
    return t ? { text: t.label, muted: false } : { text: '割り当て済み(名称を取得できていません)', muted: true }
  }
  const m = macros.find((x) => x.id === assignment.id)
  return m ? { text: m.name, muted: false } : { text: '割り当て済み(名称を取得できていません)', muted: true }
}

export default function SettingsPanel({
  layout,
  currentItems,
  templates,
  macros,
  connected,
  onApply,
  onClose,
  onForget
}: Props): React.JSX.Element {
  const [pickerIndex, setPickerIndex] = useState<number | null>(null)

  const isAuto = layout === null
  // 自動モードのあいだも「いま出ている配置」を編集対象として見せる。こうすると自動から
  // 手動へ切り替えたときに並びが変わらず、どこをいじったのかが分かりやすい
  const slots: (SlotAssignment | null)[] = isAuto
    ? currentItems.map((i) => (i ? { kind: i.kind, id: i.id } : null))
    : layout.slots
  const count = isAuto ? Math.max(MIN_BUTTONS, slots.length) : layout.count

  const applyCount = (next: number): void => {
    const c = clampCount(next)
    onApply({ count: c, slots: resizeSlots(slots, c) })
  }

  const applyAssignment = (index: number, assignment: SlotAssignment | null): void => {
    const next = resizeSlots(slots, count)
    next[index] = assignment
    onApply({ count, slots: next })
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>設定</Text>
        <Pressable style={styles.doneButton} onPress={onClose} hitSlop={8}>
          <Text style={styles.doneButtonText}>完了</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        <Text style={styles.sectionTitle}>ボタン数</Text>
        <View style={styles.counterRow}>
          <Pressable
            style={[styles.stepButton, (isAuto || count <= MIN_BUTTONS) && styles.stepButtonDisabled]}
            onPress={() => applyCount(count - 1)}
            disabled={isAuto || count <= MIN_BUTTONS}
          >
            <Text style={styles.stepButtonText}>−</Text>
          </Pressable>
          <Text style={styles.counterValue}>{isAuto ? `自動(${slots.length})` : count}</Text>
          <Pressable
            style={[styles.stepButton, !isAuto && count >= MAX_BUTTONS && styles.stepButtonDisabled]}
            onPress={() => applyCount(count + 1)}
            disabled={!isAuto && count >= MAX_BUTTONS}
          >
            <Text style={styles.stepButtonText}>＋</Text>
          </Pressable>
        </View>
        <Text style={styles.hint}>
          最大{MAX_BUTTONS}個。ボタンの大きさと間隔は、個数と画面サイズに合わせて自動で調整されます。
        </Text>

        <View style={styles.modeRow}>
          <Pressable
            style={[styles.modeChip, isAuto && styles.modeChipActive]}
            onPress={() => onApply(null)}
          >
            <Text style={isAuto ? styles.modeChipTextActive : styles.modeChipText}>自動</Text>
          </Pressable>
          <Pressable
            style={[styles.modeChip, !isAuto && styles.modeChipActive]}
            onPress={() => onApply({ count, slots: resizeSlots(slots, count) })}
          >
            <Text style={!isAuto ? styles.modeChipTextActive : styles.modeChipText}>カスタム</Text>
          </Pressable>
        </View>
        <Text style={styles.hint}>
          「自動」はPC側でコマンドパレットに固定した項目をそのまま並べます。「カスタム」にすると
          ボタン数と割り当てを自由に変えられます。
        </Text>

        <Text style={styles.sectionTitle}>各ボタンの割り当て</Text>
        {!connected && <Text style={styles.hint}>PCと未接続のため、選べる項目を取得できていません。</Text>}
        {resizeSlots(slots, count).map((assignment, index) => {
          const { text, muted } = labelFor(assignment, templates, macros)
          return (
            <Pressable key={index} style={styles.slotRow} onPress={() => setPickerIndex(index)}>
              <Text style={styles.slotIndex}>{index + 1}</Text>
              <Text style={[styles.slotLabel, muted && styles.slotLabelMuted]} numberOfLines={1}>
                {text}
              </Text>
              <Text style={styles.slotChevron}>›</Text>
            </Pressable>
          )
        })}

        <Pressable style={styles.forgetButton} onPress={onForget}>
          <Text style={styles.forgetButtonText}>このPCとの連携を解除</Text>
        </Pressable>
      </ScrollView>

      <Modal visible={pickerIndex !== null} transparent animationType="fade" onRequestClose={() => setPickerIndex(null)}>
        <Pressable style={styles.pickerBackdrop} onPress={() => setPickerIndex(null)}>
          <Pressable style={styles.pickerPanel} onPress={() => {}}>
            <Text style={styles.title}>ボタン{(pickerIndex ?? 0) + 1}に割り当て</Text>
            <ScrollView contentContainerStyle={styles.pickerBody}>
              <Pressable
                style={styles.pickerRow}
                onPress={() => {
                  if (pickerIndex !== null) applyAssignment(pickerIndex, null)
                  setPickerIndex(null)
                }}
              >
                <Text style={styles.pickerRowTextMuted}>未割り当て(空きマス)</Text>
              </Pressable>

              {templates.length > 0 && <Text style={styles.pickerGroup}>定型文</Text>}
              {templates.map((t) => (
                <Pressable
                  key={`t-${t.id}`}
                  style={styles.pickerRow}
                  onPress={() => {
                    if (pickerIndex !== null) applyAssignment(pickerIndex, { kind: 'template', id: t.id })
                    setPickerIndex(null)
                  }}
                >
                  <Text style={styles.pickerRowText} numberOfLines={1}>
                    {t.label}
                  </Text>
                </Pressable>
              ))}

              {macros.length > 0 && <Text style={styles.pickerGroup}>マクロ</Text>}
              {macros.map((m) => (
                <Pressable
                  key={`m-${m.id}`}
                  style={styles.pickerRow}
                  onPress={() => {
                    if (pickerIndex !== null) applyAssignment(pickerIndex, { kind: 'macro', id: m.id })
                    setPickerIndex(null)
                  }}
                >
                  <Text style={styles.pickerRowText} numberOfLines={1}>
                    ⚡ {m.name}
                  </Text>
                </Pressable>
              ))}

              {templates.length === 0 && macros.length === 0 && (
                <Text style={styles.hint}>
                  PC側でコマンドパレットに固定した定型文・マクロがここに並びます。PCと接続してから
                  選んでください。
                </Text>
              )}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  title: { color: colors.text, fontSize: 16, fontWeight: '700' },
  doneButton: {
    backgroundColor: colors.accent,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 7
  },
  doneButtonText: { color: colors.accentText, fontSize: 14, fontWeight: '600' },
  body: { gap: 8, paddingBottom: 16 },
  sectionTitle: { color: colors.textSecondary, fontSize: 13, fontWeight: '600', marginTop: 10 },
  hint: { color: colors.textMuted, fontSize: 12, lineHeight: 17 },
  counterRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  stepButton: {
    width: 44,
    height: 40,
    borderRadius: 10,
    backgroundColor: colors.buttonBg,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center'
  },
  stepButtonDisabled: { opacity: 0.4 },
  stepButtonText: { color: colors.text, fontSize: 20, lineHeight: 22 },
  counterValue: { color: colors.text, fontSize: 16, fontWeight: '600', minWidth: 84, textAlign: 'center' },
  modeRow: { flexDirection: 'row', gap: 8, marginTop: 4 },
  modeChip: {
    flex: 1,
    paddingVertical: 9,
    borderRadius: 8,
    backgroundColor: colors.buttonBg,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center'
  },
  modeChipActive: { backgroundColor: colors.accentBg, borderColor: colors.accent },
  modeChipText: { color: colors.textSecondary, fontSize: 14 },
  modeChipTextActive: { color: colors.accentHover, fontSize: 14, fontWeight: '600' },
  slotRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.panelAlt,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 12
  },
  slotIndex: { color: colors.textMuted, fontSize: 13, width: 18 },
  slotLabel: { color: colors.text, fontSize: 14, flex: 1 },
  slotLabelMuted: { color: colors.textMuted },
  slotChevron: { color: colors.textMuted, fontSize: 18 },
  forgetButton: {
    marginTop: 18,
    borderWidth: 1,
    borderColor: colors.dangerBorder,
    backgroundColor: colors.dangerBg,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center'
  },
  forgetButtonText: { color: colors.danger, fontSize: 14, fontWeight: '600' },
  pickerBackdrop: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'center', padding: 20 },
  pickerPanel: {
    maxHeight: '75%',
    backgroundColor: colors.headerBg,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14
  },
  pickerBody: { gap: 6, paddingTop: 10 },
  pickerGroup: { color: colors.textMuted, fontSize: 12, marginTop: 8 },
  pickerRow: {
    backgroundColor: colors.panelAlt,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 12
  },
  pickerRowText: { color: colors.text, fontSize: 14 },
  pickerRowTextMuted: { color: colors.textMuted, fontSize: 14 }
})
