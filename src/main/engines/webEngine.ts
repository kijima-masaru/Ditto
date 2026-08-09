import { randomUUID } from 'node:crypto'
import { chromium, type Browser, type BrowserContext, type Frame, type Page } from 'playwright'
import type {
  PlaybackProgress,
  PlaybackResult,
  PlayerEngine,
  RecorderEngine,
  RecordedStep,
  StepType,
  TestCase
} from '../../shared/types'

/**
 * Web(ブラウザ)対象の録画・再生エンジン。
 * Playwrightで実ブラウザを起動し、ページに操作記録用スクリプトを注入して
 * クリック・入力・遷移をセレクタベースで記録する。再生も同エンジンで行う。
 */

const RECORDER_BINDING = '__autoTestToolRecorderEvent'

/** ブラウザ側 (page.exposeBinding) から Node 側へ渡されるイベントペイロード */
interface RecorderEventPayload {
  kind: 'click' | 'dblclick' | 'input' | 'keypress'
  selector?: string
  value?: string
  key?: string
  pageX?: number
  pageY?: number
  label?: string
}

/**
 * ページに注入するスクリプトを生成する。
 * クリック・ダブルクリック・input/change・Enter/Tabキー押下を capture フェーズで監視し、
 * イベント発生元要素から堅牢な CSS セレクタを算出して window[bindingName] 経由で Node 側へ通知する。
 * (このスクリプトはブラウザのページコンテキストで実行されるため、外側スコープの変数は参照できない)
 */
function buildRecorderInitScript(bindingName: string): string {
  const bindingRef = `window[${JSON.stringify(bindingName)}]`
  return `
(function () {
  if (window.__autoTestToolRecorderInstalled) return;
  window.__autoTestToolRecorderInstalled = true;

  function describeElement(el) {
    if (!el) return '';
    var tag = el.tagName ? el.tagName.toLowerCase() : '';
    var text = (el.textContent || '').trim().slice(0, 30);
    var idPart = el.id ? ('#' + el.id) : '';
    return text ? (tag + idPart + ' "' + text + '"') : (tag + idPart);
  }

  function computeSelector(el) {
    if (!el || el.nodeType !== 1) return '';
    if (el.id) return '#' + CSS.escape(el.id);
    var testId = el.getAttribute && el.getAttribute('data-testid');
    if (testId) return '[data-testid=' + JSON.stringify(testId) + ']';
    var nameAttr = el.getAttribute && el.getAttribute('name');
    if (nameAttr) return el.tagName.toLowerCase() + '[name=' + JSON.stringify(nameAttr) + ']';
    var ariaLabel = el.getAttribute && el.getAttribute('aria-label');
    if (ariaLabel) return '[aria-label=' + JSON.stringify(ariaLabel) + ']';

    var parts = [];
    var node = el;
    var depth = 0;
    while (node && node.nodeType === 1 && depth < 8) {
      if (node.id) {
        parts.unshift('#' + CSS.escape(node.id));
        break;
      }
      var parent = node.parentElement;
      if (!parent) {
        parts.unshift(node.tagName.toLowerCase());
        break;
      }
      var idx = Array.prototype.indexOf.call(parent.children, node) + 1;
      parts.unshift(node.tagName.toLowerCase() + ':nth-child(' + idx + ')');
      if (parent.tagName === 'BODY') {
        parts.unshift('body');
        break;
      }
      node = parent;
      depth += 1;
    }
    return parts.join(' > ');
  }

  function send(payload) {
    try {
      var fn = ${bindingRef};
      if (typeof fn === 'function') fn(payload);
    } catch (e) {
      /* ignore */
    }
  }

  function targetElement(e) {
    var t = e.target;
    return (t && t.nodeType === 1) ? t : null;
  }

  var pendingClickTimer = null;

  document.addEventListener('click', function (e) {
    var el = targetElement(e);
    if (!el) return;
    if (pendingClickTimer) { window.clearTimeout(pendingClickTimer); pendingClickTimer = null; }
    var payload = {
      kind: 'click',
      selector: computeSelector(el),
      pageX: e.pageX,
      pageY: e.pageY,
      label: describeElement(el)
    };
    pendingClickTimer = window.setTimeout(function () {
      pendingClickTimer = null;
      send(payload);
    }, 300);
  }, true);

  document.addEventListener('dblclick', function (e) {
    var el = targetElement(e);
    if (!el) return;
    if (pendingClickTimer) { window.clearTimeout(pendingClickTimer); pendingClickTimer = null; }
    send({
      kind: 'dblclick',
      selector: computeSelector(el),
      pageX: e.pageX,
      pageY: e.pageY,
      label: describeElement(el)
    });
  }, true);

  var inputTimers = new WeakMap();

  function flushInput(el) {
    var t = inputTimers.get(el);
    if (t) { window.clearTimeout(t); inputTimers.delete(el); }
    send({
      kind: 'input',
      selector: computeSelector(el),
      value: 'value' in el ? String(el.value) : '',
      label: describeElement(el)
    });
  }

  // input: テキスト系入力は一定時間操作が止まってから確定値を送る (キー1つずつ記録すると
  // ステップ数が爆発し再生も遅くなるため)。checkbox/radio は change イベント側で処理する。
  document.addEventListener('input', function (e) {
    var el = targetElement(e);
    if (!el) return;
    var tag = el.tagName;
    if (tag !== 'INPUT' && tag !== 'TEXTAREA') return;
    var t = el.type;
    if (t === 'checkbox' || t === 'radio') return;
    var existing = inputTimers.get(el);
    if (existing) window.clearTimeout(existing);
    inputTimers.set(el, window.setTimeout(function () { flushInput(el); }, 500));
  }, true);

  document.addEventListener('change', function (e) {
    var el = targetElement(e);
    if (!el) return;
    var tag = el.tagName;
    if (tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT') return;
    var existing = inputTimers.get(el);
    if (existing) { window.clearTimeout(existing); inputTimers.delete(el); }
    if (el.type === 'checkbox' || el.type === 'radio') {
      send({ kind: 'input', selector: computeSelector(el), value: String(el.checked), label: describeElement(el) });
    } else {
      send({ kind: 'input', selector: computeSelector(el), value: 'value' in el ? String(el.value) : '', label: describeElement(el) });
    }
  }, true);

  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' && e.key !== 'Tab') return;
    var el = targetElement(e);
    send({
      kind: 'keypress',
      key: e.key,
      selector: el ? computeSelector(el) : undefined,
      label: describeElement(el)
    });
  }, true);
})();
`
}

