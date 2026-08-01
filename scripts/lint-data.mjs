#!/usr/bin/env node
/**
 * 資料健檢。刻意不接進 npm run build：
 * 缺出處不該擋掉建置，但補資料時需要一份待辦清單。
 *
 *   node scripts/lint-data.mjs                # 列出重要度 >= 門檻卻沒有出處的事件
 *   node scripts/lint-data.mjs --min 3        # 調整門檻（預設 4）
 *   node scripts/lint-data.mjs --strict       # 有缺漏就以 exit 1 結束，可用於 CI
 *   node scripts/lint-data.mjs --check-urls   # 連線驗證每個出處網址是否還活著
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as yaml from 'js-yaml'

const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'data')

const args = process.argv.slice(2)
const has = (flag) => args.includes(flag)
const minImportance = Number(args[args.indexOf('--min') + 1]) || 4

const regions = yaml
  .load(readFileSync(join(DATA_DIR, 'regions.yaml'), 'utf8'))
  .sort((a, b) => a.order - b.order)

const load = (region, file) => {
  const path = join(DATA_DIR, region.id, file)
  return existsSync(path) ? (yaml.load(readFileSync(path, 'utf8')) ?? []) : []
}

let missing = 0
let total = 0
const urls = new Map()

console.log(`\n出處覆蓋率（重要度 >= ${minImportance}）\n`)

for (const region of regions) {
  const events = load(region, 'events.yaml')
  const target = events.filter((e) => e.importance >= minImportance)
  const without = target.filter((e) => !e.sources?.length)
  total += target.length
  missing += without.length

  for (const e of events) {
    for (const s of e.sources ?? []) {
      if (s.url) urls.set(s.url, `${region.id}/${e.id}`)
    }
  }

  const covered = target.length - without.length
  const pct = target.length ? Math.round((covered / target.length) * 100) : 100
  const bar = '█'.repeat(Math.round(pct / 5)).padEnd(20, '·')
  console.log(
    `  ${region.name.padEnd(4)} ${bar} ${String(pct).padStart(3)}%  ` +
      `${covered}/${target.length}　（全部 ${events.length} 則）`,
  )

  for (const e of without) {
    console.log(`      缺出處  ${String(e.year).padStart(5)}  ${e.title}`)
  }
}

console.log(`\n合計：${total - missing}/${total} 有出處，缺 ${missing} 則`)

if (has('--check-urls')) {
  console.log(`\n驗證 ${urls.size} 個網址…\n`)
  let dead = 0
  // 逐一送出，不要對維基百科同時開一堆連線
  for (const [url, where] of urls) {
    let status
    try {
      const res = await fetch(encodeURI(decodeURI(url)), { redirect: 'follow' })
      status = res.status
    } catch (err) {
      status = err.message
    }
    if (status !== 200) {
      dead++
      console.log(`  ✗ ${status}  ${where}\n      ${url}`)
    }
  }
  console.log(dead === 0 ? `  全部 ${urls.size} 個網址正常` : `\n  ${dead} 個網址有問題`)
  if (dead && has('--strict')) process.exit(1)
}

if (missing && has('--strict')) process.exit(1)
