import { useEffect, useRef, useState } from 'react'
import KeyGate from './components/KeyGate'
import StatusBar from './components/StatusBar'
import TabBar from './components/TabBar'
import CoursesView from './views/CoursesView'
import DueView from './views/DueView'
import MailView from './views/MailView'
import TodayView from './views/TodayView'
import { useDashboard } from './data/useDashboard'
import { loadCompletion, saveCompletion } from './data/completion'
import type { TabId } from './data/types'
import './styles/fonts.css'
import './styles/industry.css'
import './styles/app.css'

interface Props {
  userName?: string
  startTab?: TabId
}

export default function App({ userName = 'Alex', startTab = 'today' }: Props) {
  const { dashboard, error, busy, needsKey, rejected, refresh, installKey } = useDashboard()
  const [tab, setTab] = useState<TabId>(startTab)
  const [done, setDone] = useState(loadCompletion)
  const [setupOpen, setSetupOpen] = useState(false)
  const scroller = useRef<HTMLDivElement>(null)

  // Each tab is its own screen — arrive at the top of it.
  useEffect(() => {
    scroller.current?.scrollTo({ top: 0 })
  }, [tab])

  useEffect(() => {
    saveCompletion(done)
  }, [done])

  const toggleDone = (id: string) => setDone((prev) => ({ ...prev, [id]: !prev[id] }))

  const openSetup = () => setSetupOpen(true)

  return (
    <div className="ld-stage">
      <div className="ld-phone">
        <StatusBar />

        <main className="ld-scroll" ref={scroller}>
          {tab === 'today' && (
            <TodayView
              userName={userName}
              dashboard={dashboard}
              needsKey={needsKey}
              busy={busy}
              onSetUp={openSetup}
              onRefresh={() => refresh(true)}
              error={error}
            />
          )}
          {tab === 'courses' && (
            <CoursesView dashboard={dashboard} needsKey={needsKey} onSetUp={openSetup} error={error} />
          )}
          {tab === 'due' && (
            <DueView
              dashboard={dashboard}
              done={done}
              onToggle={toggleDone}
              needsKey={needsKey}
              onSetUp={openSetup}
            />
          )}
          {tab === 'inbox' && (
            <MailView dashboard={dashboard} needsKey={needsKey} onSetUp={openSetup} />
          )}
        </main>

        <TabBar active={tab} onChange={setTab} />

        {setupOpen && (
          <KeyGate
            rejected={rejected}
            onClose={() => setSetupOpen(false)}
            onInstall={(key) => {
              installKey(key)
              setSetupOpen(false)
            }}
          />
        )}
      </div>
    </div>
  )
}
