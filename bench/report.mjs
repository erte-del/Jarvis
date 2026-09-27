/**
 * Turns bench results into one comparison: bench/results/report.md.
 *
 *   node bench/report.mjs                       # newest result for each brain
 *   node bench/report.mjs a.json b.json         # these files
 *
 * Every saved answer is graded again with the current checks in checks.mjs
 * and the current questions.json, so results recorded before a check existed
 * are held to it too. Only questions that every result set answered are
 * compared.
 */

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { grade, STYLE_CHECKS } from './checks.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const DIR = join(HERE, 'results')

function pickFiles() {
  const given = process.argv.slice(2)
  if (given.length) return given
  let names = []
  try {
    names = readdirSync(DIR).filter((n) => n.endsWith('.json')).sort()
  } catch {
    // no results folder yet
  }
  // Names end in an ISO date, so the last one per brain is the newest.
  const newest = new Map()
  for (const n of names) newest.set(n.split('-')[0], join(DIR, n))
  return [...newest.values()]
}

const files = pickFiles()
if (!files.length) {
  console.error('No results yet. Run node bench/run.mjs first.')
  process.exit(1)
}

const { tasks } = JSON.parse(readFileSync(join(HERE, 'questions.json'), 'utf8'))
const taskById = new Map(tasks.map((t) => [t.id, t]))

const sets = files.map((f) => {
  const data = JSON.parse(readFileSync(f, 'utf8'))
  const results = data.results
    .filter((r) => taskById.has(r.id))
    .map((r) => {
      const task = taskById.get(r.id)
      return { ...r, category: task.category, ...grade(task, r) }
    })
  return { file: basename(f), ...data, results }
})

// Only questions every set answered, in questions.json order, so no brain is
// scored on questions the other never saw.
const ids = tasks.map((t) => t.id).filter((id) => sets.every((s) => s.results.some((r) => r.id === id)))
const skipped = tasks.length - ids.length
for (const s of sets) s.results = s.results.filter((r) => ids.includes(r.id))

// ---------------------------------------------------------------- numbers

const median = (xs) => {
  const v = xs.filter((x) => x != null).sort((a, b) => a - b)
  if (!v.length) return null
  const mid = Math.floor(v.length / 2)
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2
}
const seconds = (ms) => (ms == null ? '—' : `${(ms / 1000).toFixed(1)} s`)
const percent = (n, d) => (d ? `${Math.round((100 * n) / d)}%` : '—')
const share = (rs, ok) => {
  const n = rs.filter(ok).length
  return `${n}/${rs.length} (${percent(n, rs.length)})`
}
const name = (s) => `${s.brain} · ${s.model}`
const cell = (text) => String(text ?? '').replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim()
const hasIssue = (r, key) => r.styleIssues.some((i) => i.startsWith(key))

const categories = [...new Set(tasks.filter((t) => ids.includes(t.id)).map((t) => t.category))]

// ---------------------------------------------------------------- report

const lines = []
const row = (...cells) => lines.push(`| ${cells.join(' | ')} |`)
const header = () => {
  row('', ...sets.map(name))
  row('---', ...sets.map(() => '---'))
}

lines.push('# Brain comparison', '')
lines.push(
  'Each brain answered the same questions through the face bridge, the way the browser asks them.',
  'Times are measured from sending the question to the bridge.',
  '',
)
if (skipped) {
  lines.push(
    `${ids.length} questions are compared. ${skipped} more in \`bench/questions.json\` are left out because not every result set has them. Run the test again to include them.`,
    '',
  )
}

lines.push('## Correct', '', 'Did it do what was asked?', '')
header()
row('**All questions**', ...sets.map((s) => share(s.results, (r) => r.pass)))
for (const c of categories) row(c, ...sets.map((s) => share(s.results.filter((r) => r.category === c), (r) => r.pass)))
lines.push('')

lines.push('## Style', '', 'Does it sound like JARVIS speaking? Scored separately from correctness.', '')
header()
row('**Answers with no style problem**', ...sets.map((s) => share(s.results, (r) => r.styleIssues.length === 0)))
for (const [key, label] of STYLE_CHECKS) row(label, ...sets.map((s) => share(s.results, (r) => !hasIssue(r, key))))
row('Median answer length', ...sets.map((s) => `${median(s.results.map((r) => r.words)) ?? '—'} words`))
lines.push('')

