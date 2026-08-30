// 檢查一個「乾淨機器第一次啟動」之後的資料庫長得對不對。
//
//   node --experimental-sqlite tools/smoke-check.mjs "<aoe.sqlite 的路徑>"
//   （Node 24 起 node:sqlite 已穩定，不需要旗標）
//
// 驗的是**內嵌 bundle 那條路徑**：安裝檔裡 include_bytes! 進去的資料，
// 在完全沒有 repo YAML、也還沒按過「檢查更新」的情況下，有沒有自己把上游表建起來。
// 這是發布版最重要的一條路 —— 使用者裝完打開就該看到完整的時間軸。
//
// 期望值刻意不寫死數字：事件數每次補資料都會變，寫死就變成每補一批資料就得改這裡。
// 改成檢查「有沒有到一個合理的量級」與「內建 View 有沒有跟主題數對上」。

import { DatabaseSync } from 'node:sqlite'

const path = process.argv[2]
if (!path) {
  console.error('用法：node tools/smoke-check.mjs <aoe.sqlite>')
  process.exit(2)
}

// 刻意**不開 readOnly**：App 是被強制關掉的，WAL 裡可能還有沒 checkpoint 的東西，
// 唯讀開啟會讀到還原前的狀態或直接失敗。可寫開啟才會讓 sqlite 先把 WAL 收乾淨。
const db = new DatabaseSync(path)
const one = (sql) => Object.values(db.prepare(sql).get() ?? {})[0]

const version = one('SELECT version FROM bundle_meta')
const topics = one('SELECT COUNT(*) FROM topics')
const events = one('SELECT COUNT(*) FROM events')
const periods = one('SELECT COUNT(*) FROM periods')
const views = one('SELECT COUNT(*) FROM views WHERE builtin = 1')

console.log(`version=${version} topics=${topics} events=${events} periods=${periods} builtinViews=${views}`)

const fail = []
// version 不該是 "repo"：那代表它讀到了 repo 的 YAML，不是內嵌的 bundle，
// 這條 smoke test 也就沒有驗到發布版真正會走的路。
if (!version || version === 'repo') fail.push(`bundle_meta.version 是 "${version}"，不是內嵌 bundle 的版本`)
if (topics < 2) fail.push(`主題只有 ${topics} 個`)
if (events < 1000) fail.push(`事件只有 ${events} 則，內嵌 bundle 多半沒載進來`)
if (periods < 100) fail.push(`時期只有 ${periods} 段`)
// 每個主題自動建一個內建 View（db.rs 的 replace_upstream）
if (views !== topics) fail.push(`內建 View ${views} 個，與主題數 ${topics} 對不上`)

if (fail.length) {
  console.error('\n乾淨機器首次啟動的資料不正確：')
  for (const f of fail) console.error(`  - ${f}`)
  process.exit(1)
}
console.log('OK：內嵌 bundle 在乾淨機器上自己把上游表建起來了')
