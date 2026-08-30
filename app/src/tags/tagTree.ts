import type { Tag, TagGroup } from '../types'

export interface TagNode {
  tag: Tag
  depth: number
}

/**
 * 把平的 tag 清單排成「依分組 → 依層級縮排」的順序，給清單與勾選框用。
 * 父層找不到（被刪了）的當根。
 */
export function tagTree(tags: Tag[], groups: TagGroup[]): { group: TagGroup | null; nodes: TagNode[] }[] {
  const byParent = new Map<string | null, Tag[]>()
  const ids = new Set(tags.map((t) => t.id))
  for (const t of tags) {
    const p = t.parentId && ids.has(t.parentId) ? t.parentId : null
    const list = byParent.get(p) ?? []
    list.push(t)
    byParent.set(p, list)
  }
  const walk = (parent: string | null, depth: number, groupId: string | null, out: TagNode[]) => {
    for (const t of byParent.get(parent) ?? []) {
      // 分組只看根層；子層跟著父層走，不管自己的 groupId
      if (depth === 0 && (t.groupId ?? null) !== groupId) continue
      out.push({ tag: t, depth })
      walk(t.id, depth + 1, groupId, out)
    }
  }
  const sections: { group: TagGroup | null; nodes: TagNode[] }[] = []
  for (const g of groups) {
    const nodes: TagNode[] = []
    walk(null, 0, g.id, nodes)
    sections.push({ group: g, nodes })
  }
  const loose: TagNode[] = []
  walk(null, 0, null, loose)
  // 分組被刪掉的 tag（groupId 指向不存在的分組）也算未分組
  const known = new Set(groups.map((g) => g.id))
  for (const t of byParent.get(null) ?? []) {
    if (t.groupId && !known.has(t.groupId)) {
      loose.push({ tag: t, depth: 0 })
      walk(t.id, 1, t.groupId, loose)
    }
  }
  if (loose.length) sections.push({ group: null, nodes: loose })
  return sections
}
