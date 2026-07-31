/// <reference types="vite/client" />

// @rollup/plugin-yaml 把 .yaml 轉成 ES module；型別由 Zod 在執行期把關。
declare module '*.yaml' {
  const value: unknown
  export default value
}
