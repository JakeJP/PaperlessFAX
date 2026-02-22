# Yokinsoft Paperless for FAX - monitor.py 本番導入手順

このドキュメントでは、`monitor/monitor.py` を production 環境へ導入し、サービスとして常駐稼働させる手順を説明します。

## 1. 前提

- Python 3.11 以上（推奨）
- 監視対象ディレクトリへの読み取り権限
- DBファイル配置先への読み書き権限
- Gemini API キー（分類機能を使う場合）

## 2. 配置と依存パッケージ

プロジェクト配置後、`monitor` 配下で依存をインストールします。

```bash
cd monitor
pip install -r requirements.txt
```

`--as-service` を使う場合は `watchdog` が必要です（`requirements.txt` に含まれる前提）。

## 3. 環境変数（production）

`monitor.py` は `monitor/db_config.py` を通してDBパスを解決します。優先順位は以下です。

1. `DATABASE_PATH`
2. `DATABASE_URL`
3. `APP_ENV`（`prod` / `stg` / `dev`）

production では `DATABASE_PATH` の明示を推奨します。

主な環境変数:

- `APP_ENV=prod`
- `DATABASE_PATH`（例: `C:/ProgramData/Yokinsoft/Paperless/data/yokinspaperless.db`）
- `GEMINI_API_KEY`
- `GEMINI_API_MODEL`（任意、未指定時は既定モデル）
- `MONITOR_DIR` または `MONITOR_DIR_1`, `MONITOR_DIR_2`, ...
- `MONITOR_FILE_TYPES`（例: `.pdf,.tiff,.tif`）

## 4. 初期DB作成（未作成の場合）

初期状態のDBを作成します。

```bash
python scripts/init_sqlite_db.py
```

`DATABASE_PATH` を指定している場合はそのパスに作成されます。

## 5. 手動起動確認

まずはサービス化前に手動で起動確認します。

```bash
cd monitor
python monitor.py --as-service --dir "<監視ディレクトリ>"
```

正常時ログ例:

- `[monitor] watching: ...`
- `[monitor] service started`
- 新規ファイル検知時に `[monitor] detected new file: ...`

## 6. Linux でサービス化（systemd）

`/etc/systemd/system/yokinsoft-paperless-monitor.service` を作成:

```ini
[Unit]
Description=Yokinsoft Paperless for FAX Monitor Service
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/yokinsoft-paperless/monitor
Environment=APP_ENV=prod
Environment=DATABASE_PATH=/var/lib/yokinsoft-paperless/yokinspaperless.db
Environment=MONITOR_DIR=/var/spool/fax/incoming
Environment=GEMINI_API_KEY=YOUR_API_KEY
ExecStart=/usr/bin/python3 /opt/yokinsoft-paperless/monitor/monitor.py --as-service
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
sudo systemctl enable yokinsoft-paperless-monitor
sudo systemctl start yokinsoft-paperless-monitor
sudo systemctl status yokinsoft-paperless-monitor
```

ログ確認:

```bash
sudo journalctl -u yokinsoft-paperless-monitor -f
```

## 7. Windows でサービス化（NSSM 推奨）

PowerShell（管理者）例:

```powershell
nssm install YokinsoftPaperlessMonitor "C:\Python311\python.exe" "monitor.py --as-service"
nssm set YokinsoftPaperlessMonitor AppDirectory "D:\Services\YokinsoftPaperless\monitor"
nssm set YokinsoftPaperlessMonitor AppEnvironmentExtra APP_ENV=prod DATABASE_PATH=C:\ProgramData\Yokinsoft\Paperless\data\yokinspaperless.db MONITOR_DIR=C:\FAX\Incoming GEMINI_API_KEY=YOUR_API_KEY
nssm start YokinsoftPaperlessMonitor
```

状態確認:

```powershell
Get-Service YokinsoftPaperlessMonitor
```

停止/再起動:

```powershell
Stop-Service YokinsoftPaperlessMonitor
Restart-Service YokinsoftPaperlessMonitor
```

## 8. 運用メモ

- 本番では `DATABASE_PATH` を固定して運用する
- 監視先ディレクトリの権限不足に注意する
- 障害時はサービスログと `Queue` テーブルの `Retry` / `LastFailure` を確認する
- 変更反映時はサービス再起動を行う