lines.push('## Speed and cost', '')
header()
row('Median time to first word', ...sets.map((s) => seconds(median(s.results.map((r) => r.firstTextMs)))))
row('Median time to full answer', ...sets.map((s) => seconds(median(s.results.map((r) => r.totalMs)))))
row('Slowest answer', ...sets.map((s) => seconds(Math.max(...s.results.map((r) => r.totalMs ?? 0)))))
const costs = (s) => s.results.map((r) => r.costUsd).filter((c) => c != null)
row(
  'Reported cost, all answers',
  ...sets.map((s) => (costs(s).length ? `$${costs(s).reduce((a, b) => a + b, 0).toFixed(2)}` : '$0 (runs locally)')),
)
row(
  'Reported cost per answer',
  ...sets.map((s) => (costs(s).length ? `$${(costs(s).reduce((a, b) => a + b, 0) / costs(s).length).toFixed(3)}` : '$0')),
)
row('Answers', ...sets.map((s) => `${s.results.length} (${s.runs} runs)`))
row('Machine', ...sets.map((s) => cell(`${s.machine.cpu}, ${s.machine.memoryGB} GB, ${s.machine.platform} ${s.machine.arch}`)))
row('Date', ...sets.map((s) => s.date.slice(0, 16).replace('T', ' ')))
lines.push('')

lines.push('## Every question', '', 'The answer shown is from the first run. Problems are counted over all runs.', '')
row('Question', ...sets.map(name))
row('---', ...sets.map(() => '---'))
for (const id of ids) {
  const task = taskById.get(id)
  const question = task.steps ? task.steps.join(' → ') : task.ask
  row(
    cell(`**${id}**<br>${question}`),
    ...sets.map((s) => {
      const rs = s.results.filter((r) => r.id === id)
      const r = rs[0]
      const mark = rs.every((x) => x.pass) ? 'PASS' : rs.some((x) => x.pass) ? 'SOME' : 'FAIL'
      const problems = [...new Set(rs.flatMap((x) => [...x.reasons, ...x.styleIssues.map((i) => `style: ${i}`)]))]
      // Escaped, so an answer written in markdown shows its symbols here
      // instead of being rendered as formatting and looking like plain speech.
      const trimmed = r.text.length > 160 ? `${r.text.slice(0, 157)}…` : r.text
      const answer = trimmed.replace(/[*_`#<>[\]]/g, '\\$&')
      const why = problems.length ? `<br>_${cell(problems.join('; '))}_` : ''
      return cell(`**${mark}** · ${seconds(median(rs.map((x) => x.totalMs)))}<br>${answer || '(no text)'}${why}`)
    }),
  )
}
lines.push('')

lines.push('## How to read this', '')
lines.push(
  '- **Correct** is an automatic check. Facts and sums must contain the right word; for answers that explain themselves, the last sentence must. Face tasks must send the right face change. Instructions like "one word only" must be followed. A FAIL can still be a right answer in words the check did not expect. Read the answers.',
  '- **Style** checks what a listener would notice. Digits and symbols are written for reading, not speaking ("5:15" instead of "five fifteen"). Filler is phrases like "let me know if…". Short enough means 30 words unless the question needs more. Face changes nobody asked for include changing the core\'s shape when asked only to make it bigger.',
  '- **SOME** means the question passed in some runs and failed in others.',
  '- **Time to first word** is when the face could start to speak. The OpenJarvis agent sends its whole answer at once, so for it the first word and the full answer arrive together.',
  '- **Cost** for Claude is what the Claude Agent SDK reports. On a Claude subscription it comes out of the plan, not as a bill. The local model has no per-answer cost, only electricity.',
  '- The two brains get different instructions. Claude uses the long JARVIS persona from `face/bridge/server.mjs`. OpenJarvis uses the short one from `face/bridge/openjarvis.mjs`. Some of the style gap may come from that.',
  '- Voice is not part of the test. The questions go in as text.',
  '',
  `Source files: ${sets.map((s) => `\`${s.file}\``).join(', ')}.`,
  '',
)

mkdirSync(DIR, { recursive: true })
const out = join(DIR, 'report.md')
writeFileSync(out, lines.join('\n'))
console.log(`Wrote ${out}`)
