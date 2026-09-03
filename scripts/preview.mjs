#!/usr/bin/env node
// Starts the project's dev server, proxies it, and serves the font picker shell
// on top of it. The app runs in an iframe on the same origin, so the shell can
// reach into it directly to apply fonts — nothing is injected into the response.
//
// Exits after the user applies a selection, writing it to SELECTION_FILE.

import { createServer, request as httpRequest } from 'node:http'
import { connect, createConnection } from 'node:net'
import { spawn } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { existsSync, readFileSync } from 'node:fs'
import { join, dirname, extname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const SHELL_DIR = join(HERE, 'shell')
const ROOT = join(HERE, '..')
const PREFIX = '/__fonts'
const SELECTION_FILE = '.fonts-selection.json'

const cwd = process.argv[2] ? resolve(process.argv[2]) : process.cwd()

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
}

// --- dev server -------------------------------------------------------------

function findDevCommand(dir) {
  const pkgPath = join(dir, 'package.json')
  if (!existsSync(pkgPath)) return null
  let pkg
  try {
    pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
  } catch {
    return null
  }
  const script = ['dev', 'start', 'serve'].find((s) => pkg.scripts?.[s])
  if (!script) return null
  const agent = existsSync(join(dir, 'pnpm-lock.yaml'))
    ? 'pnpm'
    : existsSync(join(dir, 'yarn.lock'))
      ? 'yarn'
      : existsSync(join(dir, 'bun.lockb'))
        ? 'bun'
        : 'npm'
  return { agent, script, args: agent === 'npm' ? ['run', script] : [script] }
}

function killTree(child) {
  if (!child || child.exitCode !== null) return
  try {
    process.kill(-child.pid, 'SIGTERM')
  } catch {
    try {
      child.kill('SIGTERM')
    } catch {}
  }
}

function waitForPort(port, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs
  return new Promise((res, rej) => {
    const attempt = () => {
      const sock = createConnection({ port, host: '127.0.0.1' })
      sock.once('connect', () => {
        sock.destroy()
        res()
      })
      sock.once('error', () => {
        sock.destroy()
        if (Date.now() > deadline) rej(new Error(`port ${port} never opened`))
        else setTimeout(attempt, 250)
      })
    }
    attempt()
  })
}

// Dev servers announce themselves on stdout; that line is the only reliable
// way to learn the port, since most of them fall back when the default is taken.
function startDev(dir) {
  const found = findDevCommand(dir)
  if (!found) return Promise.resolve(null)

  // detached puts the package manager in its own process group, so killTree can
  // take the dev server down with it. Signalling the manager alone can leave the
  // real server orphaned and holding the port.
  const child = spawn(found.agent, found.args, {
    cwd: dir,
    env: { ...process.env, FORCE_COLOR: '0', BROWSER: 'none' },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  })

  return new Promise((res) => {
    let settled = false
    const done = (port) => {
      if (settled) return
      settled = true
      res(port ? { child, port } : null)
    }

    const scan = (buf) => {
      const text = buf.toString()
      process.stderr.write(text)
      const m = text.match(/(?:localhost|127\.0\.0\.1|\[::1\]):(\d{2,5})/)
      if (m) done(Number(m[1]))
    }

    child.stdout.on('data', scan)
    child.stderr.on('data', scan)
    child.on('error', () => done(null))
    child.on('exit', () => done(null))
    setTimeout(() => done(null), 30000)
  })
}

// --- shell + proxy ----------------------------------------------------------

async function serveShell(req, res, url) {
  const rel = url.pathname.slice(PREFIX.length) || '/'

  if (rel === '/fonts.json') {
    const body = await readFile(join(ROOT, 'fonts.json'))
    res.writeHead(200, { 'content-type': MIME['.json'] })
    return res.end(body)
  }

  const name = rel === '/' ? 'index.html' : rel.replace(/^\/+/, '')
  const file = join(SHELL_DIR, name)
  if (!file.startsWith(SHELL_DIR) || !existsSync(file)) {
    res.writeHead(404)
    return res.end('not found')
  }
  res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' })
  res.end(await readFile(file))
}

// X-Frame-Options and frame-ancestors would stop the app being framed at all.
// The rest of CSP goes too: a style-src or font-src policy blocks the Google
// Fonts request the preview depends on. This is a dev-only proxy, so nothing
// downstream relies on the policy holding.
function stripFraming(headers) {
  const out = { ...headers }
  delete out['x-frame-options']
  delete out['content-security-policy']
  delete out['content-security-policy-report-only']
  return out
}

