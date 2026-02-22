import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router-dom'
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  DocumentTextIcon,
  EnvelopeIcon,
  EnvelopeOpenIcon,
  FunnelIcon,
  MagnifyingGlassIcon,
  TrashIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline'
import { appConfig } from '../config'
import { apiClient, DocumentSummary } from '../api/client'
import { useAuth } from '../auth'

type DocumentClassOption = {
  id: string
  name: string
}

type ListTab = 'active' | 'trash'

type DocumentFilters = {
  docClass: string
  sender: string
  recipient: string
  from: string
  to: string
}

const UNCLASSIFIED_DOC_CLASS = '__UNCLASSIFIED__'

const normalizeFaxValue = (value: unknown): string => {
  if (value == null) {
    return ''
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(value) : ''
  }
  if (typeof value !== 'string') {
    return ''
  }
  const trimmed = value.trim()
  return trimmed && trimmed !== '-' ? trimmed : ''
}

const getFaxProperty = (row: DocumentSummary, key: 'senderFaxNumber' | 'recipientFaxNumber'): string => {
  return normalizeFaxValue(row[key])
}

export function DocumentsPage() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const location = useLocation()
  const [searchParams, setSearchParams] = useSearchParams()
  const [docClass, setDocClass] = useState('All')
  const [sender, setSender] = useState('')
  const [recipient, setRecipient] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [listTab, setListTab] = useState<ListTab>('active')
  const [classes, setClasses] = useState<DocumentClassOption[]>([])
  const [rows, setRows] = useState<DocumentSummary[]>([])
  const [togglingIds, setTogglingIds] = useState<Set<string>>(new Set())
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set())
  const [tabCounts, setTabCounts] = useState({ active: 0, trash: 0 })
  const [page, setPage] = useState(1)
  const [pageSize] = useState(50)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const documentsRequestIdRef = useRef(0)
  const countsRequestIdRef = useRef(0)

  useEffect(() => {
    apiClient.listDocumentClasses().then((items) => {
      setClasses(items.map((item) => ({ id: item.id, name: item.name })))
    })
  }, [])

  const buildFilters = (override?: Partial<DocumentFilters>): DocumentFilters => ({
    docClass,
    sender,
    recipient,
    from,
    to,
    ...override,
  })

  const setQueryString = (filters: DocumentFilters, tab: ListTab, targetPage: number) => {
    const params = new URLSearchParams()
    params.set('class', filters.docClass || 'All')
    params.set('sender', filters.sender)
    params.set('recipient', filters.recipient)
    params.set('from', filters.from)
    params.set('to', filters.to)
    params.set('tab', tab)
    params.set('page', String(Math.max(1, targetPage)))
    setSearchParams(params)
  }

  const loadDocuments = async (targetPage: number, override?: Partial<DocumentFilters>, tab?: ListTab) => {
    const filters = buildFilters(override)
    const targetTab = tab ?? listTab
    const requestId = ++documentsRequestIdRef.current
    setLoading(true)
    try {
      const result = await apiClient.listDocuments({
        docClass: filters.docClass,
        sender: filters.sender,
        recipient: filters.recipient,
        from: filters.from,
        to: filters.to,
        active: targetTab === 'active',
        page: targetPage,
        pageSize,
      })
      if (requestId !== documentsRequestIdRef.current) {
        return
      }
      setRows(result.items)
      setTotal(result.total)
      setPage(result.page)
    } finally {
      if (requestId === documentsRequestIdRef.current) {
        setLoading(false)
      }
    }
  }

  const loadTabCounts = async (override?: Partial<DocumentFilters>) => {
    const filters = buildFilters(override)
    const requestId = ++countsRequestIdRef.current
    const [activeResult, trashResult] = await Promise.all([
      apiClient.listDocuments({
        docClass: filters.docClass,
        sender: filters.sender,
        recipient: filters.recipient,
        from: filters.from,
        to: filters.to,
        active: true,
        page: 1,
        pageSize: 1,
      }),
      apiClient.listDocuments({
        docClass: filters.docClass,
        sender: filters.sender,
        recipient: filters.recipient,
        from: filters.from,
        to: filters.to,
        active: false,
        page: 1,
        pageSize: 1,
      }),
    ])
    if (requestId !== countsRequestIdRef.current) {
      return
    }
    setTabCounts({ active: activeResult.total, trash: trashResult.total })
  }

  useEffect(() => {
    const initialDocClass = (searchParams.get('class') || 'All').trim() || 'All'
    const initialSender = (searchParams.get('sender') || '').trim()
    const initialRecipient = (searchParams.get('recipient') || '').trim()
    const initialFrom = (searchParams.get('from') || '').trim()
    const initialTo = (searchParams.get('to') || '').trim()
    const initialTab: ListTab = searchParams.get('tab') === 'trash' ? 'trash' : 'active'
    const initialPageRaw = Number.parseInt(searchParams.get('page') || '1', 10)
    const initialPage = Number.isFinite(initialPageRaw) && initialPageRaw > 0 ? initialPageRaw : 1

    const initialFilters: DocumentFilters = {
      docClass: initialDocClass,
      sender: initialSender,
      recipient: initialRecipient,
      from: initialFrom,
      to: initialTo,
    }

    setDocClass(initialDocClass)
    setSender(initialSender)
    setRecipient(initialRecipient)
    setFrom(initialFrom)
    setTo(initialTo)
    setListTab(initialTab)

    setQueryString(initialFilters, initialTab, initialPage)
    void loadDocuments(initialPage, initialFilters, initialTab)
    void loadTabCounts(initialFilters)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined' || typeof EventSource === 'undefined') {
      return
    }

    const normalizedBase = appConfig.apiBaseUrl.replace(/\/$/, '')
    const eventsUrl =
      normalizedBase.startsWith('http://') || normalizedBase.startsWith('https://')
        ? `${normalizedBase}/documents/events`
        : `${window.location.origin}${normalizedBase}/documents/events`

    const eventSource = new EventSource(eventsUrl, { withCredentials: true })
    const handleDocumentsChanged = () => {
      const filters = buildFilters()
      void loadDocuments(page, filters, listTab)
      void loadTabCounts(filters)
    }

    eventSource.addEventListener('documents_changed', handleDocumentsChanged)

    return () => {
      eventSource.removeEventListener('documents_changed', handleDocumentsChanged)
      eventSource.close()
    }
  }, [docClass, sender, recipient, from, to, listTab, page])

  const onSearch = () => {
    const filters = buildFilters()
    setQueryString(filters, listTab, 1)
    void loadDocuments(1, filters)
    void loadTabCounts(filters)
  }

  const onClear = () => {
    const clearedFilters: DocumentFilters = {
      docClass: 'All',
      sender: '',
      recipient: '',
      from: '',
      to: '',
    }
    setDocClass(clearedFilters.docClass)
    setSender(clearedFilters.sender)
    setRecipient(clearedFilters.recipient)
    setFrom(clearedFilters.from)
    setTo(clearedFilters.to)
    setQueryString(clearedFilters, listTab, 1)
    void loadDocuments(1, clearedFilters)
    void loadTabCounts(clearedFilters)
  }

  const toggleActive = async (row: DocumentSummary) => {
    if (togglingIds.has(row.id)) return
    setTogglingIds((prev) => new Set(prev).add(row.id))
    try {
      const next = !row.active
      await apiClient.setDocumentActive(row.id, next)
      setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, active: next } : r)))
      setTabCounts((prev) => ({
        active: prev.active + (next ? 1 : -1),
        trash: prev.trash + (next ? -1 : 1),
      }))
    } finally {
      setTogglingIds((prev) => {
        const next = new Set(prev)
        next.delete(row.id)
        return next
      })
    }
  }

  const deleteDocument = async (row: DocumentSummary) => {
    if (deletingIds.has(row.id)) return
    if (!window.confirm(`「${row.title}」を削除しますか？`)) return
    setDeletingIds((prev) => new Set(prev).add(row.id))
    try {
      await apiClient.deleteDocument(row.id)
      setRows((prev) => prev.filter((r) => r.id !== row.id))
      setTotal((prev) => Math.max(0, prev - 1))
      setTabCounts((prev) => ({
        active: row.active ? Math.max(0, prev.active - 1) : prev.active,
        trash: row.active ? prev.trash : Math.max(0, prev.trash - 1),
      }))
    } finally {
      setDeletingIds((prev) => {
        const next = new Set(prev)
        next.delete(row.id)
        return next
      })
    }
  }

  const maxPage = Math.max(1, Math.ceil(total / pageSize))

  return (
    <section className="rounded-lg border border-blue-200 bg-white p-4 shadow-sm">
      <h2 className="page-title flex items-center gap-2">
        <FunnelIcon className="h-7 w-7 text-slate-600" />
        文書一覧・検索
      </h2>
      <div className="tabs">
        <label className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700">
          <span className="font-medium">文書タイプ</span>
          <select
            value={docClass}
            onChange={(event) => {
              const nextDocClass = event.target.value
              const nextFilters = buildFilters({ docClass: nextDocClass })
              setDocClass(nextDocClass)
              setQueryString(nextFilters, listTab, 1)
              void loadDocuments(1, nextFilters)
              void loadTabCounts(nextFilters)
            }}
          >
            <option>All</option>
            {classes.map((value) => (
              <option key={value.id} value={value.id}>
                {value.name}
              </option>
            ))}
            <option value={UNCLASSIFIED_DOC_CLASS}>(未分類/不明)</option>
          </select>
        </label>
        <button className={`tab-btn inline-flex items-center ${listTab === 'active' ? 'is-active' : ''}`} onClick={() => { const filters = buildFilters(); setListTab('active'); setQueryString(filters, 'active', 1); void loadDocuments(1, filters, 'active'); void loadTabCounts(filters) }}>
          <EnvelopeIcon className="mr-1 shrink-0 h-4 w-4" />
          新着
          <span className="ml-2 inline-flex min-w-6 items-center justify-center rounded-full bg-slate-200 px-2 py-0.5 text-xs font-semibold text-slate-700">
            {tabCounts.active}
          </span>
        </button>
        <button className={`tab-btn inline-flex items-center ${listTab === 'trash' ? 'is-active' : ''}`} onClick={() => { const filters = buildFilters(); setListTab('trash'); setQueryString(filters, 'trash', 1); void loadDocuments(1, filters, 'trash'); void loadTabCounts(filters) }}>
          <EnvelopeOpenIcon className="mr-1 shrink-0 h-4 w-4" />
          既読
          <span className="ml-2 inline-flex min-w-6 items-center justify-center rounded-full bg-slate-200 px-2 py-0.5 text-xs font-semibold text-slate-700">
            {tabCounts.trash}
          </span>
        </button>
      </div>
      <div className="grid">
        <label className="field">
          <span>送信者</span>
          <input value={sender} onChange={(event) => setSender(event.target.value)} placeholder="送信者" />
        </label>
        <label className="field">
          <span>受信者</span>
          <input value={recipient} onChange={(event) => setRecipient(event.target.value)} placeholder="受信者" />
        </label>
        <label className="field">
          <span>期間～</span>
          <input type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
        </label>
        <label className="field">
          <span>まで</span>
          <input type="date" value={to} onChange={(event) => setTo(event.target.value)} />
        </label>
      </div>
      <div className="actions">
        <button onClick={onSearch}>
          <MagnifyingGlassIcon className="mr-1 inline-block h-4 w-4" />
          検索
        </button>
        <button onClick={onClear}>
          <XMarkIcon className="mr-1 inline-block h-4 w-4" />
          クリア
        </button>
      </div>

      <p className="hint-text">
        {loading ? '読み込み中...' : `${total} 件`} / page {page} / {maxPage}
      </p>

      <table>
        <thead>
          <tr>
            <th>受信日時</th>
            <th>文書タイプ</th>
            <th>タイトル</th>
            <th>送信者</th>
            <th>受信者</th>
            <th className="w-0 p-0"></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const senderFaxNumber = getFaxProperty(row, 'senderFaxNumber')
            const recipientFaxNumber = getFaxProperty(row, 'recipientFaxNumber')

            return (
            <tr key={row.id} className={`group ${row.active ? 'bg-white font-semibold' : 'bg-slate-50 font-normal text-slate-400'}`}>
              <td>{new Date(row.receivedAt).toLocaleString()}</td>
              <td>{classes.find((item) => item.id === row.docClass)?.name ?? row.docClass ?? '未分類/不明'}</td>
              <td>
                <div className="flex items-center gap-2">
                  <Link className="document-title-link" to={`/documents/${row.id}${location.search}`}>
                    {row.title}
                  </Link>
                  <a
                    href={apiClient.getDocumentSourceUrl(row.id)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center text-slate-500 hover:text-slate-700"
                    title="原本ファイルを開く"
                    aria-label={`原本ファイルを開く: ${row.title}`}
                  >
                    <DocumentTextIcon className="h-4 w-4" />
                  </a>
                </div>
              </td>
              <td>
                <div>{row.senderName || row.sender}</div>
                {senderFaxNumber && <div className="cell-muted">{senderFaxNumber}</div>}
              </td>
              <td>
                <div>{row.recipientName || row.recipient}</div>
                {recipientFaxNumber && <div className="cell-muted">{recipientFaxNumber}</div>}
              </td>
              <td className="relative w-0 overflow-visible p-0">
                <div className="absolute right-0 top-0 bottom-0 hidden group-hover:flex items-center gap-3 px-3 bg-white/95 shadow-[-8px_0_8px_rgba(255,255,255,0.95)] whitespace-nowrap">
                {isAdmin && (
                  <button
                    onClick={() => void deleteDocument(row)}
                    disabled={deletingIds.has(row.id)}
                    title="削除"
                    className="inline-flex items-center gap-2 rounded px-4 py-2 font-semibold text-red-600 hover:bg-red-50 transition-colors disabled:opacity-40"
                  >
                    <TrashIcon className="h-6 w-6" />
                    
                  </button>
                )}
                <button
                  onClick={() => void toggleActive(row)}
                  disabled={togglingIds.has(row.id)}
                  title={row.active ? 'クリックで既読にする' : 'クリックで新着に戻す'}
                  className={`inline-flex items-center gap-2 rounded px-4 py-2 font-semibold transition-colors ${
                    row.active
                      ? 'bg-blue-50 text-blue-700 hover:bg-blue-100'
                      : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                  } disabled:opacity-40`}
                >
                  {row.active ? (
                    <>
                      <EnvelopeOpenIcon className="h-6 w-6" />
                      
                    </>
                  ) : (
                    <>
                      <EnvelopeIcon className="h-6 w-6" />
                      
                    </>
                  )}
                </button>
                </div>
              </td>
            </tr>
            )
          })}
          {!loading && rows.length === 0 && (
            <tr>
              <td colSpan={6}>該当データはありません。</td>
            </tr>
          )}
        </tbody>
      </table>

      <div className="actions">
        <button disabled={page <= 1 || loading} onClick={() => { const targetPage = page - 1; const filters = buildFilters(); setQueryString(filters, listTab, targetPage); void loadDocuments(targetPage, filters) }}>
          <ChevronLeftIcon className="mr-1 inline-block h-4 w-4" />
          前へ
        </button>
        <button disabled={page >= maxPage || loading} onClick={() => { const targetPage = page + 1; const filters = buildFilters(); setQueryString(filters, listTab, targetPage); void loadDocuments(targetPage, filters) }}>
          <ChevronRightIcon className="mr-1 inline-block h-4 w-4" />
          次へ
        </button>
      </div>
    </section>
  )
}
