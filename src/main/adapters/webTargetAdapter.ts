import { join } from 'path'
import { WebContentsView, ipcMain, type BrowserWindow } from 'electron'
import type { RecordedStep, TargetAdapter, TestTarget, ViewportRect } from '../../shared/types'

/**
 * Web対象のアダプタ。ElectronのWebContentsViewをアプリ自身のウィンドウに埋め込んで表示する。
 * 記録はページに注入したスクリプトがcontextBridge経由でイベントを送信し、
 * 再生はCSSセレクタをexecuteJavaScriptで解決した上でsendInputEvent(実イベント)を発行する。
 */

interface RecorderEventPayload {
  kind: 'click' | 'dblclick' | 'input' | 'keypress'
  selector?: string
  value?: string
  key?: string
  pageX?: number
  pageY?: number
  label?: string
}

const RECORDER_SCRIPT = `
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
      if (node.id) { parts.unshift('#' + CSS.escape(node.id)); break; }
      var parent = node.parentElement;
      if (!parent) { parts.unshift(node.tagName.toLowerCase()); break; }
      var idx = Array.prototype.indexOf.call(parent.children, node) + 1;
      parts.unshift(node.tagName.toLowerCase() + ':nth-child(' + idx + ')');
      if (parent.tagName === 'BODY') { parts.unshift('body'); break; }
      node = parent;
      depth += 1;
    }
    return parts.join(' > ');
  }

  function send(payload) {
    try {
      if (window.__autoTestToolBridge) window.__autoTestToolBridge.send(payload);
    } catch (e) { /* ignore */ }
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
    var payload = { kind: 'click', selector: computeSelector(el), pageX: e.pageX, pageY: e.pageY, label: describeElement(el) };
    pendingClickTimer = window.setTimeout(function () { pendingClickTimer = null; send(payload); }, 300);
  }, true);

  document.addEventListener('dblclick', function (e) {
    var el = targetElement(e);
    if (!el) return;
    if (pendingClickTimer) { window.clearTimeout(pendingClickTimer); pendingClickTimer = null; }
    send({ kind: 'dblclick', selector: computeSelector(el), pageX: e.pageX, pageY: e.pageY, label: describeElement(el) });
  }, true);

  var inputTimers = new WeakMap();
  function flushInput(el) {
    inputTimers.delete(el);
    send({ kind: 'input', selector: computeSelector(el), value: 'value' in el ? String(el.value) : '', label: describeElement(el) });
  }

  document.addEventListener('input', function (e) {
    var el = targetElement(e);
    if (!el) return;
    var tag = el.tagName;
    if (tag !== 'INPUT' && tag !== 'TEXTAREA') return;
    if (el.type === 'checkbox' || el.type === 'radio') return;
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
    send({ kind: 'keypress', key: e.key, selector: el ? computeSelector(el) : undefined, label: describeElement(el) });
  }, true);
})();
`

const registry = new Map<number, WebTargetAdapter>()
let listenerRegistered = false

function ensureIpcListener(): void {
  if (listenerRegistered) return
  listenerRegistered = true
  ipcMain.on('recorder:event', (event, payload: RecorderEventPayload) => {
    registry.get(event.sender.id)?.handleEvent(payload)
  })
}

const OFFSCREEN = -10000

export class WebTargetAdapter implements TargetAdapter {
  private readonly target: TestTarget
  private readonly mainWindow: BrowserWindow
  private view: WebContentsView | null = null
  private active = false
  private recording = false
  private lastUrl: string | null = null
  private onStepCb: ((step: Omit<RecordedStep, 'id' | 'targetId' | 'timestamp' | 'delayMs'>) => void) | null = null

  constructor(target: TestTarget, mainWindow: BrowserWindow) {
    this.target = target
    this.mainWindow = mainWindow
    ensureIpcListener()
  }

  async init(viewport: ViewportRect): Promise<void> {
    if (!this.target.url) throw new Error('URLが指定されていません')

    const view = new WebContentsView({
      webPreferences: {
        preload: join(__dirname, '../preload/recorder.js'),
        contextIsolation: true,
        sandbox: false
      }
    })
    this.view = view
    this.mainWindow.contentView.addChildView(view)
    registry.set(view.webContents.id, this)

    view.webContents.on('dom-ready', () => {
      view.webContents.executeJavaScript(RECORDER_SCRIPT).catch(() => {})
    })
    view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    view.webContents.on('did-navigate', (_e, url) => this.trackNavigation(url))
    view.webContents.on('did-navigate-in-page', (_e, url) => this.trackNavigation(url))

    this.applyBounds(viewport, false)
    await view.webContents.loadURL(this.target.url)
  }

