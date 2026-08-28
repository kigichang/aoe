#!/usr/bin/env node
/**
 * 資料健檢。刻意不接進 npm run build：
 * 缺出處不該擋掉建置，但補資料時需要一份待辦清單。
 *
 *   node scripts/lint-data.mjs                # 列出重要度 >= 門檻卻沒有出處的事件
 *   node scripts/lint-data.mjs --min 3        # 調整門檻（預設 4）
 *   node scripts/lint-data.mjs --topic world  # 只檢查單一主題（預設全部）
 *   node scripts/lint-data.mjs --strict       # 有缺漏就以 exit 1 結束，可用於 CI
 *   node scripts/lint-data.mjs --check-urls   # 連線驗證每個出處網址是否還活著
 *   node scripts/lint-data.mjs --check-pages  # 問維基 API：條目是否存在、是不是消歧義頁
 *
 * --check-urls 只看 HTTP 狀態碼，驗不出「連得通但指錯地方」——
 * 消歧義頁一樣回 200。--check-pages 補的就是這一段。
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as yaml from 'js-yaml'

const TOPICS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'topics')

const args = process.argv.slice(2)
const has = (flag) => args.includes(flag)
const minImportance = Number(args[args.indexOf('--min') + 1]) || 4
const onlyTopic = args.includes('--topic') ? args[args.indexOf('--topic') + 1] : null

const read = (path) => (existsSync(path) ? (yaml.load(readFileSync(path, 'utf8')) ?? []) : [])

const topics = readdirSync(TOPICS_DIR, { withFileTypes: true })
  .filter((d) => d.isDirectory() && existsSync(join(TOPICS_DIR, d.name, 'topic.yaml')))
  .map((d) => ({ slug: d.name, meta: read(join(TOPICS_DIR, d.name, 'topic.yaml')) }))
  .filter((t) => !onlyTopic || t.slug === onlyTopic)

if (topics.length === 0) {
  console.error(onlyTopic ? `找不到主題 "${onlyTopic}"` : '找不到任何主題')
  process.exit(1)
}

let missing = 0
let total = 0
const urls = new Map()

console.log(`\n出處覆蓋率（重要度 >= ${minImportance}）`)

for (const topic of topics) {
  const dir = join(TOPICS_DIR, topic.slug)
  const regions = read(join(dir, 'regions.yaml')).sort((a, b) => a.order - b.order)

  console.log(`\n${topic.meta.name}（${topic.slug}）\n`)

  for (const region of regions) {
    const events = read(join(dir, region.id, 'events.yaml'))
    const target = events.filter((e) => e.importance >= minImportance)
    const without = target.filter((e) => !e.sources?.length)
    total += target.length
    missing += without.length

    for (const e of events) {
      for (const s of e.sources ?? []) {
        if (s.url) urls.set(s.url, `${topic.slug}/${region.id}/${e.id}`)
      }
    }

    const covered = target.length - without.length
    const pct = target.length ? Math.round((covered / target.length) * 100) : 100
    const bar = '█'.repeat(Math.round(pct / 5)).padEnd(20, '·')
    console.log(
      `  ${region.name.padEnd(6)} ${bar} ${String(pct).padStart(3)}%  ` +
        `${covered}/${target.length}　（全部 ${events.length} 則）`,
    )

    for (const e of without) {
      console.log(`      缺出處  ${String(e.year).padStart(5)}  ${e.title}`)
    }
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

if (has('--check-pages')) {
  /**
   * 依站台分組後問各自的 API。出處不限中文維基：日本史可引日文版、
   * 歐洲史可引英文版（`title` 一律寫繁體中文），所以這裡要按 host 分開查。
   */
  const byHost = new Map()
  for (const [url, where] of urls) {
    const m = url.match(/^https:\/\/([a-z-]+\.wikipedia\.org)\/wiki\/(.+)$/)
    if (!m) continue
    if (!byHost.has(m[1])) byHost.set(m[1], new Map())
    byHost.get(m[1]).set(decodeURIComponent(m[2]).replace(/_/g, ' '), where)
  }

  console.log(`\n查詢維基 API：${urls.size} 個條目，${byHost.size} 個站台…\n`)
  let bad = 0

  for (const [host, titles] of byHost) {
    const all = [...titles.keys()]
    for (let i = 0; i < all.length; i += 40) {
      // 一個請求最多 50 個標題，但別打太快
      if (i || byHost.size > 1) await new Promise((r) => setTimeout(r, 1500))
      const params = new URLSearchParams({
        format: 'json',
        action: 'query',
        redirects: '1',
        prop: 'pageprops',
        ppprop: 'disambiguation',
        titles: all.slice(i, i + 40).join('|'),
      })
      // 中文維基的 API 不做繁簡變體轉換（`/wiki/` 路徑會做），
      // 少了這個參數，繁體標題會被大量誤報成 missing。
      if (host.startsWith('zh.')) params.set('converttitles', 'zh-hans')

      /**
       * 條目數上千之後，維基會對這串連續請求回 503
       * （`upstream connect error … reset reason: overflow`）。那是暫時性的
       * 負載保護，不是標題有問題 —— 退避重試幾次就會過。
       *
       * **一定要判斷回應裡有沒有 `query`。** 曾經直接解構就用，非 200 的回應
       * 沒有這個欄位，整支腳本會以 `Cannot read properties of undefined`
       * 中止在半路 —— 看起來像資料壞了，實際上只是被限流，而且已經檢查過的
       * 那幾百個條目也一起白跑。
       */
      let query
      for (let attempt = 0; attempt < 4 && !query; attempt++) {
        if (attempt) await new Promise((r) => setTimeout(r, 3000 * attempt))
        try {
          const res = await fetch(`https://${host}/w/api.php?${params}`, {
            headers: { 'User-Agent': 'aoe-data-lint (https://github.com/kigichang/aoe)' },
          })
          ;({ query } = await res.json())
        } catch {
          // 連線層的失敗與 503 同樣處理：重試，仍不行才報出來
        }
      }
      if (!query) {
        bad++
        console.log(`  ✗ 維基 API 沒有回應（${host}，第 ${i + 1}–${i + 40} 個標題），這批沒驗到`)
        continue
      }

      // normalized / converted / redirects 逐層把回傳標題對回原始寫法
      const chain = new Map()
      for (const kind of ['normalized', 'converted', 'redirects'])
        for (const r of query[kind] ?? []) chain.set(r.to, r.from)
      const original = (t) => {
        let cur = t
        for (const seen = new Set(); chain.has(cur) && !seen.has(cur); ) {
          seen.add(cur)
          cur = chain.get(cur)
        }
        return cur
      }

      for (const page of Object.values(query.pages)) {
        const title = original(page.title)
        const problem =
          page.missing !== undefined
            ? '條目不存在'
            : page.pageprops?.disambiguation !== undefined
              ? '這是消歧義頁，不是條目'
              : null
        if (problem) {
          bad++
          console.log(`  ✗ ${problem}  ${host}  ${title}\n      ${titles.get(title) ?? ''}`)
        }
      }
    }
  }

  console.log(bad === 0 ? `  全部 ${urls.size} 個條目正常` : `\n  ${bad} 個條目有問題`)
  if (bad && has('--strict')) process.exit(1)
}

if (missing && has('--strict')) process.exit(1)
