# Yokinsoft Paperless for FAX - Web利用者マニュアル

このドキュメントは、Web 管理機能（React + Node.js API 統合実装）の利用者向け手順書です。  
画面仕様（旧 `WEB_MANAGER.md`）の内容を、現在の実装に合わせて統合しています。

## 1. 概要

Web 機能では、次を提供します。

- ログイン（ローカルユーザー認証）
- 文書一覧・検索（アクティブ/ゴミ箱）
- 文書詳細表示（原本リンク表示、文書プロパティ表示）
- 管理画面（文書タイプ / ローカルユーザー / APIキー）

## 2. 権限

- 一般ユーザー
	- ログイン
	- 文書一覧・検索
	- 文書詳細表示
- 管理者
	- 上記すべて
	- 管理画面（`/admin`）
	- 文書の状態切替、文書タイプ変更、文書削除

## 3. 画面と遷移

- `/login`
	- 認証成功で `/documents` へ遷移
- `/documents`
	- 一覧から 1 件選択で `/documents/:id` へ
- `/documents/:id`
	- 一覧へ戻る（検索条件・ページを保持）
- `/admin`
	- 管理者のみアクセス可能

## 4. 画面別の使い方

### 4.1 ログイン画面

- 入力項目: ユーザー名 / パスワード
- 必須入力: 両方必須
- 認証失敗時はエラーメッセージを表示

### 4.2 文書一覧・検索画面

- 検索条件
	- 文書タイプ（`All` / 各タイプ / `未分類/不明`）
	- 送信者
	- 受信者
	- 受信日 From / To
- タブ
	- `アクティブ`
	- `ゴミ箱`
- 操作
	- 検索 / クリア
	- タイトルクリックで詳細へ
	- 文書行のアイコンから原本リンクを新規タブで開く
- ページング
	- 1ページ 50件（固定）

### 4.3 文書詳細画面

- 表示項目
	- タイトル、受信日時、送信者、受信者、元ファイルパス、Document ID
	- 文書プロパティ（`typed_properties`）
- 操作
	- 一覧へ戻る
	- 原本リンクを開く
- 管理者のみ
	- 文書タイプ変更
	- 状態切替（アクティブ / ゴミ箱）
	- 文書削除（確認ダイアログあり）

### 4.4 管理画面

管理画面は 3 タブ構成です。新規追加フォームは各「＋新規…追加」ボタン押下時に表示されます。

1) 文書タイプ管理
- 一覧項目: 文書タイプID / 名称 / 優先度 / 有効 / Prompt
- 操作: 追加、更新、削除
- Prompt は編集ダイアログで編集

2) ローカルユーザー管理
- 一覧項目: ユーザーID / 有効 / 管理者 / パスワード（変更時のみ入力）
- 操作: 追加、更新、削除
- 削除時は確認ダイアログ表示

3) APIキー管理
- 一覧項目: キー名 / 作成日時 / 有効期限 / 有効
- 操作: 追加、更新、削除
- 新規作成時は「キー生成」「コピー」ボタンを利用可能
- 削除時は確認ダイアログ表示

## 5. 起動方法

### 5.1 前提

- Node.js 18 以上
- ルートディレクトリに `.env` を配置（`web/server/index.mjs` はルートの `.env` を読み込みます）

### 5.2 開発起動（推奨）

```bash
cd web
npm install
npm run dev
```

`npm run dev` は API サーバーとフロントエンドを 1 プロセスで起動します。

### 5.3 分離起動（必要時）

```bash
npm run dev:web
npm run dev:api
```

### 5.4 本番想定起動

```bash
npm run build
npm run start
```

## 6. 環境変数（Web機能で使用）

主要項目:

- `VITE_API_BASE_URL`（既定: `/api`）
- `API_HOST`（既定: `127.0.0.1`）
- `API_PORT`（既定: `3001`）
- `API_HTTPS`（`true/false`）
- `API_HTTPS_PFX_PATH`
- `API_HTTPS_CERT_PATH`
- `API_HTTPS_KEY_PATH`
- `API_HTTPS_CA_PATH`
- `API_HTTPS_PASSPHRASE`
- `API_SESSION_SECRET`（本番で設定推奨）
- `APP_SECRET`（`API_SESSION_SECRET` 未設定時のフォールバック）
- `DATABASE_PATH`
- `APP_ENV`（`dev` / `stg` / `prod`）
- `MONITOR_EVENT_NOTIFY_TOKEN`（monitor からの内部イベント通知を検証する共有トークン）

HTTPS の指定ルール:

- `API_HTTPS_PFX_PATH` を設定した場合は PFX を優先使用
- PFX を使わない場合は `API_HTTPS_CERT_PATH` と `API_HTTPS_KEY_PATH` の両方が必要

共通の設定例はルートの `../.env.sample` を参照してください。

## 7. API エンドポイント（実装準拠）

認証:

- `POST /api/auth/login`
- `GET /api/auth/me`
- `POST /api/auth/logout`

文書:

- `GET /api/documents`
- `GET /api/documents/events`
- `GET /api/documents/:id`
- `PATCH /api/documents/:id/active`
- `PATCH /api/documents/:id/doc-class`
- `GET /api/documents/:id/source`
- `DELETE /api/documents/:id`

内部通知（monitor 連携）:

- `POST /api/internal/documents-inserted`

文書タイプ:

- `GET /api/document-classes`
- `POST /api/document-classes`
- `PUT /api/document-classes/:id`
- `DELETE /api/document-classes/:id`

管理（管理者のみ）:

- `GET /api/admin/users`
- `POST /api/admin/users`
- `PUT /api/admin/users/:userName`
- `DELETE /api/admin/users/:userName`
- `GET /api/admin/apikeys`
- `POST /api/admin/apikeys`
- `PUT /api/admin/apikeys/:id`
- `DELETE /api/admin/apikeys/:id`

## 8. 既知の注意点

- 文書原本は DB に保存せず、リンク（`SourcePath`）のみ管理します。
- 原本ファイルの移動/削除によるリンク切れは自動修復しません。
- HTTPS 利用時は証明書鍵長に注意してください（推奨: RSA 2048bit 以上または ECDSA）。
