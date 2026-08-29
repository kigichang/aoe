import { resolve } from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * 桌面版的前端就是網站的程式碼（`../src`），只換掉兩支檔案：
 *
 *   ../src/lib/data.ts   → src/shims/data.ts   資料改從 window.__AOE_DATA__ 來
 *   ../src/lib/topic.ts  → src/shims/topic.ts  「當前主題」改由 payload 決定
 *
 * 換法是**比對解析後的絕對路徑**，不是比對 import 字串 —— `App.tsx` 寫的是
 * `./lib/data`、`scale.ts` 寫的是 `./data`，用字串 alias 要列舉每一種寫法，
 * 而且日後網站多一種寫法這裡就漏掉。resolveId 之後再攔，一律抓得到。
 *
 * 其餘網站程式碼（scale／layout／search／所有元件／styles.css）一行不改，
 * 也**不複製**：`@web/*` 直接指到 `../src/*`。
 */
const WEB = resolve(import.meta.dirname, '../src')
const SHIMS: Record<string, string> = {
  [resolve(WEB, 'lib/data.ts')]: resolve(import.meta.dirname, 'src/shims/data.ts'),
  [resolve(WEB, 'lib/topic.ts')]: resolve(import.meta.dirname, 'src/shims/topic.ts'),
}

const shims: Plugin = {
  name: 'aoe-shims',
  enforce: 'pre',
  async resolveId(source, importer, opts) {
    const r = await this.resolve(source, importer, { ...opts, skipSelf: true })
    if (r && SHIMS[r.id]) return SHIMS[r.id]
    return null
  },
}

export default defineConfig({
  plugins: [shims, react()],
  resolve: { alias: { '@web': WEB }, dedupe: ['react', 'react-dom', 'zod'] },
  // Tauri 的 dev server 埠號要固定，tauri.conf.json 的 devUrl 對著它
  server: { port: 1420, strictPort: true, fs: { allow: ['..'] } },
  clearScreen: false,
  envPrefix: ['VITE_', 'TAURI_ENV_'],
  build: { target: 'es2022' },
})
