import { invoke } from '@tauri-apps/api/core'
import type { TopicCatalog, UserEvent, View, ViewPayload } from './types'

/** 與 src-tauri/src/commands.rs 一對一。 */
export const api = {
  getViewPayload: (view: string | null) => invoke<ViewPayload>('get_view_payload', { view }),
  listViews: () => invoke<View[]>('list_views'),
  saveView: (view: View) => invoke<void>('save_view', { view }),
  deleteView: (id: string) => invoke<void>('delete_view', { id }),
  listTopicCatalog: () => invoke<TopicCatalog[]>('list_topic_catalog'),
  listUserEvents: () => invoke<UserEvent[]>('list_user_events'),
  getUserEvent: (ref: string) => invoke<UserEvent | null>('get_user_event', { ref }),
  saveUserEvent: (event: UserEvent) => invoke<void>('save_user_event', { event }),
  deleteUserEvent: (ref: string) => invoke<void>('delete_user_event', { ref }),
  /** 回傳寫出的檔案路徑 */
  exportUserEvents: () => invoke<string[]>('export_user_events'),
}

/** 切換 View = 整頁重載（見 bootstrap.ts） */
export function openView(id: string) {
  location.href = `?view=${encodeURIComponent(id)}`
}
