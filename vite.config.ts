import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import yaml from '@rollup/plugin-yaml'
import * as jsyaml from 'js-yaml'
// 站名同時給 <title> 與標題列的 h1 用。抄成兩份遲早會分岔，見 src/lib/site.ts。
import { SITE_NAME } from './src/lib/site'

// GitHub Pages 專案頁面掛在 https://<user>.github.io/<repo>/ 底下，
// 所以 CI 上必須把 base 設成 /<repo>/，本機開發則是 '/'。
// 這是 Pages 部署後整頁空白最常見的原因。
const repo = process.env.GITHUB_REPOSITORY?.split('/')[1]
const base = process.env.GITHUB_ACTIONS && repo ? `/${repo}/` : '/'

const root = resolve(import.meta.dirname)
const TOPICS_DIR = join(root, 'src', 'topics')

interface TopicMeta {
  name: string
  title?: string
  description: string
  root?: boolean
}

/**
 * 每個主題要有自己的 HTML entry。
 *
 * **這是因為 GitHub Pages 沒有 server-side rewrite** —— `/aoe/tw-railway/`
 * 這個路徑必須真的存在一份 index.html，靠前端 router 接不到（瀏覽器會先吃到 404）。
 * 順便讓每個主題有自己的 <title> 與 meta description。
 */
const topics = readdirSync(TOPICS_DIR, { withFileTypes: true })
  .filter((d) => d.isDirectory() && existsSync(join(TOPICS_DIR, d.name, 'topic.yaml')))
  .map((d) => ({
    slug: d.name,
    meta: jsyaml.load(
      readFileSync(join(TOPICS_DIR, d.name, 'topic.yaml'), 'utf8'),
    ) as TopicMeta,
  }))

// 跟 data.ts 同一道檢查，只是提早到建置期：沒設 root 的話根網址會是空白，
// 設兩個的話哪個贏取決於檔案順序。兩種都不該安靜地過。
const rootTopics = topics.filter((t) => t.meta.root)
if (rootTopics.length !== 1) {
  throw new Error(
    `恰好要有一個主題設定 root: true（目前有 ${rootTopics.length} 個：` +
      `${rootTopics.map((t) => t.slug).join('、') || '無'}）。` +
      `\n設了 root 的主題掛在根網址，其餘掛在 /<目錄名>/。`,
  )
}

const escapeHtml = (s: string) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

/**
 * 非 root 主題的 index.html 是**根目錄那一份的複本**，不是手寫的。
 *
 * 理由：index.html 的 <head> 有一段防閃爍的 theme inline script，裡面的
 * localStorage key 必須跟 `theme.ts` 的 THEME_KEY 一致。每個主題手抄一份，
 * 改 key 的時候就有 N 份要記得一起改，而漏改不會報錯 —— 只會在暗色系統上
 * 閃一下白底。同一段東西存兩份就是遲早會分岔，所以只留一份來源。
 *
 * 產生的檔案是 gitignored 的，刪掉也沒關係，下次跑 vite 會重建。
 */
const template = readFileSync(join(root, 'index.html'), 'utf8')

const input: Record<string, string> = { main: join(root, 'index.html') }

for (const { slug, meta } of topics) {
  if (meta.root) continue
  mkdirSync(join(root, slug), { recursive: true })
  writeFileSync(join(root, slug, 'index.html'), template)
  input[slug] = join(root, slug, 'index.html')
}

/** `/tw-railway/index.html` → tw-railway 的 meta；`/index.html` → root 主題的 */
const topicOf = (path: string) => {
  const slug = path.split('/').filter((s) => s && !s.endsWith('.html'))[0]
  return (slug ? topics.find((t) => t.slug === slug) : rootTopics[0])?.meta
}

/**
 * <title> 與 meta description 一律由 topic.yaml 決定，**根目錄那份也一樣**。
 *
 * 一開始是在產生子目錄 HTML 時做字串抽換，但那樣 root 主題的標題就留在
 * index.html 裡，變成「其他主題看 topic.yaml、根主題看 HTML」兩套規則。
 * 改用 transformIndexHtml 之後每個 entry 走同一條路徑，index.html 裡寫什麼
 * 都只是預留位，不會有人以為改那裡有用。
 */
const topicMeta = {
  name: 'topic-meta',
  transformIndexHtml(html: string, ctx: { path: string }) {
    const meta = topicOf(ctx.path)
    if (!meta) return html
    return html
      // topic.yaml 的 name 只填主題名，站名由這裡前綴 —— 跟標題列的 h1 同一個規則。
      // 想要別的分頁標題就在 topic.yaml 填 title 覆寫。
      .replace(
        /<title>[^<]*<\/title>/,
        `<title>${escapeHtml(meta.title ?? `${SITE_NAME} · ${meta.name}`)}</title>`,
      )
      .replace(
        /(<meta name="description" content=")[^"]*(")/,
        `$1${escapeHtml(meta.description)}$2`,
      )
  },
}

export default defineConfig({
  base,
  plugins: [react(), yaml(), topicMeta],
  build: {
    rollupOptions: { input },
  },
})
