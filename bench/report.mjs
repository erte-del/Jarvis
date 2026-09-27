/**
 * Turns bench results into one comparison: bench/results/report.md.
 *
 *   node bench/report.mjs                       # newest result for each brain
 *   node bench/report.mjs a.json b.json         # these files
 */

import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

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
const sets = files.map((f) => ({ file: basename(f), ...JSON.parse(readFileSync(f, 'utf8')) }))

// ---------------------------------------------------------------- numbers

const median = (xs) => {
  const v = xs.filter((x) => x != null).sort((a, b) => a - b)
  if (!v.length) return null
  const mid = Math.floor(v.length / 2)
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2
}
const seconds = (ms) => (ms == null ? '—' : `${(ms / 1000).toFixed(1)} s`)
const percent = (n, d) => (d ? `${Math.round((100 * n) / d)}%` : '—')
const passRate = (rs) => `${rs.filter((r) => r.pass).length}/${rs.length} (${percent(rs.filter((r) => r.pass).length, rs.length)})`
const name = (s) => `${s.brain} · ${s.model}`
const cell = (text) => String(text ?? '').replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim()

const categories = [...new Set(sets.flatMap((s) => s.results.map((r) => r.category)))]

// ---------------------------------------------------------------- report

const lines = []
const row = (...cells) => lines.push(`| ${cells.join(' | ')} |`)

lines.push('# Brain comparison', '')
lines.push(
  'Each brain answered the same questions through the face bridge, the way the browser asks them.',
  'Times are measured from sending the question to the bridge.',
  '',
)

lines.push('## Summary', '')
row('', ...sets.map(name))
row('---', ...sets.map(() => '---'))
row('Passed', ...sets.map((s) => passRate(s.results)))
for (const c of categories) {
  row(`Passed: ${c}`, ...sets.map((s) => passRate(s.results.filter((r) => r.category === c))))
}
row('Median time to first word', ...sets.map((s) => seconds(median(s.results.map((r) => r.firstTextMs)))))
row('Median time to full answer', ...sets.map((s) => seconds(median(s.results.map((r) => r.totalMs)))))
row('Slowest answer', ...sets.map((s) => seconds(Math.max(...s.results.map((r) => r.totalMs ?? 0)))))
row('Median answer length', ...sets.map((s) => `${median(s.results.map((r) => r.words)) ?? '—'} words`))
row('Plain speech (no markdown)', ...sets.map((s) => percent(s.results.filter((r) => r.spoken).length, s.results.length)))
row(
  'Reported cost, all questions',
  ...sets.map((s) => {
    const costs = s.results.map((r) => r.costUsd).filter((c) => c != null)
    return costs.length ? `$${costs.reduce((a, b) => a + b, 0).toFixed(4)}` : '$0 (runs locally)'
  }),
)
row('Runs per question', ...sets.map((s) => s.runs))
row('Machine', ...sets.map((s) => cell(`${s.machine.cpu}, ${s.machine.memoryGB} GB, ${s.machine.platform} ${s.machine.arch}`)))
row('Date', ...sets.map((s) => s.date.slice(0, 16).replace('T', ' ')))
lines.push('')

lines.push('## Every question', '')
row('Question', ...sets.map(name))
row('---', ...sets.map(() => '---'))
const ids = [...new Set(sets.flatMap((s) => s.results.map((r) => r.id)))]
for (const id of ids) {
  const first = sets.flatMap((s) => s.results).find((r) => r.id === id)
  row(
    cell(`**${id}**<br>${first.ask}`),
    ...sets.map((s) => {
      const rs = s.results.filter((r) => r.id === id)
      if (!rs.length) return '—'
      const r = rs[0]
      const mark = rs.every((x) => x.pass) ? 'PASS' : rs.some((x) => x.pass) ? 'SOME' : 'FAIL'
      const why = r.pass ? '' : `<br>_${cell(r.reasons.join('; '))}_`
      // Escaped, so an answer written in markdown shows its symbols here
      // instead of being rendered as formatting and looking like plain speech.
      const trimmed = r.text.length > 160 ? `${r.text.slice(0, 157)}…` : r.text
      const answer = trimmed.replace(/[*_`#<>[\]]/g, '\\$&')
      return cell(`**${mark}** · ${seconds(median(rs.map((x) => x.totalMs)))}<br>${answer || '(no text)'}${why}`)
    }),
  )
}
lines.push('')

lines.push('## How to read this', '')
lines.push(
  '- **Passed** is an automatic check. Facts and sums must contain the right word. Face tasks must send the right face change. Some answers must be short enough to speak. A PASS does not mean the answer is good, and a FAIL can be a right answer in words the check did not expect. Read the answers.',
  '- **SOME** means the question passed in some runs and failed in others.',
  '- **Time to first word** is when the face could start to speak. The OpenJarvis agent sends its whole answer at once, so for it the first word and the full answer arrive together.',
  '- **Cost** for Claude is what the Claude Agent SDK reports. On a Claude subscription it comes out of the plan, not as a bill. The local model has no per-question cost, only electricity.',
  '- The two brains get different instructions. Claude uses the long JARVIS persona from `face/bridge/server.mjs`. OpenJarvis uses the short one from `face/bridge/openjarvis.mjs`.',
  '- Voice is not part of the test. The questions go in as text.',
  '',
  `Source files: ${sets.map((s) => `\`${s.file}\``).join(', ')}.`,
  '',
)

const out = join(DIR, 'report.md')
writeFileSync(out, lines.join('\n'))
console.log(`Wrote ${out}`)
