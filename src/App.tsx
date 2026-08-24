import { useEffect, useRef, useState } from 'react'
import StatusBar from './components/StatusBar'
import TabBar from './components/TabBar'
import CoursesView from './views/CoursesView'
import DueView from './views/DueView'
import MailView from './views/MailView'
import MoneyView from './views/MoneyView'
import TodayView from './views/TodayView'
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
          {tab === 'today' && <TodayView userName={userName} />}
          {tab === 'courses' && <CoursesView />}
          {tab === 'due' && <DueView done={done} onToggle={toggleDone} />}
          {tab === 'inbox' && <MailView />}
          {tab === 'money' && <MoneyView />}
        </main>

        <TabBar active={tab} onChange={setTab} />
      </div>
    </div>
  )
}
