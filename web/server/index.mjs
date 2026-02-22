import crypto from 'node:crypto'
import fs from 'node:fs'
import https from 'node:https'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import express from 'express'
import Database from 'better-sqlite3'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const webRoot = path.resolve(__dirname, '..')
const projectRoot = path.resolve(webRoot, '..')
const isDevServer = process.argv.includes('--dev')

function loadEnvFile() {
  const envPath = path.join(projectRoot, '.env')
  if (!fs.existsSync(envPath)) {
    return
  }

  const lines = fs.readFileSync(envPath, 'utf-8').split(/\r?\n/)
  for (const line of lines) {
    const text = line.trim()
    if (!text || text.startsWith('#') || !text.includes('=')) {
      continue
    }

    const index = text.indexOf('=')
    const key = text.slice(0, index).trim()
    const value = text.slice(index + 1).trim().replace(/^['"]|['"]$/g, '')
    if (key && process.env[key] == null) {
      process.env[key] = value
    }
  }
}

loadEnvFile()

const app = express()
app.use(express.json())

const SESSION_COOKIE_NAME = 'yokins_session'
const REMEMBER_ME_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000
const SESSION_MAX_AGE_MS = 8 * 60 * 60 * 1000
const SESSION_TOKEN_VERSION = 1

function resolveDbPath() {
  if (process.env.DATABASE_PATH?.trim()) {
    return process.env.DATABASE_PATH.trim()
  }

  const appEnv = (process.env.APP_ENV ?? 'dev').toLowerCase()
  if (appEnv === 'prod') {
    return path.join(projectRoot, 'data', 'yokinspaperless.db')
  }

  if (appEnv === 'stg') {
    return path.join(projectRoot, 'data', 'yokinspaperless-stg.db')
  }

  return path.join(projectRoot, 'data', 'yokinspaperless-dev.db')
}

const dbPath = resolveDbPath()
fs.mkdirSync(path.dirname(dbPath), { recursive: true })
const db = new Database(dbPath)
const monitorEventToken = String(process.env.MONITOR_EVENT_NOTIFY_TOKEN ?? '').trim()
const documentEventClients = new Set()
let documentEventSequence = 0

function hashPassword(password, salt) {
  return crypto.createHash('sha256').update(`${salt}:${password}`).digest('hex')
}

function hashApiKey(apiKey) {
  return crypto.createHash('sha256').update(`apikey:${String(apiKey ?? '').trim()}`).digest('hex')
}

let hasWarnedInsecureSessionSecret = false

function resolveServerFingerprint() {
  const hostName = os.hostname()
  const platform = process.platform
  const release = os.release()
  const arch = process.arch
  const cpus = os.cpus()?.length ?? 0

  let macAddresses = []
  try {
    const interfaces = os.networkInterfaces()
    macAddresses = Object.values(interfaces)
      .flatMap((items) => items ?? [])
      .map((item) => String(item?.mac ?? '').trim().toLowerCase())
      .filter((mac) => mac && mac !== '00:00:00:00:00:00')
      .sort()
  } catch {
    macAddresses = []
  }

  const fingerprintParts = [hostName, platform, release, arch, String(cpus), ...macAddresses]
    .map((part) => String(part ?? '').trim())
    .filter(Boolean)

  if (fingerprintParts.length === 0) {
    return ''
  }

  return fingerprintParts.join('|')
}

function getSessionSecretKey() {
  const configuredSecret = String(process.env.API_SESSION_SECRET ?? process.env.APP_SECRET ?? '').trim()

  if (configuredSecret) {
    return crypto.createHash('sha256').update(configuredSecret).digest()
  }

  const fingerprint = resolveServerFingerprint()
  if (fingerprint) {
    if (!hasWarnedInsecureSessionSecret) {
      hasWarnedInsecureSessionSecret = true
      console.warn('[api] API_SESSION_SECRET is not set. Using server-fingerprint-derived secret for session cookies.') // eslint-disable-line no-console
    }

    return crypto.createHash('sha256').update(`server-fingerprint:${fingerprint}`).digest()
  }

  const runtimeRandomSecret = crypto.randomBytes(32)
  if (!hasWarnedInsecureSessionSecret) {
    hasWarnedInsecureSessionSecret = true
    console.warn('[api] API_SESSION_SECRET is not set. Using runtime-random secret for session cookies.') // eslint-disable-line no-console
  }

  return crypto.createHash('sha256').update(runtimeRandomSecret).digest()
}

const sessionSecretKey = getSessionSecretKey()

function parseCookies(headerValue) {
  const cookieText = String(headerValue ?? '').trim()
  if (!cookieText) {
    return {}
  }

  const result = {}
  for (const pair of cookieText.split(';')) {
    const [rawKey, ...rest] = pair.split('=')
    const key = String(rawKey ?? '').trim()
    if (!key) {
      continue
    }
    const rawValue = rest.join('=').trim()
    result[key] = decodeURIComponent(rawValue)
  }
  return result
}

function toBool(value) {
  return Boolean(value)
}

function parseEnvBool(value) {
  const text = String(value ?? '').trim().toLowerCase()
  return text === '1' || text === 'true' || text === 'yes' || text === 'on'
}

function resolvePathFromProjectRoot(rawPath) {
  if (!rawPath) {
    return ''
  }
  if (path.isAbsolute(rawPath)) {
    return rawPath
  }
  return path.resolve(projectRoot, rawPath)
}

function resolveHttpsOptions() {
  const httpsEnabled = parseEnvBool(process.env.API_HTTPS)
  const pfxPathRaw = String(process.env.API_HTTPS_PFX_PATH ?? '').trim()
  const certPathRaw = String(process.env.API_HTTPS_CERT_PATH ?? '').trim()
  const keyPathRaw = String(process.env.API_HTTPS_KEY_PATH ?? '').trim()
  const caPathRaw = String(process.env.API_HTTPS_CA_PATH ?? '').trim()
  const passphraseRaw = String(process.env.API_HTTPS_PASSPHRASE ?? '').trim()

  const hasAnyTlsConfig = httpsEnabled || pfxPathRaw || certPathRaw || keyPathRaw || caPathRaw || passphraseRaw
  if (!hasAnyTlsConfig) {
    return null
  }

  const caPath = resolvePathFromProjectRoot(caPathRaw)
  if (caPath && !fs.existsSync(caPath)) {
    throw new Error(`HTTPS CA file not found: ${caPath}`)
  }

  if (pfxPathRaw) {
    const pfxPath = resolvePathFromProjectRoot(pfxPathRaw)
    if (!fs.existsSync(pfxPath)) {
      throw new Error(`HTTPS PFX file not found: ${pfxPath}`)
    }

    return {
      pfx: fs.readFileSync(pfxPath),
      ca: caPath ? fs.readFileSync(caPath) : undefined,
      passphrase: passphraseRaw || undefined,
      pfxPath,
      certPath: '',
      keyPath: '',
      caPath,
    }
  }

  if (!certPathRaw || !keyPathRaw) {
    throw new Error(
      'HTTPS requires API_HTTPS_PFX_PATH, or both API_HTTPS_CERT_PATH and API_HTTPS_KEY_PATH'
    )
  }

  const certPath = resolvePathFromProjectRoot(certPathRaw)
  const keyPath = resolvePathFromProjectRoot(keyPathRaw)

  if (!fs.existsSync(certPath)) {
    throw new Error(`HTTPS cert file not found: ${certPath}`)
  }
  if (!fs.existsSync(keyPath)) {
    throw new Error(`HTTPS key file not found: ${keyPath}`)
  }

  return {
    cert: fs.readFileSync(certPath),
    key: fs.readFileSync(keyPath),
    ca: caPath ? fs.readFileSync(caPath) : undefined,
    passphrase: passphraseRaw || undefined,
    certPath,
    keyPath,
    caPath,
  }
}

function ensureSchema() {
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  // Create tables if they don't exist (needed on first run / Railway cold start)
  db.exec(`
    CREATE TABLE IF NOT EXISTS DocumentClasses (
      DocumentClassID TEXT PRIMARY KEY,
      Name            TEXT    NOT NULL,
      Priority        INTEGER NOT NULL DEFAULT 0,
      Enabled         INTEGER NOT NULL DEFAULT 1,
      Prompt          TEXT    NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS Users (
      UserName      TEXT PRIMARY KEY,
      PasswordSalt  TEXT NOT NULL,
      PasswordHash  TEXT,
      Enabled       INTEGER NOT NULL DEFAULT 1,
      IsAdmin       INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS Documents (
      ID                   TEXT PRIMARY KEY,
      Active               INTEGER NOT NULL DEFAULT 1,
      SourcePath           TEXT    NOT NULL,
      DateCreated          TEXT    NOT NULL,
      DateReceived         TEXT    NOT NULL,
      Title                TEXT    NOT NULL,
      Sender               TEXT,
      SenderOrganization   TEXT,
      Recipient            TEXT,
      RecipientOrganization TEXT,
      DocumentClassID      TEXT,
      DocumentData         TEXT    NOT NULL,
      FOREIGN KEY (DocumentClassID) REFERENCES DocumentClasses(DocumentClassID)
    );

    CREATE TABLE IF NOT EXISTS ApiKeys (
      ApiKeyID   TEXT PRIMARY KEY,
      KeyName    TEXT NOT NULL UNIQUE,
      KeyHash    TEXT NOT NULL,
      CreatedAt  TEXT NOT NULL,
      ExpiresAt  TEXT,
      Enabled    INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS Queue (
      EntryID    INTEGER PRIMARY KEY AUTOINCREMENT,
      Retry      INTEGER NOT NULL DEFAULT 0,
      LastFailure TEXT,
      SourcePath TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_documentclasses_priority
      ON DocumentClasses(Priority, DocumentClassID);
    CREATE INDEX IF NOT EXISTS idx_documents_active_received_id
      ON Documents(Active, DateReceived DESC, ID);
    CREATE INDEX IF NOT EXISTS idx_documents_docclass_active_received_id
      ON Documents(DocumentClassID, Active, DateReceived DESC, ID);
    CREATE INDEX IF NOT EXISTS idx_documents_docclass_received_id
      ON Documents(DocumentClassID, DateReceived DESC, ID);
    CREATE INDEX IF NOT EXISTS idx_documents_recipient
      ON Documents(Recipient);
    CREATE INDEX IF NOT EXISTS idx_queue_source_path
      ON Queue(SourcePath);
  `)
}

function seedIfEmpty() {
  const hasClasses = db.prepare('SELECT COUNT(*) as cnt FROM DocumentClasses').get().cnt > 0
  if (!hasClasses) {
    const insertClass = db.prepare('INSERT INTO DocumentClasses (DocumentClassID, Name, Priority, Enabled, Prompt) VALUES (?, ?, ?, ?, ?)')
    insertClass.run('Invoice', '請求書', 10, 1, '請求書向けプロンプト')
    insertClass.run('Order', '注文書', 20, 1, '注文書向けプロンプト')
    insertClass.run('Notice', '通知書', 30, 1, '通知書向けプロンプト')
  }

  const hasUsers = db.prepare('SELECT COUNT(*) as cnt FROM Users').get().cnt > 0
  if (!hasUsers) {
    const insertUser = db.prepare(
      'INSERT INTO Users (UserName, PasswordSalt, PasswordHash, Enabled, IsAdmin) VALUES (?, ?, ?, ?, ?)'
    )

    const users = [
      ['admin', true],
      ['tanaka', false],
      ['suzuki', false],
    ]

    for (const [userName, isAdmin] of users) {
      const salt = crypto.randomUUID().replaceAll('-', '').slice(0, 16)
      insertUser.run(userName, salt, hashPassword('pass1234', salt), 1, isAdmin ? 1 : 0)
    }
  }
}

function parseBoolQuery(value) {
  return String(value ?? '').toLowerCase() === 'true'
}

function parseOptionalBoolQuery(value) {
  if (value == null) {
    return undefined
  }
  const text = String(value).toLowerCase().trim()
  if (text === 'true' || text === '1') {
    return true
  }
  if (text === 'false' || text === '0') {
    return false
  }
  return undefined
}

function asIsoNow() {
  return new Date().toISOString().replace('.000Z', '')
}

function toSseData(eventName, payload) {
  const id = String(++documentEventSequence)
  return `id: ${id}\nevent: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`
}

function broadcastDocumentsChanged(payload = {}) {
  if (documentEventClients.size === 0) {
    return
  }

  const body = toSseData('documents_changed', {
    event: 'documents_changed',
    occurredAt: asIsoNow(),
    ...payload,
  })

  for (const client of documentEventClients) {
    try {
      client.write(body)
    } catch {
      documentEventClients.delete(client)
    }
  }
}

function isLoopbackAddress(rawAddress) {
  const address = String(rawAddress ?? '').trim().toLowerCase()
  if (!address) {
    return false
  }

  return (
    address === '::1' ||
    address === '127.0.0.1' ||
    address === '::ffff:127.0.0.1' ||
    address === 'localhost'
  )
}

function isLoopbackRequest(req) {
  const forwardedFor = String(req.headers['x-forwarded-for'] ?? '')
    .split(',')[0]
    .trim()
  if (isLoopbackAddress(forwardedFor)) {
    return true
  }

  return isLoopbackAddress(req.socket?.remoteAddress)
}

function buildSessionUser(row) {
  if (!row) {
    return null
  }
  return {
    username: row.UserName,
    role: toBool(row.IsAdmin) ? 'admin' : 'user',
  }
}

function toBase64Url(buffer) {
  return Buffer.from(buffer)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
}

function fromBase64Url(value) {
  const text = String(value ?? '').trim()
  if (!text) {
    return Buffer.alloc(0)
  }

  const normalized = text.replace(/-/g, '+').replace(/_/g, '/')
  const padLength = (4 - (normalized.length % 4)) % 4
  const padded = normalized + '='.repeat(padLength)
  return Buffer.from(padded, 'base64')
}

function encryptSessionPayload(payload) {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', sessionSecretKey, iv)
  const plaintext = Buffer.from(JSON.stringify(payload), 'utf-8')
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()])
  const authTag = cipher.getAuthTag()

  return `${toBase64Url(iv)}.${toBase64Url(encrypted)}.${toBase64Url(authTag)}`
}

