import type { PlayerEngine, RecorderEngine } from '../../shared/types'

/**
 * Web(ブラウザ)対象の録画・再生エンジン。
 * Playwrightで実ブラウザを起動し、ページに操作記録用スクリプトを注入して
 * クリック・入力・遷移をセレクタベースで記録する。再生も同エンジンで行う。
 *
 * NOTE: 現時点ではスタブ実装。Playwrightベースの本実装に置き換え予定。
 */
export class WebRecorderEngine implements RecorderEngine {
  async start(): Promise<void> {
    throw new Error('WebRecorderEngine.start: not implemented yet')
  }

  async stop(): Promise<void> {
    throw new Error('WebRecorderEngine.stop: not implemented yet')
  }
}

export class WebPlayerEngine implements PlayerEngine {
  async run(): Promise<import('../../shared/types').PlaybackResult> {
    throw new Error('WebPlayerEngine.run: not implemented yet')
  }

  async abort(): Promise<void> {
    // no-op in stub
  }
}
