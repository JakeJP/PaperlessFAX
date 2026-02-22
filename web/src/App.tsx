import { Link, Navigate, Route, Routes } from 'react-router-dom'
import { ArrowLeftOnRectangleIcon, DocumentTextIcon, ShieldCheckIcon, UserCircleIcon } from '@heroicons/react/24/outline'
import { LoginPage } from './pages/LoginPage'
import { DocumentsPage } from './pages/DocumentsPage'
import { DocumentDetailPage } from './pages/DocumentDetailPage'
import { AdminPage } from './pages/AdminPage'
import { AuthProvider, useAuth } from './auth'

function RequireAuth({ children }: { children: JSX.Element }) {
  const { isAuthenticated, isReady } = useAuth()
  if (!isReady) {
    return null
  }
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />
  }
  return children
}

function RequireAdmin({ children }: { children: JSX.Element }) {
  const { isAuthenticated, isReady, user } = useAuth()
  if (!isReady) {
    return null
  }
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />
  }
  if (user?.role !== 'admin') {
    return <Navigate to="/documents" replace />
  }
  return children
}

function HeaderNav() {
  const { isAuthenticated, user, logout } = useAuth()

  return (
    <header className="border-b border-sky-900/20 bg-gradient-to-r from-sky-950 via-blue-900 to-slate-800 px-5 py-3 shadow-md">
      <div className="mx-auto flex w-full max-w-screen-2xl items-center justify-between px-1 sm:px-2">
        <Link to="/" className="m-0 inline-flex items-center gap-2 text-lg font-semibold text-white no-underline tracking-wide">
          <span>Yokinsoft</span> <span style={{ color: '#00c896' }}>Paperless for FAX</span>
          <img src="/logo.svg" alt="Yokinsoft Logo" className="h-8 w-auto opacity-90 brightness-200" />
          <span className="relative -top-2 text-[0.6rem] font-normal text-sky-200 leading-none tracking-wider">v{__APP_VERSION__}</span>
        </Link>
        <nav className="flex items-center gap-3">
          {!isAuthenticated && (
            <Link className="inline-flex items-center gap-1 text-sm text-sky-200 hover:text-white no-underline transition-colors" to="/login">
              <UserCircleIcon className="h-4 w-4" />
              Login
            </Link>
          )}
          {isAuthenticated && (
            <Link className="inline-flex items-center gap-1 text-sm text-sky-200 hover:text-white no-underline transition-colors" to="/documents">
              <DocumentTextIcon className="h-4 w-4" />
              文書一覧
            </Link>
          )}
          {user?.role === 'admin' && (
            <Link className="inline-flex items-center gap-1 text-sm text-amber-300 hover:text-amber-100 no-underline transition-colors" to="/admin">
              <ShieldCheckIcon className="h-4 w-4" />
              管理者
            </Link>
          )}
        {isAuthenticated && (
            <button
            className="h-9 cursor-pointer rounded-md border border-sky-600 bg-sky-800/50 px-3 text-sm text-sky-100 hover:bg-sky-700/60 transition-colors disabled:cursor-not-allowed disabled:opacity-60"
            type="button"
            onClick={() => {
              void logout()
            }}
            >
            <ArrowLeftOnRectangleIcon className="mr-1 inline-block h-4 w-4" />
            ログアウト ({user?.username})
            </button>
        )}
        </nav>
      </div>
    </header>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <div>
        <HeaderNav />
        <main className="mx-auto w-full max-w-screen-2xl px-4 py-5 sm:px-6 lg:px-8">
          <Routes>
            <Route path="/" element={<Navigate to="/login" replace />} />
            <Route path="/login" element={<LoginPage />} />
            <Route
              path="/documents"
              element={
                <RequireAuth>
                  <DocumentsPage />
                </RequireAuth>
              }
            />
            <Route
              path="/documents/:id"
              element={
                <RequireAuth>
                  <DocumentDetailPage />
                </RequireAuth>
              }
            />
            <Route
              path="/admin"
              element={
                <RequireAdmin>
                  <AdminPage />
                </RequireAdmin>
              }
            />
          </Routes>
        </main>
      </div>
    </AuthProvider>
  )
}