function decryptSessionPayload(token) {
  const text = String(token ?? '').trim()
  if (!text) {
    return null
  }

  const parts = text.split('.')
  if (parts.length !== 3) {
    return null
  }

  try {
    const iv = fromBase64Url(parts[0])
    const encrypted = fromBase64Url(parts[1])
    const authTag = fromBase64Url(parts[2])

    if (iv.length !== 12 || authTag.length !== 16) {
      return null
    }

    const decipher = crypto.createDecipheriv('aes-256-gcm', sessionSecretKey, iv)
    decipher.setAuthTag(authTag)
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()])
    const payload = JSON.parse(decrypted.toString('utf-8'))
    return payload && typeof payload === 'object' ? payload : null
  } catch {
    return null
  }
}

function getSessionTokenFromRequest(req) {
  const cookies = parseCookies(req.headers.cookie)
  const token = String(cookies[SESSION_COOKIE_NAME] ?? '').trim()
  return token || ''
}

function clearSessionCookie(res) {
  res.clearCookie(SESSION_COOKIE_NAME, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: parseEnvBool(process.env.API_HTTPS),
  })
}

function setSessionCookie(res, sessionToken, rememberMe) {
  const cookieOptions = {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: parseEnvBool(process.env.API_HTTPS),
  }

  if (rememberMe) {
    cookieOptions.maxAge = REMEMBER_ME_MAX_AGE_MS
  }

  res.cookie(SESSION_COOKIE_NAME, sessionToken, cookieOptions)
}

