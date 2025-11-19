# OCR Feature Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement automatic menu OCR using AWS Textract (coordinates) + Bedrock Claude (understanding) with SQS async processing.

**Architecture:** Upload handler sends SQS message after storing image to S3. OCR worker Lambda processes messages asynchronously, calls Textract for text extraction, calls Bedrock Claude for intelligent structuring, stores results in menu_items table. Frontend polls for completion status.

**Tech Stack:** AWS Lambda, SQS, Textract, Bedrock (Claude 3.5 Sonnet), PostgreSQL, React + TypeScript

---

## Task 1: Database Migration

**Files:**
- Create: `menu-combo-backend/db/migration-ocr.sql`
- Reference: `menu-combo-backend/db/schema.sql`

**Step 1: Create migration SQL file**

Create `menu-combo-backend/db/migration-ocr.sql`:

```sql
-- Migration: Add OCR status tracking to uploads table and bbox to menu_items

-- Update uploads table
ALTER TABLE uploads
ADD COLUMN IF NOT EXISTS ocr_status VARCHAR(50) DEFAULT 'pending',
ADD COLUMN IF NOT EXISTS ocr_started_at TIMESTAMP,
ADD COLUMN IF NOT EXISTS ocr_completed_at TIMESTAMP,
ADD COLUMN IF NOT EXISTS ocr_error TEXT,
ADD COLUMN IF NOT EXISTS items_count INTEGER DEFAULT 0;

-- Add index for faster status queries
CREATE INDEX IF NOT EXISTS idx_uploads_ocr_status
ON uploads(ocr_status, created_at DESC);

-- Update menu_items table
ALTER TABLE menu_items
ADD COLUMN IF NOT EXISTS bbox JSONB,
ADD COLUMN IF NOT EXISTS notes TEXT;

-- Add comments
COMMENT ON COLUMN menu_items.bbox IS 'Bounding box from Textract: {left, top, width, height} in percentages (0-1)';
COMMENT ON COLUMN menu_items.notes IS 'Additional notes like "price not found" or "estimated category"';
```

**Step 2: Test migration locally**

Run migration:
```bash
PGPASSWORD='menu1234uiop' psql \
  -h menu-db.cq7eu8cumvwf.us-east-1.rds.amazonaws.com \
  -U menuuser \
  -d menu-db \
  -f menu-combo-backend/db/migration-ocr.sql
```

Expected output: `ALTER TABLE` (multiple times), `CREATE INDEX`, `COMMENT`

**Step 3: Verify schema changes**

```bash
PGPASSWORD='menu1234uiop' psql \
  -h menu-db.cq7eu8cumvwf.us-east-1.rds.amazonaws.com \
  -U menuuser \
  -d menu-db \
  -c "\d uploads"
```

Expected: Should show new columns `ocr_status`, `ocr_started_at`, `ocr_completed_at`, `ocr_error`, `items_count`

```bash
PGPASSWORD='menu1234uiop' psql \
  -h menu-db.cq7eu8cumvwf.us-east-1.rds.amazonaws.com \
  -U menuuser \
  -d menu-db \
  -c "\d menu_items"
```

Expected: Should show new columns `bbox`, `notes`

**Step 4: Commit**

```bash
git add menu-combo-backend/db/migration-ocr.sql
git commit -m "feat: add database migration for OCR feature

Add ocr_status tracking columns to uploads table
Add bbox and notes columns to menu_items table"
```

---

## Task 2: Install Dependencies

**Files:**
- Modify: `menu-combo-backend/package.json`

**Step 1: Add new AWS SDK dependencies**

```bash
cd menu-combo-backend
npm install @aws-sdk/client-textract@^3.928.0 \
            @aws-sdk/client-bedrock-runtime@^3.928.0 \
            @aws-sdk/client-sqs@^3.928.0
```

**Step 2: Verify installation**

Check that `package.json` includes:
```json
{
  "dependencies": {
    "@aws-sdk/client-textract": "^3.928.0",
    "@aws-sdk/client-bedrock-runtime": "^3.928.0",
    "@aws-sdk/client-sqs": "^3.928.0"
  }
}
```

**Step 3: Test imports**

Create temporary test file `test-imports.js`:
```javascript
import { TextractClient } from '@aws-sdk/client-textract';
import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';
import { SQSClient } from '@aws-sdk/client-sqs';

console.log('All imports successful');
```

