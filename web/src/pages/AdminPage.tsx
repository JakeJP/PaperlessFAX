import { useEffect, useRef, useState } from 'react'
import { KeyIcon, QueueListIcon, RectangleStackIcon, ShieldCheckIcon, UsersIcon, WrenchScrewdriverIcon } from '@heroicons/react/24/outline'
import { apiClient, ApiKey, DocumentClass, LocalUser, QueueEntry } from '../api/client'

type Tab = 'classes' | 'users' | 'apikeys' | 'queue'
type PromptEditorTarget = { mode: 'new' } | { mode: 'existing'; id: string }
type EditableLocalUser = LocalUser & { originalUserName: string }

export function AdminPage() {
  const [tab, setTab] = useState<Tab>('classes')
  const [classes, setClasses] = useState<DocumentClass[]>([])
  const [users, setUsers] = useState<EditableLocalUser[]>([])
  const [keys, setKeys] = useState<ApiKey[]>([])
  const [queueEntries, setQueueEntries] = useState<QueueEntry[]>([])
  const [status, setStatus] = useState('')

  const [newClassId, setNewClassId] = useState('')
  const [newClassName, setNewClassName] = useState('')
  const [newClassPriority, setNewClassPriority] = useState('0')
  const [newClassEnabled, setNewClassEnabled] = useState(true)
  const [newClassPrompt, setNewClassPrompt] = useState('')
  const [showNewClassForm, setShowNewClassForm] = useState(false)
  const [promptEditorTarget, setPromptEditorTarget] = useState<PromptEditorTarget | null>(null)
  const [promptDraft, setPromptDraft] = useState('')

  const [newUserName, setNewUserName] = useState('')
  const [newUserIsAdmin, setNewUserIsAdmin] = useState(false)
  const [newUserPassword, setNewUserPassword] = useState('')
  const [showNewUserForm, setShowNewUserForm] = useState(false)
  const [userPasswords, setUserPasswords] = useState<Record<string, string>>({})

  const [newKeyName, setNewKeyName] = useState('')
  const [newKeyValue, setNewKeyValue] = useState('')
  const [newKeyExpiresAt, setNewKeyExpiresAt] = useState('')
  const [showNewApiKeyForm, setShowNewApiKeyForm] = useState(false)
  const [isGeneratedApiKey, setIsGeneratedApiKey] = useState(false)
  const newApiKeyInputRef = useRef<HTMLInputElement | null>(null)

  const [dirtyClassIds, setDirtyClassIds] = useState<Set<string>>(new Set())
  const [dirtyUserNames, setDirtyUserNames] = useState<Set<string>>(new Set())
  const [dirtyKeyIds, setDirtyKeyIds] = useState<Set<string>>(new Set())

  const markClassDirty = (id: string) => setDirtyClassIds((prev) => new Set(prev).add(id))
  const clearClassDirty = (id: string) => setDirtyClassIds((prev) => { const next = new Set(prev); next.delete(id); return next })
  const markUserDirty = (name: string) => setDirtyUserNames((prev) => new Set(prev).add(name))
  const clearUserDirty = (name: string) => setDirtyUserNames((prev) => { const next = new Set(prev); next.delete(name); return next })
  const markKeyDirty = (id: string) => setDirtyKeyIds((prev) => new Set(prev).add(id))
  const clearKeyDirty = (id: string) => setDirtyKeyIds((prev) => { const next = new Set(prev); next.delete(id); return next })

  const loadClasses = () => apiClient.listDocumentClasses().then((items) => setClasses(items))
  const loadUsers = () =>
    apiClient
      .listLocalUsers()
      .then((items) => setUsers(items.map((item) => ({ ...item, originalUserName: item.userName }))))
  const loadKeys = () => apiClient.listApiKeys().then((items) => setKeys(items))
  const loadQueue = () => apiClient.listQueue().then((items) => setQueueEntries(items))

  useEffect(() => {
    void loadClasses()
    void loadKeys()
    void loadUsers()
    void loadQueue()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const openNewClassPromptEditor = () => {
    setPromptEditorTarget({ mode: 'new' })
    setPromptDraft(newClassPrompt)
  }

  const openExistingClassPromptEditor = (targetClass: DocumentClass) => {
    setPromptEditorTarget({ mode: 'existing', id: targetClass.id })
    setPromptDraft(targetClass.prompt)
  }

  const closePromptEditor = () => {
    setPromptEditorTarget(null)
    setPromptDraft('')
  }

  const savePromptEditor = () => {
    if (!promptEditorTarget) {
      return
    }

    if (promptEditorTarget.mode === 'new') {
      setNewClassPrompt(promptDraft)
      closePromptEditor()
      return
    }

    setClasses((prev) =>
      prev.map((current) => (current.id === promptEditorTarget.id ? { ...current, prompt: promptDraft } : current)),
    )
    markClassDirty(promptEditorTarget.id)
    closePromptEditor()
  }

  const generateRecommendedApiKey = () => {
    const bytes = new Uint8Array(24)
    window.crypto.getRandomValues(bytes)
    const value = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
    setNewKeyValue(`yk_${value}`)
    setIsGeneratedApiKey(true)
  }

  const copyNewApiKeyToClipboard = async () => {
    if (!newKeyValue) {
      setStatus('先にAPIキーを入力または生成してください。')
      return
    }
    try {
      await navigator.clipboard.writeText(newKeyValue)
      setStatus('APIキーをクリップボードにコピーしました。')
    } catch {
      setStatus('APIキーのコピーに失敗しました。')
    }
  }

  const handleNewApiKeyFocus = () => {
    if (isGeneratedApiKey && newApiKeyInputRef.current) {
      newApiKeyInputRef.current.select()
    }
  }

  return (
    <section className="rounded-lg border border-blue-200 bg-white p-4 shadow-sm">
      <h2 className="page-title flex items-center gap-2">
        <WrenchScrewdriverIcon className="h-7 w-7 text-slate-600" />
        管理画面
      </h2>
      <div className="tabs">
        <button className={`tab-btn ${tab === 'classes' ? 'is-active' : ''}`} onClick={() => setTab('classes')}>
          <RectangleStackIcon className="mr-1 inline-block h-4 w-4" />
          文書タイプ
        </button>
        <button className={`tab-btn ${tab === 'users' ? 'is-active' : ''}`} onClick={() => setTab('users')}>
          <UsersIcon className="mr-1 inline-block h-4 w-4" />
          ローカルユーザー
        </button>
        <button className={`tab-btn ${tab === 'apikeys' ? 'is-active' : ''}`} onClick={() => setTab('apikeys')}>
          <KeyIcon className="mr-1 inline-block h-4 w-4" />
          APIキー
        </button>
        <button
          className={`tab-btn ${tab === 'queue' ? 'is-active' : ''}`}
          onClick={() => {
            setTab('queue')
            void loadQueue()
          }}
        >
          <QueueListIcon className="mr-1 inline-block h-4 w-4" />
          キュー
        </button>
      </div>

      {tab === 'classes' && (
        <div>
          <h3 className="flex items-center gap-2">
            <ShieldCheckIcon className="h-5 w-5 text-slate-600" />
            文書タイプ管理
          </h3>
          <div className="actions">
            <button type="button" onClick={() => setShowNewClassForm((prev) => !prev)}>
              ＋新規文書タイプ追加
            </button>
          </div>
          {showNewClassForm && (
            <div className="new-record-form-panel">
              <div className="grid">
                <label className="field">
                  <span>文書タイプID</span>
                  <input value={newClassId} onChange={(event) => setNewClassId(event.target.value)} />
                </label>
                <label className="field">
                  <span>名称</span>
                  <input value={newClassName} onChange={(event) => setNewClassName(event.target.value)} />
                </label>
                <label className="field">
                  <span>優先度</span>
                  <input
                    type="number"
                    value={newClassPriority}
                    onChange={(event) => setNewClassPriority(event.target.value)}
                  />
                </label>
                <label className="field">
                  <span>有効</span>
                  <input
                    type="checkbox"
                    checked={newClassEnabled}
                    onChange={(event) => setNewClassEnabled(event.target.checked)}
                  />
                </label>
                <label className="field">
                  <span>プロンプト</span>
                  <button
                    type="button"
                    onClick={openNewClassPromptEditor}
                    className="prompt-preview cursor-pointer text-left hover:bg-slate-100 rounded"
                  >
                    {newClassPrompt ? newClassPrompt.slice(0, 60) + (newClassPrompt.length > 60 ? '…' : '') : 'クリックして編集…'}
                  </button>
                </label>
              </div>
              <div className="actions">
                <button
                  onClick={async () => {
                    if (!newClassId.trim() || !newClassName.trim()) {
                      setStatus('文書タイプIDと名称は必須です。')
                      return
                    }
                    try {
                      await apiClient.createDocumentClass({
                        id: newClassId.trim(),
                        name: newClassName.trim(),
                        priority: Number.parseInt(newClassPriority, 10) || 0,
                        enabled: newClassEnabled,
                        prompt: newClassPrompt,
                      })
                      setNewClassId('')
                      setNewClassName('')
                      setNewClassPriority('0')
                      setNewClassEnabled(true)
                      setNewClassPrompt('')
                      setShowNewClassForm(false)
                      await loadClasses()
                      setStatus('文書タイプを追加しました。')
                    } catch {
                      setStatus('文書タイプ追加に失敗しました。')
                    }
                  }}
                >
                  文書タイプ追加
                </button>
              </div>
            </div>
          )}
          <table>
            <thead>
              <tr>
                <th>文書タイプID</th>
                <th>名称</th>
                <th>優先度</th>
                <th>有効</th>
                <th>プロンプト</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {classes.map((item) => (
                <tr key={item.id}>
                  <td>{item.id}</td>
                  <td>
                    <input
                      value={item.name}
                      onChange={(event) => {
                        markClassDirty(item.id)
                        setClasses((prev) =>
                          prev.map((current) =>
                            current.id === item.id ? { ...current, name: event.target.value } : current,
                          ),
                        )
                      }}
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      value={item.priority}
                      onChange={(event) => {
                        markClassDirty(item.id)
                        setClasses((prev) =>
                          prev.map((current) =>
                            current.id === item.id
                              ? { ...current, priority: Number.parseInt(event.target.value, 10) || 0 }
                              : current,
                          ),
                        )
                      }}
                    />
                  </td>
                  <td>
                    <input
                      type="checkbox"
                      checked={item.enabled}
                      onChange={(event) => {
                        markClassDirty(item.id)
                        setClasses((prev) =>
                          prev.map((current) =>
                            current.id === item.id ? { ...current, enabled: event.target.checked } : current,
                          ),
                        )
                      }}
                    />
                  </td>
                  <td>
                    <button
                      type="button"
                      onClick={() => openExistingClassPromptEditor(item)}
                      className="prompt-preview cursor-pointer text-left hover:bg-slate-100 rounded w-full"
                    >
                      {item.prompt ? item.prompt.slice(0, 60) + (item.prompt.length > 60 ? '…' : '') : 'クリックして編集…'}
                    </button>
                  </td>
                  <td>
                    <div className="actions-inline">
                      <button
                        disabled={!dirtyClassIds.has(item.id)}
                        onClick={async () => {
                          try {
                            await apiClient.updateDocumentClass(item.id, {
                              name: item.name,
                              priority: item.priority,
                              enabled: item.enabled,
                              prompt: item.prompt,
                            })
                            clearClassDirty(item.id)
                            await loadClasses()
                            setStatus(`文書タイプ ${item.id} を更新しました。`)
                          } catch {
                            setStatus('文書タイプ更新に失敗しました。')
                          }
                        }}
                      >
                        保存
                      </button>
                      <button
                        onClick={async () => {
                          if (!window.confirm(`文書タイプ ${item.id} を削除します。よろしいですか？`)) {
                            return
                          }
                          try {
                            await apiClient.deleteDocumentClass(item.id)
                            await loadClasses()
                            setStatus(`文書タイプ ${item.id} を削除しました。`)
                          } catch {
                            setStatus('文書タイプ削除に失敗しました（関連文書が存在する可能性があります）。')
                          }
                        }}
                      >
                        削除
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'users' && (
        <div>
          <h3>ローカルユーザー管理</h3>
          <p>ユーザー追加、再設定、有効/無効切替を行います。</p>
          <>
              <div className="actions">
                <button type="button" onClick={() => setShowNewUserForm((prev) => !prev)}>
                  ＋新規ローカルユーザー追加
                </button>
              </div>
              {showNewUserForm && (
                <div className="new-record-form-panel">
                  <div className="grid">
                    <label className="field">
                      <span>新規ユーザーID</span>
                      <input value={newUserName} onChange={(event) => setNewUserName(event.target.value)} />
                    </label>
                    <label className="field">
                      <span>管理者</span>
                      <input
                        type="checkbox"
                        checked={newUserIsAdmin}
                        onChange={(event) => setNewUserIsAdmin(event.target.checked)}
                      />
                    </label>
                    <label className="field">
                      <span>パスワード</span>
                      <input
                        type="password"
                        value={newUserPassword}
                        onChange={(event) => setNewUserPassword(event.target.value)}
                      />
                    </label>
                  </div>
                  <div className="actions">
                    <button
                      onClick={async () => {
                        if (!newUserName.trim()) {
                          setStatus('ユーザー名を入力してください。')
                          return
                        }
                        if (newUserPassword.trim().length < 4) {
                          setStatus('初期パスワードは4文字以上にしてください。')
                          return
                        }
                        try {
                          await apiClient.createLocalUser({
                            userName: newUserName.trim(),
                            isAdmin: newUserIsAdmin,
                            enabled: true,
                            password: newUserPassword,
                          })
                          setNewUserName('')
                          setNewUserIsAdmin(false)
                          setNewUserPassword('')
                          setShowNewUserForm(false)
                          await loadUsers()
                          setStatus('ローカルユーザーを追加しました。')
                        } catch {
                          setStatus('ローカルユーザー追加に失敗しました。')
                        }
                      }}
                    >
                      ユーザー追加
                    </button>
                  </div>
                </div>
              )}
              <table>
                <thead>
                  <tr>
                    <th>ユーザーID</th>
                    <th>有効</th>
                    <th>管理者</th>
                    <th>パスワード</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((item) => (
                    <tr key={item.originalUserName}>
                      <td>
                        <input
                          value={item.userName}
                          onChange={(event) => {
                            markUserDirty(item.originalUserName)
                            setUsers((prev) =>
                              prev.map((current) =>
                                current.originalUserName === item.originalUserName
                                  ? { ...current, userName: event.target.value }
                                  : current,
                              ),
                            )
                          }}
                        />
                      </td>
                      <td>
                        <input
                          type="checkbox"
                          checked={item.enabled}
                          onChange={(event) => {
                            markUserDirty(item.originalUserName)
                            setUsers((prev) =>
                              prev.map((current) =>
                                current.originalUserName === item.originalUserName
                                  ? { ...current, enabled: event.target.checked }
                                  : current,
                              ),
                            )
                          }}
                        />
                      </td>
                      <td>
                        <input
                          type="checkbox"
                          checked={item.isAdmin}
                          onChange={(event) => {
                            markUserDirty(item.originalUserName)
                            setUsers((prev) =>
                              prev.map((current) =>
                                current.originalUserName === item.originalUserName
                                  ? { ...current, isAdmin: event.target.checked }
                                  : current,
                              ),
                            )
                          }}
                        />
                      </td>
                      <td>
                        <input
                          type="password"
                          placeholder="変更時のみ入力"
                          value={userPasswords[item.originalUserName] ?? ''}
                          onChange={(event) => {
                            markUserDirty(item.originalUserName)
                            setUserPasswords((prev) => ({ ...prev, [item.originalUserName]: event.target.value }))
                          }}
                        />
                      </td>
                      <td>
                        <div className="actions-inline">
                          <button
                            disabled={!dirtyUserNames.has(item.originalUserName)}
                            onClick={async () => {
                              try {
                                const password = (userPasswords[item.originalUserName] ?? '').trim()
                                if (password && password.length < 4) {
                                  setStatus('新規パスワードは4文字以上にしてください。')
                                  return
                                }
                                await apiClient.updateLocalUser(item.originalUserName, {
                                  userName: item.userName,
                                  isAdmin: item.isAdmin,
                                  enabled: item.enabled,
                                  password: password || undefined,
                                })
                                setUserPasswords((prev) => ({ ...prev, [item.originalUserName]: '' }))
                                clearUserDirty(item.originalUserName)
                                await loadUsers()
                                setStatus(`ユーザー ${item.userName} を更新しました。`)
                              } catch {
                                setStatus('ユーザー更新に失敗しました。')
                              }
                            }}
                          >
                            保存
                          </button>
                          <button
                            onClick={async () => {
                              if (!window.confirm(`ユーザー ${item.userName} を削除します。よろしいですか？`)) {
                                return
                              }
                              try {
                                await apiClient.deleteLocalUser(item.originalUserName)
                                await loadUsers()
                                setStatus(`ユーザー ${item.userName} を削除しました。`)
                              } catch {
                                setStatus('ユーザー削除に失敗しました。')
                              }
                            }}
                          >
                            削除
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
          </>
        </div>
      )}

      {tab === 'apikeys' && (
        <div>
          <h3>APIキー管理</h3>
          <div className="actions">
            <button type="button" onClick={() => setShowNewApiKeyForm((prev) => !prev)}>
              ＋新規APIキー追加
            </button>
          </div>
          {showNewApiKeyForm && (
            <div className="new-record-form-panel">
              <div className="grid">
                <label className="field">
                  <span>新規キー名</span>
                  <input value={newKeyName} onChange={(event) => setNewKeyName(event.target.value)} />
                </label>
                <label className="field">
                  <div className="field-label-row">
                    <span>APIキー文字列</span>
                    <button type="button" onClick={generateRecommendedApiKey}>
                      キー生成
                    </button>
                  </div>
                  <div className="inline-input-action">
                    <input
                      ref={newApiKeyInputRef}
                      value={newKeyValue}
                      onChange={(event) => {
                        setNewKeyValue(event.target.value)
                        setIsGeneratedApiKey(false)
                      }}
                      onFocus={handleNewApiKeyFocus}
                    />
                    <button type="button" onClick={() => void copyNewApiKeyToClipboard()}>
                      コピー
                    </button>
                  </div>
                </label>
                <label className="field">
                  <span>有効期限 (ISO日時)</span>
                  <input
                    placeholder="2026-12-31T23:59:59"
                    value={newKeyExpiresAt}
                    onChange={(event) => setNewKeyExpiresAt(event.target.value)}
                  />
                </label>
              </div>
              <div className="actions">
                <button
                  onClick={async () => {
                    if (!newKeyName.trim()) {
                      setStatus('キー名を入力してください。')
                      return
                    }
                    if (!newKeyValue.trim()) {
                      setStatus('APIキー文字列を入力してください。')
                      return
                    }
                    try {
                      await apiClient.createApiKey({
                        key: newKeyValue.trim(),
                        keyName: newKeyName.trim(),
                        enabled: true,
                        expiresAt: newKeyExpiresAt.trim() || null,
                      })
                      setNewKeyName('')
                      setNewKeyValue('')
                      setNewKeyExpiresAt('')
                      setIsGeneratedApiKey(false)
                      setShowNewApiKeyForm(false)
                      await loadKeys()
                      setStatus('APIキーを追加しました。')
                    } catch {
                      setStatus('APIキー追加に失敗しました。')
                    }
                  }}
                >
                  APIキー追加
                </button>
              </div>
            </div>
          )}
          <table>
            <thead>
              <tr>
                <th>キー名</th>
                <th>作成日時</th>
                <th>有効期限</th>
                <th>有効</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {keys.map((item) => (
                <tr key={item.id}>
                  <td>
                    <input
                      value={item.keyName}
                      onChange={(event) => {
                        markKeyDirty(item.id)
                        setKeys((prev) =>
                          prev.map((current) =>
                            current.id === item.id ? { ...current, keyName: event.target.value } : current,
                          ),
                        )
                      }}
                    />
                  </td>
                  <td>{new Date(item.createdAt).toLocaleString()}</td>
                  <td>
                    <input
                      value={item.expiresAt ?? ''}
                      onChange={(event) => {
                        markKeyDirty(item.id)
                        setKeys((prev) =>
                          prev.map((current) =>
                            current.id === item.id ? { ...current, expiresAt: event.target.value || null } : current,
                          ),
                        )
                      }}
                    />
                  </td>
                  <td>
                    <input
                      type="checkbox"
                      checked={item.enabled}
                      onChange={(event) => {
                        markKeyDirty(item.id)
                        setKeys((prev) =>
                          prev.map((current) =>
                            current.id === item.id ? { ...current, enabled: event.target.checked } : current,
                          ),
                        )
                      }}
                    />
                  </td>
                  <td>
                    <div className="actions-inline">
                      <button
                        disabled={!dirtyKeyIds.has(item.id)}
                        onClick={async () => {
                          try {
                            await apiClient.updateApiKey(item.id, {
                              keyName: item.keyName,
                              expiresAt: item.expiresAt ?? null,
                              enabled: item.enabled,
                            })
                            clearKeyDirty(item.id)
                            await loadKeys()
                            setStatus(`APIキー ${item.keyName} を更新しました。`)
                          } catch {
                            setStatus('APIキー更新に失敗しました。')
                          }
                        }}
                      >
                        保存
                      </button>
                      <button
                        onClick={async () => {
                          if (!window.confirm(`APIキー ${item.keyName} を削除します。よろしいですか？`)) {
                            return
                          }
                          try {
                            await apiClient.deleteApiKey(item.id)
                            await loadKeys()
                            setStatus(`APIキー ${item.keyName} を削除しました。`)
                          } catch {
                            setStatus('APIキー削除に失敗しました。')
                          }
                        }}
                      >
                        削除
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'queue' && (
        <div>
          <h3 className="flex items-center gap-2">
            <QueueListIcon className="h-5 w-5 text-slate-600" />
            処理キュー管理
          </h3>
          <div className="actions">
            <button
              type="button"
              onClick={async () => {
                await loadQueue()
                setStatus('キューを更新しました。')
              }}
            >
              更新
            </button>
            <button
              type="button"
              disabled={queueEntries.length === 0}
              onClick={async () => {
                if (!window.confirm(`キューの全エントリ (${queueEntries.length} 件) を削除します。よろしいですか？`)) {
                  return
                }
                try {
                  const result = await apiClient.clearQueue()
                  await loadQueue()
                  setStatus(`キューを全削除しました (${result.deleted} 件)。`)
                } catch {
                  setStatus('キューの全削除に失敗しました。')
                }
              }}
            >
              全クリア
            </button>
          </div>
          {queueEntries.length === 0 ? (
            <p className="hint-text">キューにエントリはありません。</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>EntryID</th>
                  <th>リトライ回数</th>
                  <th>最終失敗日時</th>
                  <th>ファイルパス</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {queueEntries.map((entry) => (
                  <tr key={entry.entryId}>
                    <td>{entry.entryId}</td>
                    <td>{entry.retry}</td>
                    <td>{entry.lastFailure ? new Date(entry.lastFailure).toLocaleString() : '—'}</td>
                    <td style={{ wordBreak: 'break-all', maxWidth: '400px' }}>{entry.sourcePath}</td>
                    <td>
                      <button
                        onClick={async () => {
                          if (!window.confirm(`EntryID ${entry.entryId} を削除します。よろしいですか？`)) {
                            return
                          }
                          try {
                            await apiClient.deleteQueueEntry(entry.entryId)
                            await loadQueue()
                            setStatus(`EntryID ${entry.entryId} を削除しました。`)
                          } catch {
                            setStatus('キューエントリの削除に失敗しました。')
                          }
                        }}
                      >
                        削除
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {status && <p className="hint-text">{status}</p>}

      {promptEditorTarget && (
        <div className="dialog-backdrop" role="dialog" aria-modal="true">
          <div className="dialog-panel">
            <h3>Prompt編集</h3>
            <p className="hint-text">
              {promptEditorTarget.mode === 'new' ? '新規文書タイプのPromptを編集' : `文書タイプ ${promptEditorTarget.id} のPromptを編集`}
            </p>
            <textarea
              className="prompt-editor-textarea"
              value={promptDraft}
              onChange={(event) => setPromptDraft(event.target.value)}
            />
            <div className="actions">
              <button type="button" onClick={savePromptEditor}>
                保存
              </button>
              <button type="button" onClick={closePromptEditor}>
                キャンセル
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
