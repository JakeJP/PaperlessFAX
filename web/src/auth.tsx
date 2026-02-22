import { createContext, ReactNode, useContext, useEffect, useMemo, useState } from 'react'
import { apiClient } from './api/client'

export type UserRole = 'admin' | 'user'

type AuthUser = {
  username: string
  role: UserRole
}

type LoginInput = {
  username: string
  password: string
  rememberMe: boolean
}

type AuthContextValue = {
  user: AuthUser | null
  isAuthenticated: boolean
  isReady: boolean
  login: (input: LoginInput) => Promise<{ success: boolean; message?: string }>
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [isReady, setIsReady] = useState(false)

  useEffect(() => {
    let mounted = true

    const restoreSession = async () => {
      try {
        const result = await apiClient.me()
        if (!mounted || !result) {
          return
        }

        const role: UserRole = result.role === 'admin' ? 'admin' : 'user'
        setUser({ username: result.username, role })
      } catch {
        if (mounted) {
          setUser(null)
        }
      } finally {
        if (mounted) {
          setIsReady(true)
        }
      }
    }

    restoreSession()

    return () => {
      mounted = false
    }
  }, [])

  const value = useMemo<AuthContextValue>(() => {
    return {
      user,
      isAuthenticated: user !== null,
      isReady,
      login: async ({ username, password, rememberMe }) => {
        const trimmedUser = username.trim()
        const trimmedPassword = password.trim()

        if (!trimmedUser || !trimmedPassword) {
          return { success: false, message: 'ユーザー名とパスワードを入力してください。' }
        }

        if (trimmedUser === 'admin' && trimmedPassword.length < 4) {
          return { success: false, message: 'admin の場合は4文字以上のパスワードを入力してください。' }
        }

        try {
          const result = await apiClient.login({ username: trimmedUser, password: trimmedPassword, rememberMe })
          const role: UserRole = result.role === 'admin' ? 'admin' : 'user'
          setUser({ username: result.username, role })
          return { success: true }
        } catch {
          return { success: false, message: 'ログインに失敗しました。ユーザー名またはパスワードを確認してください。' }
        }
      },
      logout: async () => {
        try {
          await apiClient.logout()
        } catch {
          // no-op
        }
        setUser(null)
      },
    }
  }, [isReady, user])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider')
  }
  return context
}