Run: `node test-imports.js`
Expected: "All imports successful"

Delete test file: `rm test-imports.js`

**Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "feat: add AWS SDK dependencies for OCR

Add Textract, Bedrock Runtime, and SQS clients"
```

---

## Task 3: Textract Service Module

**Files:**
- Create: `menu-combo-backend/services/textract.js`

**Step 1: Create Textract service with text extraction**

Create `menu-combo-backend/services/textract.js`:

```javascript
import { TextractClient, DetectDocumentTextCommand } from '@aws-sdk/client-textract';

const textractClient = new TextractClient({ region: 'us-east-1' });

/**
 * Extract text and bounding boxes from image using AWS Textract
 * @param {Buffer} imageBytes - Image binary data
 * @returns {Promise<Array>} Array of text blocks with coordinates
 */
export async function extractTextWithCoordinates(imageBytes) {
  try {
    const command = new DetectDocumentTextCommand({
      Document: { Bytes: imageBytes }
    });

    const response = await textractClient.send(command);

    // Filter for LINE blocks only (more semantic than WORD blocks)
    const blocks = response.Blocks
      .filter(block => block.BlockType === 'LINE')
      .map((block, index) => ({
        id: index,
        text: block.Text,
        confidence: block.Confidence,
        bbox: {
          left: block.Geometry.BoundingBox.Left,
          top: block.Geometry.BoundingBox.Top,
          width: block.Geometry.BoundingBox.Width,
          height: block.Geometry.BoundingBox.Height
        }
      }));

    return blocks;
  } catch (error) {
    console.error('Textract extraction failed:', error);
    throw new Error(`Textract failed: ${error.message}`);
  }
}
```

**Step 2: Test Textract service manually (optional for now)**

Note: Full testing requires real AWS credentials and image. We'll test in integration phase.

**Step 3: Commit**

```bash
git add menu-combo-backend/services/textract.js
git commit -m "feat: add Textract service for text extraction

Implement extractTextWithCoordinates function
Uses LINE-level blocks for semantic text grouping"
```

---

## Task 4: Bedrock Service Module

**Files:**
- Create: `menu-combo-backend/services/bedrock.js`

**Step 1: Create Bedrock service with Claude integration**

Create `menu-combo-backend/services/bedrock.js`:

```javascript
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';

const bedrockClient = new BedrockRuntimeClient({ region: 'us-east-1' });

const CLAUDE_MODEL_ID = 'anthropic.claude-3-5-sonnet-20241022-v2:0';

/**
 * Build prompt for Claude to structure menu items from Textract blocks
 * @param {Array} textractBlocks - Blocks from Textract
 * @returns {string} Prompt for Claude
 */
function buildMenuAnalysisPrompt(textractBlocks) {
  return `You are a professional menu analysis assistant. I used AWS Textract to extract text and coordinates from a menu image.

**Textract extracted text blocks**:
${JSON.stringify(textractBlocks, null, 2)}

**Task**:
1. Analyze these text blocks and identify which ones form a complete menu item
2. Translate/merge item names into English
3. Extract price, description, category
4. Record which Textract block IDs each item uses

**Output JSON format**:
{
  "items": [
    {
      "name": "English item name",
      "price": number or null,
      "description": "description",
      "category": "category",
      "blockIds": [0, 1, 2],
      "confidence": 0.0-1.0,
      "notes": "remarks (e.g., reason for missing price)"
    }
  ]
}

**Rules**:
- If both Chinese and English names exist, keep only English or translate to English
- If price is unclear, set to null and explain in notes
- Confidence based on text clarity and information completeness
- Try to identify all items, don't miss any`;
}

/**
 * Analyze menu image and Textract results using Bedrock Claude
 * @param {Buffer} imageBytes - Image binary data
 * @param {Array} textractBlocks - Text blocks from Textract
 * @returns {Promise<Object>} Structured menu data
 */
