import type { Dispatch, RefObject, SetStateAction } from 'react'
import type { EventRecord, LookupRecord, RepairFormData } from '../types'
import { formatDate } from '../utils'

interface Props {
  isEditing: boolean
  saving: boolean
  formError: string | null
  formData: RepairFormData
  setFormData: Dispatch<SetStateAction<RepairFormData>>
  itemInputRef: RefObject<HTMLInputElement | null>
  events: EventRecord[]
  sources: LookupRecord[]
  sections: LookupRecord[]
  repairers: LookupRecord[]
  closeDialog: () => void
  cancelDialog: () => void
  handleSave: () => Promise<void>
}

const compareLookupNames = (a: LookupRecord, b: LookupRecord) =>
  a.lk_name.localeCompare(b.lk_name, undefined, { sensitivity: 'base' })

export function RepairDialog({
  isEditing, saving, formError, formData, setFormData, itemInputRef,
  events, sources, sections, repairers, closeDialog, cancelDialog, handleSave,
}: Props) {
  return (
    <div className="modal-backdrop" role="presentation" onClick={closeDialog}>
      <section className="modal repair-modal" role="dialog" aria-modal="true" aria-label={isEditing ? 'Edit repair' : 'Add repair'} onClick={(event) => event.stopPropagation()}>
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
          <label className="wide">
            Item
            <input
              ref={itemInputRef}
              type="text"
              value={formData.rp_item}
              onChange={(event) => setFormData((current) => ({ ...current, rp_item: event.target.value }))}
            />
          </label>
          <label className="wide">
            Problem
            <textarea
              rows={4}
              value={formData.rp_problem}
              onChange={(event) => setFormData((current) => ({ ...current, rp_problem: event.target.value }))}
            />
          </label>
          <div className="wide repair-selects">
            <label>
              Source
              <select
                value={formData.rp_source}
                onChange={(event) => setFormData((current) => ({ ...current, rp_source: event.target.value }))}
              >
                <option value="">Select source</option>
                {[...sources].sort(compareLookupNames).map((source) => (
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
                {[...sections].sort(compareLookupNames).map((section) => (
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
                {[...repairers].sort(compareLookupNames).map((repairer) => (
                  <option key={repairer.lookup_id} value={repairer.lookup_id}>
                    {repairer.lk_name}
                  </option>
                ))}
              </select>
            </label>
          </div>
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
          <button type="button" onClick={cancelDialog} disabled={saving}>
            Cancel
          </button>
          <button type="button" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </section>
    </div>
  )
}
