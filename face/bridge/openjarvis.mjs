/**
 * The OpenJarvis brain.
 *
 * The default bridge runs Claude Code through the Agent SDK. This file is the
 * other option: it sends each question to a local OpenJarvis server (started
 * with `jarvis serve`) over its OpenAI-compatible /v1/chat/completions
 * endpoint, and relays the answer to the browser in the same frames the face
 * already understands — `ready`, `text`, `done`, `error`.
 *
 * Chosen with JARVIS_BRAIN=openjarvis. Read by bridge/server.mjs.
 *
 * The other direction runs over MCP. The same ui_* and display tools the
 * Claude path loads in-process are served here over HTTP, at /mcp/ui and
 * /mcp/display, so OpenJarvis can load them as outside MCP servers (see
 * config/openjarvis.toml). A call pushes its frame to every open face.
 *
 * Not carried over: the Chrome and camera servers. The camera has to ask the
 * browser and wait for a reply, which needs a turn to belong to.
 */

import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { displayServer } from './panels.mjs'
import { uiServer } from './ui.mjs'

export const OJ_URL = (process.env.OPENJARVIS_URL ?? 'http://127.0.0.1:8000').replace(/\/+$/, '')
const OJ_KEY = process.env.OPENJARVIS_API_KEY ?? ''

/**
 * How many earlier messages ride along with each question. The server is
 * stateless per request, so the conversation lives here, per socket. Small
 * local models have small context windows, so this is kept short.
 */
const HISTORY_LIMIT = Number(process.env.OPENJARVIS_HISTORY ?? 12)

/**
 * The browser abandons a turn after two minutes of silence. OpenJarvis agents
 * run their tool loop before sending anything, and a local model on a laptop
 * can take longer than that, so a frame goes out on this interval to prove the
 * turn is still alive. The browser ignores the frame type, but not the frame.
 */
const HEARTBEAT_MS = 15_000

/**
 * Much shorter than the Claude persona in server.mjs, because a local model
 * pays for every token of it on every turn. The tools' own descriptions carry
 * the detail of how to use them.
 */
const SYSTEM_PROMPT = `You are JARVIS, speaking out loud to one person.
Keep every answer short: one or two sentences, unless they asked you to read out data.
Give the answer first. Follow any length or format the user asks for exactly, and add nothing to it.
Plain spoken prose only. No markdown, lists, headings, emoji or asterisks.
Every word is read aloud, so write every number in words, never in digits:
say "twenty-six", not "26"; "half past nine", not "9:30". Write in English only.
Dry, calm, British service register. Address the user as "sir" now and then.
Never apologise and never say you are an AI model.
Never offer more help. Never say "let me know", "how can I assist", "feel free", or "I hope this helps".

The screen in front of the user is your own face. The ui_ tools change it.
Use a ui_ tool only when the user asks to change how you look. For every other question, call no tool.
The argument names: ui_theme takes accent, a colour. ui_reactor takes scale (above one is bigger)
and spin (above one is faster). ui_effect takes kind: glitch, pulse, scan, shake or flash.
ui_chrome takes systems or transcript: false hides that panel, true shows it. ui_reset takes nothing.
Pass only the settings the user asked for. Do not change anything else.
Every change is its own tool call: a new colour and a bigger core are two calls.
Say a change is done only after its tool replied that it was done. If a tool reply says
"No change", call it again with the arguments above.
A change the user asked for stays until the user asks to change it. Never undo it yourself.
Call ui_reset only when the user asks for normal or default.
A private note like [FACE STATUS: ...] may follow. It says how your face looks right now and is
always correct: trust it over your earlier replies. With no note, your face is normal.
The note is for you only. Never say it, quote it or describe it unless the user asks how you look.
Answer the new request, not an old one.
The blade tool opens an article, image or video on screen when the user asks to see something.`

/**
 * What the face looks like now, as the sum of every ui frame this bridge has
 * pushed. The model cannot see the screen and only hears its own earlier
 * words, so without this it answers "I am red" long after it isn't. Faces that
 * connect later are brought in line with it (see syncFace), so it stays true
 * across a page reload.
 */
const REACTOR_DEFAULTS = { color: null, scale: 1, intensity: 1, spin: 1, style: 'ring', visible: true }
const CHROME_NAMES = {
  systems: 'systems rail',
  transcript: 'transcript',
  toolBadge: 'tool badge',
  suggestions: 'suggestions',
  brand: 'wordmark',
}

