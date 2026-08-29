/**
 * 取代 ../src/lib/topic.ts。網站從 pathname 推主題；桌面版由 payload 決定。
 * `slugFromPath` 照抄簽名以防日後有人 import 它。
 */
export function slugFromPath(pathname: string, base: string): string | null {
  let rest = pathname
  if (base !== '/' && rest.startsWith(base)) rest = rest.slice(base.length)
  else if (base !== '/' && rest === base.slice(0, -1)) rest = ''
  else if (base === '/') rest = rest.slice(1)
  const first = rest.split('/').filter((s) => s && !s.endsWith('.html'))[0]
  return first ?? null
}

export const TOPIC_SLUG: string | null = window.__AOE_DATA__?.viewId ?? null
