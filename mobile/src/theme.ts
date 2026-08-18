/**
 * PC側Ditto本体のダークテーマ(src/renderer/src/App.css の :root[data-theme='dark'])
 * から値をそのまま移植したもの。両者で色がずれると「同じアプリの一部」に見えなくなるため、
 * 本体側のCSS変数を変えたときはここも合わせて更新すること。
 */

export const colors = {
  /** --bg 画面全体の背景 */
  bg: '#16191d',
  /** --panel-bg カード・ボタンの面 */
  panel: '#23272e',
  /** --panel-bg-alt 一段沈んだ面(グリッドの土台など) */
  panelAlt: '#1c2026',
  /** --header-bg 最も暗い面(モーダルの背景) */
  header: '#101317',

  /** --text */
  text: '#e6e9ec',
  /** --text-secondary */
  textSecondary: '#b7c0cc',
  /** --text-muted 未設定スロットの説明など */
  textMuted: '#7d8a99',

  /** --border */
  border: '#33393f',
  /** --border-strong 選択中・強調したい枠 */
  borderStrong: '#454c54',
  /** --hover-bg 押下中の面 */
  pressed: '#2a2f36',

  /** --accent */
  accent: '#4d94f0',
  /** --accent-hover */
  accentHover: '#79b0f5',
  /** --accent-bg 選択中タブの背景 */
  accentBg: '#1d3a5c',
  /** --accent-text */
  accentText: '#ffffff',
  /** --accent-disabled */
  accentDisabled: '#3a4b5e',

  /** --danger */
  danger: '#ff6b62',
  /** --danger-bg */
  dangerBg: '#3a2321',
  /** --danger-border */
  dangerBorder: '#66332e',

  /** --success-text 接続済みの表示に使う */
  success: '#7fdba3',
  /** --success-bg */
  successBg: '#1c3a2c',
  /** --warning-bg 未接続バナーの背景 */
  warningBg: '#3a3319',

  /** モーダル表示時に背後を覆う膜 */
  scrim: 'rgba(0, 0, 0, 0.6)'
} as const
