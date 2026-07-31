import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import yaml from '@rollup/plugin-yaml'

// GitHub Pages 專案頁面掛在 https://<user>.github.io/<repo>/ 底下，
// 所以 CI 上必須把 base 設成 /<repo>/，本機開發則是 '/'。
// 這是 Pages 部署後整頁空白最常見的原因。
const repo = process.env.GITHUB_REPOSITORY?.split('/')[1]
const base = process.env.GITHUB_ACTIONS && repo ? `/${repo}/` : '/'

export default defineConfig({
  base,
  plugins: [react(), yaml()],
})
