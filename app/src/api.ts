import { invoke } from '@tauri-apps/api/core'
import type { TopicCatalog, View, ViewPayload } from './types'

/** 與 src-tauri/src/commands.rs 一對一。 */
export const api = {
  getViewPayload: (view: string | null) => invoke<ViewPayload>('get_view_payload', { view }),
  listViews: () => invoke<View[]>('list_views'),
  saveView: (view: View) => invoke<void>('save_view', { view }),
  deleteView: (id: string) => invoke<void>('delete_view', { id }),
  listTopicCatalog: () => invoke<TopicCatalog[]>('list_topic_catalog'),
}

/** 切換 View = 整頁重載（見 bootstrap.ts） */
export function openView(id: string) {
  location.href = `?view=${encodeURIComponent(id)}`
}
