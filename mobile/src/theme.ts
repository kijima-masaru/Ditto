/**
 * 配色。PC側Ditto(src/renderer/src/App.css の :root[data-theme='dark'])のダークテーマと
 * 同じ値を使い、PCとスマホで見た目の印象を揃える。CSS変数はRNから参照できないため、
 * 対応する変数名をコメントに残した上でここに複製する(App.css側を変えたらここも合わせる)。
 */
export const colors = {
  /** --bg: 画面の地の色 */
  bg: '#16191d',
  /** --panel-bg: ボタングリッドを載せるパネル */
  panel: '#23272e',
  /** --panel-bg-alt: パネル内でさらに一段落とす面 */
  panelAlt: '#1c2026',
  /** --header-bg: モーダルの背景など、最も暗い面 */
  headerBg: '#101317',

  /** --text */
  text: '#e6e9ec',
  /** --text-secondary */
  textSecondary: '#b7c0cc',
  /** --text-muted */
  textMuted: '#7d8a99',

  /** --border */
  border: '#33393f',
  /** --border-strong */
  borderStrong: '#454c54',
  /** --hover-bg: 押せる面の既定色 */
  buttonBg: '#2a2f36',

  /** --accent */
  accent: '#4d94f0',
  /** --accent-hover */
  accentHover: '#79b0f5',
  /** --accent-bg: マクロボタンなど、種別で塗り分ける面 */
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

  /** --success-text: 接続中を示す色 */
  success: '#7fdba3',
  /** --warning-bg / 未接続を示す色 */
  warning: '#e0b341',
  warningBg: '#3a3319',

  /** --shadow */
  overlay: 'rgba(0, 0, 0, 0.6)'
} as const
