// Runs as an Electron utilityProcess (its own Node-ABI process), isolating pty IO
// and crashes from the UI. Talks to main over the parentPort message channel.
import * as pty from 'node-pty'
import type { HostInbound, HostOutbound } from '../shared/types'

const port: Electron.ParentPort = (process as unknown as { parentPort: Electron.ParentPort }).parentPort

interface Entry {
  p: pty.IPty
  buf: string
  timer: NodeJS.Timeout | null
  // True once we kill the pty deliberately (re-create / dispose) — suppresses the
  // resulting onExit so the UI only shows a "disconnected" overlay on a REAL exit.
  suppressed: boolean
}

const ptys = new Map<string, Entry>()

function send(msg: HostOutbound): void {
  port.postMessage(msg)
}

function flush(id: string): void {
  const e = ptys.get(id)
  if (!e) return
  if (e.timer) {
    clearTimeout(e.timer)
    e.timer = null
  }
  if (e.buf) {
    send({ type: 'data', ptyId: id, data: e.buf })
    e.buf = ''
  }
}

function kill(id: string): void {
  const e = ptys.get(id)
  if (!e) return
  e.suppressed = true // deliberate kill: don't emit an exit/overlay
  flush(id)
  try {
    e.p.kill()
  } catch {
    /* already gone */
  }
  ptys.delete(id)
}

function create(msg: Extract<HostInbound, { type: 'create' }>): void {
  // A window reload re-issues create for the same id; drop the stale client first.
  if (ptys.has(msg.ptyId)) kill(msg.ptyId)
  let p: pty.IPty
  try {
    p = pty.spawn(msg.file, msg.args, {
      name: 'xterm-256color',
      cols: msg.cols || 80,
      rows: msg.rows || 24,
      cwd: msg.cwd || msg.env.HOME || process.cwd(),
      env: msg.env
    })
  } catch (err) {
    send({ type: 'exit', ptyId: msg.ptyId, exitCode: -1, error: String(err) })
    return
  }

  const entry: Entry = { p, buf: '', timer: null, suppressed: false }
  ptys.set(msg.ptyId, entry)
  send({ type: 'spawned', ptyId: msg.ptyId, pid: p.pid })

  // Coalesce output bursts: buffer and flush on a short timer (or when large) to
  // cap IPC message count under flood (e.g. `yes`, large logs).
  p.onData((d) => {
    entry.buf += d
    if (entry.buf.length > 256 * 1024) {
      flush(msg.ptyId)
      return
    }
    if (!entry.timer) entry.timer = setTimeout(() => flush(msg.ptyId), 4)
  })
  p.onExit(({ exitCode }) => {
    if (entry.suppressed) return // we killed it on purpose; stay quiet
    flush(msg.ptyId)
    send({ type: 'exit', ptyId: msg.ptyId, exitCode })
    ptys.delete(msg.ptyId)
  })
}

port.on('message', (e: Electron.MessageEvent) => {
  const msg = e.data as HostInbound
  switch (msg.type) {
    case 'create':
      create(msg)
      break
    case 'input':
      ptys.get(msg.ptyId)?.p.write(msg.data)
      break
    case 'resize': {
      const e2 = ptys.get(msg.ptyId)
      if (e2) {
        try {
          e2.p.resize(msg.cols || 80, msg.rows || 24)
        } catch {
          /* resize race during teardown */
        }
      }
      break
    }
    case 'kill':
      kill(msg.ptyId)
      break
  }
})
