export interface RepairRecord {
  repair_id: number
  rp_uid: number
  rp_event: number
  rp_item: string
  rp_problem: string
  rp_section: number
  rp_source: number
  rp_repairer: number
  rp_tryfix: number
  rp_fixed: number
  rp_comments: string
  event_date: string
  venue_name: string | null
  section_name: string | null
  source_name: string | null
  repairer_name: string | null
}

export interface EventRecord {
  event_id: number
  ev_date: string
  ev_comment: string
  venue_name: string | null
}

export interface EventSummary {
  event_id: number
  ev_date: string
  venue_name: string | null
  total_repairs: number
  fixed_repairs: number
}

export interface LookupRecord {
  lookup_id: number
  lk_name: string
}

export interface RepairFormData {
  rp_uid: string
  rp_event: string
  rp_item: string
  rp_problem: string
  rp_section: string
  rp_source: string
  rp_repairer: string
  rp_tryfix: boolean
  rp_fixed: boolean
  rp_comments: string
}

export interface MaxUidResponse {
  maxUid: number
}

export interface ImportSummaryResponse {
  totalRows: number
  inserted: number
  skippedExisting: number
  skippedInvalid: number
}

export interface AuthUser {
  email: string
  luName: string
  isAdmin: boolean
}

export type ApiFetch = (url: string, options?: RequestInit) => Promise<Response>
