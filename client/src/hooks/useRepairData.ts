import { useCallback, useEffect, useState } from 'react'
import { apiBase } from '../api'
import type { ApiFetch, EventRecord, LookupRecord, MaxUidResponse, RepairRecord } from '../types'

class SessionExpiredError extends Error {}

function checkSession(...responses: Response[]) {
  if (responses.some((response) => response.status === 401)) {
    throw new SessionExpiredError()
  }
}

export function useRepairData(apiFetch: ApiFetch) {
  const [repairs, setRepairs] = useState<RepairRecord[]>([])
  const [events, setEvents] = useState<EventRecord[]>([])
  const [sources, setSources] = useState<LookupRecord[]>([])
  const [sections, setSections] = useState<LookupRecord[]>([])
  const [repairers, setRepairers] = useState<LookupRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [maxRpUid, setMaxRpUid] = useState(0)

  const loadData = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      const [eventsResponse, repairsResponse] = await Promise.all([
        apiFetch(`${apiBase}/api/events`),
        apiFetch(`${apiBase}/api/repairs`),
      ])
      checkSession(eventsResponse, repairsResponse)

      const [sourcesResponse, sectionsResponse, repairersResponse] = await Promise.all([
        apiFetch(`${apiBase}/api/lookups/source`),
        apiFetch(`${apiBase}/api/lookups/section`),
        apiFetch(`${apiBase}/api/lookups/repairer`),
      ])
      checkSession(sourcesResponse, sectionsResponse, repairersResponse)

      const maxUidResponse = await apiFetch(`${apiBase}/api/repairs/max-uid`)
      checkSession(maxUidResponse)

      if (!eventsResponse.ok || !repairsResponse.ok || !sourcesResponse.ok || !sectionsResponse.ok || !repairersResponse.ok || !maxUidResponse.ok) {
        throw new Error('API request failed')
      }

      const eventsData: EventRecord[] = await eventsResponse.json()
      const repairsData: RepairRecord[] = await repairsResponse.json()
      const sourcesData: LookupRecord[] = await sourcesResponse.json()
      const sectionsData: LookupRecord[] = await sectionsResponse.json()
      const repairersData: LookupRecord[] = await repairersResponse.json()
      const maxUidData: MaxUidResponse = await maxUidResponse.json()
      setEvents(eventsData)
      setRepairs(repairsData)
      setSources(sourcesData)
      setSections(sectionsData)
      setRepairers(repairersData)
      setMaxRpUid(Number.isFinite(maxUidData.maxUid) ? maxUidData.maxUid : 0)
    } catch (error) {
      setError(error instanceof SessionExpiredError
        ? 'Your session has expired. Please sign out and sign in again.'
        : 'Unable to load repair data from the API.')
    } finally {
      setLoading(false)
    }
  }, [apiFetch])

  useEffect(() => {
    void loadData()
  }, [loadData])

  return { repairs, setRepairs, events, setEvents, sources, sections, repairers, loading, error, maxRpUid, setMaxRpUid, loadData }
}

export type RepairData = ReturnType<typeof useRepairData>
