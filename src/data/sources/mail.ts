/**
 * Unread mail → the INBOX screen.
 *
 * Grouped by sender, because that is the axis a morning triage actually runs
 * on: five things from the registrar are one decision, not five.
 *
 * A note on what is deliberately *not* here. The screen's design has a notion
 * of a thread that "wants a reply", and nothing in Gmail's metadata can tell us
 * that — reading bodies to guess would be both a bigger permission and a worse
 * answer. So emphasis goes to what is verifiable instead: mail that arrived
 * today. The tag says which course a message is about when the subject line
 * says so, and how old it is when it doesn't.
 */
import type { RawMessage } from '../payload'
import type { Cluster } from '../types'
import { parseCourse } from './calendar'

/** Beyond this the screen stops being a summary. */
const MAX_CLUSTERS = 12

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate())

const daysAgo = (at: number, now: Date) =>
  Math.round((startOfDay(now).getTime() - startOfDay(new Date(at)).getTime()) / 86_400_000)

function ageLabel(at: number, now: Date): string {
  const days = daysAgo(at, now)
  if (days <= 0) return 'TODAY'
  if (days === 1) return 'YESTERDAY'
  return `${days} DAYS AGO`
}

export function toClusters(messages: RawMessage[], now: Date = new Date()): Cluster[] {
  const bySender = new Map<string, RawMessage[]>()
  for (const m of messages) {
    const key = m.address.toLowerCase() || m.from.toLowerCase()
    const list = bySender.get(key)
    if (list) list.push(m)
    else bySender.set(key, [m])
  }

  return [...bySender.entries()]
    .map(([key, group]): Cluster => {
      const sorted = [...group].sort((a, b) => b.date - a.date)
      const newest = sorted[0]
      const course = sorted.map((m) => parseCourse(m.subject, now)).find(Boolean)
      const rest = sorted.length - 1

      return {
        id: key,
        name: newest.from,
        count: `${sorted.length} UNREAD`,
        summary: rest > 0 ? `${newest.subject} · and ${rest} more` : newest.subject,
        tag: course?.code.toUpperCase() ?? ageLabel(newest.date, now),
        live: daysAgo(newest.date, now) <= 0,
      }
    })
    .sort((a, b) => {
      // Newest sender first; the date lives on the messages, so compare through
      // the group rather than the cluster.
      const at = (id: string) =>
        Math.max(...bySender.get(id)!.map((m) => m.date))
      return at(b.id) - at(a.id)
    })
    .slice(0, MAX_CLUSTERS)
}