function createSessionToken(userName, rememberMe) {
  const now = Date.now()
  const ttl = rememberMe ? REMEMBER_ME_MAX_AGE_MS : SESSION_MAX_AGE_MS
  const payload = {
    ver: SESSION_TOKEN_VERSION,
    sub: userName,
    iat: now,
    exp: now + ttl,
  }

  return encryptSessionPayload(payload)
}

function resolveSessionUser(req) {
  const sessionToken = getSessionTokenFromRequest(req)
  if (!sessionToken) {
    return null
  }

  const payload = decryptSessionPayload(sessionToken)
  const userName = String(payload?.sub ?? '').trim()
  const expiresAt = Number(payload?.exp)

  if (payload?.ver !== SESSION_TOKEN_VERSION || !userName || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    return null
  }

  const row = db
    .prepare(
      `
      SELECT UserName, Enabled, IsAdmin
      FROM Users
      WHERE UserName = ?
    `
    )
    .get(userName)

  if (!row || !toBool(row.Enabled)) {
    return null
  }

  return buildSessionUser(row)
}

function resolveApiKeyUser(req) {
  const authorizationHeader = String(req.headers.authorization ?? '').trim()
  const matched = authorizationHeader.match(/^Bearer\s+(.+)$/i)
  const apiKey = String(matched?.[1] ?? '').trim()
  if (!apiKey) {
    return null
  }

  const keyHash = hashApiKey(apiKey)
  const row = db
    .prepare(
      `
      SELECT KeyName, ExpiresAt, Enabled
      FROM ApiKeys
      WHERE KeyHash = ?
      LIMIT 1
    `
    )
    .get(keyHash)

  if (!row || !toBool(row.Enabled)) {
    return null
  }

  const expiresAt = String(row.ExpiresAt ?? '').trim()
  if (expiresAt && expiresAt <= asIsoNow()) {
    return null
  }

  return {
    username: `apikey:${row.KeyName}`,
    role: 'user',
  }
}

