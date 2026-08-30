#!/usr/bin/env node
// 把 src/topics/** 打成桌面版用的資料 bundle。
//
//   node --experimental-strip-types tools/bundle.mjs [--out <dir>]   （Node 24 不需要旗標）
//
// 產出：<out>/data-bundle.json.gz 與 <out>/manifest.json
//   manifest = { version, builtAt, sha256, size, eventCount, url }
//
// 驗證用的是網站同一套 Zod schema 與 validate.ts —— 這支檔案不自己定義任何規則，
// 所以「網站載得起來」與「bundle 打得出來」永遠是同一個判準。
// 桌面版讀進去時 Rust 端還會再驗一次結構（serde），前端 shim 再跑一次 validate.ts。
//
// **這支是 `npm run build` 的最後一步，不是 CI 的一個步驟。** 站台已經搬到
// Cloudflare Pages，那邊的建置指令是後台設定的 `npm run build`，repo 管不到；
// 把它掛在 CI 上的話，Cloudflare 建出來的站就沒有 /data/，而症狀很難查 ——
// Pages 對未知路徑回的是 **200 + index.html**（不是 404），桌面版拿到 HTML
// 去 parse JSON，錯誤訊息看起來像「manifest 檔案壞了」。

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { gzipSync } from 'node:zlib'
import { execSync } from 'node:child_process'
import * as yaml from 'js-yaml'
import { z } from 'zod'
import {
  DEFAULT_CATEGORIES,
  categoryListSchema,
  eventSchema,
  periodSchema,
  regionSchema,
  timelineSchema,
  topicSchema,
} from '../src/lib/schema.ts'
import {
  assertActualYearBeforeMinYear,
  assertInRange,
  assertKnownCategory,
  assertNoOverlap,
  assertUniqueIds,
} from '../src/lib/validate.ts'

const root = resolve(import.meta.dirname, '..')
const TOPICS_DIR = join(root, 'src', 'topics')
const outIdx = process.argv.indexOf('--out')
const OUT = resolve(outIdx > 0 ? process.argv[outIdx + 1] : join(root, 'dist', 'data'))

const load = (p) => (existsSync(p) ? yaml.load(readFileSync(p, 'utf8')) : undefined)
const parse = (schema, raw, where) => {
  const r = schema.safeParse(raw)
  if (!r.success) {
    throw new Error(`${where} 資料格式錯誤：\n${r.error.issues.map((i) => `  [${i.path.join('.')}] ${i.message}`).join('\n')}`)
  }
  return r.data
}

const topics = []
for (const d of readdirSync(TOPICS_DIR, { withFileTypes: true })) {
  if (!d.isDirectory()) continue
  const dir = join(TOPICS_DIR, d.name)
  if (!existsSync(join(dir, 'topic.yaml'))) continue
  const slug = d.name
  const meta = parse(topicSchema, load(join(dir, 'topic.yaml')), `${slug}/topic.yaml`)
  const timeline = parse(timelineSchema, load(join(dir, 'timeline.yaml')), `${slug}/timeline.yaml`)
  for (const y of meta.jumps ?? []) {
    if (y < timeline.minYear || y > timeline.maxYear) throw new Error(`${slug}/topic.yaml：跳轉年代 ${y} 超出範圍`)
  }
  const catRaw = load(join(dir, 'categories.yaml'))
  const categories = catRaw ? parse(categoryListSchema, catRaw, `${slug}/categories.yaml`) : DEFAULT_CATEGORIES
  const catMap = Object.fromEntries(categories.map((c) => [c.id, c]))
  const regionMetas = parse(z.array(regionSchema), load(join(dir, 'regions.yaml')), `${slug}/regions.yaml`)
  assertUniqueIds(regionMetas, `${slug}/regions.yaml`)
  const regions = regionMetas.map((rm) => {
    const where = `${slug}/${rm.id}`
    const periods = parse(z.array(periodSchema), load(join(dir, rm.id, 'periods.yaml')) ?? [], `${where}/periods.yaml`)
    const events = parse(z.array(eventSchema), load(join(dir, rm.id, 'events.yaml')) ?? [], `${where}/events.yaml`)
    assertUniqueIds(periods, `${where}/periods.yaml`)
    assertUniqueIds(events, `${where}/events.yaml`)
    assertNoOverlap(periods, where)
    assertKnownCategory(events, catMap, `${where}/events.yaml`, slug)
    assertActualYearBeforeMinYear(events, timeline, `${where}/events.yaml`)
    assertInRange(periods.map((p) => ({ id: p.id, from: p.start, to: p.end })), timeline, `${where}/periods.yaml`, slug)
    assertInRange(events.map((e) => ({ id: e.id, from: e.year, to: e.endYear ?? e.year })), timeline, `${where}/events.yaml`, slug)
    return { meta: rm, periods, events }
  })
  topics.push({ slug, meta, timeline, categories, regions })
}
const roots = topics.filter((t) => t.meta.root)
if (roots.length !== 1) throw new Error(`恰好要有一個主題設定 root: true（目前 ${roots.length} 個）`)

let sha = 'unknown'
try {
  sha = execSync('git rev-parse --short=7 HEAD', { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
} catch {}
const builtAt = new Date().toISOString()
const version = `${builtAt.slice(0, 10).replace(/-/g, '')}.${sha}`
const eventCount = topics.reduce((n, t) => n + t.regions.reduce((m, r) => m + r.events.length, 0), 0)

const bundle = { version, builtAt, topics }
const gz = gzipSync(Buffer.from(JSON.stringify(bundle)), { level: 9 })
const sha256 = createHash('sha256').update(gz).digest('hex')
mkdirSync(OUT, { recursive: true })
writeFileSync(join(OUT, 'data-bundle.json.gz'), gz)
writeFileSync(
  join(OUT, 'manifest.json'),
  JSON.stringify({ version, builtAt, sha256, size: gz.length, eventCount, topicCount: topics.length, url: 'data-bundle.json.gz' }, null, 2) + '\n',
)
console.log(`bundle ${version}：${topics.length} 主題、${eventCount} 則事件，${(gz.length / 1024).toFixed(0)} KB → ${OUT}`)
