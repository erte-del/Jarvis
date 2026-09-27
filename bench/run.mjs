/**
 * Asks the brain behind the face bridge a fixed set of questions and records
 * how it did: how long until the first word, how long in total, what it said,
 * whether the answer passed its check, whether it changed the face, and what
 * it cost.
 *
 * It talks to the bridge exactly as the browser does, so it measures the whole
 * system as you use it, not the model alone. Start the bridge (and, for
 * OpenJarvis, the brain) first, then:
 *
 *   node bench/run.mjs                 # one pass over bench/questions.json
 *   node bench/run.mjs --runs 3        # three passes, for steadier timings
 *   node bench/run.mjs --only fact-gold,face-red
 *   node bench/run.mjs --model claude-opus-5   # label for the Claude brain
 *   node bench/run.mjs --tag thinking          # a name for this setup
 *
 * Which brain is running is read from the bridge. Results go to
 * bench/results/<brain>-<date>.json. Then run bench/report.mjs.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { cpus, totalmem, platform, arch, release } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { performance } from 'node:perf_hooks'
import { grade, looksSpoken, wordCount } from './checks.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))

let WebSocket
try {
  ;({ default: WebSocket } = await import('../face/node_modules/ws/wrapper.mjs'))
} catch {
  console.error('Run `npm install` in the face folder first. This script uses its WebSocket library.')
  process.exit(1)
}

// ---------------------------------------------------------------- options

const args = process.argv.slice(2)
const option = (name, fallback) => {
  const i = args.indexOf(`--${name}`)
  return i === -1 ? fallback : args[i + 1]
}
const RUNS = Math.max(1, Number(option('runs', 1)))
// A name for this setup, so two runs of one brain can sit side by side in the
// report: --tag improved, --tag thinking. Letters, digits and dashes only.
const TAG = option('tag', '').toLowerCase().replace(/[^a-z0-9-]/g, '')
const ONLY = option('only', '')
const TIMEOUT_MS = Number(option('timeout', 180)) * 1000
const BRIDGE_PORT = Number(process.env.JARVIS_BRIDGE_PORT ?? 8787)
const BRIDGE_WS = `ws://localhost:${BRIDGE_PORT}`
const BRIDGE_HTTP = `http://127.0.0.1:${BRIDGE_PORT}`
const OJ_URL = (process.env.OPENJARVIS_URL ?? 'http://127.0.0.1:8000').replace(/\/+$/, '')
// A local dev origin, which the bridge accepts — the same one the face uses.
const ORIGIN = 'http://localhost:5173'

const { tasks: allTasks } = JSON.parse(readFileSync(join(HERE, 'questions.json'), 'utf8'))
const tasks = ONLY ? allTasks.filter((t) => ONLY.split(',').includes(t.id)) : allTasks
if (!tasks.length) {
  console.error(`No task matches --only ${ONLY}`)
  process.exit(1)
}

// ---------------------------------------------------------------- talking to the bridge

/** Opens a socket and resolves with it and the bridge's `ready` frame. */
function open() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(BRIDGE_WS, { origin: ORIGIN })
    const timer = setTimeout(() => reject(new Error('the bridge did not answer')), 10_000)
    ws.once('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
    ws.once('message', (raw) => {
      clearTimeout(timer)
      const ready = JSON.parse(raw)
      // Let the connect-time frames (the OpenJarvis face sync) pass before
      // anything is measured, so they are not counted as the answer's.
      setTimeout(() => resolve({ ws, ready }), 400)
    })
  })
}

let asks = 0

/** Sends one message and records everything that comes back for it. */
function ask(ws, text) {
  return new Promise((resolve) => {
    const id = `bench-${++asks}`
    const out = { text: '', firstTextMs: null, totalMs: null, costUsd: null, tools: [], ui: [], calls: [], error: null }
    const start = performance.now()

    const finish = () => {
      clearTimeout(timer)
      ws.off('message', onMessage)
      resolve(out)
    }
    const timer = setTimeout(() => {
      out.error = `no answer after ${TIMEOUT_MS / 1000} seconds`
      finish()
    }, TIMEOUT_MS)

    const onMessage = (raw) => {
      const m = JSON.parse(raw)
      // Face changes carry no turn id; everything else must be this turn's.
      if (m.type === 'ui') return void out.ui.push({ op: m.op, args: m.args ?? {} })
      // Face tool calls with their arguments and replies. Only the OpenJarvis
      // bridge sends these; they show why a face command did nothing.
      if (m.type === 'mcp') return void out.calls.push({ name: m.name, args: m.args, reply: m.reply, isError: m.isError })
      if (m.ask !== id) return
      if (m.type === 'text') {
        out.firstTextMs ??= Math.round(performance.now() - start)
        out.text += m.delta ?? ''
      } else if (m.type === 'tool') {
        out.tools.push(m.name)
      } else if (m.type === 'done') {
        out.totalMs = Math.round(performance.now() - start)
        out.text = (out.text || m.text || '').trim()
        out.costUsd = m.costUsd ?? null
        finish()
      } else if (m.type === 'error') {
        out.totalMs = Math.round(performance.now() - start)
        out.error = m.message ?? 'error'
        finish()
      }
    }
    ws.on('message', onMessage)
    ws.send(JSON.stringify({ type: 'ask', text, id }))
  })
}

