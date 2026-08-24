import type { TabId } from '../data/types'

const TABS: { id: TabId; label: string }[] = [
  { id: 'today', label: 'TODAY' },
  { id: 'courses', label: 'COURSES' },
  { id: 'due', label: 'DUE' },
  { id: 'inbox', label: 'MAIL' },
]

interface Props {
  active: TabId
  onChange: (tab: TabId) => void
}

export default function TabBar({ active, onChange }: Props) {
  return (
    <nav className="ld-tabs" aria-label="Sections">
      {TABS.map(({ id, label }) => {
        const current = id === active
        return (
          <button
            key={id}
            type="button"
            className="ld-tab"
            aria-current={current ? 'page' : undefined}
            onClick={() => onChange(id)}
          >
            {label}
            {current && <i className="ld-tab__marker" aria-hidden="true" />}
          </button>
        )
      })}
    </nav>
  )
}
