import { BrowserRouter } from 'react-router-dom'
import { AuthShell } from './components/AuthShell'
import { AppRoutes } from './AppRoutes'
import './App.css'

function App() {
  return (
    <BrowserRouter>
      <AuthShell>{(isAdmin, apiFetch) => <AppRoutes isAdmin={isAdmin} apiFetch={apiFetch} />}</AuthShell>
    </BrowserRouter>
  )
}

export default App
