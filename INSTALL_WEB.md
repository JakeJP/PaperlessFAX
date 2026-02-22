# Yokinsoft Paperless for FAX - Webサーバー導入手順

このドキュメントでは、運用環境で Web サーバー（Node.js/Express）を起動し、サービスとして常駐稼働させる方法を説明します。  
本プロジェクトの `web` は API とフロント配信を同一プロセスで動かせます（`npm run start`）。

## 1. 前提

- OS: Windows Server または Linux
- Node.js: 20 系推奨
- 配置先: 例 `D:\Services\YokinsoftPaperless`（Windows）/ `/opt/yokinsoft-paperless`（Linux）

## 2. 配置とビルド

1. ソース一式をサーバーへ配置
2. `web` 配下で依存関係をインストール
3. 本番ビルドを作成

```bash
cd web
npm install
npm run build
```

## 3. 環境変数（運用）

`web/server/index.mjs` は以下を参照します。

- `API_HOST`（既定: `127.0.0.1`）
- `API_PORT`（既定: `3001`）
- `API_HTTPS`（`true` でHTTPS起動）
- `API_HTTPS_PFX_PATH`（任意。HTTPS PFX/PKCS#12 ファイル）
- `API_HTTPS_CERT_PATH`（HTTPS証明書ファイル）
- `API_HTTPS_KEY_PATH`（HTTPS秘密鍵ファイル）
- `API_HTTPS_CA_PATH`（任意。CAチェーン証明書）
- `API_HTTPS_PASSPHRASE`（任意。秘密鍵パスフレーズ）
- `APP_ENV`（`dev` / `stg` / `prod`）
- `DATABASE_PATH`（任意。指定時は最優先）

HTTPS設定は `API_HTTPS_PFX_PATH` を優先し、未指定の場合のみ `API_HTTPS_CERT_PATH` + `API_HTTPS_KEY_PATH` を使用します。

本番DBを固定したい場合は `DATABASE_PATH` を明示してください。

## 4. 手動起動確認

```bash
cd web
npm run start
```

起動後、以下で確認:

- HTTP: `http://<host>:<port>/`（Web画面）
- HTTP: `http://<host>:<port>/api/document-classes`（API）
- HTTPS有効時: `https://<host>:<port>/` / `https://<host>:<port>/api/document-classes`

## 5. Linux でサービス化（systemd）

`/etc/systemd/system/yokinsoft-paperless-web.service` を作成:

```ini
[Unit]
Description=Yokinsoft Paperless for FAX Web Server
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/yokinsoft-paperless/web
Environment=API_HOST=0.0.0.0
Environment=API_PORT=3001
Environment=APP_ENV=prod
Environment=DATABASE_PATH=/var/lib/yokinsoft-paperless/yokinspaperless.db
ExecStart=/usr/bin/npm run start
Restart=always
RestartSec=5
User=www-data
Group=www-data

[Install]
WantedBy=multi-user.target
```

反映・起動:

```bash
sudo systemctl daemon-reload
sudo systemctl enable yokinsoft-paperless-web
sudo systemctl start yokinsoft-paperless-web
sudo systemctl status yokinsoft-paperless-web
```

ログ確認:

```bash
sudo journalctl -u yokinsoft-paperless-web -f
```

## 6. Windows でサービス化（NSSM 推奨）

### 6.1 NSSM の準備

- NSSM をインストール（`nssm.exe` を配置）

### 6.2 サービス登録

PowerShell（管理者）例:

```powershell
nssm install YokinsoftPaperlessWeb "C:\Program Files\nodejs\npm.cmd" "run start"
nssm set YokinsoftPaperlessWeb AppDirectory "D:\Services\YokinsoftPaperless\web"
nssm set YokinsoftPaperlessWeb AppEnvironmentExtra API_HOST=0.0.0.0 API_PORT=3001 APP_ENV=prod DATABASE_PATH=D:\ProgramData\Yokinsoft\Paperless\data\yokinspaperless.db
nssm start YokinsoftPaperlessWeb
```

状態確認:

```powershell
Get-Service YokinsoftPaperlessWeb
```

## 7. 逆プロキシ（任意）

運用では Nginx / Apache / IIS などで 80/443 を受け、Node の `3001` へリバースプロキシする構成を推奨します。

## 8. 運用メモ

- デプロイ後は `web` 配下で `npm install` と `npm run build` を実施
- サービス再起動で反映（`systemctl restart ...` / `Restart-Service ...`）
- DBファイルのバックアップ運用を必ず設計

