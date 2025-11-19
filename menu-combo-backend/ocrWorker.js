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

      // Step 3: Process with Textract + OpenAI
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
