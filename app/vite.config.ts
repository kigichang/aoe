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

/**
 * **路徑一律轉成正斜線再比對。** `resolve()` 在 Windows 上給的是
 * `D:\a\aoe\src\lib\data.ts`，但 Vite／Rollup 的 `id` 一律是正斜線
 * （`D:/a/aoe/src/lib/data.ts`）—— 直接拿兩者比對，在 Windows 上永遠不相等。
 *
 * 這個 bug 沒有任何錯誤訊息：shim 不生效，於是真正的 `data.ts` 被拉進來，
 * 它的 `import.meta.glob('../topics/*\/*\/events.yaml')` 又需要
 * `@rollup/plugin-yaml`（桌面版刻意沒裝），最後炸在一個看起來毫不相干的地方 ——
 * 「`topic.yaml` 第 1 行有個沒見過的字元 `。`」。macOS 上完全正常，只有 Windows 會壞。
 */
const norm = (p: string) => p.replace(/\\/g, '/')

const SHIMS: Record<string, string> = {
  [norm(resolve(WEB, 'lib/data.ts'))]: resolve(import.meta.dirname, 'src/shims/data.ts'),
  [norm(resolve(WEB, 'lib/topic.ts'))]: resolve(import.meta.dirname, 'src/shims/topic.ts'),
}

/**
 * `data.ts` 是**必須**換到的那一支（整個 View 機制都靠它）。`topic.ts` 只是保險 ——
 * 目前沒有人 import 它（唯一的 importer 就是 data.ts，而它已經被換掉了），
 * 所以不能要求它一定要命中。
 */
const REQUIRED = norm(resolve(WEB, 'lib/data.ts'))
const used = new Set<string>()

const shims: Plugin = {
  name: 'aoe-shims',
  enforce: 'pre',
  async resolveId(source, importer, opts) {
    const r = await this.resolve(source, importer, { ...opts, skipSelf: true })
    if (!r) return null
    // YAML 進到桌面版的模組圖，就代表網站那份 data.ts 的 import.meta.glob 生效了，
    // 也就是 shim 沒換到。這是上面那個 Windows bug 的直接症狀，在這裡攔比較好懂 ——
    // 讓它繼續走下去的話，錯誤會變成「topic.yaml 第 1 行有個沒見過的字元」。
    if (r.id.endsWith('.yaml')) {
      this.error(`桌面版不該打包 YAML，但 ${importer ?? '?'} 要求了 ${r.id}——aoe-shims 沒換到 data.ts。`)
    }
    const hit = SHIMS[norm(r.id)]
    if (!hit) return null
    used.add(norm(r.id))
    return hit
  },
  /**
   * **沒換到就讓建置失敗。** 上面那個 Windows bug 之所以難查，是因為它安靜 ——
   * 換不到只是「網站的 data.ts 被打進去了」，資料會變成從 YAML 來而不是從
   * `window.__AOE_DATA__` 來，整個 View 機制默默失效。
   */
  buildEnd() {
    if (!used.has(REQUIRED)) {
      this.error(
        `aoe-shims 沒有替換到 ${REQUIRED}` +
          `\n路徑比對失敗（Windows 的反斜線？）或那支檔案已經沒有人 import 了。`,
      )
    }
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
