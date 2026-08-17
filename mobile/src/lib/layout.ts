import { Platform } from 'react-native'

/**
 * 画面上端の余白。AndroidではSafeAreaView(react-native)が何もしないため、
 * ステータスバーを避ける分を自前で確保する必要がある。一方iOSではSafeAreaViewが
 * ノッチ/Dynamic Island分を既に挿入しているので、同じ60を足すと上端が大きく間延びする。
 * そのためiOSでは見た目を整える分だけに留める。
 */
export const SCREEN_TOP_PADDING = Platform.OS === 'ios' ? 12 : 60
