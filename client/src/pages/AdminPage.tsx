import { useCallback, useEffect, useRef, useState } from 'react'
import { apiBase } from '../api'
import type { AdminEvent, AdminLookup, AdminUser, ApiFetch } from '../types'
import { formatDate } from '../utils'

interface Props {
  apiFetch: ApiFetch
  reloadRepairData: () => Promise<void>
}

type Editing =
  | { kind: 'event'; isNew: boolean; record: AdminEvent }
  | { kind: 'user'; isNew: boolean; record: AdminUser; password: string; confirmPassword: string }
  | { kind: 'lookup'; isNew: boolean; record: AdminLookup }

type Tab = 'events' | 'users' | 'lookups'
type AdminData = [AdminEvent[], AdminUser[], AdminLookup[], string[]]

async function checkResponse(response: Response) {
  if (response.ok) return
  if (response.status === 401) throw new Error('Your session has expired. Please sign out and sign in again.')
  const result: { message?: string } = await response.json()
  throw new Error(result.message || `Request failed (${response.status}).`)
}

export function AdminPage({ apiFetch, reloadRepairData }: Props) {
  const [tab, setTab] = useState<Tab>('events')
  const [events, setEvents] = useState<AdminEvent[]>([])
  const [users, setUsers] = useState<AdminUser[]>([])
  const [lookups, setLookups] = useState<AdminLookup[]>([])
  const [groups, setGroups] = useState<string[]>([])
  const [group, setGroup] = useState('')
  const [editing, setEditing] = useState<Editing | null>(null)
  const [loading, setLoading] = useState(true)
  const [loaded, setLoaded] = useState(false)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const eventsTab = useRef<HTMLButtonElement>(null)
  const usersTab = useRef<HTMLButtonElement>(null)
  const lookupsTab = useRef<HTMLButtonElement>(null)

  const fetchData = useCallback(async (signal?: AbortSignal): Promise<AdminData> => {
    const responses = await Promise.all([
      apiFetch(`${apiBase}/api/events`, { signal }),
      apiFetch(`${apiBase}/api/admin/users`, { signal }),
      apiFetch(`${apiBase}/api/admin/lookups`, { signal }),
      apiFetch(`${apiBase}/api/admin/lookup-groups`, { signal }),
    ])
    for (const response of responses) await checkResponse(response)
    return Promise.all([
      responses[0].json(), responses[1].json(), responses[2].json(), responses[3].json(),
    ])
  }, [apiFetch])

  const applyData = useCallback(([nextEvents, nextUsers, nextLookups, nextGroups]: AdminData) => {
    setEvents(nextEvents)
    setUsers(nextUsers)
    setLookups(nextLookups)
    setGroups(nextGroups)
    setLoaded(true)
    setGroup((current) => current && !nextGroups.includes(current) ? '' : current)
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    void fetchData(controller.signal).then((data) => {
      if (!controller.signal.aborted) applyData(data)
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) setError(error instanceof Error ? error.message : 'Unable to load administration data.')
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false)
    })
    return () => controller.abort()
  }, [applyData, fetchData])

  const changeTab = (next: Tab) => {
    setTab(next)
    setError(null)
  }

  const changeTabByKey = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight' && event.key !== 'Home' && event.key !== 'End') return
    event.preventDefault()
    const tabs: Tab[] = ['events', 'users', 'lookups']
    const index = tabs.indexOf(tab)
    const next = event.key === 'Home' ? 'events' : event.key === 'End' ? 'lookups'
      : tabs[(index + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length]
    changeTab(next)
    ;(next === 'events' ? eventsTab : next === 'users' ? usersTab : lookupsTab).current?.focus()
  }

  const save = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!editing) return
    if (editing.kind === 'user' && editing.isNew && editing.password !== editing.confirmPassword) {
      setError('Passwords do not match.')
      return
    }
    setWorking(true)
    setError(null)
    const kind = editing.kind
    const id = kind === 'event' ? editing.record.event_id : kind === 'user' ? editing.record.loguser_id : editing.record.lookup_id
    const payload = kind === 'event' ? editing.record
      : kind === 'user'
        ? { ...editing.record, lu_admin: Boolean(editing.record.lu_admin), ...(editing.isNew ? { password: editing.password } : {}) }
        : { ...editing.record, lk_header: Boolean(editing.record.lk_header) }
    const url = editing.isNew && kind === 'event'
      ? `${apiBase}/api/events`
      : `${apiBase}/api/admin/${kind === 'event' ? 'events' : kind === 'user' ? 'users' : 'lookups'}${editing.isNew ? '' : `/${id}`}`
    try {
      const response = await apiFetch(url, {
        method: editing.isNew ? 'POST' : 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      await checkResponse(response)
      setEditing(null)
      if (kind !== 'user') await reloadRepairData()
      applyData(await fetchData())
      if (editing.kind === 'lookup' && editing.isNew) setGroup(editing.record.lk_group.trim())
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Unable to save changes.')
    } finally {
      setWorking(false)
    }
  }

  const remove = async (kind: Tab, id: number, name: string) => {
    if (!window.confirm(`Delete ${name}?`)) return
    setWorking(true)
    setError(null)
    try {
      const response = await apiFetch(`${apiBase}/api/admin/${kind}/${id}`, { method: 'DELETE' })
      await checkResponse(response)
      if (kind !== 'users') await reloadRepairData()
      applyData(await fetchData())
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Unable to delete record.')
    } finally {
      setWorking(false)
    }
  }

  return (
    <section className="admin-page">
      <div className="page-heading"><h1>Admin</h1></div>
      <div className="admin-tabs" role="tablist" aria-label="Administration">
        <button ref={eventsTab} id="admin-events-tab" type="button" role="tab" aria-selected={tab === 'events'} aria-controls="admin-events-panel" tabIndex={tab === 'events' ? 0 : -1} onClick={() => changeTab('events')} onKeyDown={changeTabByKey}>Events</button>
        <button ref={usersTab} id="admin-users-tab" type="button" role="tab" aria-selected={tab === 'users'} aria-controls="admin-users-panel" tabIndex={tab === 'users' ? 0 : -1} onClick={() => changeTab('users')} onKeyDown={changeTabByKey}>Users</button>
        <button ref={lookupsTab} id="admin-lookups-tab" type="button" role="tab" aria-selected={tab === 'lookups'} aria-controls="admin-lookups-panel" tabIndex={tab === 'lookups' ? 0 : -1} onClick={() => changeTab('lookups')} onKeyDown={changeTabByKey}>Lookups</button>
      </div>
      {loading && <p className="status">Loading administration data...</p>}
      {error && !editing && <p className="status error" role="alert">{error}</p>}
      {!loading && loaded && (
        <>
          <div id="admin-events-panel" role="tabpanel" aria-labelledby="admin-events-tab" hidden={tab !== 'events'}>
            <button type="button" className="admin-add-link" disabled={working} aria-label="Add event" onClick={() => { setError(null); setEditing({ kind: 'event', isNew: true, record: { event_id: 0, ev_date: '', ev_venue: 0, ev_comment: '', venue_name: null } }) }}>Add</button>
            <div className="table-wrap">
              <table className="admin-table">
                <thead><tr><th scope="col">Date</th><th scope="col">Venue</th><th scope="col">Comment</th><th scope="col">Actions</th></tr></thead>
                <tbody>
                  {events.length === 0 && <tr><td colSpan={4}>No events found.</td></tr>}
                  {events.map((item) => (
                    <tr key={item.event_id}>
                      <td>{formatDate(item.ev_date)}</td><td>{item.venue_name ?? 'Unknown venue'}</td><td>{item.ev_comment}</td>
                      <td><div className="admin-actions">
                        <button type="button" disabled={working} aria-label={`Edit event ${formatDate(item.ev_date)} at ${item.venue_name ?? 'Unknown venue'}`} onClick={() => { setError(null); setEditing({ kind: 'event', isNew: false, record: { ...item, ev_date: item.ev_date.slice(0, 10) } }) }}>Edit</button>
                        <button type="button" disabled={working} aria-label={`Delete event ${formatDate(item.ev_date)} at ${item.venue_name ?? 'Unknown venue'}`} onClick={() => void remove('events', item.event_id, `event on ${formatDate(item.ev_date)}`)}>Delete</button>
                      </div></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div id="admin-users-panel" role="tabpanel" aria-labelledby="admin-users-tab" hidden={tab !== 'users'}>
            <button type="button" className="admin-add-link" disabled={working} aria-label="Add user" onClick={() => { setError(null); setEditing({ kind: 'user', isNew: true, record: { loguser_id: 0, lu_name: '', lu_email: '', lu_admin: 0 }, password: '', confirmPassword: '' }) }}>Add</button>
            <div className="table-wrap">
              <table className="admin-table">
                <thead><tr><th scope="col">Name</th><th scope="col">Email</th><th scope="col">Administrator</th><th scope="col">Actions</th></tr></thead>
                <tbody>
                  {users.length === 0 && <tr><td colSpan={4}>No users found.</td></tr>}
                  {users.map((user) => (
                    <tr key={user.loguser_id}>
                      <td>{user.lu_name}</td><td>{user.lu_email}</td><td>{user.lu_admin ? 'Yes' : 'No'}</td>
                      <td><div className="admin-actions">
                        <button type="button" disabled={working} aria-label={`Edit user ${user.lu_email}`} onClick={() => { setError(null); setEditing({ kind: 'user', isNew: false, record: { ...user }, password: '', confirmPassword: '' }) }}>Edit</button>
                        <button type="button" disabled={working} aria-label={`Delete user ${user.lu_email}`} onClick={() => void remove('users', user.loguser_id, user.lu_email)}>Delete</button>
                      </div></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div id="admin-lookups-panel" role="tabpanel" aria-labelledby="admin-lookups-tab" hidden={tab !== 'lookups'}>
            <button type="button" className="admin-add-link" disabled={working} aria-label="Add lookup" onClick={() => { setError(null); setEditing({ kind: 'lookup', isNew: true, record: { lookup_id: 0, lk_group: group, lk_name: '', lk_seq: 0, lk_header: 0 } }) }}>Add</button>
            <label className="admin-group-filter">
              Group
              <select value={group} onChange={(event) => setGroup(event.target.value)}>
                <option value="">All groups</option>
                {groups.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            </label>
            <div className="table-wrap">
              <table className="admin-table">
                <thead><tr><th scope="col">Group</th><th scope="col">Name</th><th scope="col">Sequence</th><th scope="col">Header</th><th scope="col">Actions</th></tr></thead>
                <tbody>
                  {lookups.filter((lookup) => !group || lookup.lk_group === group).map((lookup) => (
                    <tr key={lookup.lookup_id}>
                      <td>{lookup.lk_group}</td><td>{lookup.lk_name}</td><td>{lookup.lk_seq}</td><td>{lookup.lk_header ? 'Yes' : 'No'}</td>
                      <td><div className="admin-actions">
                        <button type="button" disabled={working} aria-label={`Edit lookup ${lookup.lk_name} (${lookup.lk_group})`} onClick={() => { setError(null); setEditing({ kind: 'lookup', isNew: false, record: { ...lookup } }) }}>Edit</button>
                        <button type="button" disabled={working} aria-label={`Delete lookup ${lookup.lk_name} (${lookup.lk_group})`} onClick={() => void remove('lookups', lookup.lookup_id, lookup.lk_name)}>Delete</button>
                      </div></td>
                    </tr>
                  ))}
                  {!lookups.some((lookup) => !group || lookup.lk_group === group) && <tr><td colSpan={5}>No lookups found.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
      {editing && (
        <div className="modal-backdrop" role="presentation">
          <section className="modal admin-edit-modal" role="dialog" aria-modal="true" aria-labelledby="admin-edit-title">
            <h2 id="admin-edit-title">{editing.isNew ? 'Add' : 'Edit'} {editing.kind}</h2>
            <form onSubmit={(event) => void save(event)}>
              <div className="modal-grid">
                {editing.kind === 'event' ? (
                  <>
                    <label>Date<input type="date" min="1000-01-01" max="9999-12-31" required value={editing.record.ev_date} onChange={(event) => setEditing({ ...editing, record: { ...editing.record, ev_date: event.target.value } })} /></label>
                    <label>Venue
                      <select required value={editing.record.ev_venue || ''} onChange={(event) => setEditing({ ...editing, record: { ...editing.record, ev_venue: Number(event.target.value) } })}>
                        <option value="">Select venue</option>
                        {!editing.isNew && editing.record.ev_venue > 0 && !lookups.some((lookup) => lookup.lookup_id === editing.record.ev_venue && lookup.lk_group === 'venue' && !lookup.lk_header) && (
                          <option value={editing.record.ev_venue} disabled>Current venue unavailable</option>
                        )}
                        {lookups.filter((lookup) => lookup.lk_group === 'venue' && !lookup.lk_header).map((lookup) => <option key={lookup.lookup_id} value={lookup.lookup_id}>{lookup.lk_name}</option>)}
                      </select>
                    </label>
                    <label className="wide">Comment (optional)<textarea maxLength={255} value={editing.record.ev_comment ?? ''} onChange={(event) => setEditing({ ...editing, record: { ...editing.record, ev_comment: event.target.value } })} /></label>
                  </>
                ) : editing.kind === 'user' ? (
                  <>
                    <label>Name<input required value={editing.record.lu_name} onChange={(event) => setEditing({ ...editing, record: { ...editing.record, lu_name: event.target.value } })} /></label>
                    <label>Email<input type="email" required value={editing.record.lu_email} onChange={(event) => setEditing({ ...editing, record: { ...editing.record, lu_email: event.target.value } })} /></label>
                    {editing.isNew && (
                      <>
                        <label>Initial password<input type="password" minLength={12} required autoComplete="new-password" value={editing.password} onChange={(event) => setEditing({ ...editing, password: event.target.value })} /></label>
                        <label>Confirm password<input type="password" minLength={12} required autoComplete="new-password" value={editing.confirmPassword} onChange={(event) => setEditing({ ...editing, confirmPassword: event.target.value })} /></label>
                        <p className="wide">At least 12 characters and no more than 72 UTF-8 bytes.</p>
                      </>
                    )}
                    <label className="checkbox-label"><input type="checkbox" checked={Boolean(editing.record.lu_admin)} onChange={(event) => setEditing({ ...editing, record: { ...editing.record, lu_admin: event.target.checked ? 1 : 0 } })} /> Administrator</label>
                  </>
                ) : (
                  <>
                    <label>Group<input required value={editing.record.lk_group} onChange={(event) => setEditing({ ...editing, record: { ...editing.record, lk_group: event.target.value } })} /></label>
                    <label>Name<input required value={editing.record.lk_name} onChange={(event) => setEditing({ ...editing, record: { ...editing.record, lk_name: event.target.value } })} /></label>
                    <label>Sequence<input type="number" step="1" required value={editing.record.lk_seq} onChange={(event) => setEditing({ ...editing, record: { ...editing.record, lk_seq: event.target.valueAsNumber } })} /></label>
                    <label className="checkbox-label"><input type="checkbox" checked={Boolean(editing.record.lk_header)} onChange={(event) => setEditing({ ...editing, record: { ...editing.record, lk_header: event.target.checked ? 1 : 0 } })} /> Header</label>
                  </>
                )}
              </div>
              {error && <p className="status error event-form-error" role="alert">{error}</p>}
              <div className="modal-actions event-form-actions">
                <button type="button" disabled={working} onClick={() => { setEditing(null); setError(null) }}>Cancel</button>
                <button type="submit" disabled={working}>{working ? 'Saving...' : 'Save'}</button>
              </div>
            </form>
          </section>
        </div>
      )}
    </section>
  )
}
