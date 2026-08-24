/**
 * The Desktop scan, as the app sees it.
 *
 * `courses.generated.json` is written by `npm run scan` on the Mac and baked
 * into the bundle. It is a snapshot from deploy time, so the app never claims
 * it is live — the Courses screen prints when it was taken.
 */
import generated from './courses.generated.json'
import type { CourseFolder } from './types'
import type { Term } from './sources/term'

interface Scan {
  scannedAt: number
  root: string
  /** True when the scan recorded section names and counts but no filenames. */
  redacted: boolean
  /** Term dates, needed to answer "which week is it". */
  term: Term | null
  courses: CourseFolder[]
}

const scan = generated as unknown as Scan

export const courseFolders: CourseFolder[] = scan.courses ?? []
/** Epoch ms, or null when no scan has run yet. */
export const scannedAt: number | null = scan.scannedAt || null
export const scanRoot: string = scan.root ?? '~/Desktop/Courses'
export const scanRedacted: boolean = scan.redacted ?? false
export const term: Term | null = scan.term ?? null
