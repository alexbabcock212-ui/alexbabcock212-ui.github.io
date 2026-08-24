import EmptyState from '../components/EmptyState'
import type { Dashboard } from '../data/types'

interface Props {
  dashboard: Dashboard
  done: Record<string, boolean>
  onToggle: (id: string) => void
}

export default function DueView({ dashboard, done, onToggle }: Props) {
  const { tasks, deadlines } = dashboard
  const open = deadlines.filter((d) => !done[d.id]).length

  return (
    <div>
      <header className="ld-page-head">
        <div className="ld-kicker">NEXT 14 DAYS</div>
        <h1 className="ld-page-title">Deadlines</h1>
        {deadlines.length > 0 && (
          <p className="ld-page-sub">{open} open. Tap one when it's off your plate.</p>
        )}
      </header>

      {deadlines.length === 0 ? (
        <EmptyState
          kicker="TASKS"
          title={tasks === 'ready' ? 'Nothing due' : 'Not connected'}
          note={
            tasks === 'ready'
              ? 'Nothing lands in the next two weeks.'
              : 'Connect Google and anything due in the next two weeks collects here.'
          }
        />
      ) : (
        <ul className="ld-deadlines">
          {deadlines.map((d) => {
            const isDone = Boolean(done[d.id])
            return (
              <li key={d.id}>
                <button
                  type="button"
                  className={`ld-deadline${isDone ? ' is-done' : ''}`}
                  aria-pressed={isDone}
                  onClick={() => onToggle(d.id)}
                >
                  <span className="ld-deadline__box" aria-hidden="true" />
                  <span>
                    <span className="ld-deadline__course">{d.course}</span>
                    <span className="ld-deadline__title">{d.title}</span>
                    <span className="ld-deadline__note">{d.note}</span>
                  </span>
                  <span
                    className={`ld-deadline__when${d.urgent ? ' ld-deadline__when--urgent' : ''}`}
                  >
                    {d.when}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
