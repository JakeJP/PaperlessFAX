import { appConfig } from '../config'

export type DocumentSummary = {
  id: string
  receivedAt: string
  title: string
  docClass: string | null
  sender: string
  recipient: string
  senderName: string
  senderFaxNumber: string
  recipientName: string
  recipientFaxNumber: string
  documentData?: Record<string, unknown>
  active: boolean,
  confidence?: number
}

export type DocumentDetail = DocumentSummary & {
  sourcePath: string
  documentData: Record<string, unknown>
}

export type DocumentClass = {
  id: string
  name: string
  priority: number
  enabled: boolean
  prompt: string
}

export type LocalUser = {
  userName: string
  enabled: boolean
  isAdmin: boolean
}

export type ApiKey = {
  id: string
  keyName: string
  createdAt: string
  expiresAt: string | null
  enabled: boolean
}

export type QueueEntry = {
  entryId: number
  retry: number
  lastFailure: string | null
  sourcePath: string
}

export type DocumentListQuery = {
  docClass?: string
  sender?: string
  recipient?: string
  from?: string
  to?: string
  active?: boolean
  page?: number
  pageSize?: number
}

export type DocumentListResult = {
  items: DocumentSummary[]
  total: number
  page: number
  pageSize: number
}

export type UserRole = 'admin' | 'user'

export type LoginResult = {
  username: string
  role: UserRole
}

type ApiClient = {
  login: (input: { username: string; password: string; rememberMe?: boolean }) => Promise<LoginResult>
  me: () => Promise<LoginResult | null>
  logout: () => Promise<{ success: boolean }>
  listDocumentClasses: () => Promise<DocumentClass[]>
  createDocumentClass: (input: { id: string; name: string; priority: number; enabled: boolean; prompt: string }) => Promise<DocumentClass>
  updateDocumentClass: (id: string, input: { name: string; priority: number; enabled: boolean; prompt: string }) => Promise<DocumentClass>
  deleteDocumentClass: (id: string) => Promise<{ id: string; deleted: boolean }>
  listDocuments: (query: DocumentListQuery) => Promise<DocumentListResult>
  getDocumentById: (id: string) => Promise<DocumentDetail | null>
  getDocumentSourceUrl: (id: string) => string
  setDocumentDocClass: (id: string, docClass: string | null) => Promise<{ id: string; docClass: string | null }>
  setDocumentActive: (id: string, active: boolean) => Promise<{ id: string; active: boolean }>
  deleteDocument: (id: string) => Promise<{ id: string; deleted: boolean }>
  listLocalUsers: () => Promise<LocalUser[]>
  createLocalUser: (input: { userName: string; isAdmin: boolean; enabled: boolean; password: string }) => Promise<LocalUser>
  updateLocalUser: (userName: string, input: { userName: string; isAdmin: boolean; enabled: boolean; password?: string }) => Promise<LocalUser>
  deleteLocalUser: (userName: string) => Promise<{ userName: string; deleted: boolean }>
  listApiKeys: () => Promise<ApiKey[]>
  createApiKey: (input: { id?: string; key: string; keyName: string; expiresAt?: string | null; enabled: boolean }) => Promise<ApiKey>
  updateApiKey: (id: string, input: { keyName: string; expiresAt?: string | null; enabled: boolean }) => Promise<ApiKey>
  deleteApiKey: (id: string) => Promise<{ id: string; deleted: boolean }>
  listQueue: () => Promise<QueueEntry[]>
  deleteQueueEntry: (entryId: number) => Promise<{ entryId: number; deleted: boolean }>
  clearQueue: () => Promise<{ deleted: number }>
}

const httpClient: ApiClient = {
  login: (input) => request<LoginResult>('/auth/login', { method: 'POST', body: JSON.stringify(input) }),
  me: () => request<LoginResult | null>('/auth/me'),
  logout: () => request<{ success: boolean }>('/auth/logout', { method: 'POST' }),
  listDocumentClasses: () => request<DocumentClass[]>('/document-classes'),
  createDocumentClass: (input) => request<DocumentClass>('/document-classes', { method: 'POST', body: JSON.stringify(input) }),
  updateDocumentClass: (id, input) =>
    request<DocumentClass>(`/document-classes/${id}`, { method: 'PUT', body: JSON.stringify(input) }),
  deleteDocumentClass: (id) => request<{ id: string; deleted: boolean }>(`/document-classes/${id}`, { method: 'DELETE' }),
  listDocuments: (query) => {
    const search = new URLSearchParams()
    if (query.docClass && query.docClass !== 'All') {
      search.set('class', query.docClass)
    }
    if (query.sender) {
      search.set('sender', query.sender)
    }
    if (query.recipient) {
      search.set('recipient', query.recipient)
    }
    if (query.from) {
      search.set('from', query.from)
    }
    if (query.to) {
      search.set('to', query.to)
    }
    if (query.active != null) {
      search.set('active', query.active ? 'true' : 'false')
    }
    search.set('page', String(query.page ?? 1))
    search.set('pageSize', String(query.pageSize ?? 50))

    return request<DocumentListResult>(`/documents?${search.toString()}`)
  },
  getDocumentById: (id) => request<DocumentDetail | null>(`/documents/${id}`),
  getDocumentSourceUrl: (id) => `${appConfig.apiBaseUrl}/documents/${encodeURIComponent(id)}/source`,
  setDocumentDocClass: (id, docClass) =>
    request<{ id: string; docClass: string | null }>(`/documents/${id}/doc-class`, {
      method: 'PATCH',
      body: JSON.stringify({ docClass }),
    }),
  setDocumentActive: (id, active) =>
    request<{ id: string; active: boolean }>(`/documents/${id}/active`, {
      method: 'PATCH',
      body: JSON.stringify({ active }),
    }),
  deleteDocument: (id) => request<{ id: string; deleted: boolean }>(`/documents/${id}`, { method: 'DELETE' }),
  listLocalUsers: () => request<LocalUser[]>('/admin/users'),
  createLocalUser: (input) => request<LocalUser>('/admin/users', { method: 'POST', body: JSON.stringify(input) }),
  updateLocalUser: (userName, input) =>
    request<LocalUser>(`/admin/users/${encodeURIComponent(userName)}`, { method: 'PUT', body: JSON.stringify(input) }),
  deleteLocalUser: (userName) =>
    request<{ userName: string; deleted: boolean }>(`/admin/users/${encodeURIComponent(userName)}`, { method: 'DELETE' }),
  listApiKeys: () => request<ApiKey[]>('/admin/apikeys'),
  createApiKey: (input) => request<ApiKey>('/admin/apikeys', { method: 'POST', body: JSON.stringify(input) }),
  updateApiKey: (id, input) => request<ApiKey>(`/admin/apikeys/${id}`, { method: 'PUT', body: JSON.stringify(input) }),
  deleteApiKey: (id) => request<{ id: string; deleted: boolean }>(`/admin/apikeys/${id}`, { method: 'DELETE' }),
  listQueue: () => request<QueueEntry[]>('/admin/queue'),
  deleteQueueEntry: (entryId) => request<{ entryId: number; deleted: boolean }>(`/admin/queue/${entryId}`, { method: 'DELETE' }),
  clearQueue: () => request<{ deleted: number }>('/admin/queue', { method: 'DELETE' }),
}

export const apiClient: ApiClient = httpClient

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${appConfig.apiBaseUrl}${path}`, {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
    ...init,
  })

  if (!response.ok) {
    const message = await response.text()
    throw new Error(message || `API request failed: ${response.status}`)
  }

  return (await response.json()) as T
}
