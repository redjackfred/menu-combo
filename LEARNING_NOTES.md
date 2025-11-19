# Menu Combo App - 開發學習筆記

> 記錄日期：2025-11-13
>
> 本文件記錄了 Menu Combo App 後端開發的完整過程、技術決策與知識點整理。

---

## 📚 目錄

- [功能概覽](#功能概覽)
- [核心知識點](#核心知識點)
  - [1. JWT 驗證與 Cognito 整合](#1-jwt-驗證與-cognito-整合)
  - [2. CORS 跨域資源共享](#2-cors-跨域資源共享)
  - [3. PostgreSQL 資料庫設計](#3-postgresql-資料庫設計)
  - [4. AWS RDS 網路配置](#4-aws-rds-網路配置)
  - [5. Serverless Framework 配置](#5-serverless-framework-配置)
  - [6. S3 檔案上傳架構](#6-s3-檔案上傳架構)
  - [7. Express 在 Lambda 中的運作](#7-express-在-lambda-中的運作)
- [檔案結構](#檔案結構)
- [技術棧總結](#技術棧總結)
- [學習建議](#學習建議)
- [快速參考](#快速參考)

---

## 🎯 功能概覽

今天完成了 **Menu Combo App 的核心基礎架構**：

### ✅ 已完成功能

1. **後端 JWT 驗證** - 使用 Cognito 保護 API endpoints
2. **CORS 配置** - 解決跨域問題，支援前端呼叫
3. **資料庫設計與實作** - 5 個表格的完整 schema
4. **圖片上傳 + 資料庫記錄** - 完整的上傳流程
5. **RDS 公開訪問設定** - 開發環境連線配置

### 🔄 工作流程

```
使用者登入（Cognito）
    ↓
獲取 Access Token
    ↓
上傳菜單圖片（帶 JWT）
    ↓
Lambda 驗證 Token → 上傳到 S3 → 記錄到 RDS
    ↓
返回上傳結果（含 uploadId）
```

---

## 核心知識點

### 1. JWT 驗證與 Cognito 整合

#### 📍 檔案位置
- `menu-combo-backend/middleware/auth.js`

#### 🧠 核心概念

**JWT (JSON Web Token)**：一種安全的身份驗證令牌，由三部分組成：

```
Header.Payload.Signature
```

**Access Token vs ID Token**：
- **Access Token**：用於 API 授權（本專案使用）
- **ID Token**：包含用戶詳細資訊（email, name 等）

#### 💻 實作流程

```javascript
// 1. 從 Authorization header 提取 token
const authHeader = req.headers.authorization; // "Bearer <token>"
const token = authHeader.split(" ")[1];

// 2. 解碼 token 獲取 header（含 kid）
const decoded = jwt.decode(token, { complete: true });

// 3. 從 Cognito JWKS 端點獲取對應的公鑰
const key = await getSigningKeyAsync(decoded.header.kid);
const signingKey = key.getPublicKey();

// 4. 驗證 token 簽名
const payload = await verifyAsync(token, signingKey, {
  algorithms: ["RS256"],
  issuer: `https://cognito-idp.${REGION}.amazonaws.com/${USER_POOL_ID}`,
});

// 5. 將用戶資訊附加到 request
req.user = {
  sub: payload.sub,        // Cognito User ID
  email: payload.email,
  username: payload["cognito:username"],
};
```

#### 🔑 關鍵學習點

- ✅ JWT 使用 **RS256 非對稱加密**：
  - Cognito 用私鑰簽名
  - 後端用公鑰驗證
  - 公鑰不需保密，可公開

- ✅ **JWKS (JSON Web Key Set)**：
  - 公鑰的集合
  - Cognito 自動輪換密鑰
  - URL: `https://cognito-idp.{region}.amazonaws.com/{userPoolId}/.well-known/jwks.json`

- ✅ **kid (Key ID)**：
  - JWT header 中的欄位
  - 指示使用哪個公鑰
  - 支援密鑰輪換

#### ⚠️ 常見問題與解決

**問題 1：Timeout 錯誤**
```
原因：回調函數未正確處理，導致 Lambda 掛起
解決：改用 Promise + async/await
```

**問題 2：Email 為 undefined**
```
原因：Access Token 不包含 email（email 在 ID Token 中）
解決：將 DB 的 email 欄位改為可 NULL
```

#### 📖 延伸閱讀
- [JWT.io - JWT 介紹](https://jwt.io/)
- [AWS Cognito Developer Guide](https://docs.aws.amazon.com/cognito/)

---

### 2. CORS 跨域資源共享

#### 📍 檔案位置
- `menu-combo-backend/serverless.yml`
- `menu-combo-backend/handler.js`

#### 🧠 核心概念

**CORS (Cross-Origin Resource Sharing)**：
- 瀏覽器的安全機制
- 限制跨域 HTTP 請求
- 需要伺服器明確允許

**同源政策 (Same-Origin Policy)**：
- 協定、域名、端口 三者都相同才算同源
- 例如：`https://menu-combo.peiwen.dev:443` 和 `http://localhost:5173` 不同源

**Preflight Request**：
```
當請求包含以下條件時，瀏覽器會先發送 OPTIONS 請求：
- 使用 PUT、DELETE、PATCH 方法
- 包含自定義 headers（如 Authorization）
- Content-Type 不是 application/x-www-form-urlencoded、multipart/form-data、text/plain
```

#### 💻 實作層級

**層級 1：API Gateway（serverless.yml）**

```yaml
provider:
  httpApi:
    cors:
      allowedOrigins:
        - https://menu-combo.peiwen.dev
        - http://localhost:5173
      allowedHeaders:
        - Content-Type
        - Authorization  # ⚠️ 必須明確列出
      allowedMethods:
        - GET
        - POST
        - PUT
        - DELETE
        - OPTIONS
      allowCredentials: true
```

**層級 2：Express Middleware（handler.js）**

```javascript
// CORS middleware
app.use(cors({
  origin: ["https://menu-combo.peiwen.dev", "http://localhost:5173"],
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true,
}));

// 處理 OPTIONS preflight requests
app.options("*", cors());
```

#### 🔍 CORS Headers 說明

| Header | 說明 | 範例值 |
|--------|------|--------|
| `Access-Control-Allow-Origin` | 允許的來源 | `https://menu-combo.peiwen.dev` |
| `Access-Control-Allow-Methods` | 允許的 HTTP 方法 | `GET, POST, OPTIONS` |
| `Access-Control-Allow-Headers` | 允許的 request headers | `Content-Type, Authorization` |
| `Access-Control-Allow-Credentials` | 是否允許攜帶 cookies | `true` |

#### ⚠️ 常見錯誤

**錯誤訊息：**
```
Access to fetch at 'https://api.example.com/upload' from origin 'https://frontend.com'
has been blocked by CORS policy: No 'Access-Control-Allow-Origin' header is present.
```

**可能原因：**
1. ❌ 後端未設定 CORS
2. ❌ `allowedHeaders` 未包含 `Authorization`
3. ❌ API Gateway 和 Express 兩層未一致設定
4. ❌ `allowCredentials: true` 時，`allowedOrigins` 不能是 `*`

#### 📖 延伸閱讀
- [MDN - CORS](https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS)

---

### 3. PostgreSQL 資料庫設計

#### 📍 檔案位置
- `menu-combo-backend/db/schema.sql`
- `menu-combo-backend/db/index.js`

#### 🗂️ 資料庫架構

```
┌─────────────────┐
│     users       │ ← 用戶基本資訊
└────────┬────────┘
         │ 1
         │
         │ N
┌────────┴────────┐     ┌──────────────────┐
│    uploads      │────→│   menu_items     │ ← OCR 解析結果
└────────┬────────┘  1:N └──────────────────┘
         │
         │ 1:N
         ↓
┌─────────────────┐
│ recommendations │ ← AI 推薦歷史
└─────────────────┘

┌─────────────────┐
│user_preferences │ ← 用戶偏好（1:1）
└─────────────────┘
```

#### 📋 表格設計詳解

**1. users 表**
```sql
CREATE TABLE users (
  user_id UUID PRIMARY KEY,           -- Cognito sub
  email VARCHAR(255) UNIQUE,          -- 可為 NULL（Access Token 無 email）
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

**2. uploads 表**
```sql
CREATE TABLE uploads (
  upload_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(user_id) ON DELETE CASCADE,
  file_url TEXT NOT NULL,             -- S3 完整 URL
  file_name VARCHAR(255),             -- 原始檔名
  s3_key TEXT NOT NULL,               -- S3 object key
  file_size INTEGER,                  -- 檔案大小（bytes）
  mime_type VARCHAR(100),             -- MIME type
  upload_status VARCHAR(50) DEFAULT 'uploaded',  -- uploaded/processing/completed/failed
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

**3. menu_items 表**
```sql
CREATE TABLE menu_items (
  item_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  upload_id UUID REFERENCES uploads(upload_id) ON DELETE CASCADE,
  item_name VARCHAR(255) NOT NULL,    -- 菜名
  price DECIMAL(10, 2),               -- 價格
  description TEXT,                   -- 描述
  category VARCHAR(100),              -- 分類（主食、飲料等）
  extracted_text JSONB,               -- OCR 原始資料
  confidence_score DECIMAL(3, 2),     -- OCR 信心分數 (0.00-1.00)
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

**4. user_preferences 表**
```sql
CREATE TABLE user_preferences (
  preference_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(user_id) ON DELETE CASCADE,
  dietary_restrictions JSONB,         -- ["vegetarian", "no-peanuts", "halal"]
  favorite_cuisines JSONB,            -- ["italian", "japanese"]
  budget_range VARCHAR(50),           -- "low", "medium", "high"
  spice_level VARCHAR(50),            -- "none", "mild", "medium", "hot"
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id)  -- 一個用戶只能有一筆偏好記錄
);
```

**5. recommendations 表**
```sql
CREATE TABLE recommendations (
  recommendation_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(user_id) ON DELETE CASCADE,
  upload_id UUID REFERENCES uploads(upload_id) ON DELETE CASCADE,
  recommended_items JSONB NOT NULL,   -- 推薦的組合
  confidence_score DECIMAL(3, 2),     -- AI 信心分數
  reasoning TEXT,                     -- AI 推薦理由
  total_price DECIMAL(10, 2),         -- 總價
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

#### 🎯 關鍵設計決策

**1. UUID vs Auto-increment ID**

```sql
-- UUID
upload_id UUID PRIMARY KEY DEFAULT uuid_generate_v4()

-- Auto-increment
upload_id SERIAL PRIMARY KEY
```

| 特性 | UUID | Auto-increment |
|------|------|----------------|
| 分散式友好 | ✅ | ❌ |
| 客戶端可生成 | ✅ | ❌ |
| 空間佔用 | 16 bytes | 4 bytes |
| 可讀性 | ❌ | ✅ |
| 效能 | 稍慢 | 快 |

**選擇 UUID 原因**：未來可能多區域部署，避免 ID 衝突。

**2. JSONB 欄位的使用**

```sql
dietary_restrictions JSONB  -- ["vegetarian", "no-peanuts"]
```

優點：
- ✅ 靈活儲存陣列或物件
- ✅ 可索引：`CREATE INDEX ON user_preferences USING GIN (dietary_restrictions);`
- ✅ 可查詢：`WHERE dietary_restrictions @> '["vegetarian"]'`
- ✅ 適合不固定結構的資料

**3. 外鍵約束**

```sql
user_id UUID REFERENCES users(user_id) ON DELETE CASCADE
```

- ✅ `ON DELETE CASCADE`：刪除用戶時自動刪除相關記錄
- ✅ 保證參照完整性（Referential Integrity）
- ✅ 防止孤兒記錄（Orphaned Records）

**4. 索引優化**

```sql
-- 查詢用戶的上傳記錄（常用）
CREATE INDEX idx_uploads_user_id ON uploads(user_id);

-- 查詢最新上傳（常用）
CREATE INDEX idx_uploads_created_at ON uploads(created_at DESC);

-- 查詢某次上傳的菜單項目
CREATE INDEX idx_menu_items_upload_id ON menu_items(upload_id);
```

索引選擇原則：
- ✅ WHERE 子句中常用的欄位
- ✅ JOIN 條件的欄位
- ✅ ORDER BY 的欄位
- ⚠️ 過多索引影響寫入效能

**5. Triggers（觸發器）自動更新時間**

```sql
-- 定義觸發器函數
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- 套用到表格
CREATE TRIGGER update_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
```

優點：
- ✅ 自動化，減少應用層邏輯
- ✅ 保證一致性
- ✅ 無法遺忘

#### 💻 Connection Pooling

```javascript
// db/index.js
import { Pool } from "pg";

const pool = new Pool({
  host: dbConfig.host,
  user: dbConfig.username,
  password: dbConfig.password,
  database: dbConfig.dbname,
  port: dbConfig.port,
  ssl: { rejectUnauthorized: false },
  max: 10,                      // 最多 10 個連線
  idleTimeoutMillis: 30000,     // 30 秒後釋放閒置連線
  connectionTimeoutMillis: 10000, // 連線超時 10 秒
});

// 全域變數（Lambda warm start 時重用）
let poolInstance = null;

export async function getPool() {
  if (!poolInstance) {
    poolInstance = createPool();
  }
  return poolInstance;
}
```

**Connection Pool 優點**：
- ✅ 重用連線，避免反覆建立/關閉
- ✅ Lambda warm start 時保留連線
- ✅ 自動管理連線數量
- ✅ 提升效能

#### 📖 延伸閱讀
- [PostgreSQL Official Documentation](https://www.postgresql.org/docs/)
- [JSONB 資料型別](https://www.postgresql.org/docs/current/datatype-json.html)

---

### 4. AWS RDS 網路配置

#### 🌐 網路架構理解

**目前架構（開發環境）**：
```
Internet
    ↓
API Gateway (public)
    ↓
Lambda (no VPC)
    ↓
RDS (publicly accessible) ← 開發用
    ↑
Security Group (0.0.0.0/0 允許)
```

**生產環境架構（建議）**：
```
Internet
    ↓
API Gateway
    ↓
Lambda (in VPC private subnet)
    ↓ (through VPC)
RDS (private subnet)
    ↑
Security Group (只允許 Lambda SG)
```

#### 🔧 開發環境設定步驟

**步驟 1：設定 RDS 為 Publicly Accessible**

```bash
aws rds modify-db-instance \
  --db-instance-identifier menu-db \
  --publicly-accessible \
  --apply-immediately
```

**步驟 2：開放 Security Group**

```bash
aws ec2 authorize-security-group-ingress \
  --group-id sg-07bdabcb9902de7cc \
  --ip-permissions IpProtocol=tcp,FromPort=5432,ToPort=5432,IpRanges='[{CidrIp=0.0.0.0/0}]'
```

⚠️ **安全警告**：
- `0.0.0.0/0` 表示允許所有 IP
- **僅用於開發環境**
- 生產環境應使用 VPC + 特定 IP 白名單

#### 🔐 生產環境配置（未實作）

**serverless.yml 配置**：

```yaml
functions:
  api:
    handler: handler.handler
    vpc:
      securityGroupIds:
        - sg-xxxxxxxx  # Lambda Security Group
      subnetIds:
        - subnet-xxxxxx  # Private Subnet 1
        - subnet-yyyyyy  # Private Subnet 2 (多 AZ)
```

**RDS Security Group 規則**：
```
Inbound Rules:
Type: PostgreSQL (5432)
Source: Lambda Security Group (sg-xxxxxxxx)
Description: Allow Lambda access only
```

#### 🎓 網路概念學習

**VPC (Virtual Private Cloud)**：
- AWS 中的虛擬網路
- 隔離你的資源
- 完全控制網路設定

**Subnet（子網路）**：
- VPC 內的 IP 範圍劃分
- **Public Subnet**：有 Internet Gateway，可對外
- **Private Subnet**：無直接對外路由，需 NAT Gateway

**Security Group**：
- 虛擬防火牆
- 控制進出流量（Inbound/Outbound）
- 狀態保持（Stateful）：允許 inbound 自動允許對應 outbound

**NAT Gateway**：
- 讓 Private Subnet 的資源訪問 Internet
- 單向（只能發起連線，不能接收）
- 用於下載套件、呼叫外部 API

#### 📖 延伸閱讀
- [AWS VPC Documentation](https://docs.aws.amazon.com/vpc/)
- [RDS in VPC Best Practices](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_VPC.html)

---

### 5. Serverless Framework 配置

#### 📍 檔案位置
- `menu-combo-backend/serverless.yml`

#### ⚙️ 核心配置解析

**基本設定**：

```yaml
org: peiwen
app: menu-combo
service: menu-combo-backend

provider:
  name: aws
  runtime: nodejs20.x
  region: us-east-1
  timeout: 30  # Lambda 執行時間上限（秒）
```

**環境變數**：

```yaml
provider:
  environment:
    BUCKET_NAME: menu-combo-uploads
    DB_SECRET_ARN: arn:aws:secretsmanager:us-east-1:xxx:secret:menu-db
    CLAUDE_API_KEY: arn:aws:secretsmanager:us-east-1:xxx:secret:menu-claude-api-key
```

所有 Lambda 函數都可透過 `process.env` 存取。

**IAM 權限管理**：

```yaml
provider:
  iamRoleStatements:
    - Effect: Allow
      Action:
        - secretsmanager:GetSecretValue
      Resource:
        - arn:aws:secretsmanager:us-east-1:xxx:secret:menu-db
        - arn:aws:secretsmanager:us-east-1:xxx:secret:menu-claude-api-key
    - Effect: Allow
      Action:
        - s3:GetObject
        - s3:PutObject
      Resource:
        - arn:aws:s3:::menu-combo-uploads/*
```

**Lambda 函數定義**：

```yaml
functions:
  api:
    handler: handler.handler  # 檔案.匯出函數
    timeout: 30
    events:
      - httpApi:
          path: /upload
          method: POST
      - httpApi:
          path: /uploads
          method: GET
```

**資源定義（S3 Bucket）**：

```yaml
resources:
  Resources:
    MenuComboBucket:
      Type: AWS::S3::Bucket
      Properties:
        BucketName: menu-combo-uploads
        CorsConfiguration:
          CorsRules:
            - AllowedOrigins:
                - "https://menu-combo.peiwen.dev"
              AllowedMethods: ["GET", "PUT", "POST"]
              AllowedHeaders: ["*"]
```

#### 🚀 部署過程

執行 `serverless deploy` 時：

1. **打包程式碼**
   ```
   - 安裝 node_modules
   - 排除 devDependencies
   - 壓縮為 .zip
   ```

2. **上傳到 S3**
   ```
   - 上傳 .zip 到 Serverless 管理的 S3 bucket
   ```

3. **建立 CloudFormation Stack**
   ```
   - 轉換 serverless.yml 為 CloudFormation template
   - 建立/更新所有資源
   ```

4. **配置資源**
   ```
   - Lambda 函數
   - API Gateway
   - IAM Roles
   - S3 Buckets
   - 其他自訂資源
   ```

#### 📊 CloudFormation 與 IaC

**CloudFormation**：
- AWS 的基礎設施即程式碼（IaC）服務
- 使用 JSON/YAML 定義資源
- 確保一致性、可重複性

**Serverless Framework**：
- CloudFormation 的高階抽象
- 更簡潔的語法
- 專注於 Serverless 架構

#### 📖 延伸閱讀
- [Serverless Framework Documentation](https://www.serverless.com/framework/docs)
- [AWS CloudFormation User Guide](https://docs.aws.amazon.com/cloudformation/)

---

### 6. S3 檔案上傳架構

#### 📍 檔案位置
- `menu-combo-backend/handler.js`

#### 📤 目前實作（透過 Lambda）

**流程**：
```
User → API Gateway → Lambda → S3
                       ↓
                   Write to DB
```

**程式碼**：

```javascript
app.post("/upload", verifyToken, async (req, res) => {
  // 1. 接收檔案（express-fileupload 自動解析）
  const file = req.files.image;

  // 2. 上傳到 S3
  const key = `uploads/${userId}/${Date.now()}_${file.name}`;
  await s3.send(new PutObjectCommand({
    Bucket: bucketName,
    Key: key,
    Body: file.data,
    ContentType: file.mimetype,
  }));

  // 3. 記錄到資料庫
  const uploadRecord = await createUpload(
    userId,
    fileUrl,
    file.name,
    key,
    file.size,
    file.mimetype
  );

  res.json({ uploadId: uploadRecord.upload_id });
});
```

**優點**：
- ✅ 簡單直接
- ✅ 單一 API 完成所有操作

**缺點**：
- ❌ 大檔案會佔用 Lambda 執行時間
- ❌ Lambda 有 6MB payload 限制（透過 API Gateway）
- ❌ 成本較高（Lambda 執行時間長）

#### 🚀 改善方案：Presigned URL

**流程**：
```
1. User → Lambda: 請求上傳 URL
2. Lambda → User: 回傳 Presigned URL
3. User → S3: 直接上傳（不經過 Lambda）
4. S3 → Lambda: Event notification
5. Lambda → DB: 記錄上傳
```

**實作範例**：

```javascript
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

// 生成 Presigned URL
app.post("/generate-upload-url", verifyToken, async (req, res) => {
  const { fileName, fileType } = req.body;
  const userId = req.user.sub;

  const key = `uploads/${userId}/${Date.now()}_${fileName}`;

  const command = new PutObjectCommand({
    Bucket: bucketName,
    Key: key,
    ContentType: fileType,
  });

  // URL 有效期 5 分鐘
  const uploadUrl = await getSignedUrl(s3, command, { expiresIn: 300 });

  res.json({
    uploadUrl,
    key,
    fileUrl: `https://${bucketName}.s3.${region}.amazonaws.com/${key}`,
  });
});

// S3 Event Handler（觸發 Lambda）
export async function s3EventHandler(event) {
  const record = event.Records[0];
  const bucket = record.s3.bucket.name;
  const key = decodeURIComponent(record.s3.object.key.replace(/\+/g, ' '));

  // 從 key 解析 userId
  const userId = key.split('/')[1];

  // 記錄到 DB
  await createUpload(userId, fileUrl, fileName, key, size, mimeType);
}
```

**優點**：
- ✅ 不佔用 Lambda 執行時間
- ✅ 更快（直接上傳到 S3）
- ✅ 支援大檔案
- ✅ 更省成本

#### 📖 延伸閱讀
- [S3 Presigned URLs](https://docs.aws.amazon.com/AmazonS3/latest/userguide/PresignedUrlUploadObject.html)
- [S3 Event Notifications](https://docs.aws.amazon.com/AmazonS3/latest/userguide/NotificationHowTo.html)

---

### 7. Express 在 Lambda 中的運作

#### 📍 使用套件
- `serverless-http`

#### 🔄 運作機制

**傳統 Express Server**：
```javascript
const app = express();
app.listen(3000, () => console.log('Server running on port 3000'));
```
- 持續運行的 process
- 監聽特定 port
- 保持長連線

**Lambda + Express**：
```javascript
import serverless from "serverless-http";
import express from "express";

const app = express();

app.get("/", (req, res) => res.json({ message: "Hello" }));

export const handler = serverless(app);
```
- 每次請求觸發一次 Lambda
- 無持續運行的 process
- 無狀態（stateless）

#### 🔀 請求轉換流程

```
1. Client → API Gateway
   POST /upload
   Headers: { Authorization: "Bearer xxx" }
   Body: <binary image data>

2. API Gateway → Lambda Event
   {
     httpMethod: "POST",
     path: "/upload",
     headers: { authorization: "Bearer xxx" },
     body: "<base64 encoded>",
     isBase64Encoded: true
   }

3. serverless-http → Express Request
   req.method = "POST"
   req.url = "/upload"
   req.headers = { authorization: "Bearer xxx" }
   req.body = <decoded binary>

4. Express 處理請求
   執行 middleware
   執行 route handler
   生成 response

5. serverless-http → Lambda Response
   {
     statusCode: 200,
     headers: { "content-type": "application/json" },
     body: '{"uploadId": "xxx"}'
   }

6. API Gateway → Client
   HTTP/1.1 200 OK
   Content-Type: application/json
   {"uploadId": "xxx"}
```

#### ⚡ Cold Start vs Warm Start

**Cold Start**：
```
Request → Lambda 實例不存在
        → 啟動新 Container
        → 載入程式碼
        → 執行 global scope
        → 執行 handler
        ↓
Response (耗時 1-3 秒)
```

**Warm Start**：
```
Request → Lambda 實例存在（重用）
        → 直接執行 handler
        ↓
Response (耗時 <100ms)
```

#### 🎯 優化 Cold Start

**1. 重用全域變數**

```javascript
// ✅ Good: 全域變數，warm start 時重用
let dbPool = null;

export const handler = async (event) => {
  if (!dbPool) {
    dbPool = createPool();  // 只在 cold start 時建立
  }
  // 使用 dbPool
};

// ❌ Bad: 每次都重新建立
export const handler = async (event) => {
  const dbPool = createPool();  // 每次請求都建立
};
```

**2. 減少套件大小**

```javascript
// ✅ Good: 只引入需要的
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

// ❌ Bad: 引入整個 SDK
import AWS from "aws-sdk";
```

**3. 使用 Provisioned Concurrency**

```yaml
functions:
  api:
    provisionedConcurrency: 2  # 保持 2 個實例常駐（需額外費用）
```

#### 📖 延伸閱讀
- [AWS Lambda Execution Context](https://docs.aws.amazon.com/lambda/latest/dg/runtimes-context.html)
- [Optimizing Lambda Cold Starts](https://aws.amazon.com/blogs/compute/operating-lambda-performance-optimization-part-1/)

---

## 📂 檔案結構

### 專案目錄

```
menu-combo-v2/
├── menu-combo-backend/          # 後端 (Serverless)
│   ├── middleware/
│   │   └── auth.js              # ✨ JWT 驗證 middleware
│   ├── db/
│   │   ├── schema.sql           # ✨ 資料庫 schema
│   │   └── index.js             # ✨ 資料庫操作函數
│   ├── handler.js               # ✏️ Express app + API routes
│   ├── serverless.yml           # ✏️ Serverless 配置
│   ├── package.json             # ✏️ 套件依賴
│   └── .env                     # 環境變數（本地開發）
├── frontend/                    # 前端 (React + Vite)
│   ├── src/
│   │   ├── components/
│   │   │   ├── UploadPage.tsx   # ✏️ 上傳頁面
│   │   │   ├── TestSecretPage.tsx
│   │   │   └── TestDbPage.tsx
│   │   ├── App.tsx              # ✏️ 主應用
│   │   └── main.tsx             # Cognito 配置
│   └── .env                     # API endpoint 配置
└── LEARNING_NOTES.md            # ✨ 本文件

圖例：
✨ 新增檔案
✏️ 修改檔案
```

### 改動檔案清單（13 個）

| 檔案 | 類型 | 說明 |
|------|------|------|
| `middleware/auth.js` | ✨ 新增 | JWT 驗證 middleware |
| `db/schema.sql` | ✨ 新增 | PostgreSQL schema |
| `db/index.js` | ✨ 新增 | 資料庫操作函數 |
| `handler.js` | ✏️ 修改 | 加入 auth、DB 整合 |
| `serverless.yml` | ✏️ 修改 | CORS、timeout、endpoints |
| `package.json` | ✏️ 修改 | 加入 jsonwebtoken、jwks-rsa |
| `frontend/src/components/UploadPage.tsx` | ✏️ 修改 | 加入 JWT token |
| `frontend/src/App.tsx` | ✏️ 修改 | Cognito 整合 |

---

## 🔧 技術棧總結

### 後端技術

| 技術 | 用途 | 關鍵概念 |
|------|------|----------|
| **AWS Lambda** | Serverless 運算 | Cold/Warm Start, Stateless |
| **API Gateway** | API 管理 | HTTP API, CORS, Routes |
| **AWS Cognito** | 用戶認證 | OAuth 2.0, JWT, User Pools |
| **PostgreSQL** | 關聯式資料庫 | JSONB, UUID, Foreign Keys |
| **AWS RDS** | 託管資料庫 | VPC, Security Groups, Connection Pool |
| **AWS S3** | 物件儲存 | Bucket, Key, CORS, Presigned URL |
| **Express.js** | Web 框架 | Middleware, Routes, serverless-http |
| **Serverless Framework** | 部署框架 | IaC, CloudFormation |
| **JWT** | API 授權 | RS256, JWKS, Token 驗證 |

### 套件依賴

```json
{
  "dependencies": {
    "express": "^4.19.2",
    "serverless-http": "^3.2.0",
    "cors": "^2.8.5",
    "express-fileupload": "^1.5.2",
    "@aws-sdk/client-s3": "^3.928.0",
    "@aws-sdk/client-secrets-manager": "^3.928.0",
    "pg": "^8.16.3",
    "jsonwebtoken": "^9.0.2",
    "jwks-rsa": "^3.2.0"
  },
  "devDependencies": {
    "serverless-offline": "^14.4.0"
  }
}
```

### 前端技術

| 技術 | 用途 |
|------|------|
| **React** | UI 框架 |
| **Vite** | 建置工具 |
| **react-oidc-context** | Cognito OAuth 整合 |
| **shadcn/ui** | UI 組件庫 |
| **Tailwind CSS** | CSS 框架 |

---

## 📚 學習建議

### 🔰 初學者學習路徑

#### 第 1 週：基礎概念
- [ ] 理解 HTTP 請求/回應
- [ ] 學習 REST API 設計原則
- [ ] 了解 JSON 格式
- [ ] 熟悉 JavaScript async/await

**推薦資源**：
- [MDN Web Docs - HTTP](https://developer.mozilla.org/en-US/docs/Web/HTTP)
- [REST API Tutorial](https://restfulapi.net/)

#### 第 2 週：認證與授權
- [ ] 什麼是 JWT？為什麼安全？
- [ ] OAuth 2.0 流程
- [ ] Access Token vs Refresh Token
- [ ] CORS 跨域問題

**推薦資源**：
- [JWT.io](https://jwt.io/introduction)
- [OAuth 2.0 Simplified](https://aaronparecki.com/oauth-2-simplified/)

#### 第 3 週：資料庫
- [ ] SQL 基本語法（SELECT, INSERT, UPDATE）
- [ ] 關聯（一對一、一對多、多對多）
- [ ] 索引與效能
- [ ] JSONB 資料型別

**推薦資源**：
- [PostgreSQL Tutorial](https://www.postgresqltutorial.com/)
- [SQL Zoo](https://sqlzoo.net/)

#### 第 4 週：AWS 與 Serverless
- [ ] AWS 核心服務（Lambda, S3, RDS）
- [ ] Serverless 架構概念
- [ ] VPC 與網路基礎
- [ ] CloudFormation 基礎

**推薦資源**：
- [AWS Getting Started](https://aws.amazon.com/getting-started/)
- [Serverless Framework Docs](https://www.serverless.com/framework/docs)

### 🚀 進階學習方向

#### 效能優化
- Lambda Cold Start 優化技巧
- DB 查詢效能調校（EXPLAIN ANALYZE）
- 快取策略（Redis, CloudFront）
- Connection Pool 調校

#### 安全強化
- Rate Limiting（防 DDoS）
- SQL Injection 防護
- XSS/CSRF 防護
- OWASP Top 10

#### 監控與除錯
- CloudWatch Logs 分析
- X-Ray 分散式追蹤
- Error 處理最佳實踐
- Alerting 設定

#### DevOps
- CI/CD Pipeline（GitHub Actions）
- 多環境部署（dev/staging/prod）
- Infrastructure as Code
- 備份與災難復原

### 💡 實作練習建議

1. **修改現有功能**
   - 改變上傳檔案的命名規則
   - 加入檔案類型限制
   - 新增 GET /uploads/:id 單筆查詢

2. **擴充功能**
   - 實作檔案刪除功能
   - 加入檔案大小限制
   - 支援多檔案上傳

3. **優化改善**
   - 改用 Presigned URL 上傳
   - 加入 API Rate Limiting
   - 實作 JWT Refresh Token

---

## 🔖 快速參考

### 常用指令

```bash
# === 後端部署 ===
cd menu-combo-backend
serverless deploy                     # 部署到 AWS
serverless logs -f api --tail         # 即時查看 logs

# === 查看 Lambda 日誌 ===
aws logs tail /aws/lambda/menu-combo-backend-dev-api --follow --since 5m

# === 資料庫連線 ===
# 方法 1：直接連線
PGPASSWORD='menu1234uiop' psql \
  -h menu-db.cq7eu8cumvwf.us-east-1.rds.amazonaws.com \
  -U menuuser \
  -d menu-db \
  -p 5432

# 方法 2：執行查詢
PGPASSWORD='menu1234uiop' psql -h ... -c "SELECT * FROM uploads;"

# 方法 3：使用腳本
/tmp/view_rds_data.sh

# === 測試 API ===
# 測試無需驗證的 endpoint
curl https://hymek82qkl.execute-api.us-east-1.amazonaws.com/testdb

# 測試需要驗證的 endpoint
curl -X POST https://hymek82qkl.execute-api.us-east-1.amazonaws.com/upload \
  -H "Authorization: Bearer YOUR_TOKEN_HERE" \
  -F "image=@menu.png"
```

### API Endpoints

| Method | Path | 驗證 | 說明 |
|--------|------|------|------|
| GET | `/` | ❌ | 健康檢查 |
| GET | `/init-db` | ❌ | 初始化資料庫 schema |
| GET | `/testdb` | ❌ | 測試 DB 連線 |
| GET | `/testsecret` | ❌ | 測試 Secrets Manager |
| POST | `/upload` | ✅ | 上傳菜單圖片 |
| GET | `/uploads` | ✅ | 查詢用戶上傳歷史 |

### 連線資訊

**RDS PostgreSQL**：
```
Host: menu-db.cq7eu8cumvwf.us-east-1.rds.amazonaws.com
Port: 5432
Database: menu-db
Username: menuuser
Password: menu1234uiop
```

**API Gateway**：
```
Base URL: https://hymek82qkl.execute-api.us-east-1.amazonaws.com
```

**S3 Bucket**：
```
Bucket: menu-combo-uploads
Region: us-east-1
```

### 常用 SQL 查詢

```sql
-- 查看所有表格
\dt

-- 查看表格結構
\d uploads

-- 查看最近 10 筆上傳
SELECT
    upload_id,
    file_name,
    upload_status,
    created_at
FROM uploads
ORDER BY created_at DESC
LIMIT 10;

-- 查看用戶統計
SELECT
    u.user_id,
    COUNT(up.upload_id) as total_uploads,
    MIN(up.created_at) as first_upload,
    MAX(up.created_at) as last_upload
FROM users u
LEFT JOIN uploads up ON u.user_id = up.user_id
GROUP BY u.user_id;

-- 刪除特定上傳記錄
DELETE FROM uploads WHERE upload_id = 'xxx-xxx-xxx';

-- 清空某個表格（保留結構）
TRUNCATE TABLE menu_items;
```

---

## 🎯 下一步開發方向

### 選項 1：OCR 流程（核心功能）
- 建立 `/ocr` endpoint
- 整合 AWS Bedrock
- 解析菜單項目（名稱、價格、描述）
- 儲存到 `menu_items` 表

### 選項 2：AI 推薦系統
- 建立 `/recommend` endpoint
- 整合 Claude API
- 根據菜單 + 用戶偏好生成推薦
- 儲存推薦記錄

### 選項 3：前端功能擴充
- 顯示上傳歷史列表
- 查看 OCR 解析結果
- 設定用戶偏好
- 查看推薦歷史

### 選項 4：優化改善
- 改用 Presigned URL 上傳
- 加入 Lambda 在 VPC 配置
- 實作 API Rate Limiting
- 加入 CloudWatch Dashboard

---

## 📖 參考資源

### 官方文件
- [AWS Documentation](https://docs.aws.amazon.com/)
- [Serverless Framework Docs](https://www.serverless.com/framework/docs)
- [PostgreSQL Documentation](https://www.postgresql.org/docs/)
- [Express.js Guide](https://expressjs.com/en/guide/routing.html)

### 學習資源
- [AWS Free Tier](https://aws.amazon.com/free/)
- [PostgreSQL Tutorial](https://www.postgresqltutorial.com/)
- [JWT.io](https://jwt.io/)
- [MDN Web Docs](https://developer.mozilla.org/)

### 工具
- [Postman](https://www.postman.com/) - API 測試
- [pgAdmin](https://www.pgadmin.org/) - PostgreSQL GUI
- [DBeaver](https://dbeaver.io/) - 資料庫管理工具
- [AWS CLI](https://aws.amazon.com/cli/) - AWS 命令列工具

---

## 📝 版本歷史

| 版本 | 日期 | 變更內容 |
|------|------|----------|
| 1.0.0 | 2025-11-13 | 初版：JWT 驗證、CORS、DB Schema、上傳功能 |

---

**撰寫者**：Claude (Anthropic AI)
**專案**：Menu Combo Recommendation App
**最後更新**：2025-11-13
