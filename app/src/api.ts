import { invoke } from '@tauri-apps/api/core'
import type { EventHit, EventLink, LinkInput, Tag, TagGroup, TopicCatalog, UserEvent, View, ViewPayload } from './types'

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

  listTagGroups: () => invoke<TagGroup[]>('list_tag_groups'),
  saveTagGroup: (group: TagGroup) => invoke<void>('save_tag_group', { group }),
  deleteTagGroup: (id: string) => invoke<void>('delete_tag_group', { id }),
  listTags: () => invoke<Tag[]>('list_tags'),
  saveTag: (tag: Tag) => invoke<void>('save_tag', { tag }),
  deleteTag: (id: string) => invoke<void>('delete_tag', { id }),
  getEventTags: (ref: string) => invoke<string[]>('get_event_tags', { ref }),
  setEventTags: (ref: string, tagIds: string[], title: string) =>
    invoke<void>('set_event_tags', { ref, tagIds, title }),
  eventsWithTag: (tagId: string) => invoke<EventHit[]>('events_with_tag', { tagId }),
  searchEvents: (query: string, limit = 30) => invoke<EventHit[]>('search_events', { query, limit }),

  listLinks: (ref: string) => invoke<EventLink[]>('list_links', { ref }),
  saveLink: (link: LinkInput) => invoke<void>('save_link', { link }),
  deleteLink: (id: string) => invoke<void>('delete_link', { id }),
}

/** 切換 View = 整頁重載（見 bootstrap.ts） */
export function openView(id: string) {
  location.href = `?view=${encodeURIComponent(id)}`
}

/** 畫面上的事件 id → 全域 ref。跨主題 View 的 id 有前綴，由 Rust 端給對照表，這裡不猜。 */
export function refOf(eventId: string): string {
  const r = window.__AOE_DATA__?.refs[eventId]
  if (!r) throw new Error(`找不到事件 ${eventId} 的 ref`)
  return r
}

/**
 * 跳到某一則事件。在目前這個 View 裡就只換 hash（網站的 hashchange 會接手），
 * 不在就開它自己主題的 View。孤兒（已對不到事件）不能跳。
 */
export function gotoHit(hit: EventHit) {
  if (hit.orphan) return
  const data = window.__AOE_DATA__
  const inView = data && Object.entries(data.refs).find(([, r]) => r === hit.ref)
  if (inView) {
    location.hash = `e=${encodeURIComponent(inView[0])}`
  } else {
    location.href = `?view=${encodeURIComponent(hit.topic)}#e=${encodeURIComponent(hit.eventId)}`
  }
}
