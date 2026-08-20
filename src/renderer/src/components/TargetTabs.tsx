import type { MacroTarget } from '../../../shared/types'

interface Props {
  targets: MacroTarget[]
  activeId: string
  onSelect: (id: string) => void
  disabled?: boolean
}

export default function TargetTabs({ targets, activeId, onSelect, disabled }: Props): React.JSX.Element {
  return (
    <div className="target-tabs">
      {targets.map((t) => (
        <button
          key={t.id}
          className={t.id === activeId ? 'active' : ''}
          disabled={disabled}
          onClick={() => onSelect(t.id)}
          title={t.label}
        >
          <span className="badge">{t.kind === 'web' ? 'WEB' : 'APP'}</span>
        </button>
      ))}
    </div>
  )
}