  private trackNavigation(url: string): void {
    if (!this.recording || !this.active) return
    if (!url || url === 'about:blank' || url === this.lastUrl) return
    this.lastUrl = url
    this.onStepCb?.({ type: 'navigate', url })
  }

  private applyBounds(viewport: ViewportRect, active: boolean): void {
    if (!this.view) return
    const width = Math.max(1, Math.round(viewport.width))
    const height = Math.max(1, Math.round(viewport.height))
    if (active) {
      this.view.setBounds({ x: Math.round(viewport.x), y: Math.round(viewport.y), width, height })
    } else {
      this.view.setBounds({ x: OFFSCREEN, y: OFFSCREEN, width, height })
    }
  }

  async setActive(active: boolean, viewport: ViewportRect): Promise<void> {
    this.active = active
    this.applyBounds(viewport, active)
  }

  async updateViewport(viewport: ViewportRect): Promise<void> {
    this.applyBounds(viewport, this.active)
  }

  handleEvent(payload: RecorderEventPayload): void {
    if (!this.recording || !this.active) return
    switch (payload.kind) {
      case 'click':
      case 'dblclick':
        this.onStepCb?.({
          type: payload.kind,
          selector: payload.selector,
          pageX: payload.pageX,
          pageY: payload.pageY,
          label: payload.label
        })
        break
      case 'input':
        this.onStepCb?.({ type: 'input', selector: payload.selector, value: payload.value, label: payload.label })
        break
      case 'keypress':
        this.onStepCb?.({ type: 'keypress', selector: payload.selector, key: payload.key, label: payload.label })
        break
    }
  }

  async startRecording(
    onStep: (step: Omit<RecordedStep, 'id' | 'targetId' | 'timestamp' | 'delayMs'>) => void
  ): Promise<void> {
    this.onStepCb = onStep
    this.recording = true
  }

  async stopRecording(): Promise<void> {
    this.recording = false
    this.onStepCb = null
  }

  private async resolvePoint(selector: string): Promise<{ x: number; y: number }> {
    const script = `
      (function () {
        var el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return null;
        el.scrollIntoView({ block: 'center', inline: 'center' });
        var r = el.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      })();
    `
    const point = (await this.view!.webContents.executeJavaScript(script)) as { x: number; y: number } | null
    if (!point) throw new Error(`要素が見つかりません: ${selector}`)
    return point
  }

  async execStep(step: RecordedStep, speed: number): Promise<void> {
    if (!this.view) throw new Error('対象ビューがありません')
    const wc = this.view.webContents

    switch (step.type) {
      case 'navigate': {
        if (!step.url) throw new Error('navigate step is missing url')
        await wc.loadURL(step.url)
        return
      }
      case 'click':
      case 'dblclick': {
        if (!step.selector) throw new Error('click step is missing selector')
        const { x, y } = await this.resolvePoint(step.selector)
        const clicks = step.type === 'dblclick' ? 2 : 1
        wc.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: clicks })
        wc.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: clicks })
        return
      }
      case 'input': {
        if (!step.selector) throw new Error('input step is missing selector')
        const script = `
          (function () {
            var el = document.querySelector(${JSON.stringify(step.selector)});
            if (!el) return false;
            el.focus();
            var proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
            var d = Object.getOwnPropertyDescriptor(proto, 'value');
            if (d && d.set) { d.set.call(el, ${JSON.stringify(step.value ?? '')}); } else { el.value = ${JSON.stringify(step.value ?? '')}; }
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            return true;
          })();
        `
        const ok = await wc.executeJavaScript(script)
        if (!ok) throw new Error(`要素が見つかりません: ${step.selector}`)
        return
      }
      case 'keypress': {
        if (step.selector) {
          await wc.executeJavaScript(
            `(function(){ var el = document.querySelector(${JSON.stringify(step.selector)}); if (el) el.focus(); })();`
          )
        }
        const keyCode = step.key ?? 'Enter'
        wc.sendInputEvent({ type: 'keyDown', keyCode })
        wc.sendInputEvent({ type: 'keyUp', keyCode })
        return
      }
      case 'wait': {
        await new Promise((resolve) => setTimeout(resolve, Math.min(step.delayMs, 3000) / speed))
        return
      }
      default:
        return
    }
  }

  async dispose(): Promise<void> {
    this.recording = false
    if (this.view) {
      registry.delete(this.view.webContents.id)
      this.mainWindow.contentView.removeChildView(this.view)
      this.view.webContents.close()
      this.view = null
    }
  }
}

export function createWebAdapter(target: TestTarget, mainWindow: BrowserWindow): TargetAdapter {
  return new WebTargetAdapter(target, mainWindow)
}
