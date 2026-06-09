import { app } from 'electron'
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PersistedState } from '../shared/types'

const file = (): string => join(app.getPath('userData'), 'workspace.json')

let pending: PersistedState | null = null
let timer: NodeJS.Timeout | null = null

export function loadState(): PersistedState | null {
  try {
    const f = file()
    if (!existsSync(f)) return null
    return JSON.parse(readFileSync(f, 'utf8')) as PersistedState
  } catch (e) {
    console.error('[store] load failed', e)
    return null
  }
}

function writeNow(state: PersistedState): void {
  try {
    const tmp = file() + '.tmp'
    writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8')
    renameSync(tmp, file()) // atomic replace
  } catch (e) {
    console.error('[store] write failed', e)
  }
}

/** Debounced save — UI mutates state often during a drag/typing burst. */
export function saveStateDebounced(state: PersistedState): void {
  pending = state
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => {
    if (pending) writeNow(pending)
    pending = null
    timer = null
  }, 400)
}

/** Force any pending write to disk (call on quit). */
export function flushState(): void {
  if (timer) { clearTimeout(timer); timer = null }
  if (pending) { writeNow(pending); pending = null }
}
