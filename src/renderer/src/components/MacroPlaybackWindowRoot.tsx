import { useEffect, useState } from 'react'
import type { MacroCase } from '../../../shared/types'
import Playback from './Playback'

/**
 * コマンドパレットで選んだマクロの再生専用の別ウィンドウのルート。
 * メインウィンドウと同じrenderer bundleを`?macroPlayback=1`付きで読み込むことで
 * 実現している(macroPlaybackWindow.ts参照)。
 *
 * Ditto本体(クリップボード・マクロ一覧・設定を含むメインウィンドウ)を作業中の画面へ
 * 割り込ませずに再生だけを行えるよう、この画面には再生に必要なUI(Playback)と、
 * 枠なしウィンドウを移動・クローズするための細いヘッダーのみを置く。
 */

// 表示対象のマクロIDは、ウィンドウ生成時にクエリ文字列で渡される。
// (IPCで受け取る形にすると、mainからの送信がこのコンポーネントのマウントより早い場合に
//  メッセージが捨てられ、画面が「読み込み中」のまま止まってしまう)
const initialMacroId = new URLSearchParams(window.location.search).get('macroId')

export default function MacroPlaybackWindowRoot(): React.JSX.Element {
  const [macroId, setMacroId] = useState<string | null>(initialMacroId)
  const [macroCase, setMacroCase] = useState<MacroCase | null>(null)
  const [notFound, setNotFound] = useState(false)

  useEffect(() => {
    // メインウィンドウとは別のBrowserWindowなのでdata-theme属性を独自に引き継ぐ必要がある
    window.api.getSettings().then((s) => document.documentElement.setAttribute('data-theme', s.theme))
  }, [])

  // 既にこのウィンドウが開いている状態でパレットから別のマクロを選んだ場合は、
  // main側から新しいマクロIDが送られてくる(この時点では既にマウント済みなので取りこぼさない)
  useEffect(() => {
    return window.api.onOpenMacroForPlayback((id) => setMacroId(id))
  }, [])

  // main側からは対象のマクロIDのみ渡ってくるため、ここで最新の一覧から該当のマクロを取得する
  useEffect(() => {
    if (!macroId) return undefined
    let cancelled = false
    setMacroCase(null)
    setNotFound(false)
    window.api.listMacros().then((list) => {
      if (cancelled) return
      const found = list.find((m) => m.id === macroId) ?? null
      setMacroCase(found)
      setNotFound(found === null)
    })
    return () => {
      cancelled = true
    }
  }, [macroId])

  const message = !macroId || notFound ? 'マクロが見つかりませんでした' : '読み込み中...'

  return (
    <div className="macro-playback-window">
      <div className="macro-playback-window-header">
        <span className="macro-playback-window-title">{macroCase?.name ?? ''}</span>
        <button
          type="button"
          className="macro-playback-window-close"
          onClick={() => window.close()}
          title="閉じる"
          aria-label="閉じる"
        >
          ×
        </button>
      </div>
      {macroCase ? (
        // 別のマクロに切り替わった際に前の再生状態(進捗・速度など)が残らないよう作り直す
        <Playback key={macroCase.id} macroCase={macroCase} />
      ) : (
        <div className="macro-playback-window-loading">{message}</div>
      )}
    </div>
  )
}
