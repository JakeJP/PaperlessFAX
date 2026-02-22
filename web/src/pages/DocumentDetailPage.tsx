import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import {
  ArrowDownTrayIcon,
  ArrowLeftIcon,
  ArrowTopRightOnSquareIcon,
  ClipboardDocumentIcon,
  DocumentMagnifyingGlassIcon,
  EnvelopeIcon,
  EnvelopeOpenIcon,
  TrashIcon,
} from '@heroicons/react/24/outline'
import { useAuth } from '../auth'
import { apiClient, DocumentDetail } from '../api/client'

type DocumentClassOption = {
  id: string
  name: string
}

type PropertyRow = {
  label: string
  value: string
  align?: 'left' | 'right'
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function toDisplayValue(value: unknown): string {
  if (value == null) {
    return '-'
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(value) : '-'
  }
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false'
  }
  if (typeof value === 'string') {
    return value.trim() || '-'
  }
  return JSON.stringify(value)
}

function pushPropertyRow(rows: PropertyRow[], label: string, value: unknown, align?: 'left' | 'right') {
  const text = toDisplayValue(value)
  if (text !== '-') {
    rows.push({ label, value: text, align })
  }
}

function buildPropertyRows(documentData: Record<string, unknown>): PropertyRow[] {
  const typedProperties = asObject(documentData.typed_properties)
  const rows: PropertyRow[] = []

  Object.entries(typedProperties)
    .sort(([a], [b]) => a.localeCompare(b))
    .forEach(([key, value]) => pushPropertyRow(rows, key, value))

  return rows
}

function resolveFaxNumber(detail: DocumentDetail, key: 'senderFaxNumber' | 'recipientFaxNumber'): string {
  const faxProperties = asObject(asObject(detail.documentData).fax_properties)
  const value = toDisplayValue(faxProperties[key] ?? detail[key])
  return value === '-' ? '' : value
}

function resolveConfidence(detail: DocumentDetail): string {
  const documentData = asObject(detail.documentData)
  return toDisplayValue(documentData.confidence)
}

function resolveThumbnailImage(detail: DocumentDetail): string | null {
  const documentData = asObject(detail.documentData)
  const thumbnailImage = documentData.thumbnailImage
  if (typeof thumbnailImage !== 'string') {
    return null
  }

  const trimmed = thumbnailImage.trim()
  if (!trimmed) {
    return null
  }

  if (trimmed.startsWith('data:image/')) {
    return trimmed
  }

  return `data:image/jpeg;base64,${trimmed}`
}

function resolveTotalPages(detail: DocumentDetail): number | null {
  const documentData = asObject(detail.documentData)
  const faxProperties = asObject(documentData.fax_properties)
  const val = faxProperties.totalPages
  if (typeof val === 'number' && Number.isFinite(val) && val > 0) {
    return val
  }
  return null
}

