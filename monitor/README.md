# monitor — Yokinsoft Paperless 文書登録サービス

ディレクトリ監視と Gemini API による文書分類・DB 登録を行う Python サービスです。

## 概要

受信 FAX などのファイルを監視対象ディレクトリに配置すると、自動的に Gemini API で内容を解析し、SQLite データベースの `Documents` テーブルへ登録します。

## モジュール構成

| ファイル | 役割 |
|---|---|
| `monitor.py` | メインプログラム（サービス常駐・バッチ実行） |
| `classify_file.py` | 1 ファイルを Gemini API で分類し、結果 dict を返す |
| `db_config.py` | 環境変数に基づく SQLite DB パスの解決 |
| `classify_file_prompt.md` | Gemini API への基本プロンプト |

## 依存パッケージ

```
google-genai>=0.6.0   # Gemini API クライアント
watchdog>=5.0.0       # ディレクトリ監視（--as-service 時に必要）
PyMuPDF>=1.24.0       # サムネイル生成（THUMBNAIL=true 時に必要）
```

```bash
pip install -r requirements.txt
```

## セットアップ

プロジェクトルートに `.env` ファイルを作成します。

```dotenv
# Gemini API
GEMINI_API_KEY=your_api_key_here
GEMINI_API_MODEL=gemini-2.0-flash          # 省略時: gemini-flash-latest

# 監視対象ディレクトリ（複数指定可）
MONITOR_DIR=/path/to/watch
MONITOR_DIR_1=/path/to/watch2

# 対象ファイル種別（省略時: .pdf,.tiff,.tif）
MONITOR_FILE_TYPES=.pdf,.tiff,.tif

# DB パス（省略時は APP_ENV に基づく既定値）
APP_ENV=prod
```

## 実行モード

### 常駐サービス（`--as-service`）

ディレクトリを watchdog で継続監視します。新規ファイル検知 → Queue 登録 → Gemini API 解析 → DB 挿入 の流れです。ファイル処理は常時 1 件ずつ直列実行。10 分ごとに Queue に残ったエントリを自動リトライします。

```bash
python monitor.py --as-service --dir /path/to/watch
# または .env の MONITOR_DIR / MONITOR_DIR_1 ... を使用
python monitor.py --as-service
```

### 1 ファイル処理（`--scan`）

指定ファイル（ワイルドカード可）を処理して終了します。

```bash
python monitor.py --scan /path/to/file.pdf
python monitor.py --scan "/inbox/*.pdf"
```

### ディレクトリ一括処理（`--scandir` / `--dir`）

対象ディレクトリ内の全ファイルを処理して終了します。

```bash
python monitor.py --scandir /path/to/dir
python monitor.py --dir /path/to/dir      # --as-service なしの場合は同等
```

### その他

```bash
# 登録済み文書クラス一覧を表示
python monitor.py --list-documentclass

# 構築された分類プロンプト全文を標準出力
python monitor.py --prompt
```

## 処理の詳細

### ファイル安定待機

ファイル検知後、他プロセスによる書き込みが完了するまで待機します。ファイルサイズが `MONITOR_STABLE_CHECK_COUNT` 回連続で変化しなければ「安定」と判定して処理を開始します。

| 環境変数 | 既定値 | 説明 |
|---|---|---|
| `MONITOR_STABLE_CHECK_COUNT` | `3` | 連続安定確認回数 |
| `MONITOR_STABLE_CHECK_INTERVAL_SECONDS` | `1.0` | チェック間隔（秒） |
| `MONITOR_STABLE_TIMEOUT_SECONDS` | `120` | タイムアウト（秒） |

### Queue（再試行管理）

処理開始時に `Queue` テーブルへレコードを挿入し、正常完了時に削除します。エラー時は `LastFailure` に現在時刻をセットして保持します。`MONITOR_RETRY_MAX`（既定: `3`）を超えたエントリは、エラー情報を含む「不明文書」として `Documents` に登録してから Queue を削除します。

### Gemini API 呼び出し

`classify_file_prompt.md` の基本プロンプトに、DB の `DocumentClasses` テーブルに登録された各クラスのプロンプトを結合して送信します。進捗は `MONITOR_GEMINI_PROGRESS_INTERVAL_SECONDS`（既定: `60` 秒）間隔で標準出力へ出力します。

### イベント通知

文書登録後、Web サーバーの内部 API へ POST 通知します（SSE プッシュのトリガー用）。

| 環境変数 | 既定値 | 説明 |
|---|---|---|
| `MONITOR_EVENT_NOTIFY_ENABLED` | `true` | 通知の有効/無効 |
| `MONITOR_EVENT_NOTIFY_URL` | 自動解決 | 通知先 URL |
| `MONITOR_EVENT_NOTIFY_TIMEOUT_SECONDS` | `3.0` | タイムアウト（秒） |
| `MONITOR_EVENT_NOTIFY_TOKEN` | （なし） | 認証トークン（`X-Monitor-Event-Token` ヘッダー） |

自己参照 URL（localhost 等）に対する HTTPS 通知では、証明書検証を自動的にスキップします。

### サムネイル生成

`THUMBNAIL=true` を設定すると、PyMuPDF で PDF/TIFF の 1 ページ目からサムネイルを生成し、Base64 エンコードして `DocumentData` の `thumbnailImage` フィールドに格納します。

| 環境変数 | 既定値 | 説明 |
|---|---|---|
| `THUMBNAIL` | `false` | サムネイル生成の有効/無効 |
| `THUMBNAIL_SIZE` | `250` | 長辺のピクセル数 |

## データベース

### DB パス解決の優先順位

1. `DATABASE_PATH` 環境変数
2. `DATABASE_URL` 環境変数（`sqlite:///path` 形式にも対応）
3. `APP_ENV` による既定パス

| `APP_ENV` | パス |
|---|---|
| `dev`（既定） | `data/yokinspaperless-dev.db` |
| `stg` | `data/yokinspaperless-stg.db` |
| `prod` | `data/yokinspaperless.db` |

### スキーマ自動マイグレーション

起動時に以下のマイグレーションを自動適用します。

- `Queue` テーブルの作成（存在しない場合）
- `DocumentClasses` への `Priority`・`Enabled` カラム追加
- `Documents` の `Recepient` → `Recipient`、`ReceipentOrganization` → `RecipientOrganization` カラム名修正
- `DocumentClassID` が `NOT NULL` 制約の旧スキーマからの再作成（nullable へ変更）

## systemd サービス登録（Linux）

```bash
cp yokinsoft-paperless-monitor.service.sample /etc/systemd/system/yokinsoft-paperless-monitor.service
# ファイル内のパスとユーザーを環境に合わせて編集
systemctl daemon-reload
systemctl enable --now yokinsoft-paperless-monitor
```