/**
 * Puts the face back to normal between tasks, so one task's colour does not
 * show up in the next task's prompt. Only the OpenJarvis bridge keeps face
 * state of its own; it is reset through the same MCP route OpenJarvis uses.
 */
async function resetFace() {
  const post = (body) =>
    fetch(`${BRIDGE_HTTP}/mcp/ui`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify(body),
    })
  const init = await post({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'bench', version: '1' } },
  })
  if (!init.ok) throw new Error(`face reset refused (${init.status})`)
  const call = await post({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'ui_reset', arguments: {} } })
  const body = await call.text()
  if (!call.ok || body.includes('"error"')) throw new Error(`face reset failed: ${body.slice(0, 200)}`)
}

// ---------------------------------------------------------------- run

async function describeBrain() {
  const { ws, ready } = await open()
  ws.close()
  const servers = (ready.servers ?? []).map((s) => (typeof s === 'string' ? s : s?.name))
  if (servers.length === 1 && servers[0] === 'openjarvis') {
    let model = option('model', '')
    let agent = ''
    try {
      const info = await (await fetch(`${OJ_URL}/v1/info`)).json()
      model ||= info.model ?? ''
      agent = info.agent ?? ''
    } catch {
      console.error(`OpenJarvis is not reachable at ${OJ_URL}. Start it first.`)
      process.exit(1)
    }
    return { brain: 'openjarvis', model: model || 'unknown', agent }
  }
  // The Claude bridge does not say which model it runs; it is whatever
  // JARVIS_MODEL was set to when it started, claude-opus-5 by default.
  return { brain: 'claude', model: option('model', process.env.JARVIS_MODEL ?? 'claude-opus-5'), agent: 'claude-code' }
}

async function runTask(task, meta) {
  if (meta.brain === 'openjarvis') await resetFace()
  const { ws } = await open()
  const steps = task.steps ?? [task.ask]
  const stepResults = []
  try {
    for (const text of steps) stepResults.push(await ask(ws, text))
  } finally {
    ws.close()
  }
  // Checks and timings are for the last step: the earlier ones set it up.
  const last = stepResults.at(-1)
  return {
    ...last,
    words: wordCount(last.text),
    spoken: looksSpoken(last.text),
    ...grade(task, last),
    setup: stepResults.slice(0, -1).map((r) => ({ text: r.text, error: r.error, ui: r.ui, calls: r.calls })),
  }
}

const meta = await describeBrain()
console.log(`Brain: ${meta.brain} · model ${meta.model}${meta.agent ? ` · agent ${meta.agent}` : ''}`)
console.log(`${tasks.length} tasks × ${RUNS} run(s)\n`)

// The first request to a local model loads it into memory, which can take
// many seconds. That is a one-off cost, not a fair answer time, so it is paid
// here and not recorded.
process.stdout.write('Warm-up … ')
{
  if (meta.brain === 'openjarvis') await resetFace()
  const { ws } = await open()
  const warm = await ask(ws, 'Say hello.')
  ws.close()
  console.log(warm.error ? `failed: ${warm.error}` : `done in ${(warm.totalMs / 1000).toFixed(1)} s\n`)
}

const results = []
for (let run = 1; run <= RUNS; run++) {
  for (const task of tasks) {
    const r = await runTask(task, meta)
    results.push({ id: task.id, category: task.category, ask: task.steps?.at(-1) ?? task.ask, run, ...r })
    const time = r.totalMs == null ? '   —  ' : `${(r.totalMs / 1000).toFixed(1).padStart(5)} s`
    const notes = [...r.reasons, ...r.styleIssues.map((i) => `style: ${i}`)]
    console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${time}  ${task.id}${notes.length ? `  (${notes.join('; ')})` : ''}`)
  }
}

if (meta.brain === 'openjarvis') await resetFace()

const passed = results.filter((r) => r.pass).length
console.log(`\n${passed} of ${results.length} passed.`)

const cpu = cpus()[0]?.model ?? 'unknown'
const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19)
const outDir = join(HERE, 'results')
mkdirSync(outDir, { recursive: true })
const setup = TAG ? `${meta.brain}-${TAG}` : meta.brain
const file = join(outDir, `${setup}-${stamp}.json`)
writeFileSync(
  file,
  JSON.stringify(
    {
      ...meta,
      tag: TAG,
      date: new Date().toISOString(),
      runs: RUNS,
      machine: { platform: platform(), release: release(), arch: arch(), cpu, memoryGB: Math.round(totalmem() / 2 ** 30) },
      results,
    },
    null,
    1,
  ),
)
console.log(`Saved ${file}\nNext: node bench/report.mjs`)
