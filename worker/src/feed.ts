/**
 * One source's result.
 *
 * Every read this Worker performs is best-effort and reports its own failure:
 * a dead news feed must not blank the timetable, so a source returns
 * `{ ok: false, error }` instead of throwing and taking the payload with it.
 */
export interface Feed<T> {
  ok: boolean
  items: T[]
  error?: string
}

export const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** Run a read and turn a throw into a reported failure. */
export async function settle<T>(read: Promise<T[]>): Promise<Feed<T>> {
  try {
    return { ok: true, items: await read }
  } catch (e) {
    return { ok: false, items: [], error: message(e) }
  }
}
