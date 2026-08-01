import fs from 'node:fs'; import * as yaml from 'js-yaml'
const UA = { 'User-Agent': 'aoe-data-lint/0.1' }
const regions = [['taiwan','台灣'],['japan','日本'],['china','中國'],['europe','歐洲']]
const used = new Map()
for (const [dir, name] of regions)
  for (const e of yaml.load(fs.readFileSync(`src/data/${dir}/events.yaml`,'utf8')))
    for (const s of e.sources ?? []) {
      const t = decodeURIComponent(s.url.split('/wiki/')[1])
      if (!used.has(t)) used.set(t, [])
      used.get(t).push(`${name} ${e.year} ${e.title}`)
    }
const all = [...used.keys()]
const flagged = []
for (let i = 0; i < all.length; i += 40) {
  const batch = all.slice(i, i + 40)
  await new Promise((r) => setTimeout(r, 1200))
  const j = await (await fetch('https://zh.wikipedia.org/w/api.php?format=json&' + new URLSearchParams({
    action:'query', redirects:1, converttitles:'zh-hans', prop:'pageprops', ppprop:'disambiguation',
    titles: batch.join('|'),
  }), { headers: UA })).json()
  const chain = new Map()
  for (const g of ['normalized','converted','redirects']) for (const r of j.query[g] ?? []) chain.set(r.to, r.from)
  const root = (t) => { let x=t, seen=new Set(); while (chain.has(x) && !seen.has(x)) { seen.add(x); x=chain.get(x) } return x }
  for (const p of Object.values(j.query.pages))
    if (p.pageprops?.disambiguation !== undefined) flagged.push([root(p.title), p.title])
}
console.log(`\n掃描 ${all.length} 個條目，找到 ${flagged.length} 個消歧義頁：\n`)
for (const [orig, resolved] of flagged) {
  console.log(`  ✗ ${orig}${orig !== resolved ? `  （解析為 ${resolved}）` : ''}`)
  used.get(orig).forEach((e) => console.log(`      用於 ${e}`))
}
