import { useEffect, useRef, useState } from 'react'
import StatusBar from './components/StatusBar'
import TabBar from './components/TabBar'
import CoursesView from './views/CoursesView'
import DueView from './views/DueView'
import MailView from './views/MailView'
import MoneyView from './views/MoneyView'
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
  const { dashboard, error, canRefresh, connect } = useDashboard()
  const [tab, setTab] = useState<TabId>(startTab)
  const [done, setDone] = useState(loadCompletion)
  const scroller = useRef<HTMLDivElement>(null)

  // Each tab is its own screen — arrive at the top of it.
  useEffect(() => {
    scroller.current?.scrollTo({ top: 0 })
  }, [tab])

  useEffect(() => {
    saveCompletion(done)
  }, [done])

  const toggleDone = (id: string) =>
    setDone((prev) => ({ ...prev, [id]: !prev[id] }))

  return (
    <div className="ld-stage">
      <div className="ld-phone">
        <StatusBar />

        <main className="ld-scroll" ref={scroller}>
          {tab === 'today' && (
            <TodayView
              userName={userName}
              dashboard={dashboard}
              onConnect={connect}
              canRefresh={canRefresh}
              error={error}
            />
          )}
          {tab === 'courses' && (
            <CoursesView dashboard={dashboard} onConnect={connect} error={error} />
          )}
          {tab === 'due' && (
            <DueView dashboard={dashboard} done={done} onToggle={toggleDone} />
          )}
          {tab === 'inbox' && <MailView dashboard={dashboard} />}
          {tab === 'money' && <MoneyView dashboard={dashboard} />}
        </main>

        <TabBar active={tab} onChange={setTab} />
      </div>
    </div>
  )
}