function parsePriority(value) {
  const parsed = Number.parseInt(String(value ?? '0'), 10)
  if (!Number.isFinite(parsed)) {
    return 0
  }
  return parsed
}

function resolveContentType(filePath) {
  const ext = path.extname(filePath).toLowerCase()
  if (ext === '.pdf') {
    return 'application/pdf'
  }
  if (ext === '.tif' || ext === '.tiff') {
    return 'image/tiff'
  }
  if (ext === '.png') {
    return 'image/png'
  }
  if (ext === '.jpg' || ext === '.jpeg') {
    return 'image/jpeg'
  }
  if (ext === '.gif') {
    return 'image/gif'
  }
  if (ext === '.bmp') {
    return 'image/bmp'
  }
  if (ext === '.webp') {
    return 'image/webp'
  }
  return 'application/octet-stream'
}

function sendDocumentSourceFile(res, id) {
  const row = db.prepare('SELECT SourcePath FROM Documents WHERE ID = ?').get(id)

  if (!row) {
    return res.status(404).json({ error: 'document not found' })
  }

  const sourcePath = String(row.SourcePath ?? '').trim()
  if (!sourcePath) {
    return res.status(404).json({ error: 'source path not set' })
  }

  if (!fs.existsSync(sourcePath)) {
    return res.status(404).json({ error: 'source file not found' })
  }

  const stats = fs.statSync(sourcePath)
  if (!stats.isFile()) {
    return res.status(404).json({ error: 'source path is not a file' })
  }

  res.setHeader('Content-Type', resolveContentType(sourcePath))
  res.sendFile(path.resolve(sourcePath))
}

ensureSchema()
seedIfEmpty()

app.use((req, _res, next) => {
  req.authUser = resolveSessionUser(req) ?? resolveApiKeyUser(req)
  next()
})

const publicApiPaths = new Set(['/auth/login', '/auth/me', '/auth/logout', '/internal/documents-inserted', '/documents/events'])

function requireAuth(req, res, next) {
  if (!req.authUser) {
    return res.status(401).json({ error: 'authentication required' })
  }
  next()
}

function requireAdmin(req, res, next) {
  if (!req.authUser) {
    return res.status(401).json({ error: 'authentication required' })
  }
  if (req.authUser.role !== 'admin') {
    return res.status(403).json({ error: 'admin role required' })
  }
  next()
}

app.use('/api', (req, res, next) => {
  if (publicApiPaths.has(req.path)) {
    return next()
  }
  return requireAuth(req, res, next)
})

app.use('/api/admin', requireAdmin)

app.get('/api/documents/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')

  if (typeof res.flushHeaders === 'function') {
    res.flushHeaders()
  }

  documentEventClients.add(res)
  res.write('retry: 3000\n\n')
  res.write(toSseData('documents_changed', { event: 'documents_changed', initial: true, occurredAt: asIsoNow() }))

  req.on('close', () => {
    documentEventClients.delete(res)
  })
})

app.post('/api/internal/documents-inserted', (req, res) => {
  if (monitorEventToken) {
    const token = String(req.header('x-monitor-event-token') ?? '').trim()
    if (!token || token !== monitorEventToken) {
      return res.status(401).json({ error: 'invalid monitor token' })
    }
  } else if (!isLoopbackRequest(req)) {
    return res.status(403).json({ error: 'loopback access required' })
  }

  const documentId = String(req.body?.documentId ?? '').trim()
  const reason = String(req.body?.reason ?? '').trim() || 'monitor'
  broadcastDocumentsChanged({ source: 'monitor', reason, documentId: documentId || null })

  res.json({ success: true, clients: documentEventClients.size })
})

const documentsKeepAliveTimer = setInterval(() => {
  if (documentEventClients.size === 0) {
    return
  }
  for (const client of documentEventClients) {
    try {
      client.write(': keepalive\n\n')
    } catch {
      documentEventClients.delete(client)
    }
  }
}, 25000)

if (typeof documentsKeepAliveTimer.unref === 'function') {
  documentsKeepAliveTimer.unref()
}

app.get('/api/document-classes', (_req, res) => {
  const rows = db
    .prepare('SELECT DocumentClassID, Name, Priority, Enabled, Prompt FROM DocumentClasses ORDER BY Priority, DocumentClassID')
    .all()
  res.json(
    rows.map((row) => ({
      id: row.DocumentClassID,
      name: row.Name,
      priority: row.Priority,
      enabled: toBool(row.Enabled),
      prompt: row.Prompt,
    }))
  )
})

app.post('/api/document-classes', (req, res) => {
  const id = String(req.body?.id ?? '').trim()
  const name = String(req.body?.name ?? '').trim()
  const priority = parsePriority(req.body?.priority)
  const enabled = req.body?.enabled == null ? true : toBool(req.body?.enabled)
  const prompt = String(req.body?.prompt ?? '').trim()

  if (!id || !name) {
    return res.status(400).json({ error: 'id and name are required' })
  }

  db.prepare('INSERT INTO DocumentClasses (DocumentClassID, Name, Priority, Enabled, Prompt) VALUES (?, ?, ?, ?, ?)').run(
    id,
    name,
    priority,
    enabled ? 1 : 0,
    prompt
  )
  res.status(201).json({ id, name, priority, enabled, prompt })
})