/**
 * このサンドボックス環境では、Playwright が管理する「Chrome for Testing」バイナリを直接起動すると
 * Windows の side-by-side アセンブリ解決エラー (application has failed to start because its
 * side-by-side configuration is incorrect) で launch が失敗するケースを確認した。
 * これは OS/環境固有の問題で実装のバグではないが (システムにインストール済みの Chrome 経由では
 * 同一の Playwright API で問題なく起動できることを確認済み)、実行環境によって差が出ないよう
 * まずバンドル版 Chromium の起動を試み、失敗した場合のみ system Chrome/Edge にフォールバックする。
 */
async function launchChromium(headless: boolean): Promise<Browser> {
  try {
    return await chromium.launch({ headless })
  } catch (err) {
    for (const channel of ['chrome', 'msedge'] as const) {
      try {
        return await chromium.launch({ headless, channel })
      } catch {
        // try next fallback
      }
    }
    throw err
  }
}

/** RecordedStep の id/timestamp/delayMs を自動採番しつつ onStep を呼び出すヘルパーを生成する */
function createStepEmitter(
  onStep: (step: RecordedStep) => void
): (input: { type: StepType } & Partial<Omit<RecordedStep, 'id' | 'timestamp' | 'delayMs' | 'type'>>) => void {
  let lastTs: number | null = null
  return (input) => {
    const timestamp = Date.now()
    const delayMs = lastTs === null ? 0 : timestamp - lastTs
    lastTs = timestamp
    const step: RecordedStep = {
      id: randomUUID(),
      timestamp,
      delayMs,
      ...input
    }
    onStep(step)
  }
}

export class WebRecorderEngine implements RecorderEngine {
  private browser: Browser | null = null
  private context: BrowserContext | null = null

  async start(
    target: string,
    _targetArgs: string | undefined,
    onStep: (step: RecordedStep) => void
  ): Promise<void> {
    const emit = createStepEmitter(onStep)

    const browser = await launchChromium(false)
    this.browser = browser
    console.log('[webEngine] recorder: browser launched')

    const context = await browser.newContext({ viewport: null })
    this.context = context

    const lastUrlByPage = new WeakMap<Page, string>()
    const trackNavigation = (page: Page): void => {
      page.on('framenavigated', (frame: Frame) => {
        if (frame !== page.mainFrame()) return
        const url = frame.url()
        if (!url || url === 'about:blank') return
        if (lastUrlByPage.get(page) === url) return
        lastUrlByPage.set(page, url)
        emit({ type: 'navigate', url })
      })
    }

    await context.exposeBinding(
      RECORDER_BINDING,
      (_source, payload: RecorderEventPayload) => {
        switch (payload.kind) {
          case 'click':
          case 'dblclick':
            emit({
              type: payload.kind,
              selector: payload.selector,
              pageX: payload.pageX,
              pageY: payload.pageY,
              label: payload.label
            })
            break
          case 'input':
            emit({
              type: 'input',
              selector: payload.selector,
              value: payload.value,
              label: payload.label
            })
            break
          case 'keypress':
            emit({
              type: 'keypress',
              selector: payload.selector,
              key: payload.key,
              label: payload.label
            })
            break
        }
      }
    )

    await context.addInitScript(buildRecorderInitScript(RECORDER_BINDING))

    // 新規タブ/ポップアップにも同じ記録用スクリプト・バインディングが自動適用される (context単位のため)。
    // 遷移トラッキングだけは page ごとに個別登録が必要。
    context.on('page', (page) => trackNavigation(page))

    const page = await context.newPage()
    trackNavigation(page)

    await page.goto(target)
  }

