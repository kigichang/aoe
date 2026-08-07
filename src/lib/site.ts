/**
 * 站名。**這支要能同時被瀏覽器端與 `vite.config.ts` import**，
 * 所以裡面不可以有 `import.meta.env`、DOM，或任何只在其中一邊成立的東西 —— 純常數。
 *
 * 為什麼要抽出來：標題列的 h1（`AoE · 世界史`）與 HTML `<title>` 的預設值
 * 都要用到它，而 `<title>` 是建置期由 `vite.config.ts` 換掉的，讀不到 React
 * 那一側的東西。兩邊各抄一份字串就是遲早會分岔的那類東西 —— 同 `THEME_KEY`
 * 的教訓（見 CLAUDE.md「JS 與 CSS 之間手動同步的常數」）。
 *
 * 站名**不放進 `topic.yaml`**：那是每個主題各填一次，改站名要改 N 份，
 * 而且沒有任何機制擋住填成不一樣的值。站名是站的屬性，不是主題的屬性。
 */
export const SITE_NAME = 'AoE'