app.put('/api/document-classes/:id', (req, res) => {
  const id = req.params.id
  const name = String(req.body?.name ?? '').trim()
  const priority = parsePriority(req.body?.priority)
  const enabled = req.body?.enabled
  const prompt = String(req.body?.prompt ?? '').trim()

  if (!name) {
    return res.status(400).json({ error: 'name is required' })
  }
  if (typeof enabled !== 'boolean') {
    return res.status(400).json({ error: 'enabled must be boolean' })
  }

  const result = db
    .prepare('UPDATE DocumentClasses SET Name = ?, Priority = ?, Enabled = ?, Prompt = ? WHERE DocumentClassID = ?')
    .run(name, priority, enabled ? 1 : 0, prompt, id)
  if (result.changes === 0) {
    return res.status(404).json({ error: 'document class not found' })
  }

  res.json({ id, name, priority, enabled, prompt })
})

app.delete('/api/document-classes/:id', (req, res) => {
  const id = req.params.id

  const refCount = db.prepare('SELECT COUNT(*) as cnt FROM Documents WHERE DocumentClassID = ?').get(id).cnt
  if (refCount > 0) {
    return res.status(400).json({ error: 'document class is referenced by documents' })
  }

  const result = db.prepare('DELETE FROM DocumentClasses WHERE DocumentClassID = ?').run(id)
  if (result.changes === 0) {
    return res.status(404).json({ error: 'document class not found' })
  }

  res.json({ id, deleted: true })
})

app.get('/api/documents', (req, res) => {
  const docClass = String(req.query.class ?? '').trim()
  const unclassifiedDocClassTokens = new Set([
    '__UNCLASSIFIED__',
    '(未分類/不明)',
    '未分類/不明',
    'null',
    'NULL',
  ])
  const sender = String(req.query.sender ?? '').trim()
  const recipient = String(req.query.recipient ?? '').trim()
  const from = String(req.query.from ?? '').trim()
  const to = String(req.query.to ?? '').trim()
  const activeFilter = parseOptionalBoolQuery(req.query.active)
  const page = Math.max(1, Number.parseInt(String(req.query.page ?? '1'), 10) || 1)
  const pageSize = Math.max(1, Math.min(200, Number.parseInt(String(req.query.pageSize ?? '50'), 10) || 50))

  const where = []
  const params = {}

  if (docClass) {
    if (unclassifiedDocClassTokens.has(docClass)) {
      where.push('(DocumentClassID IS NULL OR TRIM(DocumentClassID) = \'\')')
    } else {
      where.push('DocumentClassID = @docClass')
      params.docClass = docClass
    }
  }
  if (sender) {
    where.push('(Sender LIKE @sender OR SenderOrganization LIKE @sender)')
    params.sender = `%${sender}%`
  }
  if (recipient) {
    where.push('Recipient LIKE @recipient')
    params.recipient = `%${recipient}%`
  }
  if (from) {
    where.push('DateReceived >= @from')
    params.from = from
  }
  if (to) {
    where.push('DateReceived <= @to')
    params.to = to
  }
  if (activeFilter != null) {
    where.push('Active = @active')
    params.active = activeFilter ? 1 : 0
  }

  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''
  const offset = (page - 1) * pageSize

  const total = db.prepare(`SELECT COUNT(*) as cnt FROM Documents ${whereSql}`).get(params).cnt
  const rows = db
    .prepare(
      `
      SELECT ID, DateReceived, Title, DocumentClassID, Sender, SenderOrganization, Recipient, RecipientOrganization, Active, DocumentData
      FROM Documents
      ${whereSql}
      ORDER BY DateReceived DESC
      LIMIT @limit OFFSET @offset
    `
    )
    .all({ ...params, limit: pageSize, offset })

  res.json({
    items: rows.map((row) => {
      let faxProperties = {}
      try {
        const documentData = row.DocumentData ? JSON.parse(row.DocumentData) : {}
        faxProperties =
          documentData && typeof documentData.fax_properties === 'object' && documentData.fax_properties !== null
            ? documentData.fax_properties
            : {}
      } catch {
        faxProperties = {}
      }

      return {
        id: row.ID,
        receivedAt: row.DateReceived,
        title: row.Title,
        docClass: row.DocumentClassID ?? null,
        sender: row.Sender,
        recipient: row.Recipient,
        senderName: String(faxProperties.senderName ?? row.Sender ?? ''),
        senderFaxNumber: String(faxProperties.senderFaxNumber ?? row.SenderOrganization ?? ''),
        recipientName: String(faxProperties.recipientName ?? row.Recipient ?? ''),
        recipientFaxNumber: String(faxProperties.recipientFaxNumber ?? row.RecipientOrganization ?? ''),
        documentData: (() => {
          try {
            return row.DocumentData ? JSON.parse(row.DocumentData) : {}
          } catch {
            return {}
          }
        })(),
        active: toBool(row.Active),
      }
    }),
    total,
    page,
    pageSize,
  })
})