const freshLook = () => ({
  accent: null,
  background: null,
  palette: {},
  reactor: {},
  chrome: {},
  orbits: new Map(),
})
let look = freshLook()

/** Same merge rules as applyUi in src/store.ts: null is a value, undefined is not. */
function track(op, args = {}) {
  if (op === 'reset') look = freshLook()
  if (op === 'patch') {
    if (args.accent !== undefined) look.accent = args.accent
    if (args.background !== undefined) look.background = args.background
    for (const key of ['palette', 'reactor', 'chrome']) {
      for (const [k, v] of Object.entries(args[key] ?? {})) {
        if (v !== undefined) look[key][k] = v
      }
    }
  }
  if (op === 'orbit') {
    if (args.action === 'add') look.orbits.set(args.id, args)
    else if (args.action === 'remove') look.orbits.delete(args.id)
    else look.orbits.clear()
  }
}

/**
 * The note is only added when the face is not at its defaults. A small model
 * given a status line on every turn read it out as its answer ("Your face right
 * now: completely normal") to questions that had nothing to do with the face.
 */
function describeLook() {
  const parts = []
  if (look.accent) parts.push(`colour ${look.accent}`)
  if (look.background) parts.push(`background ${look.background}`)
  for (const [phase, colour] of Object.entries(look.palette)) parts.push(`${phase} colour ${colour}`)
  for (const [k, v] of Object.entries(look.reactor)) {
    if (v !== REACTOR_DEFAULTS[k] && v !== null) parts.push(`core ${k} ${v}`)
  }
  for (const [k, v] of Object.entries(look.chrome)) {
    if (v === false) parts.push(`${CHROME_NAMES[k] ?? k} hidden`)
  }
  if (look.orbits.size) parts.push(`${look.orbits.size} image(s) in orbit`)
  return parts.length ? `[FACE STATUS: ${parts.join('; ')}; everything else normal]` : ''
}

/**
 * Takes the private note back out of a reply, in case the model repeats it
 * anyway. Every word of a reply is spoken, and nobody wants to hear the
 * bracketed status line.
 */
export function withoutNote(text) {
  return text
    .replace(/\[?\s*FACE STATUS:[^\]\n]*\]?/gi, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s+([.,!?])/g, '$1')
    .trim()
}

/** Brings a newly opened face to the tracked look. */
function syncFace(send) {
  send({ type: 'ui', op: 'reset', args: {} })
  const { accent, background, palette, reactor, chrome, orbits } = look
  send({ type: 'ui', op: 'patch', args: { accent, background, palette, reactor, chrome } })
  for (const orbit of orbits.values()) send({ type: 'ui', op: 'orbit', args: orbit })
}

/** Every open face in OpenJarvis mode. MCP tool calls are pushed to all of them. */
const faces = new Set()

/** When a face tool last changed something, for the empty-reply fallback. */
let lastUiAt = 0

function broadcast(msg) {
  const frame = JSON.stringify(msg)
  for (const socket of faces) {
    if (socket.readyState === socket.OPEN) socket.send(frame)
  }
}

/**
 * The MCP servers OpenJarvis can load, by path. Built fresh for every request:
 * the transport runs stateless, and an MCP server object serves one transport.
 * Frames match what the Claude path sends in server.mjs.
 */
const MCP_ROUTES = {
  '/mcp/ui': () =>
    uiServer(
      (op, args) => {
        track(op, args)
        lastUiAt = Date.now()
        broadcast({ type: 'ui', op, args })
      },
      { keepChanges: true },
    ),
  '/mcp/display': () =>
    displayServer(
      (panel) => broadcast({ type: 'panel', panel }),
      (blade) => broadcast({ type: 'blade', blade }),
    ),
}

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'])

/** True when this request is for one of the MCP routes above. */
export const isMcpRequest = (req) => Object.hasOwn(MCP_ROUTES, (req.url ?? '').split('?')[0])

/**
 * Serve one MCP request.
 *
 * Whoever reaches this can put things on the user's screen, so it is locked to
 * this machine, and to programs rather than pages: a browser always sends an
 * Origin header on a cross-site POST, and OpenJarvis never does. That also
 * shuts out the app's own pages — they have no business calling these tools.
 */
