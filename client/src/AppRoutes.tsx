import { Route, Routes, useMatch, useNavigate } from 'react-router-dom'
import type { ApiFetch } from './types'
import { useRepairData } from './hooks/useRepairData'
import { DashboardPage } from './pages/DashboardPage'
import { RepairLogPage } from './pages/RepairLogPage'

interface Props {
  isAdmin: boolean
  apiFetch: ApiFetch
}

export function AppRoutes({ isAdmin, apiFetch }: Props) {
  const data = useRepairData(apiFetch)
  const navigate = useNavigate()
  const isDashboard = useMatch('/')
  const isRepairs = useMatch('/repairs')

  return (
    <>
      {(isDashboard || isRepairs) && (
        <div className="page-heading">
          <h1>{isDashboard ? 'Dashboard' : 'Repair Log'}</h1>
          <p>{isDashboard ? 'Summary of repair activity.' : 'Issues tracked by event, source, section, and venue.'}</p>
        </div>
      )}
      {data.loading && <p className="status">Loading repairs...</p>}
      {!data.loading && data.error && <p className="status error">{data.error}</p>}
      <Routes>
        <Route path="/" element={<DashboardPage data={data} isAdmin={isAdmin} apiFetch={apiFetch} />} />
        <Route path="/repairs" element={<RepairLogPage data={data} isAdmin={isAdmin} apiFetch={apiFetch} />} />
        <Route path="*" element={<p className="status error" role="alert">Page not found. <button type="button" onClick={() => navigate('/')}>Return to dashboard</button></p>} />
      </Routes>
    </>
  )
}
