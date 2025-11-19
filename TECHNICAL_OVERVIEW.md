# Codebase 技術導覽

## 系統總覽
Menu Combo 由三個主要子專案構成：`frontend/` (Vite + React + TypeScript)、`frontend-next/` (Next.js 16 進行中的遷移) 與 `menu-combo-backend/` (Serverless Express API)。使用者透過 Cognito OIDC 登入後可上傳菜單照片，圖片會儲存到 S3，再由 SQS 觸發 OCR Lambda，整合 Textract 與 OpenAI 產生結構化菜單與推薦結果，最後寫回 PostgreSQL。

## 前端 (Vite React)
Vite 應用的入口在 `frontend/src/main.tsx`，使用 `react-oidc-context` 包裝 `App.tsx` 驗證流程。UI 採 Tailwind v4 + shadcn/ui 元件，頁面組件放在 `src/components/`，共用工具在 `src/lib/`。主要互動頁面包括上傳 (`UploadPage.tsx`)、測試 Secrets/DB、推薦流程 (`RecommendationPage.tsx`)。環境設定透過 `frontend/.env` 提供 `VITE_API_BASE`、Cognito 參數等。

## Next.js 重構
`frontend-next/` 目前提供最小上傳測試 (`app/upload/page.tsx`)。採用 App Router、PostCSS 與 Tailwind v4。程式碼標註 `"use client"` 控制端側元件，API 基底由 `NEXT_PUBLIC_API_BASE` 決定。此資料夾用於逐步搬遷功能，可與 Vite 前端並行開發。

## 後端 (Serverless Express)
`menu-combo-backend/handler.js` 將 Express 包裝成 Lambda。核心路由：
- `POST /upload`：驗證 JWT 後接受多張圖片，上傳至 S3、建立 `uploads` 紀錄並送出 SQS 訊息。
- `GET /uploads`、`GET /uploads/:uploadId`：查詢上傳歷史與 OCR 結果，使用 `db/index.js` 的查詢助手。
- `POST /recommend`：彙整指定上傳的菜單，呼叫 AI 推薦 (`services/recommendations.js`) 並儲存。
- `GET /preferences`/`PUT /preferences`：讀寫偏好設定。
授權在 `middleware/auth.js` 藉由 Cognito JWKS 驗證 `Authorization: Bearer`。

## AI OCR 流程
`ocrWorker.js` 是獨立的 Lambda，監聽 SQS：
1. 將 `uploads` 狀態設為 processing。
2. 下載 S3 圖片，交給 `services/ocr.js`。
3. `services/textract.js` 呼叫 Textract 取得 LINE 區塊與 bounding box。
4. `services/openai.js` 提供影像 + Textract 區塊給 OpenAI (預設 `gpt-4o`)，將結果轉為菜單項目。
5. `saveMenuItems` 將項目存入 `menu_items`，成功後更新狀態為 completed，失敗重試三次再標記 failed。

## 資料庫與儲存
PostgreSQL 連線資訊存放於 Secrets Manager (`menu-db`)。`db/schema.sql` 定義 `users`、`uploads`、`menu_items`、`recommendations`、`user_preferences` 等表。初始化流程由 `GET /init-db` 觸發 `initializeDatabase()`，若資料庫不存在會自動建立。S3 bucket 名稱透過 `BUCKET_NAME` 環境變數注入。

## 認證與安全
前端登入使用 Cognito Hosted UI，redirect URI 依環境切換。後端所有敏感路由皆需有效 JWT。Secrets 由 Secrets Manager 管理，OpenAI API Key 儲存在 `CLAUDE_API_KEY` secret。請勿將 `.env`、`serverless.yml` 內的敏感資訊提交。

## 開發與部署
- 安裝依賴：在各子專案分別執行 `npm install`。
- 前端開發：`cd frontend && npm run dev`；建置 `npm run build`，Lint `npm run lint`。
- Next 開發：`cd frontend-next && npm run dev`，打包 `npm run build`，預覽 `npm run start`。
- 後端本地模擬：`cd menu-combo-backend && npx serverless offline --stage dev`；部署 `npx serverless deploy`。
- OCR 工作者需於 AWS 設定 SQS queue、Textract 權限、S3 bucket 及 Lambda 觸發器。

## 關鍵環境變數
- Frontend：`VITE_API_BASE`、`VITE_COGNITO_CLIENT_ID`、`VITE_COGNITO_DOMAIN` 等。
- Next.js：`NEXT_PUBLIC_API_BASE`。
- Backend：`BUCKET_NAME`、`SQS_QUEUE_URL`、`DB_SECRET_ARN`、`CLAUDE_API_KEY`、`OPENAI_MODEL`、`AWS_REGION`。
請根據 `.env.example` 模式提供乾淨的範本並保持機密性。
