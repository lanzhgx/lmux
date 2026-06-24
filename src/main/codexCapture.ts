import { readdirSync, openSync, readSync, closeSync, statSync, realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

// codex auto-generates its own session id (no preset flag), so to restore a SPECIFIC
// codex session per pane we capture the id right after the session starts. codex writes
// ~/.codex/sessions/YYYY/MM/DD/rollout-<ts>-<UUID>.jsonl whose first line is a
// `session_meta` record carrying { id, cwd }. We watch for the new file matching the
// pane's cwd. A shared "claimed" set prevents two panes started in the same dir from
// grabbing the same file.

const claimed = new Set<string>()

function sessionsDir(): string {
  const home = process.env.CODEX_HOME || join(homedir(), '.codex')
  return join(home, 'sessions')
}

function listRollouts(dir: string): string[] {
  const out: string[] = []
  const walk = (d: string): void => {
    let entries: import('node:fs').Dirent[]
    try {
      entries = readdirSync(d, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      const p = join(d, e.name)
      if (e.isDirectory()) walk(p)
      else if (e.isFile() && e.name.startsWith('rollout-') && e.name.endsWith('.jsonl')) out.push(p)
    }
  }
  walk(dir)
  return out
}

/**
 * Read line 1 of a rollout file (the session_meta record). codex's session_meta can be
 * ~22KB (it embeds base_instructions), so read in chunks until the first newline rather
 * than a fixed buffer — a short fixed read truncates the JSON and parsing always fails.
 */
function readFirstLine(file: string): string | null {
  let fd: number | null = null
  try {
    fd = openSync(file, 'r')
    const chunks: Buffer[] = []
    const buf = Buffer.alloc(65536)
    let pos = 0
    const cap = 1024 * 1024 // 1MB safety cap
    while (pos < cap) {
      const n = readSync(fd, buf, 0, buf.length, pos)
      if (n <= 0) break
      const nl = buf.subarray(0, n).indexOf(0x0a)
      if (nl >= 0) {
        chunks.push(Buffer.from(buf.subarray(0, nl)))
        return Buffer.concat(chunks).toString('utf8')
      }
      chunks.push(Buffer.from(buf.subarray(0, n)))
      pos += n
    }
    return chunks.length ? Buffer.concat(chunks).toString('utf8') : null
  } catch {
    return null
  } finally {
    if (fd !== null) {
      try {
        closeSync(fd)
      } catch {
        /* noop */
      }
    }
  }
}

function readMeta(file: string): { id?: string; cwd?: string } | null {
  const line = readFirstLine(file)
  if (!line) return null
  try {
    const obj = JSON.parse(line)
    if (obj?.type === 'session_meta') return { id: obj.payload?.id, cwd: obj.payload?.cwd }
  } catch {
    /* partial write / not yet flushed — try again next tick */
  }
  return null
}

function resolveCwd(cwd?: string): string {
  let c = cwd && cwd.trim() ? cwd : homedir()
  if (c === '~') c = homedir()
  else if (c.startsWith('~/')) c = join(homedir(), c.slice(2))
  try {
    return realpathSync(c)
  } catch {
    return c
  }
}

/**
 * Watch for the codex session created in `cwd` after this call, and report its id via
 * `onCaptured`. Best-effort: gives up after `timeoutMs` (pane then keeps starting fresh
 * codex and retries on the next reconnect). `nowMs` is passed in (Date.now from caller).
 */
export function armCodexCapture(
  cwd: string | undefined,
  nowMs: number,
  onCaptured: (sessionId: string) => void,
  timeoutMs = 60000
): void {
  const dir = sessionsDir()
  const target = resolveCwd(cwd)
  const baseline = new Set(listRollouts(dir))
  const deadline = nowMs + timeoutMs

  const tick = (): void => {
    const candidates: { path: string; id: string }[] = []
    for (const p of listRollouts(dir)) {
      if (baseline.has(p) || claimed.has(p)) continue
      // Only files created AFTER we armed can be this pane's session — excludes
      // pre-existing sessions and older foreign ones.
      try {
        if (statSync(p).mtimeMs < nowMs) continue
      } catch {
        continue
      }
      const meta = readMeta(p)
      if (!meta?.id) continue
      let mc = meta.cwd
      if (mc) {
        try {
          mc = realpathSync(mc)
        } catch {
          /* keep raw */
        }
      }
      if (mc && mc !== target) continue
      candidates.push({ path: p, id: meta.id })
    }
    // Claim ONLY when exactly one candidate matches; never guess between several.
    // Two codex panes in the same dir would otherwise swap ids. If ambiguous we wait:
    // as each watcher claims its file the set shrinks; if it never resolves we time out
    // and the pane simply keeps starting fresh codex (no silent mis-attribution).
    if (candidates.length === 1) {
      claimed.add(candidates[0].path)
      onCaptured(candidates[0].id)
      return
    }
    if (Date.now() < deadline) setTimeout(tick, 600)
  }
  setTimeout(tick, 600)
}