app.get('/api/documents/:id', (req, res) => {
  const row = db
    .prepare(
      `
      SELECT ID, DateReceived, Title, DocumentClassID, Sender, SenderOrganization, Recipient, RecipientOrganization, Active, SourcePath, DocumentData
      FROM Documents
      WHERE ID = ?
    `
    )
    .get(req.params.id)

  if (!row) {
    return res.json(null)
  }

  let documentData = {}
  let faxProperties = {}
  try {
    documentData = row.DocumentData ? JSON.parse(row.DocumentData) : {}
    faxProperties =
      documentData && typeof documentData.fax_properties === 'object' && documentData.fax_properties !== null
        ? documentData.fax_properties
        : {}
  } catch {
    documentData = { raw: row.DocumentData }
    faxProperties = {}
  }

  res.json({
    id: row.ID,
    receivedAt: row.DateReceived,
    title: row.Title,
    docClass: row.DocumentClassID ?? null,
    sender: row.Sender,
    recipient: row.Recipient,
    senderName: String(faxProperties.senderName ?? row.Sender ?? ''),
    senderFaxNumber: String(faxProperties.senderFaxNumber ?? row.SenderOrganization ?? ''),
    recipientName: String(faxProperties.recipientName ?? row.Recipient ?? ''),
    recipientFaxNumber: String(faxProperties.recipientFaxNumber ?? row.RecipientOrganization ?? ''),
    active: toBool(row.Active),
    sourcePath: row.SourcePath,
    documentData,
  })
})

app.patch('/api/documents/:id/active', (req, res) => {
  const active = req.body?.active
  if (typeof active !== 'boolean') {
    return res.status(400).json({ error: 'active must be boolean' })
  }

  const result = db.prepare('UPDATE Documents SET Active = ? WHERE ID = ?').run(active ? 1 : 0, req.params.id)
  if (result.changes === 0) {
    return res.status(404).json({ error: 'document not found' })
  }

  res.json({ id: req.params.id, active })
})

app.patch('/api/documents/:id/doc-class', (req, res) => {
  if (!req.authUser) {
    return res.status(401).json({ error: 'authentication required' })
  }
  if (req.authUser.role !== 'admin') {
    return res.status(403).json({ error: 'admin role required' })
  }

  const id = req.params.id
  const docClassRaw = req.body?.docClass
  const docClass = docClassRaw == null ? null : String(docClassRaw).trim() || null

  if (docClass) {
    const classExists = db.prepare('SELECT 1 FROM DocumentClasses WHERE DocumentClassID = ?').get(docClass)
    if (!classExists) {
      return res.status(400).json({ error: 'document class not found' })
    }
  }

  const result = db.prepare('UPDATE Documents SET DocumentClassID = ? WHERE ID = ?').run(docClass, id)
  if (result.changes === 0) {
    return res.status(404).json({ error: 'document not found' })
  }

  res.json({ id, docClass })
})

app.get('/api/documents/:id/source', (req, res) => {
  return sendDocumentSourceFile(res, req.params.id)
})

app.get('/documents/:id/Source', (req, res) => {
  if (!req.authUser) {
    return res.status(401).json({ error: 'authentication required' })
  }

  return sendDocumentSourceFile(res, req.params.id)
})

app.delete('/api/documents/:id', (req, res) => {
  const id = req.params.id

  const result = db.prepare('DELETE FROM Documents WHERE ID = ?').run(id)

  if (result.changes === 0) {
    return res.status(404).json({ error: 'document not found' })
  }

  res.json({ id, deleted: true })
})

app.post('/api/auth/login', (req, res) => {
  const username = String(req.body?.username ?? '').trim()
  const password = String(req.body?.password ?? '').trim()
  const rememberMe = toBool(req.body?.rememberMe)

  if (!username || !password) {
    return res.status(400).json({ error: 'username and password are required' })
  }

  const row = db
    .prepare('SELECT UserName, Enabled, IsAdmin, PasswordSalt, PasswordHash FROM Users WHERE UserName = ?')
    .get(username)

  if (!row || !toBool(row.Enabled)) {
    return res.status(401).json({ error: 'invalid credentials' })
  }

  const expectedHash = hashPassword(password, row.PasswordSalt)
  if (expectedHash !== row.PasswordHash) {
    return res.status(401).json({ error: 'invalid credentials' })
  }

  const sessionToken = createSessionToken(row.UserName, rememberMe)
  setSessionCookie(res, sessionToken, rememberMe)

  const role = toBool(row.IsAdmin) ? 'admin' : 'user'
  res.json({ username: row.UserName, role })
})

app.get('/api/auth/me', (req, res) => {
  if (!req.authUser) {
    return res.json(null)
  }

  res.json(req.authUser)
})

app.post('/api/auth/logout', (req, res) => {
  clearSessionCookie(res)
  res.json({ success: true })
})

app.get('/api/admin/users', (_req, res) => {
  const rows = db.prepare('SELECT UserName, Enabled, IsAdmin FROM Users ORDER BY UserName').all()
  res.json(
    rows.map((row) => ({
      userName: row.UserName,
      enabled: toBool(row.Enabled),
      isAdmin: toBool(row.IsAdmin),
    }))
  )
})

app.post('/api/admin/users', (req, res) => {
  const userName = String(req.body?.userName ?? '').trim()
  const password = String(req.body?.password ?? '').trim()
  const enabled = toBool(req.body?.enabled)
  const isAdmin = toBool(req.body?.isAdmin)

  if (!userName) {
    return res.status(400).json({ error: 'userName is required' })
  }
  if (password.length < 4) {
    return res.status(400).json({ error: 'password must be at least 4 characters' })
  }

  const salt = crypto.randomUUID().replaceAll('-', '').slice(0, 16)
  const passwordHash = hashPassword(password, salt)

  db.prepare(
    'INSERT INTO Users (UserName, PasswordSalt, PasswordHash, Enabled, IsAdmin) VALUES (?, ?, ?, ?, ?)'
  ).run(userName, salt, passwordHash, enabled ? 1 : 0, isAdmin ? 1 : 0)

  res.status(201).json({ userName, enabled, isAdmin })
})