export async function analyzeMenuWithClaude(imageBytes, textractBlocks) {
  try {
    const prompt = buildMenuAnalysisPrompt(textractBlocks);

    const claudeRequest = {
      anthropic_version: 'bedrock-2023-05-31',
      max_tokens: 4096,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: 'image/jpeg',
                data: imageBytes.toString('base64')
              }
            },
            {
              type: 'text',
              text: prompt
            }
          ]
        }
      ]
    };

    const command = new InvokeModelCommand({
      modelId: CLAUDE_MODEL_ID,
      body: JSON.stringify(claudeRequest)
    });

    const response = await bedrockClient.send(command);
    const responseBody = JSON.parse(new TextDecoder().decode(response.body));

    // Extract JSON from Claude's response
    const menuData = JSON.parse(responseBody.content[0].text);

    // Validate response
    if (!menuData.items || !Array.isArray(menuData.items)) {
      throw new Error('Invalid response format from Claude');
    }

    return menuData;
  } catch (error) {
    console.error('Bedrock Claude analysis failed:', error);
    throw new Error(`Bedrock failed: ${error.message}`);
  }
}
```

**Step 2: Commit**

```bash
git add menu-combo-backend/services/bedrock.js
git commit -m "feat: add Bedrock Claude service for menu analysis

Implement analyzeMenuWithClaude function
Uses Claude 3.5 Sonnet with vision capability"
```

---

## Task 5: OCR Orchestration Service

**Files:**
- Create: `menu-combo-backend/services/ocr.js`
- Reference: `menu-combo-backend/services/textract.js`, `menu-combo-backend/services/bedrock.js`

**Step 1: Create OCR orchestration service**

Create `menu-combo-backend/services/ocr.js`:

```javascript
import { extractTextWithCoordinates } from './textract.js';
import { analyzeMenuWithClaude } from './bedrock.js';

/**
 * Calculate minimum bounding box that encompasses all specified blocks
 * @param {Array} textractBlocks - All Textract blocks
 * @param {Array} blockIds - IDs of blocks to combine
 * @returns {Object} Combined bounding box {left, top, width, height}
 */
function calculateCombinedBbox(textractBlocks, blockIds) {
  if (!blockIds || blockIds.length === 0) {
    return null;
  }

  const selectedBlocks = blockIds.map(id => textractBlocks[id]).filter(Boolean);

  if (selectedBlocks.length === 0) {
    return null;
  }

  // Find minimum bounding box
  const left = Math.min(...selectedBlocks.map(b => b.bbox.left));
  const top = Math.min(...selectedBlocks.map(b => b.bbox.top));
  const right = Math.max(...selectedBlocks.map(b => b.bbox.left + b.bbox.width));
  const bottom = Math.max(...selectedBlocks.map(b => b.bbox.top + b.bbox.height));

  return {
    left,
    top,
    width: right - left,
    height: bottom - top
  };
}

/**
 * Process menu image with Textract + Bedrock Claude
 * @param {Buffer} imageBytes - Image binary data
 * @returns {Promise<Object>} { items: Array, textractBlocks: Array }
 */
export async function processMenuImage(imageBytes) {
  // Step 1: Extract text with Textract
  console.log('Extracting text with Textract...');
  const textractBlocks = await extractTextWithCoordinates(imageBytes);
  console.log(`Textract extracted ${textractBlocks.length} text blocks`);

  if (textractBlocks.length === 0) {
    throw new Error('No text found in image');
  }

  // Step 2: Analyze with Claude
  console.log('Analyzing menu with Bedrock Claude...');
  const menuData = await analyzeMenuWithClaude(imageBytes, textractBlocks);
  console.log(`Claude identified ${menuData.items.length} menu items`);

  // Step 3: Enrich items with combined bounding boxes
  const enrichedItems = menuData.items.map(item => ({
    ...item,
    bbox: calculateCombinedBbox(textractBlocks, item.blockIds)
  }));

  return {
    items: enrichedItems,
    textractBlocks
  };
}
```

**Step 2: Commit**

```bash
git add menu-combo-backend/services/ocr.js
git commit -m "feat: add OCR orchestration service

Combines Textract and Bedrock for complete OCR pipeline
Calculates combined bounding boxes for menu items"
```

---

## Task 6: Update Database Helper for OCR Operations

**Files:**
- Modify: `menu-combo-backend/db/index.js`

**Step 1: Add OCR status update function**

Add to `menu-combo-backend/db/index.js` (after existing functions):

```javascript
/**
 * Update OCR status for an upload
 * @param {string} uploadId - Upload UUID
 * @param {string} status - Status: pending | processing | completed | failed
 * @param {number} itemsCount - Number of items extracted (default 0)
 * @param {string} errorMessage - Error message if failed (default null)
 */
