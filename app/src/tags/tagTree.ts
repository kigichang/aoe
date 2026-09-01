import type { Tag } from '../types'

export interface TagNode {
  tag: Tag
  depth: number
}

/**
 * 把平的 tag 清單排成「依層級縮排」的順序，給清單與勾選框用。
 * 父層找不到（被刪了）的當根。
 */
export function tagTree(tags: Tag[]): TagNode[] {
  const byParent = new Map<string | null, Tag[]>()
  const ids = new Set(tags.map((t) => t.id))
  for (const t of tags) {
    const p = t.parentId && ids.has(t.parentId) ? t.parentId : null
    const list = byParent.get(p) ?? []
    list.push(t)
    byParent.set(p, list)
  }
  const out: TagNode[] = []
  const walk = (parent: string | null, depth: number) => {
    for (const t of byParent.get(parent) ?? []) {
      out.push({ tag: t, depth })
      walk(t.id, depth + 1)
    }
  }
  walk(null, 0)
  return out
}