app.put('/api/admin/users/:userName', (req, res) => {
  const currentUserName = decodeURIComponent(req.params.userName)
  const userName = String(req.body?.userName ?? '').trim()
  const password = String(req.body?.password ?? '').trim()
  const enabled = req.body?.enabled
  const isAdmin = req.body?.isAdmin

  if (!userName) {
    return res.status(400).json({ error: 'userName is required' })
  }
  if (typeof enabled !== 'boolean') {
    return res.status(400).json({ error: 'enabled must be boolean' })
  }
  if (typeof isAdmin !== 'boolean') {
    return res.status(400).json({ error: 'isAdmin must be boolean' })
  }

  const exists = db.prepare('SELECT 1 FROM Users WHERE UserName = ?').get(currentUserName)
  if (!exists) {
    return res.status(404).json({ error: 'user not found' })
  }

  if (password) {
    if (password.length < 4) {
      return res.status(400).json({ error: 'password must be at least 4 characters' })
    }
    const salt = crypto.randomUUID().replaceAll('-', '').slice(0, 16)
    const passwordHash = hashPassword(password, salt)
    db.prepare(
      'UPDATE Users SET UserName = ?, PasswordSalt = ?, PasswordHash = ?, Enabled = ?, IsAdmin = ? WHERE UserName = ?'
    ).run(userName, salt, passwordHash, enabled ? 1 : 0, isAdmin ? 1 : 0, currentUserName)
  } else {
    db.prepare('UPDATE Users SET UserName = ?, Enabled = ?, IsAdmin = ? WHERE UserName = ?').run(
      userName,
      enabled ? 1 : 0,
      isAdmin ? 1 : 0,
      currentUserName
    )
  }

  res.json({ userName, enabled, isAdmin })
})

app.delete('/api/admin/users/:userName', (req, res) => {
  const userName = decodeURIComponent(req.params.userName)
  const result = db.prepare('DELETE FROM Users WHERE UserName = ?').run(userName)

  if (result.changes === 0) {
    return res.status(404).json({ error: 'user not found' })
  }

  res.json({ userName, deleted: true })
})

app.get('/api/admin/apikeys', (_req, res) => {
  const rows = db.prepare('SELECT ApiKeyID, KeyName, CreatedAt, ExpiresAt, Enabled FROM ApiKeys ORDER BY CreatedAt DESC').all()
  res.json(
    rows.map((row) => ({
      id: row.ApiKeyID,
      keyName: row.KeyName,
      createdAt: row.CreatedAt,
      expiresAt: row.ExpiresAt,
      enabled: toBool(row.Enabled),
    }))
  )
})

app.post('/api/admin/apikeys', (req, res) => {
  const keyName = String(req.body?.keyName ?? '').trim()
  const apiKey = String(req.body?.key ?? '').trim()
  const expiresAtRaw = req.body?.expiresAt
  const enabled = toBool(req.body?.enabled)
  const id = String(req.body?.id ?? '').trim() || `k-${crypto.randomUUID().replaceAll('-', '').slice(0, 8)}`

  if (!keyName) {
    return res.status(400).json({ error: 'keyName is required' })
  }
  if (!apiKey) {
    return res.status(400).json({ error: 'key is required' })
  }

  const expiresAt = expiresAtRaw == null ? null : String(expiresAtRaw).trim() || null
  const createdAt = asIsoNow()
  const keyHash = hashApiKey(apiKey)

  db.prepare('INSERT INTO ApiKeys (ApiKeyID, KeyName, KeyHash, CreatedAt, ExpiresAt, Enabled) VALUES (?, ?, ?, ?, ?, ?)').run(
    id,
    keyName,
    keyHash,
    createdAt,
    expiresAt,
    enabled ? 1 : 0
  )

  res.status(201).json({ id, keyName, createdAt, expiresAt, enabled })
})

app.put('/api/admin/apikeys/:id', (req, res) => {
  const id = req.params.id
  const keyName = String(req.body?.keyName ?? '').trim()
  const expiresAtRaw = req.body?.expiresAt
  const enabled = req.body?.enabled

  if (!keyName) {
    return res.status(400).json({ error: 'keyName is required' })
  }
  if (typeof enabled !== 'boolean') {
    return res.status(400).json({ error: 'enabled must be boolean' })
  }

  const expiresAt = expiresAtRaw == null ? null : String(expiresAtRaw).trim() || null
  const result = db.prepare('UPDATE ApiKeys SET KeyName = ?, ExpiresAt = ?, Enabled = ? WHERE ApiKeyID = ?').run(
    keyName,
    expiresAt,
    enabled ? 1 : 0,
    id
  )

  if (result.changes === 0) {
    return res.status(404).json({ error: 'apikey not found' })
  }

  const row = db.prepare('SELECT CreatedAt FROM ApiKeys WHERE ApiKeyID = ?').get(id)
  res.json({ id, keyName, createdAt: row.CreatedAt, expiresAt, enabled })
})

app.delete('/api/admin/apikeys/:id', (req, res) => {
  const id = req.params.id
  const result = db.prepare('DELETE FROM ApiKeys WHERE ApiKeyID = ?').run(id)

  if (result.changes === 0) {
    return res.status(404).json({ error: 'apikey not found' })
  }

  res.json({ id, deleted: true })
})

// ---- Queue management ----

app.get('/api/admin/queue', (_req, res) => {
  const rows = db.prepare('SELECT EntryID, Retry, LastFailure, SourcePath FROM Queue ORDER BY EntryID').all()
  res.json(
    rows.map((row) => ({
      entryId: row.EntryID,
      retry: row.Retry,
      lastFailure: row.LastFailure ?? null,
      sourcePath: row.SourcePath,
    }))
  )
})

app.delete('/api/admin/queue', (_req, res) => {
  const info = db.prepare('DELETE FROM Queue').run()
  res.json({ deleted: info.changes })
})