export function DocumentDetailPage() {
  const { id } = useParams()
  const location = useLocation()
  const navigate = useNavigate()
  const { user } = useAuth()
  const [detail, setDetail] = useState<DocumentDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [updatingActive, setUpdatingActive] = useState(false)
  const [updatingDocClass, setUpdatingDocClass] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [status, setStatus] = useState('')
  const [docClassOptions, setDocClassOptions] = useState<DocumentClassOption[]>([])
  const [jsonOpen, setJsonOpen] = useState(() => user?.role === 'admin')
  const [jsonCopied, setJsonCopied] = useState(false)
  const backToDocuments = `/documents${location.search}`

  useEffect(() => {
    if (!id) {
      setLoading(false)
      return
    }

    setLoading(true)
    apiClient
      .getDocumentById(id)
      .then((item) => {
        setDetail(item)
      })
      .finally(() => {
        setLoading(false)
      })
  }, [id])

  useEffect(() => {
    if (user?.role !== 'admin') {
      setDocClassOptions([])
      return
    }

    apiClient.listDocumentClasses().then((items) => {
      setDocClassOptions(items.map((item) => ({ id: item.id, name: item.name })))
    })
  }, [user?.role])

  if (loading) {
    return (
      <section className="rounded-lg border border-blue-200 bg-white p-4 shadow-sm">
        <Link className="back-nav-link" to={backToDocuments}>
          <ArrowLeftIcon className="h-4 w-4" />
          一覧へ戻る
        </Link>
        <h2>文書詳細</h2>
        <p>読み込み中...</p>
      </section>
    )
  }

  if (!detail) {
    return (
      <section className="rounded-lg border border-blue-200 bg-white p-4 shadow-sm">
        <Link className="back-nav-link" to={backToDocuments}>
          <ArrowLeftIcon className="h-4 w-4" />
          一覧へ戻る
        </Link>
        <h2>文書詳細</h2>
        <p>ドキュメントが見つかりません。</p>
      </section>
    )
  }

  const openOriginalFileLink = () => {
    const sourceUrl = apiClient.getDocumentSourceUrl(detail.id)
    const opened = window.open(sourceUrl, '_blank', 'noopener,noreferrer')
    if (!opened) {
      setStatus('原本リンクを開けませんでした。ブラウザのポップアップ設定を確認してください。')
    }
  }

  const propertyRows = buildPropertyRows(detail.documentData)
  const senderFaxNumber = resolveFaxNumber(detail, 'senderFaxNumber')
  const recipientFaxNumber = resolveFaxNumber(detail, 'recipientFaxNumber')
  const confidence = resolveConfidence(detail)
  const thumbnailImage = resolveThumbnailImage(detail)
  const totalPages = resolveTotalPages(detail)

  const downloadDocumentDataJson = () => {
    const jsonText = JSON.stringify(detail.documentData, null, 2)
    const blob = new Blob([jsonText], { type: 'application/json;charset=utf-8' })
    const objectUrl = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = objectUrl
    anchor.download = `document-${detail.id}.json`
    document.body.appendChild(anchor)
    anchor.click()
    document.body.removeChild(anchor)
    URL.revokeObjectURL(objectUrl)
  }

  return (
    <section className="rounded-lg border border-blue-200 bg-white p-4 shadow-sm">
      <Link className="back-nav-link" to={backToDocuments}>
        <ArrowLeftIcon className="h-4 w-4" />
        一覧へ戻る
      </Link>
      <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold tracking-wide text-slate-500">
        <DocumentMagnifyingGlassIcon className="h-5 w-5 text-slate-500" />
        文書詳細
      </h2>

      <div className="mb-4 overflow-hidden rounded-lg border border-slate-200 bg-slate-50 p-4">
        <div className="float-right ml-4 mb-2 flex flex-wrap items-center justify-end gap-2">
          {user?.role === 'admin' && (
            <>
              <button
                onClick={async () => {
                  if (!detail) return
                  setDeleting(true)
                  try {
                    if (!window.confirm(`「${detail.title}」を削除しますか？`)) return
                    await apiClient.deleteDocument(detail.id)
                    navigate(backToDocuments)
                  } catch {
                    setStatus('文書削除に失敗しました。')
                  } finally {
                    setDeleting(false)
                  }
                }}
                disabled={deleting}
                title="削除"
                className="inline-flex items-center gap-2 rounded px-4 py-2 text-base font-semibold text-red-600 hover:bg-red-50 transition-colors disabled:opacity-40"
              >
                <TrashIcon className="h-6 w-6" />
                削除
              </button>
              <button
                onClick={async () => {
                  if (!detail) return
                  setUpdatingActive(true)
                  try {
                    const result = await apiClient.setDocumentActive(detail.id, !detail.active)
                    setDetail({ ...detail, active: result.active })
                  } finally {
                    setUpdatingActive(false)
                  }
                }}
                disabled={updatingActive}
                title={detail.active ? 'クリックで既読にする' : 'クリックで新着に戻す'}
                className={`inline-flex items-center gap-2 rounded px-4 py-2 text-base font-semibold transition-colors ${
                  detail.active
                    ? 'bg-blue-50 text-blue-700 hover:bg-blue-100'
                    : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                } disabled:opacity-40`}
              >
                {detail.active ? (
                  <>
                    <EnvelopeOpenIcon className="h-6 w-6" />
                    既読にする
                  </>
                ) : (
                  <>
                    <EnvelopeIcon className="h-6 w-6" />
                    新着に戻す
                  </>
                )}
              </button>
            </>
          )}
          {user?.role === 'admin' ? (
            <label className="inline-flex items-center gap-2 rounded-full border border-slate-300 bg-white px-3 py-1 text-sm font-semibold text-slate-700">
              <span>文書タイプ:</span>
              <select
                className="h-8 min-w-42 rounded-md border border-slate-300 bg-white px-2 text-sm font-medium text-slate-700"
                value={detail.docClass ?? ''}
                disabled={updatingDocClass}
                onChange={async (event) => {
                  const nextDocClass = event.target.value || null
                  const previousDocClass = detail.docClass ?? null
                  if (nextDocClass === previousDocClass) {
                    return
                  }

                  setUpdatingDocClass(true)
                  try {
                    const result = await apiClient.setDocumentDocClass(detail.id, nextDocClass)
                    setDetail({ ...detail, docClass: result.docClass })
                    setStatus('文書タイプを更新しました。')
                  } catch {
                    setStatus('文書タイプの更新に失敗しました。')
                  } finally {
                    setUpdatingDocClass(false)
                  }
                }}
              >
                <option value="">未分類/不明</option>
                {docClassOptions.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <div className="inline-flex items-center rounded-full border border-slate-300 bg-white px-3 py-1 text-sm font-semibold text-slate-700">
              文書タイプ: {detail.docClass ?? '未分類/不明'}
            </div>
          )}
        </div>
        <p className="text-3xl font-bold leading-tight text-slate-900 mb-5">{detail.title || '-'}</p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <div className="detail-meta-row">
            <span className="detail-meta-label">受信日時</span>
            <span className="detail-meta-value">{new Date(detail.receivedAt).toLocaleString()}</span>
          </div>
          <div className="detail-meta-row">
            <span className="detail-meta-label">送信者</span>
            <span className="detail-meta-value flex flex-col items-end leading-tight">
              <span>{detail.senderName || detail.sender || '-'}</span>
              {senderFaxNumber && <span className="mt-1 text-xs font-normal text-slate-500">{senderFaxNumber}</span>}
            </span>
          </div>
          <div className="detail-meta-row">
            <span className="detail-meta-label">受信者</span>
            <span className="detail-meta-value flex flex-col items-end leading-tight">
              <span>{detail.recipientName || detail.recipient || '-'}</span>
              {recipientFaxNumber && <span className="mt-1 text-xs font-normal text-slate-500">{recipientFaxNumber}</span>}
            </span>
          </div>
          {totalPages != null ? (
            <div className="flex items-center justify-end gap-1">
              <span className="text-sm text-slate-400">全</span>
              <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-indigo-500 text-xl font-bold text-white leading-none">
                {totalPages}
              </span>
              <span className="text-sm text-slate-400">ページ</span>
            </div>
          ) : <div />}

        </div>
      </div>

      <div className="detail-content-grid">
        <div className="space-y-2 min-w-0">


          <h3>文書プロパティ</h3>
          {propertyRows.length > 0 ? (
            <table className="properties-table">
              <thead>
                <tr>
                  <th>項目</th>
                  <th>値</th>
                </tr>
              </thead>
              <tbody>
                {propertyRows.map((row) => (
                  <tr key={row.label}>
                    <td className="properties-key">{row.label}</td>
                    <td className={row.align === 'right' ? 'properties-value-right' : 'properties-value'}>{row.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="hint-text">表示可能なプロパティがありません。</p>
          )}

        </div>
          {detail.sourcePath && <div className="rounded-lg border border-blue-200 bg-white p-3 self-start lg:justify-self-end lg:w-full lg:max-w-70">
          <p className="m-0 text-xs font-semibold uppercase tracking-wide text-slate-500">原本</p>
          <button
            type="button"
            onClick={openOriginalFileLink}
            className="mt-2 flex aspect-square w-full min-h-55 flex-col items-center justify-center rounded-lg border border-slate-300 bg-slate-50 px-3 text-slate-700 hover:bg-slate-100"
            style={
              thumbnailImage
                ? {
                    backgroundImage: `url('${thumbnailImage}')`,
                    backgroundSize: 'cover',
                    backgroundPosition: 'center',
                    backgroundRepeat: 'no-repeat',
                  }
                : undefined
            }
          >
            {thumbnailImage ? (
              <span className="sr-only">原本リンクを開く</span>
            ) : (
              <div className="rounded-md bg-white/80 px-3 py-2 text-center backdrop-blur-[1px]">
                <div className="mx-auto flex h-20 w-16 items-center justify-center rounded border border-slate-300 bg-white shadow-sm">
                  <div className="h-12 w-10 border border-dashed border-slate-300" />
                </div>
                <ArrowTopRightOnSquareIcon className="mx-auto mt-3 h-7 w-7" />
                <span className="mt-2 block whitespace-nowrap text-sm font-semibold leading-none">原本リンクを開く</span>
                <span className="mt-1 block whitespace-nowrap text-xs text-slate-500 leading-none">クリックして表示</span>
              </div>
            )}
          </button>
        </div>}

      </div>

      {status && <p className="hint-text">{status}</p>}

      {user?.role === 'admin' && (
      <div className="mt-3">
          <div className="detail-meta-row">
            <span className="detail-meta-label">元ファイル</span>
            <span className="detail-meta-value break-all">{detail.sourcePath || '-'}</span>
          </div>
          <div className="detail-meta-row">
            <span className="detail-meta-label">Document ID</span>
            <span className="detail-meta-value">{detail.id}</span>
          </div>
          <div className="detail-meta-row">
            <span className="detail-meta-label">Confidence</span>
            <span className="detail-meta-value">{confidence}</span>
          </div>
      </div>)}
      <div className="mt-4 mb-2 flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setJsonOpen((prev) => !prev)}
          className="flex items-center gap-2 text-sm font-semibold text-slate-600 hover:text-slate-900 transition-colors"
        >
          <span className={`inline-block transition-transform duration-200 ${jsonOpen ? 'rotate-90' : 'rotate-0'}`}>▶</span>
          <h3 className="m-0">DocumentData JSON</h3>
        </button>
        <button
          type="button"
          onClick={downloadDocumentDataJson}
          className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          <ArrowDownTrayIcon className="h-4 w-4" />
          JSONダウンロード
        </button>
      </div>
      {jsonOpen && (
        <div className="relative">
          <button
            type="button"
            onClick={() => {
              navigator.clipboard.writeText(JSON.stringify(detail.documentData, null, 2)).then(() => {
                setJsonCopied(true)
                setTimeout(() => setJsonCopied(false), 2000)
              })
            }}
            title="クリップボードにコピー"
            className="absolute top-2 right-2 rounded-md border border-slate-300 bg-white/90 p-1.5 text-slate-500 hover:bg-white hover:text-slate-800 transition-colors backdrop-blur-sm"
          >
            <ClipboardDocumentIcon className="h-5 w-5" />
            {jsonCopied && (
              <span className="absolute -top-7 right-0 whitespace-nowrap rounded bg-slate-800 px-2 py-1 text-xs text-white">コピーしました</span>
            )}
          </button>
          <pre>{JSON.stringify(detail.documentData, null, 2)}</pre>
        </div>
      )}
    </section>
  )
}
