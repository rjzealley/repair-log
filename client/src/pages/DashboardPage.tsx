import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { apiBase } from '../api'
import { RepairTrends } from '../components/RepairTrends'
import type { ApiFetch, EventRecord, EventSummary, LookupRecord } from '../types'
import type { RepairData } from '../hooks/useRepairData'
import { formatDate } from '../utils'

interface Props {
  data: RepairData
  isAdmin: boolean
  apiFetch: ApiFetch
}

export function DashboardPage({ data, isAdmin, apiFetch }: Props) {
  const { events, setEvents, repairs, loading, error } = data
  const navigate = useNavigate()
  const [isEventModalOpen, setIsEventModalOpen] = useState(false)
  const [eventDate, setEventDate] = useState('')
  const [eventVenue, setEventVenue] = useState('')
  const [eventComment, setEventComment] = useState('')
  const [venues, setVenues] = useState<LookupRecord[]>([])
  const [loadingVenues, setLoadingVenues] = useState(false)
  const [savingEvent, setSavingEvent] = useState(false)
  const [eventError, setEventError] = useState<string | null>(null)
  const [eventSummaries, setEventSummaries] = useState<EventSummary[]>([])
  const [loadingSummaries, setLoadingSummaries] = useState(true)
  const [summaryError, setSummaryError] = useState<string | null>(null)

  const now = new Date()
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`

  useEffect(() => {
    if (loading || error) return

    const controller = new AbortController()
    const loadSummaries = async () => {
      setLoadingSummaries(true)
      setSummaryError(null)
      try {
        const response = await apiFetch(`${apiBase}/api/events/summary?toDate=${encodeURIComponent(today)}`, { signal: controller.signal })
        if (!response.ok) throw new Error('Unable to load event totals.')
        const summaries: EventSummary[] = await response.json()
        if (!controller.signal.aborted) setEventSummaries(summaries)
      } catch {
        if (!controller.signal.aborted) setSummaryError('Unable to load event totals. Please refresh to try again.')
      } finally {
        if (!controller.signal.aborted) setLoadingSummaries(false)
      }
    }

    void loadSummaries()
    return () => controller.abort()
  }, [apiFetch, today, events, loading, error])

  const openRepairsForEvent = (eventId: number) => navigate(`/repairs?event=${eventId}`)

  const openAddEventDialog = async () => {
    setEventDate('')
    setEventVenue('')
    setEventComment('')
    setEventError(null)
    setVenues([])
    setLoadingVenues(true)
    setIsEventModalOpen(true)

    try {
      const response = await apiFetch(`${apiBase}/api/lookups/venue`)
      if (!response.ok) {
        throw new Error('Unable to load venues. Please close the dialog and try again.')
      }
      const venueData: LookupRecord[] = await response.json()
      setVenues(venueData)
      if (venueData.length === 0) {
        setEventError('No venues are available. An administrator must add a venue to the lookup table first.')
      }
    } catch (error) {
      setEventError(error instanceof Error ? error.message : 'Unable to load venues.')
    } finally {
      setLoadingVenues(false)
    }
  }

  const handleAddEvent = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSavingEvent(true)
    setEventError(null)

    try {
      const response = await apiFetch(`${apiBase}/api/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ev_date: eventDate, ev_venue: Number(eventVenue), ev_comment: eventComment }),
      })
      if (!response.ok) {
        const result: { message?: string } = await response.json().catch(() => ({}))
        throw new Error(result.message ?? 'Unable to add event.')
      }

      const created: EventRecord = await response.json()
      setEvents((current) => [...current, created].sort((a, b) => (
        b.ev_date.slice(0, 10).localeCompare(a.ev_date.slice(0, 10)) || b.event_id - a.event_id
      )))
      setIsEventModalOpen(false)
    } catch (error) {
      setEventError(error instanceof Error ? error.message : 'Unable to add event.')
    } finally {
      setSavingEvent(false)
    }
  }

  return (
    <>
      {!loading && !error && (
        <section className="dashboard" aria-live="polite">
          <div className="stat-card">
            <h3>Total Items</h3>
            <p>{repairs.length}</p>
          </div>
          <div className="stat-card">
            <h3>Fixed Items</h3>
            <p>
              {(() => {
                const fixedCount = repairs.filter((item) => item.rp_fixed).length
                const percent = repairs.length === 0 ? 0 : Math.round((fixedCount / repairs.length) * 100)
                return `${fixedCount} (${percent}%)`
              })()}
            </p>
          </div>

          <div className="stat-card dashboard-events-card">
            <div className="dashboard-events-header">
              <div className="dashboard-events-title">
                <h2>Events Summary</h2>
                {isAdmin && (
                  <button type="button" className="add-button" onClick={() => { void openAddEventDialog() }}>
                    Add Event
                  </button>
                )}
              </div>
              <p>Click an event to open the Repair Log with that event selected.</p>
            </div>

            {loadingSummaries && <p className="dashboard-empty">Loading event totals...</p>}
            {!loadingSummaries && summaryError && <p className="dashboard-empty" role="alert">{summaryError}</p>}
            {!loadingSummaries && !summaryError && (
              <table className="dashboard-events-table">
                <thead>
                  <tr>
                    <th scope="col">Date</th>
                    <th scope="col">Venue</th>
                    <th scope="col">Repairs</th>
                    <th scope="col">Fixed</th>
                    <th scope="col">% Fixed</th>
                  </tr>
                </thead>
                <tbody>
                  {eventSummaries.length === 0 && (
                    <tr><td colSpan={5}>No past events found.</td></tr>
                  )}
                  {eventSummaries.slice(0, 7).map((event) => (
                    <tr key={event.event_id} className="dashboard-event-row" onClick={() => openRepairsForEvent(event.event_id)}>
                      <td>
                        <button type="button" className="dashboard-event-link" aria-label={`Open repairs for ${formatDate(event.ev_date)} at ${event.venue_name ?? 'Unknown venue'}`}>
                          {formatDate(event.ev_date)}
                        </button>
                      </td>
                      <td>{event.venue_name ?? 'Unknown venue'}</td>
                      <td>{event.total_repairs}</td>
                      <td>{event.fixed_repairs}</td>
                      <td>{event.total_repairs === 0 ? 0 : Math.round((event.fixed_repairs / event.total_repairs) * 100)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <div className="stat-card">
            <h3>Repair Trends</h3>
            {loadingSummaries && <p className="trend-message">Loading event totals...</p>}
            {!loadingSummaries && summaryError && <p className="trend-message" role="alert">{summaryError}</p>}
            {!loadingSummaries && !summaryError && <RepairTrends events={eventSummaries} />}
          </div>
        </section>
      )}
      {isEventModalOpen && (
        <div className="modal-backdrop" role="presentation" onClick={() => { if (!savingEvent) setIsEventModalOpen(false) }}>
          <section className="modal" role="dialog" aria-modal="true" aria-label="Add event" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <h2>Add Event</h2>
              <button type="button" className="modal-close" onClick={() => setIsEventModalOpen(false)} disabled={savingEvent} aria-label="Close dialog">
                X
              </button>
            </div>
            <form onSubmit={handleAddEvent}>
              <div className="modal-grid">
                <label>
                  Date
                  <input type="date" value={eventDate} onChange={(event) => setEventDate(event.target.value)} min="1000-01-01" max="9999-12-31" required />
                </label>
                <label>
                  Venue
                  <select value={eventVenue} onChange={(event) => setEventVenue(event.target.value)} required disabled={loadingVenues}>
                    <option value="">{loadingVenues ? 'Loading venues...' : 'Select venue'}</option>
                    {venues.map((venue) => (
                      <option key={venue.lookup_id} value={venue.lookup_id}>{venue.lk_name}</option>
                    ))}
                  </select>
                </label>
                <label className="wide">
                  Comment (optional)
                  <textarea value={eventComment} onChange={(event) => setEventComment(event.target.value)} maxLength={255} />
                </label>
              </div>
              {eventError && <p className="status error event-form-error" role="alert">{eventError}</p>}
              <div className="modal-actions event-form-actions">
                <button type="button" onClick={() => setIsEventModalOpen(false)} disabled={savingEvent}>Cancel</button>
                <button type="submit" disabled={savingEvent || loadingVenues || venues.length === 0}>
                  {savingEvent ? 'Saving...' : 'Add Event'}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </>
  )
}
