# OCR Feature Design - Textract + Bedrock Integration

**Date**: 2025-11-15
**Status**: Approved
**Author**: Design validated through brainstorming session

## Overview

Implement automatic OCR processing for uploaded menu images using AWS Textract (for precise text extraction and bounding boxes) and AWS Bedrock Claude 3.5 Sonnet (for intelligent understanding and structuring). The system uses SQS for asynchronous processing to avoid Lambda timeout issues.

## System Architecture

```
┌─────────────────────────────────────────────────────────┐
│  Frontend (React)                                        │
│  - User uploads menu images                             │
│  - Displays processing status (polling)                 │
│  - Shows OCR results + coordinate highlighting          │
└────────────┬────────────────────────────────────────────┘
             │
             ↓
┌─────────────────────────────────────────────────────────┐
│  API Gateway → Lambda (Upload Handler)                   │
│  - Receives image upload                                │
│  - Stores to S3                                         │
│  - Writes to uploads table (status: pending)            │
│  - Sends message to SQS queue ← Auto-trigger            │
│  - Returns immediately (doesn't wait for OCR)           │
└────────────┬────────────────────────────────────────────┘
             │
             ↓
┌─────────────────────────────────────────────────────────┐
│  SQS Queue (menu-ocr-queue)                              │
│  Message format: { uploadId, s3Key, userId }             │
│  - Visibility timeout: 5 minutes                         │
│  - Max receive count: 3 (then to DLQ)                    │
└────────────┬────────────────────────────────────────────┘
             │
             ↓
┌─────────────────────────────────────────────────────────┐
│  Lambda (OCR Worker) - Triggered by SQS                  │
│  1. Update uploads.ocr_status = 'processing'             │
│  2. Download image from S3                               │
│  3. Call Textract (extract text + coordinates)           │
│  4. Call Bedrock Claude (understand + structure)         │
│  5. Merge results and write to menu_items table          │
│  6. Update uploads.ocr_status = 'completed'              │
│  Timeout: 5 minutes                                      │
└─────────────────────────────────────────────────────────┘
```

### Key Components

- **2 Lambda Functions**: Upload Handler (fast response) + OCR Worker (long processing)
- **1 SQS Queue**: Decouples upload from processing, provides retry mechanism
- **1 DLQ (Dead Letter Queue)**: Stores messages that fail after 3 retries
- **2 AWS AI Services**: Textract (coordinates) + Bedrock Claude (understanding)

## Detailed Data Flow

### Step 1: User Upload (Upload Handler Lambda)

```javascript
POST /upload
→ express-fileupload receives images
→ S3.putObject({ Key: `uploads/${userId}/${timestamp}_${filename}` })
→ DB: INSERT INTO uploads (user_id, file_url, s3_key, ocr_status: 'pending')
→ SQS.sendMessage({ uploadId, s3Key, userId })
→ Returns: { uploadId, fileUrl, ocrStatus: 'pending' }
```

**Time**: <1 second

### Step 2: Async OCR Processing (OCR Worker Lambda)

**Trigger**: SQS message arrival
**Execution time**: Estimated 30-60 seconds

```javascript
1. Receive message { uploadId, s3Key, userId }

2. UPDATE uploads SET
   ocr_status = 'processing',
   ocr_started_at = NOW()
   WHERE upload_id = uploadId

3. Download image from S3 (as base64 or buffer)

4. Call Textract.detectDocumentText()
   Returns: [
     { text: "宫保鸡丁", bbox: {left: 0.1, top: 0.2, width: 0.15, height: 0.03} },
     { text: "Kung Pao Chicken", bbox: {...} },
     { text: "$12.99", bbox: {...} },
     ...
   ]

5. Call Bedrock Claude 3.5 Sonnet
   Input: Image + Textract results + Prompt
   Prompt: "Based on these text blocks and coordinates, structure menu items as JSON..."

6. Claude returns structured data:
   {
     items: [
       {
         name: "Kung Pao Chicken",
         price: 12.99,
         description: "Classic Sichuan dish",
         category: "Main Course",
         textractBlocks: [index0, index1, index2],  // Corresponding Textract block IDs
         confidence: 0.95,
         notes: null
       }
     ]
   }

7. Batch insert into menu_items table:
   - Calculate bbox: Merge coordinates of related text blocks (minimum bounding box)
   - Store complete data

8. UPDATE uploads SET
   ocr_status = 'completed',
   ocr_completed_at = NOW(),
   items_count = items.length

9. Delete SQS message (success)
```

### Step 3: Frontend Polling for Status

```javascript
After upload, every 2 seconds call:
GET /uploads/:uploadId

Returns: {
  uploadId,
  ocrStatus: 'completed',
  itemsCount: 12,
  items: [...]  // menu_items data
}

Stop polling when ocrStatus === 'completed'
```

## Textract + Claude Integration

### Textract Call

