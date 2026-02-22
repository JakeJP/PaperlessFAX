import { FormEvent, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { LockClosedIcon } from '@heroicons/react/24/outline'
import { useAuth } from '../auth'

export function LoginPage() {
  const { isAuthenticated, isReady, login } = useAuth()
  const navigate = useNavigate()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [rememberMe, setRememberMe] = useState(false)
  const [error, setError] = useState('')

  if (!isReady) {
    return null
  }

  if (isAuthenticated) {
    return <Navigate to="/documents" replace />
  }

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault()
    const result = await login({ username, password, rememberMe })
    if (!result.success) {
      setError(result.message ?? 'ログインに失敗しました。')
      return
    }
    setError('')
    navigate('/documents', { replace: true })
  }

  return (
    <section className="mx-auto w-full max-w-md">
      <div className="rounded-2xl border border-blue-200 bg-white p-6 shadow-sm sm:p-8">
        <div className="mb-6 text-center">
          <img src="/logo.svg" alt="Yokinsoft Logo" className="mx-auto mb-3 w-[60%]" />
          <p className="m-0 text-xs font-semibold uppercase tracking-wide text-slate-500">Document Management</p>
          <h1 className="mt-2 text-2xl font-bold text-slate-900">Yokinsoft Paperless for FAX</h1>
        </div>

        <form onSubmit={onSubmit} className="space-y-4">
          <label className="field">
            <span className="text-sm font-medium text-slate-700">ユーザー名</span>
            <input value={username} onChange={(event) => setUsername(event.target.value)} placeholder="username" />
          </label>

          <label className="field">
            <span className="text-sm font-medium text-slate-700">パスワード</span>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="password"
            />
          </label>

          <label className="inline-flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={rememberMe}
              onChange={(event) => setRememberMe(event.target.checked)}
            />
            <span>ログイン状態を保持する</span>
          </label>

          <button
            type="submit"
            className="flex h-10 w-full items-center justify-center gap-2 rounded-md border border-slate-300 bg-slate-900 px-3 text-sm font-medium text-white hover:bg-slate-800"
          >
            <LockClosedIcon className="h-4 w-4" />
            ログイン
          </button>

          {error && <p className="error-text">{error}</p>}
        </form>


        <footer className="mt-5 border-t border-slate-200 pt-3 text-center text-xs text-slate-500">
                  <a
          href="https://paperlessfax.yo-ki.com/docs"
          target="_blank"
          rel="noreferrer"
          className="hover:text-slate-600 hover:underline"
        >
          Yokinsoft Paperless for FAX について
        </a>
          
        </footer>
      </div>
      <div className="mt-4 text-center text-xs text-slate-400">
<span>(c) Yokinsoft </span>
          <a
            href="https://www.yo-ki.com"
            target="_blank"
            rel="noreferrer"
            className="text-slate-600 underline decoration-slate-300 underline-offset-2 hover:text-slate-900"
          >
            https://www.yo-ki.com
          </a>
      </div>
    </section>
  )
}
