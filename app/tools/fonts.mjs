// 把網站用的兩套 Google Fonts 抓下來放進 public/fonts/，讓桌面版離線也有一樣的字。
//
// **為什麼桌面版不能沿用 <link> 到 fonts.googleapis.com**：那是網站可以接受的，
// 網站本來就要連線；桌面版第一次啟動可能完全離線，字型退回系統字型的話，
// LXGW WenKai TC 的手寫感（軸線刻度與標題用它）就整個不見了，而且是**時有時無** ——
// 有網路一個樣、沒網路另一個樣，比一律用系統字型更難查。
//
// 兩套字加起來約 11MB（440 個 unicode-range 子集）。刻意**不做 subset**：
// 使用者可以自己新增事件，打什麼字不可預期，subset 過的字型會出現豆腐字。
// 完整子集靠 unicode-range，WebView 只會載入真的用到的那幾個檔。
//
// 產物 gitignored（跟內嵌的 data bundle 同一個道理：產生得出來的東西不進版控），
// 由 package.json 的 predev／prebuild 自動跑，已經抓過就跳過。

import { mkdir, readFile, writeFile, access } from 'node:fs/promises'
import { join, dirname, basename } from 'node:path'

const FAMILIES = ['Noto+Sans+TC:wght@400;600', 'LXGW+WenKai+TC:wght@400;700']
// css2 會依 User-Agent 回不同格式。給 Chrome 才拿得到 woff2（給 curl 預設 UA 會拿到 ttf）。
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

const OUT = join(dirname(import.meta.dirname), 'public', 'fonts')
const FILES = join(OUT, 'files')
const CSS = join(OUT, 'fonts.css')

const exists = (p) => access(p).then(() => true, () => false)

/** 併發下載，Google 對太多同時連線會變慢 */
async function pool(items, n, f) {
  const it = items[Symbol.iterator]()
  await Promise.all(
    Array.from({ length: n }, async () => {
      for (const item of it) await f(item)
    }),
  )
}

async function main() {
  if (await exists(CSS)) {
    // 已經抓過就跳過。要重抓就刪掉 app/public/fonts。
    const css = await readFile(CSS, 'utf8')
    const refs = [...css.matchAll(/url\(\/fonts\/files\/([^)]+)\)/g)].map((m) => m[1])
    const ok = await Promise.all(refs.map((r) => exists(join(FILES, r))))
    if (refs.length > 0 && ok.every(Boolean)) {
      console.log(`字型已就緒（${refs.length} 個檔）`)
      return
    }
    console.log('字型檔不完整，重新抓取…')
  }

  await mkdir(FILES, { recursive: true })
  let out = '/* 由 app/tools/fonts.mjs 產生，不要手改。來源：fonts.googleapis.com */\n'
  const jobs = []

  for (const family of FAMILIES) {
    const url = `https://fonts.googleapis.com/css2?family=${family}&display=swap`
    const res = await fetch(url, { headers: { 'User-Agent': UA } })
    if (!res.ok) throw new Error(`${url} 回應 ${res.status}`)
    let css = await res.text()
    if (!css.includes('.woff2')) throw new Error(`${family}：拿到的不是 woff2，User-Agent 可能被擋了`)

    css = css.replace(/url\((https:\/\/fonts\.gstatic\.com[^)]+)\)/g, (_, u) => {
      const name = basename(new URL(u).pathname)
      jobs.push([u, name])
      return `url(/fonts/files/${name})`
    })
    out += css
  }

  const uniq = [...new Map(jobs).entries()]
  let done = 0
  await pool(uniq, 16, async ([u, name]) => {
    const dest = join(FILES, name)
    if (!(await exists(dest))) {
      const r = await fetch(u)
      if (!r.ok) throw new Error(`${u} 回應 ${r.status}`)
      await writeFile(dest, Buffer.from(await r.arrayBuffer()))
    }
    if (++done % 50 === 0) console.log(`  ${done}/${uniq.length}`)
  })

  await writeFile(CSS, out)
  console.log(`字型完成：${uniq.length} 個 woff2 → app/public/fonts/`)
}

main().catch((e) => {
  console.error(`抓字型失敗：${e.message}`)
  process.exit(1)
})
