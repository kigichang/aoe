import { invoke } from '@tauri-apps/api/core'
import type { ViewPayload } from './types'

/** 與 src-tauri/src/commands.rs 一對一。 */
export const api = {
  getViewPayload: (view: string | null) => invoke<ViewPayload>('get_view_payload', { view }),
}
