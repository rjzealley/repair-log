import { useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { apiBase } from '../api'
import { RepairDialog } from '../components/RepairDialog'
import type { ApiFetch, ImportSummaryResponse, RepairFormData, RepairRecord } from '../types'
import type { RepairData } from '../hooks/useRepairData'
import { formatDate, parseOptionalNumber } from '../utils'

interface Props {
  data: RepairData
  isAdmin: boolean
  apiFetch: ApiFetch
}

function parseFilter(value: string | null): number | 'all' | null {
  if (value === null || value === 'all') return 'all'
  if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))) return null
  return Number(value)
}

export function RepairLogPage({ data, isAdmin, apiFetch }: Props) {
  const { repairs, setRepairs, events, sources, sections, repairers, loading, error, maxRpUid, setMaxRpUid, loadData } = data
  const [searchParams, setSearchParams] = useSearchParams()
  const selectedEventId = parseFilter(searchParams.get('event'))
  const selectedSectionId = parseFilter(searchParams.get('section'))
  const setFilter = (name: string, value: string) => {
    const next = new URLSearchParams(searchParams)
    if (value === 'all') next.delete(name)
    else next.set(name, value)
    setSearchParams(next)
  }
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingRepairId, setEditingRepairId] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)
  const [importing, setImporting] = useState(false)
  const [importMessage, setImportMessage] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const itemInputRef = useRef<HTMLInputElement>(null)
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
  const initialFormData = useRef(formData)

  const isEditing = editingRepairId !== null

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
    return repairs
      .filter((item) => {
        const matchesEvent = selectedEventId === 'all' || item.rp_event === selectedEventId
        const matchesSection = selectedSectionId === 'all' || item.rp_section === selectedSectionId
        return matchesEvent && matchesSection
      })
      .sort((a, b) => b.rp_uid - a.rp_uid || b.repair_id - a.repair_id)
  }, [repairs, selectedEventId, selectedSectionId])

  const setInitialForm = (data: RepairFormData) => {
    initialFormData.current = data
    setFormData(data)
    setFormError(null)
  }

  const resetForm = (uidValue = 0, eventId = '') => {
    setInitialForm({
      rp_uid: String(uidValue),
      rp_event: eventId,
      rp_item: '',
      rp_problem: '',
      rp_section: '',
      rp_source: '',
      rp_repairer: '',
      rp_tryfix: false,
      rp_fixed: false,
      rp_comments: '',
    })
  }

  const openAddDialog = () => {
    setEditingRepairId(null)
    const defaultEvent = selectedEventId === null || selectedEventId === 'all' ? '' : String(selectedEventId)
    resetForm(maxRpUid + 1, defaultEvent)
    setIsModalOpen(true)
  }

  const openEditDialog = (repair: RepairRecord) => {
    setEditingRepairId(repair.repair_id)
    setInitialForm({
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
    setIsModalOpen(true)
  }

  const closeDialog = () => {
    setIsModalOpen(false)
    setSaving(false)
    setFormError(null)
  }

  const cancelDialog = () => {
    const changed = (Object.keys(formData) as (keyof RepairFormData)[])
      .some((key) => formData[key] !== initialFormData.current[key])
    if (!changed || window.confirm('Discard changes and close the repair form?')) {
      closeDialog()
    }
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

      resetForm(nextMaxUid + 1, formData.rp_event)
      setSaving(false)
      itemInputRef.current?.focus()
    } catch {
      setFormError('Save failed. Please try again.')
      setSaving(false)
    }
  }

  if (selectedEventId === null || selectedSectionId === null) {
    return <p className="status error" role="alert">Invalid repair filters in the URL.</p>
  }

  return (
    <>
      {!loading && !error && (
        <>
          <section className="toolbar" aria-label="filters">
            <label htmlFor="event-filter">Event</label>
            <select
              id="event-filter"
              value={selectedEventId}
              onChange={(event) => {
                const value = event.target.value
                setFilter('event', value)
              }}
            >
              <option value="all">All events</option>
              {selectedEventId !== 'all' && !events.some((event) => event.event_id === selectedEventId) && (
                <option value={selectedEventId}>Unknown event ({selectedEventId})</option>
              )}
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
                setFilter('section', value)
              }}
            >
              <option value="all">All sections</option>
              {selectedSectionId !== 'all' && !sections.some((section) => section.lookup_id === selectedSectionId) && (
                <option value={selectedSectionId}>Unknown section ({selectedSectionId})</option>
              )}
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
                  <th>Unique ID</th>
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
                  <tr
                    key={repair.repair_id}
                    className={repair.rp_tryfix ? (repair.rp_fixed ? 'repair-fixed' : 'repair-tried') : undefined}
                  >
                    <td>{repair.rp_uid}</td>
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
        <RepairDialog
          isEditing={isEditing}
          saving={saving}
          formError={formError}
          formData={formData}
          setFormData={setFormData}
          itemInputRef={itemInputRef}
          events={events}
          sources={sources}
          sections={sections}
          repairers={repairers}
          closeDialog={closeDialog}
          cancelDialog={cancelDialog}
          handleSave={handleSave}
        />
      )}
    </>
  )
}
