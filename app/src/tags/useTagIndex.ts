import { useCallback, useEffect, useRef, useState } from 'react'
import type { ExtraMatch } from '@web/lib/search'
import { api } from '../api'

/**
 * 給工具列搜尋框用的 Tag 索引：**畫面上的事件 id → 可比對的 tag 名稱**。
 *
 * 為什麼要有這一層：網站的 `search()` 是同步的（每次按鍵直接掃 ALL_EVENTS），
 * 而 tag 在 SQLite、只能非同步拿。所以整張表先攤平進記憶體，
 * 比對時只做一次 Set 查詢。量級是使用者自己貼的那些，可以忽略。
 *
 * 索引裡放的是 **tag 自己的名字 + 它所有祖先的名字**。這樣打「清代」找得到
 * 只貼了子 tag「清領前期」的事件 —— 跟 `events_with_tag`（含子 tag）
 * 是同一套語意，兩個入口不該一個含一個不含。展開刻意在前端做：
 * 後端展開的話同一個名字會在很多則事件上重複傳一遍。
 */
export function useTagIndex(): { match: ExtraMatch; refresh: () => void } {
  /** 事件 id → 小寫的 tag 名稱（比對用）配原樣（顯示用） */
  const [index, setIndex] = useState<Map<string, { lower: string; name: string }[]>>(new Map())
  /** 連點搜尋框不要疊發請求 */
  const busy = useRef(false)

  const refresh = useCallback(() => {
    if (busy.current) return
    busy.current = true
    Promise.all([api.listEventTagNames(), api.listTags()])
      .then(([byRef, tags]) => {
        // 名字 → 它自己與所有祖先的名字。父層被刪（parentId 對不到）就當根，同 tagTree。
        const byName = new Map(tags.map((t) => [t.name, t]))
        const byId = new Map(tags.map((t) => [t.id, t]))
        const withAncestors = (name: string) => {
          const out = [name]
          let cur = byName.get(name)?.parentId
          for (let i = 0; i < 32 && cur; i++) {
            const p = byId.get(cur)
            if (!p) break
            out.push(p.name)
            cur = p.parentId
          }
          return out
        }

        // ref → 事件 id。refs 是 Rust 端給的對照表（見 api.ts 的 refOf），不要自己猜。
        const idByRef = new Map<string, string>()
        for (const [id, r] of Object.entries(window.__AOE_DATA__?.refs ?? {})) idByRef.set(r, id)

        const next = new Map<string, { lower: string; name: string }[]>()
        for (const [r, names] of Object.entries(byRef)) {
          // 不在當前 View 的 ref 直接跳過 —— 搜尋本來就只走這個 View 的 ALL_EVENTS
          const id = idByRef.get(r)
          if (!id) continue
          const seen = new Set<string>()
          const list: { lower: string; name: string }[] = []
          for (const n of names.flatMap(withAncestors)) {
            if (seen.has(n)) continue
            seen.add(n)
            list.push({ lower: n.toLowerCase(), name: n })
          }
          next.set(id, list)
        }
        setIndex(next)
      })
      .catch(() => {
        // 索引拿不到就當作沒有 tag：搜尋照樣能用，只是少了這一道。
        // 這裡刻意不彈錯誤 —— 使用者是在打字，不該被一個背景查詢打斷。
      })
      .finally(() => {
        busy.current = false
      })
  }, [])

  // 掛載時先抓一次，消掉「第一次打開搜尋框還沒有索引」的空窗
  useEffect(refresh, [refresh])

  const match = useCallback<ExtraMatch>(
    (event, q) => {
      const list = index.get(event.id)
      if (!list) return null
      const hit = list.find((t) => t.lower.includes(q))
      return hit ? `Tag：${hit.name}` : null
    },
    [index],
  )

  return { match, refresh }
}
