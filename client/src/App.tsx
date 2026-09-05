import { useCallback, useEffect, useMemo, useState } from 'react'
import './App.css'
import logoOnly from './assets/Logo_only_trans.png'

interface RepairRecord {
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

interface EventRecord {
  event_id: number
  ev_date: string
  ev_comment: string
  venue_name: string | null
}

interface LookupRecord {
  lookup_id: number
  lk_name: string
}

interface RepairFormData {
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

interface MaxUidResponse {
  maxUid: number
}

interface ImportSummaryResponse {
  totalRows: number
  inserted: number
  skippedExisting: number
  skippedInvalid: number
}

interface AuthUser {
  email: string
  luName: string
  isAdmin: boolean
}

type AppPage = 'dashboard' | 'repairs'

const formatDate = (dateValue: string): string => {
  const isoMatch = dateValue.match(/^(\d{4})-(\d{2})-(\d{2})/)

  if (!isoMatch) {
    return dateValue
  }

  const [, year, month, day] = isoMatch
  return `${day}/${month}/${year}`
}

const parseOptionalNumber = (value: string): number => {
  if (!value.trim()) {
    return 0
  }

  const parsed = Number.parseInt(value, 10)
  return Number.isNaN(parsed) ? 0 : parsed
}

function App() {
  const apiBase = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? 'http://localhost:5000'
  const [token, setToken] = useState<string | null>(() => window.localStorage.getItem('repair-log-token'))
  const [authUser, setAuthUser] = useState<AuthUser | null>(() => {
    const storedUser = window.localStorage.getItem('repair-log-user')
    if (!storedUser) {
      return null
    }

    try {
      return JSON.parse(storedUser) as AuthUser
    } catch {
      return null
    }
  })
  const [isLoginOpen, setIsLoginOpen] = useState(false)
  const [loginEmail, setLoginEmail] = useState('')
  const [loginPassword, setLoginPassword] = useState('')
  const [loginError, setLoginError] = useState<string | null>(null)
  const [loggingIn, setLoggingIn] = useState(false)
  const [activePage, setActivePage] = useState<AppPage>('dashboard')
  const [repairs, setRepairs] = useState<RepairRecord[]>([])
  const [events, setEvents] = useState<EventRecord[]>([])
  const [sources, setSources] = useState<LookupRecord[]>([])
  const [sections, setSections] = useState<LookupRecord[]>([])
  const [repairers, setRepairers] = useState<LookupRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedEventId, setSelectedEventId] = useState<number | 'all'>('all')
  const [selectedSectionId, setSelectedSectionId] = useState<number | 'all'>('all')
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingRepairId, setEditingRepairId] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)
  const [importing, setImporting] = useState(false)
  const [importMessage, setImportMessage] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [maxRpUid, setMaxRpUid] = useState(0)
  const [formData, setFormData] = useState<RepairFormData>({
    rp_uid: '0',
    rp_event: '',
    rp_item: '',
    rp_problem: '',
    rp_section: '',
    rp_source: '',
    rp_repairer: '',
    rp_tryfix: false,
    rp_fixed: false,
    rp_comments: '',
  })

  const isEditing = editingRepairId !== null
  const isAdmin = authUser?.isAdmin === true

  const apiFetch = useCallback(async (url: string, options: RequestInit = {}) => {
    const headers = new Headers(options.headers)
    if (token) {
      headers.set('Authorization', `Bearer ${token}`)
    }

    return fetch(url, { ...options, headers })
  }, [token])

  const handleLogin = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setLoggingIn(true)
    setLoginError(null)

    try {
      const response = await fetch(`${apiBase}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: loginEmail, password: loginPassword }),
      })

      if (!response.ok) {
        const result: { message?: string } = await response.json().catch(() => ({}))
        throw new Error(result.message ?? 'Login failed.')
      }

      const result: { token: string; user: AuthUser } = await response.json()
      window.localStorage.setItem('repair-log-token', result.token)
      const user = result.user
      window.localStorage.setItem('repair-log-user', JSON.stringify(user))
      setToken(result.token)
      setAuthUser(user)
      setIsLoginOpen(false)
      setLoginPassword('')
    } catch (error) {
      setLoginError(error instanceof Error ? error.message : 'Login failed.')
    } finally {
      setLoggingIn(false)
    }
  }

  const loadData = useCallback(async () => {
      setLoading(true)
      setError(null)

      try {
        const [eventsResponse, repairsResponse] = await Promise.all([
          apiFetch(`${apiBase}/api/events`),
          apiFetch(`${apiBase}/api/repairs?limit=250`),
        ])

        const [sourcesResponse, sectionsResponse, repairersResponse] = await Promise.all([
          apiFetch(`${apiBase}/api/lookups/source`),
          apiFetch(`${apiBase}/api/lookups/section`),
          apiFetch(`${apiBase}/api/lookups/repairer`),
        ])

        const maxUidResponse = await apiFetch(`${apiBase}/api/repairs/max-uid`)

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
      } catch {
        setError('Unable to load repair data from the API.')
      } finally {
        setLoading(false)
      }
    }, [apiBase, apiFetch])

  useEffect(() => {
    void loadData()
  }, [loadData])

  const handleImportCsv = async () => {
    setImporting(true)
    setImportMessage(null)

    try {
      const response = await apiFetch(`${apiBase}/api/import/repairs-csv`, {
        method: 'POST',
      })

      if (!response.ok) {
        throw new Error('Import failed')
      }

      const result: ImportSummaryResponse = await response.json()
      setImportMessage(
        `Imported ${result.inserted} new records (skipped existing: ${result.skippedExisting}, invalid: ${result.skippedInvalid}, total rows: ${result.totalRows}).`,
      )

      await loadData()
    } catch {
      setImportMessage('Import failed. Please check API and CSV path configuration.')
    } finally {
      setImporting(false)
    }
  }

  const filteredRepairs = useMemo(() => {
    return repairs.filter((item) => {
      const matchesEvent = selectedEventId === 'all' || item.rp_event === selectedEventId
      const matchesSection = selectedSectionId === 'all' || item.rp_section === selectedSectionId
      return matchesEvent && matchesSection
    })
  }, [repairs, selectedEventId, selectedSectionId])

  const dashboardEvents = useMemo(() => {
    return events.map((event) => {
      const eventRepairs = repairs.filter((item) => item.rp_event === event.event_id)
      const totalRepairs = eventRepairs.length
      const fixedRepairs = eventRepairs.filter((item) => item.rp_fixed).length

      return {
        eventId: event.event_id,
        eventDate: event.ev_date,
        venueName: event.venue_name ?? 'Unknown venue',
        totalRepairs,
        fixedRepairs,
        percentFixed: totalRepairs === 0 ? 0 : Math.round((fixedRepairs / totalRepairs) * 100),
      }
    })
  }, [events, repairs])

  const openRepairsForEvent = (eventId: number) => {
    setSelectedEventId(eventId)
    setActivePage('repairs')
  }

  const resetForm = (uidValue = 0) => {
    setFormData({
      rp_uid: String(uidValue),
      rp_event: '',
      rp_item: '',
      rp_problem: '',
      rp_section: '',
      rp_source: '',
      rp_repairer: '',
      rp_tryfix: false,
      rp_fixed: false,
      rp_comments: '',
    })
    setFormError(null)
  }

  const openAddDialog = () => {
    setEditingRepairId(null)
    const defaultEvent = selectedEventId === 'all' ? '' : String(selectedEventId)
    resetForm(maxRpUid + 1)
    setFormData((current) => ({ ...current, rp_event: defaultEvent }))
    setIsModalOpen(true)
  }

  const openEditDialog = (repair: RepairRecord) => {
    setEditingRepairId(repair.repair_id)
    setFormData({
      rp_uid: String(repair.rp_uid),
      rp_event: String(repair.rp_event),
      rp_item: repair.rp_item,
      rp_problem: repair.rp_problem,
      rp_section: String(repair.rp_section),
      rp_source: String(repair.rp_source),
      rp_repairer: String(repair.rp_repairer),
      rp_tryfix: Boolean(repair.rp_tryfix),
      rp_fixed: Boolean(repair.rp_fixed),
      rp_comments: repair.rp_comments,
    })
    setFormError(null)
    setIsModalOpen(true)
  }

  const closeDialog = () => {
    setIsModalOpen(false)
    setSaving(false)
    setFormError(null)
  }

  const handleDelete = async (repairId: number) => {
    const shouldDelete = window.confirm('Delete this repair record?')
    if (!shouldDelete) {
      return
    }

    try {
      const response = await apiFetch(`${apiBase}/api/repairs/${repairId}`, { method: 'DELETE' })
      if (!response.ok) {
        throw new Error('Delete failed')
      }

      setRepairs((current) => current.filter((item) => item.repair_id !== repairId))
    } catch {
      window.alert('Delete failed. Please try again.')
    }
  }

  const handleSave = async () => {
    if (!formData.rp_event || !formData.rp_item.trim() || !formData.rp_section) {
      setFormError('Please complete all required fields.')
      return
    }

    setSaving(true)
    setFormError(null)

    const payload = {
      rp_uid: Number.parseInt(formData.rp_uid, 10),
      rp_event: Number.parseInt(formData.rp_event, 10),
      rp_item: formData.rp_item.trim(),
      rp_problem: formData.rp_problem.trim(),
      rp_section: Number.parseInt(formData.rp_section, 10),
      rp_source: parseOptionalNumber(formData.rp_source),
      rp_repairer: parseOptionalNumber(formData.rp_repairer),
      rp_tryfix: formData.rp_tryfix ? 1 : 0,
      rp_fixed: formData.rp_fixed ? 1 : 0,
      rp_comments: formData.rp_comments.trim(),
    }

    try {
      const url = isEditing ? `${apiBase}/api/repairs/${editingRepairId}` : `${apiBase}/api/repairs`
      const method = isEditing ? 'PUT' : 'POST'

      const response = await apiFetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (!response.ok) {
        throw new Error('Save failed')
      }

      const saved: RepairRecord = await response.json()

      setRepairs((current) => {
        if (isEditing) {
          return current.map((item) => (item.repair_id === saved.repair_id ? saved : item))
        }

        return [saved, ...current]
      })

      const nextMaxUid = saved.rp_uid > maxRpUid ? saved.rp_uid : maxRpUid
      setMaxRpUid(nextMaxUid)

      if (isEditing) {
        closeDialog()
        return
      }

      const preservedEvent = formData.rp_event
      resetForm(nextMaxUid + 1)
      setFormData((current) => ({ ...current, rp_event: preservedEvent }))
      setSaving(false)
    } catch {
      setFormError('Save failed. Please try again.')
      setSaving(false)
    }
  }

  return (
    <main className="page">
      <header className="header">
        <button
          type="button"
          className="logo-home"
          onClick={() => {
            setSelectedEventId('all')
            setSelectedSectionId('all')
            setActivePage('dashboard')
          }}
          aria-label="Home"
        >
          <img src={logoOnly} alt="Home" className="menu-logo" />
        </button>
        <div className="header-actions">
          {token ? (
            <div className="user-actions">
              <span>{authUser?.luName ?? 'User'}</span>
              <button
                type="button"
                className="logout-button"
                onClick={() => {
                  window.localStorage.removeItem('repair-log-token')
                  window.localStorage.removeItem('repair-log-user')
                  setToken(null)
                  setAuthUser(null)
                }}
              >
                Sign out
              </button>
            </div>
          ) : (
            <button type="button" className="logout-button" onClick={() => setIsLoginOpen(true)}>
              Sign In
            </button>
          )}
        </div>
      </header>

      <div className="page-heading">
        <h1>{activePage === 'dashboard' ? 'Dashboard' : 'Repair Log'}</h1>
        <p>
          {activePage === 'dashboard'
            ? 'Summary of repair activity.'
            : 'Issues tracked by event, source, section, and venue.'}
        </p>
      </div>

      {loading && <p className="status">Loading repairs...</p>}
      {!loading && error && <p className="status error">{error}</p>}

      {!loading && !error && activePage === 'dashboard' && (
        <section className="dashboard" aria-live="polite">
          <div className="dashboard-stats">
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
          </div>

          <div className="dashboard-events-header">
            <h2>Events Summary</h2>
            <p>Click an event to open the Repair Log with that event selected.</p>
          </div>

          <div className="dashboard-events-list" role="list">
            <div className="dashboard-events-columns" role="row">
              <span>Date</span>
              <span>Venue</span>
              <span>Repairs</span>
              <span>Fixed</span>
              <span>% Fixed</span>
            </div>
            {dashboardEvents.length === 0 && <p className="dashboard-empty">No events found.</p>}
            {dashboardEvents.map((event) => (
              <button
                key={event.eventId}
                type="button"
                className="dashboard-event-row"
                onClick={() => openRepairsForEvent(event.eventId)}
              >
                <span>{formatDate(event.eventDate)}</span>
                <span>{event.venueName}</span>
                <span>{event.totalRepairs}</span>
                <span>{event.fixedRepairs}</span>
                <span>{event.percentFixed}%</span>
              </button>
            ))}
          </div>
        </section>
      )}

      {!loading && !error && activePage === 'repairs' && (
        <>
          <section className="toolbar" aria-label="filters">
            <label htmlFor="event-filter">Event</label>
            <select
              id="event-filter"
              value={selectedEventId}
              onChange={(event) => {
                const value = event.target.value
                setSelectedEventId(value === 'all' ? 'all' : Number.parseInt(value, 10))
              }}
            >
              <option value="all">All events</option>
              {events.map((event) => (
                <option key={event.event_id} value={event.event_id}>
                  {formatDate(event.ev_date)} - {event.venue_name ?? 'Unknown venue'}
                </option>
              ))}
            </select>
            <label htmlFor="section-filter">Section</label>
            <select
              id="section-filter"
              value={selectedSectionId}
              onChange={(event) => {
                const value = event.target.value
                setSelectedSectionId(value === 'all' ? 'all' : Number.parseInt(value, 10))
              }}
            >
              <option value="all">All sections</option>
              {sections.map((section) => (
                <option key={section.lookup_id} value={section.lookup_id}>
                  {section.lk_name}
                </option>
              ))}
            </select>
            {isAdmin && (
              <>
                <button type="button" className="add-button" onClick={openAddDialog}>
                  Add Repair
                </button>
                <button type="button" className="import-button" onClick={handleImportCsv} disabled={importing}>
                  {importing ? 'Importing...' : 'Import CSV'}
                </button>
              </>
            )}
          </section>

          {importMessage && <p className="status">{importMessage}</p>}

          <section className="table-wrap" aria-live="polite">
            <table>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Date</th>
                  <th>Venue</th>
                  <th>Item</th>
                  <th>Problem</th>
                  <th>Source</th>
                  <th>Section</th>
                  <th>Tried/Fixed</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredRepairs.length === 0 && (
                  <tr>
                    <td colSpan={9}>No repairs found.</td>
                  </tr>
                )}
                {filteredRepairs.map((repair) => (
                  <tr key={repair.repair_id}>
                    <td>{repair.repair_id}</td>
                    <td>{formatDate(repair.event_date)}</td>
                    <td>{repair.venue_name ?? 'Unknown'}</td>
                    <td>{repair.rp_item}</td>
                    <td>{repair.rp_problem}</td>
                    <td>{repair.source_name ?? 'Unknown'}</td>
                    <td>{repair.section_name ?? 'Unknown'}</td>
                    <td>{`${repair.rp_tryfix ? 'Yes' : 'No'}/${repair.rp_fixed ? 'Yes' : 'No'}`}</td>
                    <td>
                      <div className="actions-cell">
                        <button
                          type="button"
                          className="icon-button"
                          title={repair.rp_comments || 'No comments'}
                          aria-label="View comments"
                        >
                          <svg viewBox="0 0 24 24" aria-hidden="true">
                            <path d="M4 4h16v12H7l-3 3V4zm3 4h10M7 11h7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                          </svg>
                        </button>
                        {isAdmin && (
                          <>
                            <button
                              type="button"
                              className="icon-button"
                              onClick={() => openEditDialog(repair)}
                              aria-label="Edit repair"
                            >
                              <svg viewBox="0 0 24 24" aria-hidden="true">
                                <path d="M4 20h4l10-10-4-4L4 16v4zm11-13 4 4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                              </svg>
                            </button>
                            <button
                              type="button"
                              className="icon-button danger"
                              onClick={() => handleDelete(repair.repair_id)}
                              aria-label="Delete repair"
                            >
                              <svg viewBox="0 0 24 24" aria-hidden="true">
                                <path d="M5 7h14M9 7V5h6v2m-8 0 1 12h8l1-12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                              </svg>
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      )}

      {isModalOpen && (
        <div className="modal-backdrop" role="presentation" onClick={closeDialog}>
          <section className="modal" role="dialog" aria-modal="true" aria-label={isEditing ? 'Edit repair' : 'Add repair'} onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <h2>{isEditing ? 'Edit Repair' : 'Add Repair'}</h2>
              <button type="button" className="modal-close" onClick={closeDialog} aria-label="Close dialog">
                X
              </button>
            </div>
            <div className="modal-grid">
              <label>
                Unique ID
                <input
                  type="number"
                  value={formData.rp_uid}
                  onChange={(event) => setFormData((current) => ({ ...current, rp_uid: event.target.value }))}
                />
              </label>
              <label>
                Event
                <select
                  value={formData.rp_event}
                  onChange={(event) => setFormData((current) => ({ ...current, rp_event: event.target.value }))}
                >
                  <option value="">Select event</option>
                  {events.map((event) => (
                    <option key={event.event_id} value={event.event_id}>
                      {formatDate(event.ev_date)} - {event.venue_name ?? 'Unknown venue'}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Item
                <input
                  type="text"
                  value={formData.rp_item}
                  onChange={(event) => setFormData((current) => ({ ...current, rp_item: event.target.value }))}
                />
              </label>
              <label>
                Source
                <select
                  value={formData.rp_source}
                  onChange={(event) => setFormData((current) => ({ ...current, rp_source: event.target.value }))}
                >
                  <option value="">Select source</option>
                  {sources.map((source) => (
                    <option key={source.lookup_id} value={source.lookup_id}>
                      {source.lk_name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Section
                <select
                  value={formData.rp_section}
                  onChange={(event) => setFormData((current) => ({ ...current, rp_section: event.target.value }))}
                >
                  <option value="">Select section</option>
                  {sections.map((section) => (
                    <option key={section.lookup_id} value={section.lookup_id}>
                      {section.lk_name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Repairer
                <select
                  value={formData.rp_repairer}
                  onChange={(event) => setFormData((current) => ({ ...current, rp_repairer: event.target.value }))}
                >
                  <option value="">Select repairer</option>
                  {repairers.map((repairer) => (
                    <option key={repairer.lookup_id} value={repairer.lookup_id}>
                      {repairer.lk_name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="wide">
                Problem
                <textarea
                  rows={4}
                  value={formData.rp_problem}
                  onChange={(event) => setFormData((current) => ({ ...current, rp_problem: event.target.value }))}
                />
              </label>
              <label className="wide">
                Comments
                <textarea
                  rows={3}
                  value={formData.rp_comments}
                  onChange={(event) => setFormData((current) => ({ ...current, rp_comments: event.target.value }))}
                />
              </label>
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={formData.rp_tryfix}
                  onChange={(event) => setFormData((current) => ({ ...current, rp_tryfix: event.target.checked }))}
                />
                <span className="checkbox-label">Tried Fix</span>
              </label>
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={formData.rp_fixed}
                  onChange={(event) => setFormData((current) => ({ ...current, rp_fixed: event.target.checked }))}
                />
                <span className="checkbox-label">Fixed</span>
              </label>
            </div>

            {formError && <p className="status error">{formError}</p>}

            <div className="modal-actions">
              <button type="button" onClick={closeDialog} disabled={saving}>
                Cancel
              </button>
              <button type="button" onClick={handleSave} disabled={saving}>
                {saving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </section>
        </div>
      )}

      {isLoginOpen && (
        <div className="modal-backdrop" role="presentation" onClick={() => setIsLoginOpen(false)}>
          <section className="modal login-modal" role="dialog" aria-modal="true" aria-label="Sign in" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <h2>Sign in</h2>
              <button type="button" className="modal-close" onClick={() => setIsLoginOpen(false)} aria-label="Close sign in dialog">
                X
              </button>
            </div>
            <form className="login-form" onSubmit={handleLogin}>
              <label>
                Email
                <input type="email" value={loginEmail} onChange={(event) => setLoginEmail(event.target.value)} required autoComplete="email" />
              </label>
              <label>
                Password
                <input type="password" value={loginPassword} onChange={(event) => setLoginPassword(event.target.value)} required autoComplete="current-password" />
              </label>
              {loginError && <p className="status error">{loginError}</p>}
              <button type="submit" className="login-button" disabled={loggingIn}>
                {loggingIn ? 'Signing in...' : 'Sign in'}
              </button>
            </form>
          </section>
        </div>
      )}
    </main>
  )
}

export default App