export async function handleMcp(req, res) {
  if (!LOOPBACK.has(req.socket.remoteAddress ?? '') || req.headers.origin) {
    console.warn('[jarvis] refused MCP request from', req.headers.origin ?? req.socket.remoteAddress)
    res.writeHead(403)
    return res.end('forbidden')
  }
  const server = MCP_ROUTES[req.url.split('?')[0]]()
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  })
  res.on('close', () => {
    void transport.close()
    void server.instance.close()
  })
  try {
    const body = await readJson(req)
    if (body?.method === 'tools/call') recordCall(body.params, res)
    await server.instance.connect(transport)
    await transport.handleRequest(req, res, body)
  } catch (err) {
    console.error('[jarvis] MCP request failed:', err)
    if (!res.headersSent) res.writeHead(500)
    res.end()
  }
}

/** The request body, parsed. Read here so the tool call can be recorded. */
async function readJson(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  const text = Buffer.concat(chunks).toString('utf8')
  return text ? JSON.parse(text) : undefined
}

/**
 * Logs one face tool call with its arguments and the tool's reply, and sends
 * it to the open faces as an `mcp` frame (the browser ignores it; the
 * benchmark records it). A local model that passes `color` where the tool
 * takes `accent` gets "No change" back and reports that it failed — this is
 * the only place that difference is visible.
 */
function recordCall(params, res) {
  const name = params?.name ?? '?'
  const args = params?.arguments ?? {}
  const chunks = []
  const write = res.write.bind(res)
  const end = res.end.bind(res)
  res.write = (chunk, ...rest) => {
    if (chunk) chunks.push(Buffer.from(chunk))
    return write(chunk, ...rest)
  }
  res.end = (chunk, ...rest) => {
    if (chunk && typeof chunk !== 'function') chunks.push(Buffer.from(chunk))
    let reply = ''
    let isError = false
    try {
      const raw = Buffer.concat(chunks).toString('utf8')
      const json = JSON.parse(raw.slice(raw.indexOf('{')))
      reply = (json.result?.content ?? []).map((c) => c.text ?? '').join(' ') || json.error?.message || ''
      isError = Boolean(json.result?.isError || json.error)
    } catch {
      // Unparseable reply: record the call without it.
    }
    console.log(`[jarvis] face tool ${name} ${JSON.stringify(args)} -> ${reply}`)
    broadcast({ type: 'mcp', name, args, reply, isError })
    return end(chunk, ...rest)
  }
}

const headers = () => ({
  'Content-Type': 'application/json',
  ...(OJ_KEY ? { Authorization: `Bearer ${OJ_KEY}` } : {}),
})

let resolvedModel = process.env.OPENJARVIS_MODEL ?? ''

/**
 * The request has to name a model. Unless OPENJARVIS_MODEL says otherwise,
 * use whatever the server itself was started with, and fall back to the first
 * model it lists.
 */
async function modelName() {
  if (resolvedModel) return resolvedModel
  try {
    const info = await fetch(`${OJ_URL}/v1/info`, { headers: headers() })
    if (info.ok) resolvedModel = (await info.json()).model ?? ''
    if (!resolvedModel) {
      const list = await fetch(`${OJ_URL}/v1/models`, { headers: headers() })
      if (list.ok) resolvedModel = (await list.json()).data?.[0]?.id ?? ''
    }
  } catch {
    // Unreachable server — the chat request below reports it properly.
  }
  return resolvedModel || 'default'
}

/** For the startup banner. Never throws. */
export async function openJarvisStatus() {
  try {
    const res = await fetch(`${OJ_URL}/health`, { signal: AbortSignal.timeout(3000) })
    if (!res.ok) return `answering ${res.status} — is its engine running?`
    return `ready, model ${await modelName()}`
  } catch {
    return 'not reachable — start it with `jarvis serve`'
  }
}

/**
 * Every word of these can be spoken, so they are sentences, not stack traces.
 */
function explain(err, status) {
  if (status === 401 || status === 403) {
    return 'OpenJarvis refused the connection. Check OPENJARVIS_API_KEY.'
  }
  if (status) return `OpenJarvis answered with an error, code ${status}.`
  const code = err?.cause?.code ?? err?.code
  if (code === 'ECONNREFUSED' || code === 'ENOTFOUND') {
    return 'I cannot reach OpenJarvis. Start it with jarvis serve.'
  }
  return `The OpenJarvis request failed: ${err?.message ?? err}`
}

/**
 * Reads an OpenAI-style server-sent event stream and calls `onEvent` with
 * each parsed JSON payload.
 */
