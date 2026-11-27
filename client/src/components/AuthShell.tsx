import { useCallback, useState } from 'react'
import type { ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { apiBase } from '../api'
import type { ApiFetch, AuthUser } from '../types'
import logoOnly from '../assets/Logo_only_trans.png'

interface Props {
  children: (isAdmin: boolean, apiFetch: ApiFetch) => ReactNode
}

export function AuthShell({ children }: Props) {
  const navigate = useNavigate()
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
  const [isForgotPassword, setIsForgotPassword] = useState(false)
  const [loginEmail, setLoginEmail] = useState('')
  const [loginPassword, setLoginPassword] = useState('')
  const [loginError, setLoginError] = useState<string | null>(null)
  const [loginNotice, setLoginNotice] = useState<string | null>(null)
  const [loggingIn, setLoggingIn] = useState(false)
  const [passwordResetToken, setPasswordResetToken] = useState(() => new URLSearchParams(window.location.search).get('resetToken'))
  const [passwordResetPassword, setPasswordResetPassword] = useState('')
  const [passwordResetConfirmation, setPasswordResetConfirmation] = useState('')
  const [passwordResetError, setPasswordResetError] = useState<string | null>(null)
  const [passwordResetSubmitting, setPasswordResetSubmitting] = useState(false)
  const [passwordResetRequestError, setPasswordResetRequestError] = useState<string | null>(null)
  const [passwordResetRequestMessage, setPasswordResetRequestMessage] = useState<string | null>(null)
  const [passwordResetRequesting, setPasswordResetRequesting] = useState(false)

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
    setLoginNotice(null)

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

  const handlePasswordResetRequest = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setPasswordResetRequesting(true)
    setPasswordResetRequestError(null)
    setPasswordResetRequestMessage(null)

    try {
      const response = await fetch(`${apiBase}/api/auth/request-password-reset`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: loginEmail }),
      })
      const result: { message?: string } = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(result.message ?? 'Could not request a password reset.')
      }

      setPasswordResetRequestMessage(result.message ?? 'If an account exists for that email, a password reset link has been sent.')
    } catch (error) {
      setPasswordResetRequestError(error instanceof Error ? error.message : 'Could not request a password reset.')
    } finally {
      setPasswordResetRequesting(false)
    }
  }

  const handlePasswordReset = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setPasswordResetError(null)
    if (passwordResetPassword !== passwordResetConfirmation) {
      setPasswordResetError('Passwords do not match.')
      return
    }

    setPasswordResetSubmitting(true)
    try {
      const response = await fetch(`${apiBase}/api/auth/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: passwordResetToken, password: passwordResetPassword }),
      })
      const result: { message?: string } = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(result.message ?? 'Could not reset the password.')
      }

      const url = new URL(window.location.href)
      url.searchParams.delete('resetToken')
      navigate(`${url.pathname}${url.search}${url.hash}`, { replace: true })
      setPasswordResetToken(null)
      setPasswordResetPassword('')
      setPasswordResetConfirmation('')
      window.localStorage.removeItem('repair-log-token')
      window.localStorage.removeItem('repair-log-user')
      setToken(null)
      setAuthUser(null)
      setIsLoginOpen(true)
      setLoginNotice(result.message ?? 'Password updated. You can now sign in.')
    } catch (error) {
      setPasswordResetError(error instanceof Error ? error.message : 'Could not reset the password.')
    } finally {
      setPasswordResetSubmitting(false)
    }
  }

  if (passwordResetToken) {
    return (
      <main className="login-page">
        <form className="login-form" onSubmit={handlePasswordReset}>
          <img src={logoOnly} alt="" className="login-logo" />
          <h1>Choose a new password</h1>
          <p>Enter a new password with at least 12 characters.</p>
          <label>
            New password
            <input
              type="password"
              value={passwordResetPassword}
              onChange={(event) => setPasswordResetPassword(event.target.value)}
              required
              minLength={12}
              autoComplete="new-password"
            />
          </label>
          <label>
            Confirm new password
            <input
              type="password"
              value={passwordResetConfirmation}
              onChange={(event) => setPasswordResetConfirmation(event.target.value)}
              required
              minLength={12}
              autoComplete="new-password"
            />
          </label>
          {passwordResetError && <p className="status error">{passwordResetError}</p>}
          <button type="submit" className="login-button" disabled={passwordResetSubmitting}>
            {passwordResetSubmitting ? 'Updating password...' : 'Update password'}
          </button>
        </form>
      </main>
    )
  }

  return (
    <main className="page">
      <header className="header">
        <button
          type="button"
          className="logo-home"
          onClick={() => {
            navigate('/')
          }}
          aria-label="Home"
        >
          <img src={logoOnly} alt="Home" className="menu-logo" />
        </button>
        <div className="header-actions">
          {token ? (
            <div className="user-actions">
              <span>{authUser?.luName ?? 'User'}</span>
              {authUser?.isAdmin && <Link className="admin-link" to="/admin">Admin</Link>}
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
      {children(authUser?.isAdmin === true, apiFetch)}

      {isLoginOpen && (
        <div className="modal-backdrop" role="presentation" onClick={() => { setIsLoginOpen(false); setIsForgotPassword(false) }}>
          <section className="modal login-modal" role="dialog" aria-modal="true" aria-label="Sign in" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <h2>{isForgotPassword ? 'Reset your password' : 'Sign in'}</h2>
              <button type="button" className="modal-close" onClick={() => { setIsLoginOpen(false); setIsForgotPassword(false) }} aria-label="Close sign in dialog">
                X
              </button>
            </div>
            {isForgotPassword ? (
              <form className="login-form" onSubmit={handlePasswordResetRequest}>
                <p>Enter your email address and, if there is an account for it, we'll send a reset link.</p>
                <label>
                  Email
                  <input type="email" value={loginEmail} onChange={(event) => setLoginEmail(event.target.value)} required autoComplete="email" />
                </label>
                {passwordResetRequestError && <p className="status error">{passwordResetRequestError}</p>}
                {passwordResetRequestMessage && <p className="status success">{passwordResetRequestMessage}</p>}
                <button type="submit" className="login-button" disabled={passwordResetRequesting}>
                  {passwordResetRequesting ? 'Sending...' : 'Send reset link'}
                </button>
                <button type="button" className="login-link-button" onClick={() => setIsForgotPassword(false)}>
                  Back to sign in
                </button>
              </form>
            ) : (
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
                {loginNotice && <p className="status success">{loginNotice}</p>}
                <button type="submit" className="login-button" disabled={loggingIn}>
                  {loggingIn ? 'Signing in...' : 'Sign in'}
                </button>
                <button
                  type="button"
                  className="login-link-button"
                  onClick={() => {
                    setIsForgotPassword(true)
                    setLoginError(null)
                    setLoginNotice(null)
                    setPasswordResetRequestError(null)
                    setPasswordResetRequestMessage(null)
                  }}
                >
                  Forgot your password?
                </button>
              </form>
            )}
          </section>
        </div>
      )}
    </main>
  )
}
