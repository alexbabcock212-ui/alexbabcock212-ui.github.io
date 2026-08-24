/**
 * Which deadlines you've ticked off, remembered across launches.
 *
 * Scoped to the day: the brief is rebuilt each morning, so yesterday's ticks
 * shouldn't carry into it. Every access is guarded — Safari throws on
 * localStorage in private mode, and the render check runs under Node.
 */
const KEY = 'life-dashboard:completion'

export type Completion = Record<string, boolean>

interface Stored {
  date: string
  done: Completion
}

const today = () => new Date().toISOString().slice(0, 10)

export function loadCompletion(): Completion {
  try {
    const raw = globalThis.localStorage?.getItem(KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Stored
    return parsed?.date === today() ? (parsed.done ?? {}) : {}
  } catch {
    return {}
  }
}

export function saveCompletion(done: Completion): void {
  try {
    const payload: Stored = { date: today(), done }
    globalThis.localStorage?.setItem(KEY, JSON.stringify(payload))
  } catch {
    // Storage full or blocked — ticking still works for this session.
  }
}
