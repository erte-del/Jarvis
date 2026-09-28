/**
 * How an answer is graded. Shared by run.mjs, which grades as it goes, and
 * report.mjs, which grades the saved answers again — so a change to the checks
 * applies to results that were recorded before it.
 *
 * Two separate grades:
 *   correct — did it do what was asked? The right fact, the right face change,
 *             the length an instruction demanded.
 *   style   — does it sound like JARVIS speaking? Numbers written as words, no
 *             filler, short, no markdown, no face changes nobody asked for.
 * A brain can be right in a way that would sound wrong out loud, and the first
 * run of this benchmark showed that is exactly where the two brains differ.
 */

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Whole-word match, so "au" finds the symbol for gold but not "because". */
export function contains(text, word) {
  const start = /^\w/.test(word) ? '\\b' : ''
  const end = /\w$/.test(word) ? '\\b' : ''
  return new RegExp(`${start}${escape(word)}${end}`, 'i').test(text)
}

export const wordCount = (text) => (text.match(/\S+/g) ?? []).length

/** Markdown is read aloud as symbols, so the face asks for plain speech. */
export const looksSpoken = (text) => !/(\*\*|^#{1,6}\s|^\s*[-*]\s|^\s*\d+\.\s|`)/m.test(text)

/**
 * Where an answer that explains itself states its result: the first sentence
 * ("Thirty-three dollars, sir. Thirty off, plus three in tax.") or the last
 * ("Thirty off leaves thirty, plus tax. So you pay thirty-three."). Checking
 * only the last sentence failed right answers given first.
 */
function answerSentences(text) {
  const parts = text.trim().split(/(?<=[.!?])\s+/).filter(Boolean)
  return parts.length > 1 ? `${parts[0]} ${parts.at(-1)}` : text
}

/**
 * For a question with a closed set of answers (the four directions, the days
 * of the week), the one mentioned last. Working that ends "…left to face
 * east. You are now facing west." concludes west, however many times east
 * came up on the way.
 */
function lastChoice(text, choices) {
  let best = null
  let at = -1
  for (const c of choices) {
    for (const m of text.matchAll(new RegExp(`\\b${escape(c)}\\b`, 'gi'))) {
      if (m.index > at) {
        at = m.index
        best = c
      }
    }
  }
  return best
}

/**
 * Numbers the question itself contains ("the novel 1984", "leaves at 3:40").
 * Repeating those as digits is not a style problem; working out new ones is.
 */
function withoutQuestionNumbers(text, question) {
  let out = text
  for (const n of question.match(/\d[\d:.,]*\d|\d/g) ?? []) out = out.split(n).join(' ')
  return out
}

const get = (obj, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj)

/** Colour names, #rgb, #rrggbb and rgb() — judged by which channel dominates. */
function colourIs(value, names, test) {
  const s = String(value ?? '').trim().toLowerCase()
  if (names.test(s)) return true
  let m = s.match(/^#([0-9a-f])([0-9a-f])([0-9a-f])$/)
  if (m) m = [null, m[1] + m[1], m[2] + m[2], m[3] + m[3]].map((h, i) => (i ? parseInt(h, 16) : h))
  else {
    m = s.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/)
    if (m) m = m.map((h, i) => (i ? parseInt(h, 16) : h))
    else m = s.match(/rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/)?.map((h, i) => (i ? Number(h) : h))
  }
  return Boolean(m && test(m[1], m[2], m[3]))
}
const isRed = (v) => colourIs(v, /red|crimson|scarlet|maroon/, (r, g, b) => r >= 150 && g < 110 && b < 110)
const isBlue = (v) => colourIs(v, /blue|navy|azure|cobalt|sapphire/, (r, g, b) => b >= 150 && r < 110 && b > g)

function frameMatches(frames, want) {
  return frames.some((f) => {
    if (f.op !== want.op) return false
    if (!want.path) return true
    const value = get(f.args, want.path)
    const [kind, arg] = (want.test ?? 'any').split(':')
    if (kind === 'red') return isRed(value)
    if (kind === 'blue') return isBlue(value)
    if (kind === 'above') return Number(value) > Number(arg)
    if (kind === 'equals') return String(value) === arg
    return value !== undefined
  })
}

/** Every leaf a patch sets, as dotted paths: { reactor: { scale: 2 } } -> reactor.scale */
function leaves(obj, prefix = '') {
  return Object.entries(obj ?? {}).flatMap(([k, v]) =>
    v && typeof v === 'object' && !Array.isArray(v) ? leaves(v, `${prefix}${k}.`) : v === undefined ? [] : [`${prefix}${k}`],
  )
}

/**
 * Face changes the question did not ask for. On a question that is not about
 * the face, any change counts. On a face task, a patch may only touch the paths
 * in `allow_ui`, and only the ops the task expects may appear.
 */
function unaskedChanges(task, frames) {
  const expected = [task.expect_ui ?? []].flat()
  const ops = new Set(expected.map((e) => e.op))
  const allow = task.allow_ui ?? []
  const out = new Set()
  for (const f of frames) {
    if (task.category !== 'face' || task.no_ui) {
      out.add(f.op === 'patch' ? leaves(f.args).join(', ') || 'patch' : f.op)
    } else if (f.op === 'patch') {
      for (const path of leaves(f.args)) {
        if (!allow.some((a) => path === a || path.startsWith(`${a}.`))) out.add(path)
      }
    } else if (!ops.has(f.op)) {
      out.add(f.op)
    }
  }
  return [...out]
}

/**
 * Phrases a spoken assistant has no use for, and that the JARVIS persona
 * forbids: offers of more help, cheerleading, hedges.
 */
const FILLER =
  /\b(let me know|feel free|how (can|may) i (help|assist)|is there anything else|anything else i can|happy to help|i hope (this|that) helps|great question|good question|certainly!|absolutely!|of course!|sure!|if you('d| would) like)\b/i

/**
 * @param {object} task    one entry from questions.json
 * @param {object} result  { text, ui, error } for the task's last step
 * @returns {{ pass: boolean, reasons: string[], styleIssues: string[] }}
 */
export function grade(task, result) {
  const text = result.text ?? ''
  const ui = result.ui ?? []
  const reasons = []

  if (result.error) reasons.push(`error: ${result.error}`)
  if (task.expect) {
    const where = task.check === 'answer_sentence' ? answerSentences(text) : text
    const ok = task.letters
      ? task.expect.some((w) => where.toLowerCase().replace(/[^a-z]/g, '').includes(w))
      : task.expect.some((w) => contains(where, w))
    const what = task.check === 'answer_sentence' ? 'the first or last sentence to say one of' : 'one of'
    if (!ok) reasons.push(`expected ${what}: ${task.expect.slice(0, 3).join(', ')}`)
    if (ok && task.choices) {
      const said = lastChoice(text, task.choices)
      if (said && !task.expect.includes(said)) reasons.push(`concluded ${said}, expected ${task.expect[0]}`)
    }
  }
  for (const want of [task.expect_ui ?? []].flat()) {
    if (!frameMatches(ui, want)) reasons.push(`expected face change: ${want.op}${want.path ? ` ${want.path}` : ''}`)
  }
  if (task.no_ui && ui.length) reasons.push('changed the face when it should have stayed as it was')
  // The OpenJarvis bridge gives the model a private note on the face's state.
  // Hearing it read out is a failure whatever else the answer got right.
  if (/FACE STATUS|your face right now/i.test(text)) reasons.push('read out the private face-status note')
  if (task.max_words && wordCount(text) > task.max_words) {
    reasons.push(`ignored the length asked for: ${wordCount(text)} words, limit ${task.max_words}`)
  }

  const styleIssues = []
  if (text) {
    const question = task.steps?.at(-1) ?? task.ask ?? ''
    if (/\d/.test(withoutQuestionNumbers(text, question))) styleIssues.push('digits')
    if (FILLER.test(text)) styleIssues.push('filler')
    if (!looksSpoken(text)) styleIssues.push('markdown')
    const limit = task.style_max_words ?? 30
    if (wordCount(text) > limit) styleIssues.push(`long (${wordCount(text)} words)`)
  }
  const unasked = unaskedChanges(task, ui)
  if (unasked.length && !task.no_ui) styleIssues.push(`unasked face change (${unasked.join(', ')})`)

  return { pass: reasons.length === 0, reasons, styleIssues }
}

/** The style categories the report counts, in the order it shows them. */
export const STYLE_CHECKS = [
  ['digits', 'Numbers written as words'],
  ['filler', 'No filler phrases'],
  ['markdown', 'No markdown'],
  ['long', 'Short enough to speak'],
  ['unasked', 'No face changes nobody asked for'],
]