export async function updateOcrStatus(uploadId, status, itemsCount = 0, errorMessage = null) {
  const pool = await getPool();

  const updates = [];
  const values = [];
  let paramIndex = 1;

  updates.push(`ocr_status = $${paramIndex++}`);
  values.push(status);

  if (status === 'processing') {
    updates.push(`ocr_started_at = $${paramIndex++}`);
    values.push(new Date());
  }

  if (status === 'completed' || status === 'failed') {
    updates.push(`ocr_completed_at = $${paramIndex++}`);
    values.push(new Date());
  }

  if (status === 'completed') {
    updates.push(`items_count = $${paramIndex++}`);
    values.push(itemsCount);
  }

  if (status === 'failed' && errorMessage) {
    updates.push(`ocr_error = $${paramIndex++}`);
    values.push(errorMessage);
  }

  values.push(uploadId);

  const query = `
    UPDATE uploads
    SET ${updates.join(', ')}, updated_at = NOW()
    WHERE upload_id = $${paramIndex}
  `;

  await pool.query(query, values);
}

/**
 * Save menu items to database
 * @param {string} uploadId - Upload UUID
 * @param {Array} items - Menu items from OCR
 */
export async function saveMenuItems(uploadId, items) {
  const pool = await getPool();

  for (const item of items) {
    await pool.query(
      `INSERT INTO menu_items
       (upload_id, item_name, price, description, category, bbox, confidence_score, notes, extracted_text)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        uploadId,
        item.name,
        item.price,
        item.description || null,
        item.category || null,
        JSON.stringify(item.bbox),
        item.confidence || null,
        item.notes || null,
        JSON.stringify(item) // Store full item as backup in extracted_text
      ]
    );
  }
}
```

**Step 2: Commit**

```bash
git add menu-combo-backend/db/index.js
git commit -m "feat: add database helpers for OCR operations

Add updateOcrStatus and saveMenuItems functions"
```

---

## Task 7: Create OCR Worker Lambda Function

**Files:**
- Create: `menu-combo-backend/ocrWorker.js`
- Reference: `menu-combo-backend/services/ocr.js`, `menu-combo-backend/db/index.js`

**Step 1: Create OCR worker Lambda handler**

Create `menu-combo-backend/ocrWorker.js`:

```javascript
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { processMenuImage } from './services/ocr.js';
import { updateOcrStatus, saveMenuItems } from './db/index.js';

const s3Client = new S3Client({ region: 'us-east-1' });

/**
 * Download image from S3 as Buffer
 * @param {string} s3Key - S3 object key
 * @returns {Promise<Buffer>} Image bytes
 */
async function downloadImageFromS3(s3Key) {
  const command = new GetObjectCommand({
    Bucket: process.env.BUCKET_NAME,
    Key: s3Key
  });

  const response = await s3Client.send(command);
  const chunks = [];

  for await (const chunk of response.Body) {
    chunks.push(chunk);
  }

  return Buffer.concat(chunks);
}

/**
 * OCR Worker Lambda handler - Processes SQS messages
 * @param {Object} event - SQS event with Records
 */
export const handler = async (event) => {
  console.log('OCR Worker triggered with', event.Records.length, 'messages');

  for (const record of event.Records) {
    const { uploadId, s3Key, userId } = JSON.parse(record.body);
    const receiveCount = parseInt(record.attributes.ApproximateReceiveCount);

    console.log(`Processing upload ${uploadId}, attempt ${receiveCount}`);

    try {
      // Step 1: Update status to processing
      await updateOcrStatus(uploadId, 'processing');

      // Step 2: Download image from S3
      console.log(`Downloading image: ${s3Key}`);
      const imageBytes = await downloadImageFromS3(s3Key);
      console.log(`Downloaded ${imageBytes.length} bytes`);

      // Step 3: Process with Textract + Bedrock
      const { items } = await processMenuImage(imageBytes);

      if (items.length === 0) {
        throw new Error('No menu items extracted');
      }

      // Step 4: Save to database
      console.log(`Saving ${items.length} menu items to database`);
      await saveMenuItems(uploadId, items);

      // Step 5: Update status to completed
      await updateOcrStatus(uploadId, 'completed', items.length);

      console.log(`✅ Successfully processed upload ${uploadId}: ${items.length} items`);

    } catch (error) {
      console.error(`❌ Error processing upload ${uploadId}:`, error);

      // Only mark as failed on final attempt (3rd retry)
      if (receiveCount >= 3) {
        await updateOcrStatus(uploadId, 'failed', 0, error.message);
        console.log(`Marked upload ${uploadId} as failed after ${receiveCount} attempts`);
      }

      // Re-throw to trigger SQS retry
      throw error;
    }
  }
};
```

**Step 2: Commit**

```bash
git add menu-combo-backend/ocrWorker.js
git commit -m "feat: add OCR worker Lambda function

Processes SQS messages to perform OCR with retry logic
Downloads from S3, calls Textract+Bedrock, saves to DB"
```

---

## Task 8: Update Upload Handler to Send SQS Messages

**Files:**
- Modify: `menu-combo-backend/handler.js`

**Step 1: Add SQS client import**

At the top of `menu-combo-backend/handler.js`, add:

```javascript
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
```

After other client initializations, add:

```javascript
const sqsClient = new SQSClient({ region: 'us-east-1' });
```

**Step 2: Update /upload endpoint to send SQS message**

Find the `/upload` endpoint in `handler.js` and modify the success block (after S3 upload and DB insert):

```javascript
// After successful upload and DB insert
const uploadResult = await pool.query(
  `INSERT INTO uploads (user_id, file_url, file_name, s3_key, file_size, mime_type, ocr_status)
   VALUES ($1, $2, $3, $4, $5, $6, 'pending')
   RETURNING upload_id, file_url, ocr_status`,
  [userId, fileUrl, file.name, s3Key, file.size, file.mimetype]
);

const uploadId = uploadResult.rows[0].upload_id;

// Send SQS message to trigger OCR processing
try {
  await sqsClient.send(new SendMessageCommand({
    QueueUrl: process.env.SQS_QUEUE_URL,
    MessageBody: JSON.stringify({
      uploadId,
      s3Key,
      userId
    })
  }));
  console.log(`Sent SQS message for upload ${uploadId}`);
} catch (sqsError) {
  console.error('Failed to send SQS message:', sqsError);
  // Don't fail the upload if SQS fails - user can retry later
}
```

**Step 3: Commit**

```bash
git add menu-combo-backend/handler.js
git commit -m "feat: send SQS message after upload for OCR processing

Upload handler now triggers async OCR via SQS queue"
```

---

## Task 9: Add Upload Status Endpoint

**Files:**
- Modify: `menu-combo-backend/handler.js`

**Step 1: Add GET /uploads/:uploadId endpoint**

Add this endpoint to `handler.js` (after existing routes):

```javascript
// Get upload status and menu items
app.get('/uploads/:uploadId', authenticateToken, async (req, res) => {
  try {
    const { uploadId } = req.params;
    const userId = req.userId;

    // Get upload info
    const uploadResult = await pool.query(
      `SELECT upload_id, file_url, file_name, ocr_status,
              items_count, ocr_error, created_at, ocr_completed_at,
              ocr_started_at
       FROM uploads
       WHERE upload_id = $1 AND user_id = $2`,
      [uploadId, userId]
    );

    if (uploadResult.rows.length === 0) {
      return res.status(404).json({ error: 'Upload not found' });
    }

    const upload = uploadResult.rows[0];

    // If completed, get menu items
    let items = [];
    if (upload.ocr_status === 'completed') {
      const itemsResult = await pool.query(
        `SELECT item_id, item_name, price, description, category,
                bbox, confidence_score, notes
         FROM menu_items
         WHERE upload_id = $1
         ORDER BY (bbox->>'top')::float`,
        [uploadId]
      );
      items = itemsResult.rows;
    }

    res.json({
      upload,
      items
    });
  } catch (error) {
    console.error('Error fetching upload status:', error);
    res.status(500).json({ error: 'Failed to fetch upload status' });
  }
});
```

**Step 2: Test endpoint manually (after deployment)**

After deploying, test with:
```bash
curl -H "Authorization: Bearer <TOKEN>" \
  https://hymek82qkl.execute-api.us-east-1.amazonaws.com/uploads/<UPLOAD_ID>
```

Expected: JSON with upload status and items (if completed)

**Step 3: Commit**

```bash
git add menu-combo-backend/handler.js
git commit -m "feat: add GET /uploads/:uploadId endpoint

Returns upload status and menu items for polling"
```

---

## Task 10: Update Serverless Configuration

**Files:**
- Modify: `menu-combo-backend/serverless.yml`

**Step 1: Add OCR worker function definition**

Add to `functions` section in `serverless.yml`:

```yaml
functions:
  api:
    handler: handler.handler
    events:
      - httpApi:
          path: /
          method: ANY
      - httpApi:
          path: /{proxy+}
          method: ANY
    timeout: 30

  ocrWorker:
    handler: ocrWorker.handler
    timeout: 300  # 5 minutes
    memorySize: 2048  # More memory for image processing
    events:
      - sqs:
          arn: !GetAtt MenuOcrQueue.Arn
          batchSize: 1
          maximumBatchingWindowInSeconds: 0
```

**Step 2: Add SQS queue URL to environment variables**

Update `provider.environment`:

```yaml
provider:
  name: aws
  runtime: nodejs20.x
  region: us-east-1
  timeout: 30
  memorySize: 1024
  environment:
    BUCKET_NAME: menu-combo-uploads
    DB_SECRET_ARN: arn:aws:secretsmanager:us-east-1:024848456604:secret:menu-db-dZh6zJ
    SQS_QUEUE_URL: !Ref MenuOcrQueue
```

**Step 3: Add IAM permissions for SQS, Textract, and Bedrock**

Update `provider.iam.role.statements`:

```yaml
  iam:
    role:
      statements:
        - Effect: Allow
          Action:
            - s3:GetObject
            - s3:PutObject
          Resource: arn:aws:s3:::menu-combo-uploads/*

        - Effect: Allow
          Action:
            - secretsmanager:GetSecretValue
          Resource:
            - arn:aws:secretsmanager:us-east-1:024848456604:secret:menu-db-*

        - Effect: Allow
          Action:
            - sqs:SendMessage
            - sqs:ReceiveMessage
            - sqs:DeleteMessage
            - sqs:GetQueueAttributes
          Resource: !GetAtt MenuOcrQueue.Arn

        - Effect: Allow
          Action:
            - textract:DetectDocumentText
          Resource: '*'

        - Effect: Allow
          Action:
            - bedrock:InvokeModel
          Resource: arn:aws:bedrock:us-east-1::foundation-model/anthropic.claude-3-5-sonnet-20241022-v2:0
```

**Step 4: Add SQS queue resources**

Add to `resources.Resources`:

```yaml
resources:
  Resources:
    MenuComboUploads:
      Type: AWS::S3::Bucket
      Properties:
        BucketName: menu-combo-uploads
        CorsConfiguration:
          CorsRules:
            - AllowedOrigins:
                - http://localhost:5173
                - https://menu-combo.peiwen.dev
              AllowedMethods:
                - GET
                - PUT
                - POST
              AllowedHeaders:
                - '*'

    MenuOcrQueue:
      Type: AWS::SQS::Queue
      Properties:
        QueueName: menu-ocr-queue
        VisibilityTimeout: 300
        MessageRetentionPeriod: 86400
        ReceiveMessageWaitTimeSeconds: 20
        RedrivePolicy:
          deadLetterTargetArn: !GetAtt MenuOcrDLQ.Arn
          maxReceiveCount: 3

    MenuOcrDLQ:
      Type: AWS::SQS::Queue
      Properties:
        QueueName: menu-ocr-dlq
        MessageRetentionPeriod: 1209600
```

**Step 5: Commit**

```bash
git add menu-combo-backend/serverless.yml
git commit -m "feat: configure SQS, OCR worker, and IAM permissions

Add ocrWorker Lambda function with SQS trigger
Add SQS queue and DLQ resources
Add IAM permissions for Textract and Bedrock"
```

---

## Task 11: Deploy Backend

**Files:**
- N/A (deployment task)

**Step 1: Deploy to AWS**

```bash
cd menu-combo-backend
serverless deploy
```

Expected output:
- CloudFormation stack update
- New Lambda function: `menu-combo-backend-dev-ocrWorker`
- New SQS queues: `menu-ocr-queue`, `menu-ocr-dlq`
- Updated API Gateway

**Step 2: Verify deployment**

Check Lambda functions:
```bash
aws lambda list-functions --query 'Functions[?starts_with(FunctionName, `menu-combo-backend`)].FunctionName'
```

Expected: Should see both `menu-combo-backend-dev-api` and `menu-combo-backend-dev-ocrWorker`

Check SQS queues:
```bash
aws sqs list-queues --query 'QueueUrls[?contains(@, `menu-ocr`)]'
```

Expected: URLs for `menu-ocr-queue` and `menu-ocr-dlq`

**Step 3: Test upload triggers SQS**

Upload an image via frontend or curl, then check SQS:
```bash
aws sqs get-queue-attributes \
  --queue-url $(aws sqs get-queue-url --queue-name menu-ocr-queue --query 'QueueUrl' --output text) \
  --attribute-names ApproximateNumberOfMessages
```

Expected: `ApproximateNumberOfMessages` should be >= 1

**Step 4: Monitor OCR worker logs**

```bash
serverless logs -f ocrWorker --tail
```

Watch for successful processing or errors.

---

## Task 12: Frontend Polling Component

**Files:**
- Modify: `frontend/src/components/UploadPage.tsx`

**Step 1: Add polling hook for upload status**

Add this hook at the top of `UploadPage.tsx`:

```typescript
import { useState, useEffect } from 'react';
import { useAuth } from 'react-oidc-context';

interface Upload {
  upload_id: string;
  file_url: string;
  file_name: string;
  ocr_status: 'pending' | 'processing' | 'completed' | 'failed';
  items_count: number;
  ocr_error?: string;
  created_at: string;
}

interface MenuItem {
  item_id: string;
  item_name: string;
  price: number;
  description: string;
  category: string;
  bbox: {
    left: number;
    top: number;
    width: number;
    height: number;
  };
  confidence_score: number;
  notes?: string;
}

function useUploadPolling(uploadId: string | null) {
  const [upload, setUpload] = useState<Upload | null>(null);
  const [items, setItems] = useState<MenuItem[]>([]);
  const auth = useAuth();

  useEffect(() => {
    if (!uploadId || !auth.user?.access_token) return;

    const fetchStatus = async () => {
      try {
        const response = await fetch(
          `${import.meta.env.VITE_API_BASE}/uploads/${uploadId}`,
          {
            headers: {
              'Authorization': `Bearer ${auth.user.access_token}`
            }
          }
        );

        if (response.ok) {
          const data = await response.json();
          setUpload(data.upload);
          setItems(data.items || []);
        }
      } catch (error) {
        console.error('Failed to fetch upload status:', error);
      }
    };

    // Initial fetch
    fetchStatus();

    // Poll every 2 seconds if not completed/failed
    const interval = setInterval(() => {
      if (upload?.ocr_status === 'completed' || upload?.ocr_status === 'failed') {
        clearInterval(interval);
        return;
      }
      fetchStatus();
    }, 2000);

    return () => clearInterval(interval);
  }, [uploadId, auth.user?.access_token, upload?.ocr_status]);

  return { upload, items };
}
```

**Step 2: Use polling hook in upload component**

Update the component to use the hook:

```typescript
export function UploadPage() {
  const [selectedUploadId, setSelectedUploadId] = useState<string | null>(null);
  const { upload, items } = useUploadPolling(selectedUploadId);

  const handleUploadSuccess = (uploadId: string) => {
    setSelectedUploadId(uploadId);
  };

  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold mb-4">Upload Menu</h1>

      {/* Existing upload form */}

      {/* Status display */}
      {upload && (
        <div className="mt-8 p-4 border rounded">
          <h2 className="text-xl font-semibold mb-2">Processing Status</h2>

          {upload.ocr_status === 'pending' && (
            <p className="text-yellow-600">⏳ Waiting to process...</p>
          )}

          {upload.ocr_status === 'processing' && (
            <p className="text-blue-600">🔄 Extracting menu items...</p>
          )}

          {upload.ocr_status === 'completed' && (
            <div>
              <p className="text-green-600">✅ Extracted {upload.items_count} items</p>

              {/* Display menu items */}
              <div className="mt-4">
                {items.map(item => (
                  <div key={item.item_id} className="border p-2 mb-2 rounded">
                    <h3 className="font-bold">{item.item_name}</h3>
                    <p className="text-sm">${item.price?.toFixed(2) || 'N/A'}</p>
                    {item.description && (
                      <p className="text-sm text-gray-600">{item.description}</p>
                    )}
                    {item.notes && (
                      <p className="text-xs text-gray-500 italic">{item.notes}</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {upload.ocr_status === 'failed' && (
            <p className="text-red-600">❌ Failed: {upload.ocr_error}</p>
          )}
        </div>
      )}
    </div>
  );
}
```

**Step 3: Commit**

```bash
git add frontend/src/components/UploadPage.tsx
git commit -m "feat: add polling for OCR status in upload page

Displays processing status and menu items
Polls every 2 seconds until completed/failed"
```

---

## Task 13: Integration Testing

**Files:**
- N/A (testing task)

**Step 1: Test full upload-to-OCR flow**

1. Open frontend: `http://localhost:5173` or `https://menu-combo.peiwen.dev`
2. Login with Cognito
3. Upload a menu image (prepare a test menu image)
4. Observe status changes: pending → processing → completed
5. Verify menu items display correctly

**Step 2: Check database**

```bash
PGPASSWORD='menu1234uiop' psql \
  -h menu-db.cq7eu8cumvwf.us-east-1.rds.amazonaws.com \
  -U menuuser \
  -d menu-db \
  -c "SELECT upload_id, ocr_status, items_count FROM uploads ORDER BY created_at DESC LIMIT 5;"
```

Expected: Recent uploads with `ocr_status = 'completed'` and `items_count > 0`

```bash
PGPASSWORD='menu1234uiop' psql \
  -h menu-db.cq7eu8cumvwf.us-east-1.rds.amazonaws.com \
  -U menuuser \
  -d menu-db \
  -c "SELECT item_name, price, category FROM menu_items ORDER BY created_at DESC LIMIT 10;"
```

Expected: Extracted menu items with English names

**Step 3: Check CloudWatch logs**

OCR Worker logs:
```bash
serverless logs -f ocrWorker --startTime 5m
```

Look for:
- "Textract extracted X text blocks"
- "Claude identified X menu items"
- "✅ Successfully processed upload"

**Step 4: Test error handling**

Upload a non-menu image (e.g., random photo):
- Should retry 3 times
- Should mark as failed
- Should have error message in database

Check DLQ:
```bash
aws sqs receive-message \
  --queue-url $(aws sqs get-queue-url --queue-name menu-ocr-dlq --query 'QueueUrl' --output text)
```

Expected: Failed message should be in DLQ

---

## Task 14: Final Commit and Documentation

**Files:**
- Update: `CLAUDE.md` (optional)
- Create: `docs/ocr-setup.md` (optional)

**Step 1: Final commit**

```bash
git add -A
git commit -m "feat: complete OCR feature implementation

Implemented full OCR pipeline with:
- AWS Textract for text extraction and bounding boxes
- AWS Bedrock Claude 3.5 Sonnet for intelligent structuring
- SQS async processing with retry and DLQ
- Frontend polling for status updates
- Database tracking for OCR status

Tested end-to-end with real menu images"
```

**Step 2: Push to remote**

```bash
git push origin main
```

**Step 3: Document any gotchas or learnings**

If needed, update `LEARNING_NOTES.md` with any challenges encountered during implementation.

---

## Success Criteria

✅ Upload triggers SQS message
✅ OCR worker processes images successfully
✅ Textract extracts text with coordinates
✅ Bedrock Claude structures data intelligently
✅ Menu items saved to database with bounding boxes
✅ Frontend displays processing status in real-time
✅ Error handling works (retries, DLQ)
✅ All services have proper IAM permissions
✅ End-to-end flow tested with real menu images

---

## Troubleshooting Common Issues

**Issue: "Bedrock model not found"**
- Solution: Check region (us-east-1) and model ID format
- Verify Bedrock model access enabled in AWS account

**Issue: "Textract throttling"**
- Solution: Add exponential backoff retry in textract.js
- Consider requesting limit increase for production

**Issue: "SQS message not triggering Lambda"**
- Solution: Check Lambda event source mapping
- Verify IAM permissions for SQS → Lambda

**Issue: "Frontend polling never stops"**
- Solution: Check that upload status actually changes in database
- Verify OCR worker is processing messages (check logs)

**Issue: "No text extracted from image"**
- Solution: Check image format (JPEG/PNG)
- Ensure image has readable text
- Check Textract response in logs