function start({ devPort, onApply, onDone }) {
  // Long-poll: a caller hangs here until the next apply. That's how the skill
  // learns about each selection without polling — its request simply completes.
  let waiters = []
  const flush = (body) => {
    const pending = waiters
    waiters = []
    for (const res of pending) {
      res.writeHead(200, { 'content-type': MIME['.json'] })
      res.end(JSON.stringify(body))
    }
  }

  // Someone choosing fonts can idle far longer than a caller can hold a request
  // open, so release the poll periodically with a no-op rather than letting it
  // time out as an error. The caller re-issues it.
  setInterval(() => flush({ event: 'idle' }), 90_000).unref()

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost')

    if (url.pathname === `${PREFIX}/apply` && req.method === 'POST') {
      const chunks = []
      for await (const c of req) chunks.push(c)
      let payload
      try {
        payload = JSON.parse(Buffer.concat(chunks).toString() || '{}')
      } catch {
        res.writeHead(400, { 'content-type': MIME['.json'] })
        return res.end('{"error":"bad json"}')
      }
      res.writeHead(200, { 'content-type': MIME['.json'] })
      res.end('{"ok":true}')
      await onApply(payload)
      return flush({ event: 'apply', selection: payload })
    }

    if (url.pathname === `${PREFIX}/wait`) {
      req.on('close', () => {
        waiters = waiters.filter((w) => w !== res)
      })
      return waiters.push(res)
    }

    if (url.pathname === `${PREFIX}/done` && req.method === 'POST') {
      res.writeHead(200, { 'content-type': MIME['.json'] })
      res.end('{"ok":true}')
      flush({ event: 'done' })
      return onDone()
    }

    // Tells the shell whether anyone is going to act on an apply, so the button
    // can say "Apply to code" only when that's true.
    if (url.pathname === `${PREFIX}/session`) {
      res.writeHead(200, { 'content-type': MIME['.json'] })
      return res.end(JSON.stringify({ watched: process.env.FONTS_SKILL === '1' }))
    }

    if (url.pathname === PREFIX || url.pathname.startsWith(`${PREFIX}/`)) {
      return serveShell(req, res, url)
    }

    // No dev server: the shell's own specimen page stands in for the app.
    if (!devPort) {
      return serveShell(req, res, new URL(`${PREFIX}/specimen.html`, 'http://localhost'))
    }

    const proxyReq = httpRequest(
      {
        host: '127.0.0.1',
        port: devPort,
        path: req.url,
        method: req.method,
        headers: { ...req.headers, host: `127.0.0.1:${devPort}` },
      },
      (upstream) => {
        res.writeHead(upstream.statusCode ?? 502, stripFraming(upstream.headers))
        upstream.pipe(res)
      },
    )
    proxyReq.on('error', () => {
      if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain' })
      res.end('dev server unreachable')
    })
    req.pipe(proxyReq)
  })

  // HMR rides on websockets; without this the framed app stops live-reloading.
  server.on('upgrade', (req, socket, head) => {
    if (!devPort) return socket.destroy()
    const upstream = connect(devPort, '127.0.0.1', () => {
      upstream.write(`${req.method} ${req.url} HTTP/1.1\r\n`)
      for (let i = 0; i < req.rawHeaders.length; i += 2) {
        upstream.write(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}\r\n`)
      }
      upstream.write('\r\n')
      if (head?.length) upstream.write(head)
      upstream.pipe(socket)
      socket.pipe(upstream)
    })
    upstream.on('error', () => socket.destroy())
    socket.on('error', () => upstream.destroy())
  })

  return server
}

function listen(server, port) {
  return new Promise((res, rej) => {
    server.once('error', (err) => (err.code === 'EADDRINUSE' ? res(null) : rej(err)))
    server.listen(port, '127.0.0.1', () => res(port))
  })
}

// --- main -------------------------------------------------------------------

const dev = await startDev(cwd)
if (!dev) {
  console.error('No dev server found or it failed to start — using the specimen page.')
} else {
  // Proceeding past a port that never opened means every request 502s with no
  // explanation, which is a worse failure than stopping here.
  try {
    await waitForPort(dev.port)
  } catch {
    console.error(
      `\nThe dev server announced port ${dev.port} but never accepted a connection.\n` +
        `Check that it starts cleanly on its own, then run this again.\n`,
    )
    killTree(dev.child)
    process.exit(1)
  }
}

let server
let port = null
for (let candidate = 7373; candidate < 7383 && port === null; candidate++) {
  server = start({
    devPort: dev?.port ?? null,
    // Applying no longer ends the session — the user can keep changing fonts and
    // apply again, and the code written between rounds reloads through HMR.
    onApply: async (payload) => {
      await writeFile(join(cwd, SELECTION_FILE), JSON.stringify(payload, null, 2) + '\n')
      console.error(`Selection written to ${SELECTION_FILE}`)
    },
    onDone: () => setTimeout(shutdown, 150),
  })
  port = await listen(server, candidate)
}

if (port === null) {
  console.error('Could not bind a port in 7373-7382.')
  process.exit(1)
}

console.error(`\n  Font picker  →  http://localhost:${port}${PREFIX}/\n`)

const shutdown = () => {
  killTree(dev?.child)
  server.close()
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
