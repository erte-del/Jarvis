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
Plain spoken prose only. No markdown, lists, headings, emoji or asterisks.
Write numbers, dates and times as you would say them.
Dry, calm, British service register. Address the user as "sir" now and then.
Never apologise, never use filler words, never say you are an AI model.

The screen in front of the user is your own face. The ui_ tools change it:
ui_theme recolours it, ui_reactor reshapes the core, ui_effect fires one effect,
ui_chrome hides or shows the side panels, ui_reset puts everything back.
When the user asks you to change how you look, call the tool, then confirm in a few words.
Otherwise change it only when it carries meaning, one change at a time.
The blade tool opens an article, image or video on screen when the user asks to see something.`

/** Every open face in OpenJarvis mode. MCP tool calls are pushed to all of them. */
const faces = new Set()

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
  '/mcp/ui': () => uiServer((op, args) => broadcast({ type: 'ui', op, args })),
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
    await server.instance.connect(transport)
    await transport.handleRequest(req, res)
  } catch (err) {
    console.error('[jarvis] MCP request failed:', err)
    if (!res.headersSent) res.writeHead(500)
    res.end()
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

  /** Earlier turns, oldest first, as OpenAI chat messages. */
  const history = []
  /** The turn in flight, so a barge-in or a new question can cancel it. */
  let current = null

  async function answer(text, id) {
    const turn = { controller: new AbortController(), id }
    current = turn
    const sendTurn = (msg) => send({ ...msg, ask: id })
    const heartbeat = setInterval(() => sendTurn({ type: 'working' }), HEARTBEAT_MS)

    const messages = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...history.slice(-HISTORY_LIMIT),
      { role: 'user', content: text },
    ]
    let reply = ''

    try {
      const res = await fetch(`${OJ_URL}/v1/chat/completions`, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ model: await modelName(), messages, stream: true }),
        signal: turn.controller.signal,
      })
      if (!res.ok || !res.body) throw Object.assign(new Error('bad status'), { status: res.status })

      await readEvents(res.body, (event) => {
        const delta = event.choices?.[0]?.delta?.content
        if (delta) {
          reply += delta
          sendTurn({ type: 'text', delta })
        }
      })

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
