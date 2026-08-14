import { useLayoutEffect, useRef, useState } from 'react'

/**
 * 表示先の画面は幅が狭くスクロールもあるため、常に「アイコンの下」にツールチップを
 * 開くCSSだけだと下端付近の項目でウィンドウ外・スクロール領域外にはみ出て見えなくなる。
 * 表示時にアイコン位置とツールチップの実サイズを測り、画面下端に収まらなければ上に開き、
 * 左右も画面内に収まるようposition:fixedで座標を計算し直す。
 */
export default function HelpIcon({ text }: { text: string }): React.JSX.Element {
  const lines = text.split('\n')
  const iconRef = useRef<HTMLSpanElement>(null)
  const tooltipRef = useRef<HTMLSpanElement>(null)
  const [visible, setVisible] = useState(false)
  const [style, setStyle] = useState<React.CSSProperties>({})

  useLayoutEffect(() => {
    if (!visible) return
    const icon = iconRef.current
    const tooltip = tooltipRef.current
    if (!icon || !tooltip) return
    const margin = 8
    const gap = 6
    const iconRect = icon.getBoundingClientRect()
    const tooltipRect = tooltip.getBoundingClientRect()

    const spaceBelow = window.innerHeight - iconRect.bottom
    const openUp = spaceBelow < tooltipRect.height + margin + gap && iconRect.top > tooltipRect.height + margin + gap
    const top = openUp ? iconRect.top - tooltipRect.height - gap : iconRect.bottom + gap

    let left = iconRect.left
    const maxLeft = window.innerWidth - tooltipRect.width - margin
    left = Math.min(left, Math.max(margin, maxLeft))
    left = Math.max(left, margin)

    setStyle({ position: 'fixed', top, left })
  }, [visible])

  return (
    <span
      className="help-icon"
      tabIndex={0}
      ref={iconRef}
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
      onFocus={() => setVisible(true)}
      onBlur={() => setVisible(false)}
    >
      ?
      <span
        className={`help-icon-tooltip${visible ? ' help-icon-tooltip-visible' : ''}`}
        ref={tooltipRef}
        style={visible ? style : undefined}
      >
        {lines.map((line, i) => (
          <span className="help-icon-tooltip-line" key={i}>
            {line}
          </span>
        ))}
      </span>
    </span>
  )
}