async function readEvents(body, onEvent) {
  const decoder = new TextDecoder()
  let buffer = ''
  for await (const chunk of body) {
    buffer += decoder.decode(chunk, { stream: true })
    let cut
    while ((cut = buffer.indexOf('\n\n')) !== -1) {
      const block = buffer.slice(0, cut)
      buffer = buffer.slice(cut + 2)
      const data = []
      for (const line of block.split('\n')) {
        if (line.startsWith('data:')) data.push(line.slice(5).trimStart())
      }
      const text = data.join('\n')
      if (!text || text === '[DONE]') continue
      try {
        onEvent(JSON.parse(text))
      } catch {
        // One unreadable event is not a reason to lose the answer.
      }
    }
  }
}

/**
 * One browser connection, answered by OpenJarvis.
 *
 * Same wire protocol as the Claude path in server.mjs: the browser sends
 * `ask` (with an id) and `interrupt`; every frame for a turn carries that
 * turn's id as `ask`, so a late frame from an abandoned turn is ignored.
 */
export function handleOpenJarvis(socket) {
  const send = (msg) => {
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(msg))
  }

  faces.add(socket)
  send({ type: 'ready', servers: ['openjarvis'] })
  syncFace(send)

  /** Earlier turns, oldest first, as OpenAI chat messages. */
  const history = []
  /** The turn in flight, so a barge-in or a new question can cancel it. */
  let current = null

  async function answer(text, id) {
    const turn = { controller: new AbortController(), id }
    current = turn
    const sendTurn = (msg) => send({ ...msg, ask: id })
    const heartbeat = setInterval(() => sendTurn({ type: 'working' }), HEARTBEAT_MS)

    const startedAt = Date.now()
    const messages = [
      { role: 'system', content: [SYSTEM_PROMPT, describeLook()].filter(Boolean).join('\n\n') },
      ...history.slice(-HISTORY_LIMIT),
      { role: 'user', content: text },
    ]
    let reply = ''

    try {
      const res = await fetch(`${OJ_URL}/v1/chat/completions`, {
        method: 'POST',
        headers: headers(),
        // OpenJarvis defaults to 1,024 tokens. With thinking on, the thinking
        // counts against that, and a long think left no room for the answer.
        body: JSON.stringify({ model: await modelName(), messages, stream: true, max_tokens: 4096 }),
        signal: turn.controller.signal,
      })
      if (!res.ok || !res.body) throw Object.assign(new Error('bad status'), { status: res.status })

      // Collected whole, then cleaned and sent as one piece: a repeated status
      // note can be split across chunks. The OpenJarvis agent sends its answer
      // in one chunk anyway, so this costs no time today. Word-by-word replies
      // will need a filter that works on the stream.
      await readEvents(res.body, (event) => {
        const delta = event.choices?.[0]?.delta?.content
        if (delta) reply += delta
      })
      // An empty reply after a face change is the model having nothing to add
      // ("Very good, sir." is true). Otherwise it is a failure, and saying so
      // beats a cheerful non-answer: a thinking model can spend its whole
      // token budget thinking and come back with nothing.
      reply = withoutNote(reply) || (lastUiAt > startedAt ? 'Very good, sir.' : "I'm afraid I have no answer, sir.")
      sendTurn({ type: 'text', delta: reply })

      history.push({ role: 'user', content: text }, { role: 'assistant', content: reply })
      sendTurn({ type: 'done', text: reply, costUsd: null })
    } catch (err) {
      if (turn.controller.signal.aborted) {
        // Barged in. Keep what was already said, so the next turn knows it.
        if (reply) history.push({ role: 'user', content: text }, { role: 'assistant', content: reply })
        return
      }
      console.error('[jarvis] openjarvis turn failed:', err?.status ?? '', err?.message ?? err)
      sendTurn({ type: 'error', message: explain(err, err?.status) })
    } finally {
      clearInterval(heartbeat)
      if (current === turn) current = null
    }
  }

  socket.on('message', (raw) => {
    let msg
    try {
      msg = JSON.parse(raw.toString())
    } catch {
      return
    }

    if (msg.type === 'ask' && typeof msg.text === 'string') {
      // A new question always wins over one still being answered.
      current?.controller.abort()
      void answer(msg.text, typeof msg.id === 'string' ? msg.id : null)
    }

    if (msg.type === 'interrupt') {
      current?.controller.abort()
    }
  })

  socket.on('close', () => {
    console.log('[jarvis] client disconnected')
    faces.delete(socket)
    current?.controller.abort()
  })
}