```javascript
import { TextractClient, DetectDocumentTextCommand } from "@aws-sdk/client-textract";

const textractClient = new TextractClient({ region: 'us-east-1' });

// Get image from S3
const s3Response = await s3Client.send(new GetObjectCommand({
  Bucket: process.env.BUCKET_NAME,
  Key: s3Key
}));
const imageBytes = await s3Response.Body.transformToByteArray();

// Textract OCR
const textractResponse = await textractClient.send(
  new DetectDocumentTextCommand({
    Document: { Bytes: imageBytes }
  })
);

// Extract all text blocks and coordinates
const blocks = textractResponse.Blocks
  .filter(b => b.BlockType === 'LINE')  // Only line-level text
  .map((b, index) => ({
    id: index,
    text: b.Text,
    confidence: b.Confidence,
    bbox: {
      left: b.Geometry.BoundingBox.Left,
      top: b.Geometry.BoundingBox.Top,
      width: b.Geometry.BoundingBox.Width,
      height: b.Geometry.BoundingBox.Height
    }
  }));
```

### Claude Prompt Design

```javascript
const prompt = `You are a professional menu analysis assistant. I used AWS Textract to extract text and coordinates from a menu image.

**Textract extracted text blocks**:
${JSON.stringify(blocks, null, 2)}

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
      "blockIds": [0, 1, 2],  // Textract block IDs used
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
```

### Bedrock Claude Call

```javascript
import { BedrockRuntimeClient, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";

const bedrockClient = new BedrockRuntimeClient({ region: 'us-east-1' });

const claudeRequest = {
  anthropic_version: "bedrock-2023-05-31",
  max_tokens: 4096,
  messages: [
    {
      role: "user",
      content: [
        {
          type: "image",
          source: {
            type: "base64",
            media_type: "image/jpeg",
            data: imageBytes.toString('base64')
          }
        },
        {
          type: "text",
          text: prompt
        }
      ]
    }
  ]
};

const response = await bedrockClient.send(
  new InvokeModelCommand({
    modelId: "anthropic.claude-3-5-sonnet-20241022-v2:0",
    body: JSON.stringify(claudeRequest)
  })
);

const result = JSON.parse(new TextDecoder().decode(response.body));
const menuData = JSON.parse(result.content[0].text);
```

## Error Handling and Retry Strategy

### SQS Configuration (serverless.yml)

```yaml
resources:
  Resources:
    MenuOcrQueue:
      Type: AWS::SQS::Queue
      Properties:
        QueueName: menu-ocr-queue
        VisibilityTimeout: 300  # 5 minutes (Lambda timeout)
        MessageRetentionPeriod: 86400  # 24 hours
        ReceiveMessageWaitTimeSeconds: 20  # Long polling
        RedrivePolicy:
          deadLetterTargetArn: !GetAtt MenuOcrDLQ.Arn
          maxReceiveCount: 3  # Retry 3 times before DLQ

    MenuOcrDLQ:
      Type: AWS::SQS::Queue
      Properties:
        QueueName: menu-ocr-dlq
        MessageRetentionPeriod: 1209600  # 14 days
```

### Error Handling Logic (OCR Worker Lambda)

```javascript
export const ocrWorker = async (event) => {
  for (const record of event.Records) {
    const { uploadId, s3Key, userId } = JSON.parse(record.body);

    try {
      // Update status to processing
      await updateUploadStatus(uploadId, 'processing');

      // Download image from S3
      const imageBytes = await downloadFromS3(s3Key);

      // Call Textract
      let textractBlocks;
      try {
        textractBlocks = await callTextract(imageBytes);
      } catch (error) {
        throw new Error(`Textract failed: ${error.message}`);
      }

      // Call Bedrock Claude
      let menuData;
      try {
        menuData = await callBedrockClaude(imageBytes, textractBlocks);
      } catch (error) {
        throw new Error(`Bedrock failed: ${error.message}`);
      }

      // Validate Claude response
      if (!menuData.items || menuData.items.length === 0) {
        throw new Error('No menu items extracted');
      }

      // Save to database
      await saveMenuItems(uploadId, menuData.items, textractBlocks);

      // Update status to completed
      await updateUploadStatus(uploadId, 'completed', menuData.items.length);

      console.log(`Successfully processed upload ${uploadId}: ${menuData.items.length} items`);

    } catch (error) {
      console.error(`Error processing upload ${uploadId}:`, error);

      // Update status to failed (only on final failure)
      const receiveCount = parseInt(record.attributes.ApproximateReceiveCount);
      if (receiveCount >= 3) {
        await updateUploadStatus(uploadId, 'failed', 0, error.message);
      }

      // Throw error to trigger SQS retry
      throw error;
    }
  }
};
```

### Retry Behavior

| Scenario | Behavior |
|----------|----------|
| Textract API throttling | SQS auto-retry (max 3 times) |
| Bedrock timeout | Retry |
| Corrupted/unrecognizable image | After 3 times mark as `failed`, move to DLQ |
| Database connection failure | Retry |
| Claude returns empty result | Mark as failed |

## Frontend Implementation

### New API Endpoint

```javascript
// GET /uploads/:uploadId - Get upload status and items
app.get('/uploads/:uploadId', authenticateToken, async (req, res) => {
  const { uploadId } = req.params;
  const userId = req.userId;

  // Get upload info
  const uploadResult = await db.query(
    `SELECT upload_id, file_url, file_name, ocr_status,
            items_count, ocr_error, created_at, ocr_completed_at
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
    const itemsResult = await db.query(
      `SELECT item_id, item_name, price, description, category,
              bbox, confidence_score, notes
       FROM menu_items
       WHERE upload_id = $1
       ORDER BY (bbox->>'top')::float`,  // Sort by position top to bottom
      [uploadId]
    );
    items = itemsResult.rows;
  }

  res.json({
    upload,
    items
  });
});
```

### Polling Component (React + TypeScript)

```typescript
// UploadPage.tsx
import { useState, useEffect } from 'react';

interface UploadStatus {
  uploadId: string;
  ocrStatus: 'pending' | 'processing' | 'completed' | 'failed';
  itemsCount: number;
  ocrError?: string;
}

export function UploadPage() {
  const [uploads, setUploads] = useState<UploadStatus[]>([]);
  const [pollingIds, setPollingIds] = useState<Set<string>>(new Set());

  // Poll for specific upload status
  useEffect(() => {
    if (pollingIds.size === 0) return;

    const interval = setInterval(async () => {
      for (const uploadId of pollingIds) {
        const response = await fetch(
          `${import.meta.env.VITE_API_BASE}/uploads/${uploadId}`,
          {
            headers: {
              'Authorization': `Bearer ${accessToken}`
            }
          }
        );

        const data = await response.json();

        // Update upload status
        setUploads(prev =>
          prev.map(u => u.uploadId === uploadId ? data.upload : u)
        );

        // Stop polling if completed or failed
        if (data.upload.ocrStatus === 'completed' ||
            data.upload.ocrStatus === 'failed') {
          setPollingIds(prev => {
            const next = new Set(prev);
            next.delete(uploadId);
            return next;
          });
        }
      }
    }, 2000);  // Poll every 2 seconds

    return () => clearInterval(interval);
  }, [pollingIds]);

  // After upload success
  const handleUploadSuccess = (uploadId: string) => {
    setPollingIds(prev => new Set(prev).add(uploadId));
  };

  return (
    <div>
      {uploads.map(upload => (
        <div key={upload.uploadId}>
          <img src={upload.fileUrl} alt="Menu" />

          {upload.ocrStatus === 'pending' && (
            <p>⏳ Waiting to process...</p>
          )}

          {upload.ocrStatus === 'processing' && (
            <p>🔄 Extracting menu items...</p>
          )}

          {upload.ocrStatus === 'completed' && (
            <p>✅ Extracted {upload.itemsCount} items</p>
          )}

          {upload.ocrStatus === 'failed' && (
            <p>❌ Failed: {upload.ocrError}</p>
          )}
        </div>
      ))}
    </div>
  );
}
```

## Database Schema Updates

### Migration SQL

```sql
-- File: menu-combo-backend/db/migration-ocr.sql

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

## Deployment Configuration

### Serverless.yml Updates

Key additions:
- New Lambda function `ocrWorker` with 5-minute timeout and 2048MB memory
- SQS queue `MenuOcrQueue` with DLQ
- IAM permissions for Textract and Bedrock
- Environment variable `SQS_QUEUE_URL`

### New NPM Dependencies

```json
{
  "dependencies": {
    "@aws-sdk/client-textract": "^3.928.0",
    "@aws-sdk/client-bedrock-runtime": "^3.928.0",
    "@aws-sdk/client-sqs": "^3.928.0"
  }
}
```

### Project File Structure

```
menu-combo-backend/
├── handler.js           # Upload handler + API routes
├── ocrWorker.js         # NEW: OCR processing Lambda
├── middleware/
│   └── auth.js
├── db/
│   ├── index.js
│   ├── schema.sql
│   └── migration-ocr.sql # NEW: Migration for OCR features
├── services/           # NEW directory
│   ├── textract.js     # Textract integration
│   ├── bedrock.js      # Bedrock Claude integration
│   └── ocr.js          # Main OCR orchestration
├── serverless.yml
└── package.json
```

## Design Summary

This design delivers:

✅ **2 Lambda Functions** (upload handler + OCR worker)
✅ **3 AWS AI/ML Services** (Textract + Bedrock + Cognito)
✅ **SQS Async Architecture** (decoupling + retry mechanism)
✅ **Complete Error Handling** (3 retries + DLQ)
✅ **Frontend Polling** (2-second interval, auto-stop)
✅ **Coordinate Tracking** (Textract bbox + visualization)
✅ **Database Extension** (status tracking + error logging)

## Next Steps

1. Run database migration
2. Update serverless.yml configuration
3. Implement service modules (textract.js, bedrock.js, ocr.js)
4. Implement ocrWorker.js Lambda function
5. Update handler.js to send SQS messages after upload
6. Add GET /uploads/:uploadId endpoint
7. Implement frontend polling component
8. Deploy and test with real menu images
