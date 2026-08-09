import type { PlayerEngine, RecorderEngine } from '../../shared/types'

/**
 * 汎用デスクトップアプリ対象の録画・再生エンジン。
 * グローバルマウス/キーボードフックで対象ウィンドウ相対座標の操作を記録し、
 * 再生時は対象ウィンドウを探してフォーカスした上で座標ベースに操作を再現する。
 *
 * NOTE: 現時点ではスタブ実装。uiohook-napi / nut-js ベースの本実装に置き換え予定。
 */
export class DesktopRecorderEngine implements RecorderEngine {
  async start(): Promise<void> {
    throw new Error('DesktopRecorderEngine.start: not implemented yet')
  }

  async stop(): Promise<void> {
    throw new Error('DesktopRecorderEngine.stop: not implemented yet')
  }
}

export class DesktopPlayerEngine implements PlayerEngine {
  async run(): Promise<import('../../shared/types').PlaybackResult> {
    throw new Error('DesktopPlayerEngine.run: not implemented yet')
  }

  async abort(): Promise<void> {
    // no-op in stub
  }
}