  async stop(): Promise<void> {
    const browser = this.browser
    const context = this.context
    this.browser = null
    this.context = null
    if (!browser) return
    try {
      await context?.close()
    } catch {
      // すでに閉じている場合は無視
    }
    try {
      await browser.close()
      console.log('[webEngine] recorder: browser closed')
    } catch {
      // すでに閉じている場合は無視
    }
  }
}

export class WebPlayerEngine implements PlayerEngine {
  private browser: Browser | null = null
  private aborted = false

  async run(testCase: TestCase, onProgress: (progress: PlaybackProgress) => void): Promise<PlaybackResult> {
    this.aborted = false
    const log: PlaybackProgress[] = []
    const push = (progress: PlaybackProgress): void => {
      log.push(progress)
      onProgress(progress)
    }

    let success = true
    let browser: Browser | null = null

    try {
      browser = await launchChromium(false)
      this.browser = browser
      console.log('[webEngine] player: browser launched')

      const context = await browser.newContext({ viewport: null })
      const page = await context.newPage()

      for (let i = 0; i < testCase.steps.length; i++) {
        if (this.aborted) {
          success = false
          break
        }

        const step = testCase.steps[i]
        push({ stepIndex: i, status: 'running' })

        try {
          await this.execStep(page, step)
          push({ stepIndex: i, status: 'ok' })
        } catch (err) {
          success = false
          push({ stepIndex: i, status: 'fail', message: err instanceof Error ? err.message : String(err) })
          break
        }
      }
    } catch (err) {
      success = false
      console.error('[webEngine] player: run failed', err)
    } finally {
      if (browser) {
        await browser.close().catch(() => {
          // すでに閉じている(abort等)場合は無視
        })
        console.log('[webEngine] player: browser closed')
      }
      this.browser = null
    }

    return { success, finishedAt: new Date().toISOString(), log }
  }

  async abort(): Promise<void> {
    this.aborted = true
    const browser = this.browser
    if (!browser) return
    try {
      await browser.close()
    } catch {
      // close中の例外は無視 (in-flightな操作は各stepのcatchでfail処理される)
    }
  }

  private async execStep(page: Page, step: RecordedStep): Promise<void> {
    switch (step.type) {
      case 'navigate': {
        if (!step.url) throw new Error('navigate step is missing url')
        await page.goto(step.url)
        return
      }
      case 'click': {
        if (!step.selector) throw new Error('click step is missing selector')
        await page.click(step.selector, { timeout: 5000 })
        return
      }
      case 'dblclick': {
        if (!step.selector) throw new Error('dblclick step is missing selector')
        await page.dblclick(step.selector, { timeout: 5000 })
        return
      }
      case 'input': {
        if (!step.selector) throw new Error('input step is missing selector')
        await page.fill(step.selector, step.value ?? '', { timeout: 5000 })
        return
      }
      case 'keypress': {
        if (step.selector) {
          await page.focus(step.selector, { timeout: 5000 })
        }
        await page.keyboard.press(step.key ?? 'Enter')
        return
      }
      case 'wait': {
        await page.waitForTimeout(Math.min(step.delayMs, 3000))
        return
      }
      case 'scroll': {
        if (typeof step.pageX === 'number' && typeof step.pageY === 'number') {
          const x = step.pageX
          const y = step.pageY
          // このファイルは DOM lib を含まない tsconfig でコンパイルされるため、
          // ブラウザ側で実行されるコールバック内の window 参照は globalThis 経由で型エラーを回避する。
          await page.evaluate(
            (coords: { x: number; y: number }) => {
              ;(globalThis as unknown as { scrollTo: (x: number, y: number) => void }).scrollTo(
                coords.x,
                coords.y
              )
            },
            { x, y }
          )
        }
        return
      }
      default: {
        throw new Error(`Unsupported step type: ${step.type as string}`)
      }
    }
  }
}
