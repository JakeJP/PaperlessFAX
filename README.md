# Yokinsoft Paperless for FAX with Gemini AI

AIを駆使したFAX文書管理システム。 FAX機器・FAX複合機が紙媒体をスキャン出力した PDF / 画像ファイルを AI 解析し、文書の詳細情報とともに検索・閲覧・管理できる文書管理システムです。  FAX文書本体は外部ストレージ（共有フォルダ等）に置いたまま、メタデータと原本リンクを管理します。

利用の案内は [フロントページ](https://jakejp.github.io/PaperlessFAX/) へ

## 特徴

- 各種メーカーのFAX機・FAX複合機が受信してデジタル化して保存されたPDFまたは画像ファイルを管理
- Gemini AI を使った強力な OCR で低コスト、高性能、初期設定不要で使用
- FAX 文書ファイルの常時監視と自動取り込み
- AIを使った強力な文書タイプ仕分け、各種メタデータの読み取り
- Web での文書検索・一覧・詳細表示
- Web API で、外部システムと連携可能
- プラグインによってファイルタイプ別の事後処理をカスタマイズ可能
- ローカルユーザー認証（管理者 / 一般ユーザー）
- データベースサーバー不要。（SQLite を内部利用）

## 動作環境

- Windows または Linux 環境
  - Node.js 18+
  - Python 3.10+
- Google Gemini API の契約
    API KEYを取得

ファイル監視プログラム・Webサーバーは共に常駐サービスとして稼働します。システムを設定する機器は、FAX複合機がファイル保存する共有フォルダと同じサーバーでも、共有フォルダへアクセス権を持つ別のサーバー、PCでも構いません。

本システムの要は Google Gemini AI によるFAXの文面の解析機能です。従来のOCRシステムでは、煩雑な書面のフォーマット、表組、数値管理など細かに初期設定を行って初めて機能するところが、AIによれば、ほんのわずかな「プロンプト」を初期設定するだけで利用できます。

※ Gemini API の契約は利用者にてご用意ください

## システム構成

本プロジェクトは大きく 2 コンポーネントで構成されます。
最小構成では、２つのシステムが同じOS上で稼働する想定です。

1. **文書登録サービス（Python / monitor）**
     - FAX文書を自動で取り込みAI解析するバックグランドプロセス
     - 監視ディレクトリに追加された PDF・画像を検知
     - AI 解析でメタデータを抽出
     - 文書情報をDBに記録

2. **文書管理 Web サービス（Node.js + React / web）**
     - 文書一覧・検索・詳細表示
     - 管理画面（文書タイプ、ローカルユーザー、API キー）
     - API 提供（一覧、詳細、状態変更など）

## リポジトリ構成

```text
.
├─ monitor/              # Python: 監視・解析・登録
├─ web/                  # Node.js + React: Web UI / API
├─ data/                 # SQLite DB ファイル
├─ scripts/              # DB 初期化スクリプト
└─ READMEmd              # 本ファイル
```

## クイックスタート

NodeJS と Python の実行環境はインストール済みとします。サーバ環境など Python の venv 機能を使って実行環境を独立させた運用が必要かも検討してください。

以下、開発ビルド(dev) での起動手順

### 0) Gemini API Key を設定

Google Gemini API( AI Studio ) から APIKey を入手してください。

`.env` ファイルを編集して Gemini の API Key を設定します。

```bash
GEMINI_API_KEY=AXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
```

### 1) DB 初期化

```bash
python scripts/init_sqlite_db.py
```

デフォルトでは `data/yokinspaperless-dev.db` 開発用データベースファイルが作成されます。

### 2) Web サービス 環境構築と起動

```bash
cd web
npm install
npm run dev
```

NodeJS で必要なライブラリのインストール。そして、
デフォルトでは 3001 ポートでウェブサーバーが起動します。
例） `http://localhost:3001/`



`npm run dev` は API サーバー（Express）とフロント（Vite middleware）を 1 プロセスで起動します。

### 3) ファイル監視サービス 環境構築と起動

Python で必要なライブラリのインストールを行います。

```bash
cd monitor
pip install -r requirements.txt
```

monitor.py はディレクトリを指定して監視常駐プログラムとして動作します。

```bash
python monitor.py --as-service --dir <監視するFILEAPTH>
```

monitor.py は１ファイルずつ、または複数ファイルをスキャンして結果をデータベースに格納するまでの単独のコマンドプログラムとしても動作します。

```bash
python monitor.py --scan <FILE>
```

### 4) Webサービスへ接続

Webブラウザで `http://localhost:3001/` へアクセスします。

管理者の初期IDとパスワードは

- admin
- pass1234

### 5) 手動で監視フォルダーにPDFファイルをコピーしてみます

ファイル監視システムがファイルを検知、通常２０秒～数分 でファイルの解析が終了して内部データベースに記録、閲覧できるようになります。

## 認証と権限

- 認証方式は **ローカルユーザー認証**
- 権限は **管理者 / 一般ユーザー** の 2 種類
- 管理画面（`/admin`）は管理者のみアクセス可

## データモデル（概要）

- `Documents`
    - 文書メタ情報、原本リンク（`SourcePath`）、AI 解析結果（`DocumentData` JSON）
- `DocumentClasses`
    - 文書タイプ定義、分類プロンプト
- `Users`
    - ローカルユーザー（有効/無効、管理者フラグ）
- `ApiKeys`
    - 外部連携用アクセスキー
- `Queue`
    - 取り込み再試行用キュー

`DocumentData` は AI が分析した結果をすべて JSON として保存したものです。

```json
{
    "documentClassId": "DocumentClassID", // 文面から判定された DocumentClassID
    "confidence": 0.5, // 判定にあたってその確度を 0 ~ 1.0 の数値で表したものを設定
    "fax_properties": { // ヘッダーフッターから読み取られたFAX情報
        "senderName": "送信元名称",
        "senderFaxNumber": "送信元番号",
        "recipientName": "株式会社FAX",
        "recipientFaxNumber": "送信先番号",
        "transmissionTimestamp": "2021-01-01T12:12:12",
        "totalPages": 3,
        "jobId": "abcd" // Job ID
    },
    "content_properties" :{
        // すべてのドキュメントタイプに腰痛して、ドキュメント内から読み取る内容
        "title": "タイトル" // ドキュメントの内容を代表するタイトル
    },
    "typed_properties": {
        // DocumentClassID 別に指示された個別の「抽出文字列」
        // 読み取った項目をここに格納
    },
    // その他DocumentClassIDごとのプロパティ、オブジェクトの定義が付与されます。
}
```

## 環境変数（主要）

プロジェクト共通の環境変数は `.env` ファイルで設定します。その他に systemd で常駐プログラム化する場合などそれぞれの方法で環境変数設定を行うことができます。

### 共通 / DB

- `APP_ENV=**dev**|stg|prod`    本番環境では `prod` を指定してください。
- `DATABASE_PATH`   デフォルトでは `data/` ディレクトリのファイルを参照します。
- `DATABASE_URL`

DB パス解決の優先順位は `DATABASE_PATH` > `DATABASE_URL` > `APP_ENV` 既定値です。

### monitor（`monitor/monitor.py`）

- `MONITOR_EVENT_NOTIFY_ENABLED`（既定 `true`）
- `MONITOR_EVENT_NOTIFY_URL`（未設定時は `API_HTTPS` / `API_HOST` / `API_PORT` から自動解決）
- `MONITOR_EVENT_NOTIFY_TOKEN`（Web 側と共有する通知トークン）
- `MONITOR_EVENT_NOTIFY_TIMEOUT_SECONDS`（既定 `3`）

`MONITOR_EVENT_NOTIFY_URL` が未設定の場合は、同一マシン上の Web API を想定し、`http(s)://127.0.0.1:<API_PORT>/api/internal/documents-inserted` へ通知します。

### Web API（`web/server/index.mjs`）

- `API_HOST`（既定 `127.0.0.1`）
- `API_PORT`（既定 `3001`）
- `API_HTTPS`（`true` / `false`）
- `API_HTTPS_PFX_PATH`
- `API_HTTPS_CERT_PATH` / `API_HTTPS_KEY_PATH`
- `API_HTTPS_CA_PATH`
- `API_HTTPS_PASSPHRASE`

詳しくは `.env.sample` を参照。

## 運用上の注意

- 本システムはFAX機器が出力した原本ファイルは読み取りだけを行い、ファイルのコピー、その他変更、削除などの操作は一切行いません。原本へのリンク（`SourcePath`）を保持しています。
- 原本の移動・削除によるリンク切れはアプリケーション側で自動修復しません。
- 本システムは主にイントラネット上（社内LANなど）に設置されることを想定しています。セキュリティに対しては最小限の対策のみです。
- 開発環境では http で稼働しますが、運用環境では HTTPS を推奨します。

## ドキュメント

- 監視モジュールのセットアップ: [WEB_MANAGER.md](INSTALL_MONITOR.md)
- Web のセットアップ/運用: [INSTALL_WEB.md](INSTALL_WEB.md)
- 監視モジュール詳細: [monitor/README.md](monitor/README.md)
- Web モジュール詳細: [web/README.md](web/README.md)

## プロジェクト方針（現状）

- 初期実装の標準 DB は SQLite
- 認証はローカルユーザー認証で運用
- まずは中小規模運用（1日数百件程度）を主対象
- 未確定要件（外部連携方針、監査・バックアップ詳細など）は段階的に確定

## ライセンス

[MIT ライセンス](LICENSE)

## 著作権

Yokinsoft, Y.Jake.Yoshimura
https://www.yo-ki.com