app.delete('/api/admin/queue/:entryId', (req, res) => {
  const entryId = Number(req.params.entryId)
  if (!Number.isInteger(entryId) || entryId <= 0) {
    return res.status(400).json({ error: 'invalid entryId' })
  }
  const result = db.prepare('DELETE FROM Queue WHERE EntryID = ?').run(entryId)
  if (result.changes === 0) {
    return res.status(404).json({ error: 'queue entry not found' })
  }
  res.json({ entryId, deleted: true })
})

app.use((err, _req, res, _next) => {
  if (err?.code === 'SQLITE_CONSTRAINT_UNIQUE' || err?.code === 'SQLITE_CONSTRAINT_PRIMARYKEY') {
    return res.status(400).json({ error: 'duplicate key or unique constraint violation' })
  }
  if (err?.code?.startsWith?.('SQLITE_CONSTRAINT')) {
    return res.status(400).json({ error: `invalid request: ${err.message}` })
  }

  console.error(err) // eslint-disable-line no-console
  res.status(500).json({ error: 'internal server error' })
})

// iisnode sets PORT to a named-pipe path (e.g. \\.\pipe\...).
// Railway / plain Node set PORT to a numeric string.
// Fall back to API_PORT, then 3001.
const _rawPort = String(process.env.PORT ?? process.env.API_PORT ?? '').trim()
// A named pipe is non-numeric (parseInt returns NaN) and starts with \\ or \\.\
const isNamedPipe = !!_rawPort && Number.isNaN(Number(_rawPort))
// Default host to 0.0.0.0 for Railway / reverse-proxy; set API_HOST=127.0.0.1 to restrict.
const host = process.env.API_HOST ?? '0.0.0.0'
const port = isNamedPipe ? 0 : Number.parseInt(_rawPort || '3001', 10)

/**
 * Call server.listen() in a way that works for both TCP (Railway, plain Node)
 * and named-pipe (iisnode on IIS) transports.
 */
function startListening(server, scheme, onListening) {
  if (isNamedPipe) {
    // Named-pipe mode: pass only the pipe path, no host argument
    server.listen(_rawPort, () => {
      console.log(`[api] Node API server started: ${scheme}//pipe:${_rawPort}`) // eslint-disable-line no-console
      console.log(`[api] Database: ${dbPath}`) // eslint-disable-line no-console
      onListening?.()
    })
  } else {
    server.listen(port, host, () => {
      console.log(`[api] Node API server started: ${scheme}//${host}:${port}`) // eslint-disable-line no-console
      console.log(`[api] Database: ${dbPath}`) // eslint-disable-line no-console
      onListening?.()
    })
  }
}

async function setupFrontend() {
  if (isDevServer) {
    const { createServer: createViteServer } = await import('vite')
    const httpsOpts = resolveHttpsOptions()
    const viteHttps = httpsOpts
      ? {
          pfx: httpsOpts.pfx,
          cert: httpsOpts.cert,
          key: httpsOpts.key,
          ca: httpsOpts.ca,
          passphrase: httpsOpts.passphrase,
        }
      : undefined

    const vite = await createViteServer({
      root: webRoot,
      server: {
        middlewareMode: true,
        https: viteHttps,
      },
      appType: 'spa',
    })

    const docsPathDev = path.join(projectRoot, 'docs')
    if (fs.existsSync(docsPathDev)) {
      app.use('/docs', express.static(docsPathDev))
    }

    app.use(vite.middlewares)
    app.get('*', async (req, res, next) => {
      if (req.path.startsWith('/api/') || req.path.startsWith('/docs/')) {
        return next()
      }

      try {
        const indexPath = path.join(webRoot, 'index.html')
        const indexHtml = await fs.promises.readFile(indexPath, 'utf-8')
        const transformed = await vite.transformIndexHtml(req.originalUrl, indexHtml)
        res.status(200).setHeader('Content-Type', 'text/html').end(transformed)
      } catch (err) {
        vite.ssrFixStacktrace(err)
        next(err)
      }
    })
    return
  }

  const distPath = path.join(webRoot, 'dist')
  if (fs.existsSync(distPath)) {
    const docsPath = path.join(projectRoot, 'docs')
    if (fs.existsSync(docsPath)) {
      app.use('/docs', express.static(docsPath))
    }

    app.use(express.static(distPath))
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api/') || req.path.startsWith('/docs/')) {
        return next()
      }
      res.sendFile(path.join(distPath, 'index.html'))
    })
  }
}

await setupFrontend()
const httpsOptions = resolveHttpsOptions()

if (httpsOptions) {
  const server = https.createServer(
    {
      pfx: httpsOptions.pfx,
      cert: httpsOptions.cert,
      key: httpsOptions.key,
      ca: httpsOptions.ca,
      passphrase: httpsOptions.passphrase,
    },
    app,
  )

  startListening(server, 'https:', () => {
    if (httpsOptions.pfxPath) {
      console.log(`[api] HTTPS pfx: ${httpsOptions.pfxPath}`) // eslint-disable-line no-console
    } else {
      console.log(`[api] HTTPS cert: ${httpsOptions.certPath}`) // eslint-disable-line no-console
      console.log(`[api] HTTPS key: ${httpsOptions.keyPath}`) // eslint-disable-line no-console
    }
    if (httpsOptions.caPath) {
      console.log(`[api] HTTPS ca: ${httpsOptions.caPath}`) // eslint-disable-line no-console
    }
    if (isDevServer) {
      console.log(`[web] Vite middleware mode enabled`) // eslint-disable-line no-console
    }
  })
} else {
  startListening(app, 'http:', () => {
    if (isDevServer) {
      console.log(`[web] Vite middleware mode enabled`) // eslint-disable-line no-console
    }
  })
}
