import sharp from 'sharp';
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import crypto from 'crypto';

const s3 = new S3Client({ region: 'us-east-1' });

/**
 * Download image from S3
 */
async function downloadImageFromS3(bucketName, key) {
  const command = new GetObjectCommand({
    Bucket: bucketName,
    Key: key
  });

  const response = await s3.send(command);
  const chunks = [];

  for await (const chunk of response.Body) {
    chunks.push(chunk);
  }

  return Buffer.concat(chunks);
}

/**
 * Annotate image with bounding boxes
 * @param {Buffer} imageBuffer - Original image buffer
 * @param {Array} items - Menu items with bbox coordinates
 * @returns {Promise<Buffer>} - Annotated image buffer
 */
async function annotateImage(imageBuffer, items) {
  try {
    // Apply EXIF rotation first and convert to buffer
    const rotatedBuffer = await sharp(imageBuffer)
      .rotate() // Auto-rotate based on EXIF orientation
      .toBuffer();

    // Get metadata from rotated image
    const metadata = await sharp(rotatedBuffer).metadata();
    const { width, height } = metadata;

    // Create SVG overlay with bounding boxes
    const svgOverlays = items.map((item) => {
      if (!item.bbox) {
        console.warn(`Item ${item.item_name} has no bbox, skipping`);
        return '';
      }

      // Convert relative coordinates (0-1) to pixel coordinates
      const x = Math.round(item.bbox.left * width);
      const y = Math.round(item.bbox.top * height);
      const boxWidth = Math.round(item.bbox.width * width);
      const boxHeight = Math.round(item.bbox.height * height);

      // Create rectangle only - no text labels
      return `
        <rect
          x="${x}"
          y="${y}"
          width="${boxWidth}"
          height="${boxHeight}"
          fill="rgba(34, 197, 94, 0.2)"
          stroke="rgb(34, 197, 94)"
          stroke-width="3"
          rx="4"
        />
      `;
    }).join('');

    const svg = `
      <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
        ${svgOverlays}
      </svg>
    `;

    // Composite SVG overlay onto rotated image
    const annotatedImage = await sharp(rotatedBuffer)
      .composite([
        {
          input: Buffer.from(svg),
          top: 0,
          left: 0
        }
      ])
      .png() // Convert to PNG for better quality
      .toBuffer();

    return annotatedImage;

  } catch (error) {
    console.error('Error in annotateImage:', error);
    throw error;
  }
}

/**
 * Main function to annotate menu image with items
 * @param {string} s3Key - S3 key of the original image
 * @param {Array} items - Menu items to highlight
 * @returns {Promise<string>} - S3 URL of the annotated image
 */
export async function annotateMenuImage(s3Key, items) {
  try {
    const bucketName = process.env.BUCKET_NAME;
    const region = 'us-east-1';

    console.log(`Annotating ${s3Key} with ${items.length} items`);

    // Download original image from S3
    const imageBuffer = await downloadImageFromS3(bucketName, s3Key);

    // Annotate image
    const annotatedBuffer = await annotateImage(imageBuffer, items);

    // Create unique S3 key based on items being highlighted
    // Sort item IDs to ensure consistent hash for same items
    const itemIds = items.map(item => item.item_id).sort().join(',');
    const itemsHash = crypto.createHash('md5').update(itemIds).digest('hex').substring(0, 8);

    // Upload annotated image to S3 with unique key per item combination
    const baseKey = s3Key.replace('uploads/', 'annotated/').replace(/\.(jpg|jpeg|png)$/i, '');
    const annotatedKey = `${baseKey}_${itemsHash}_annotated.png`;

    await s3.send(new PutObjectCommand({
      Bucket: bucketName,
      Key: annotatedKey,
      Body: annotatedBuffer,
      ContentType: 'image/png',
      CacheControl: 'max-age=86400' // Cache for 24 hours
    }));

    // Return S3 URL instead of data URL
    const s3Url = `https://${bucketName}.s3.${region}.amazonaws.com/${annotatedKey}`;
    console.log(`Annotated image uploaded: ${annotatedKey}`);

    return s3Url;

  } catch (error) {
    console.error('Image annotation failed:', error);
    throw new Error(`Failed to annotate image: ${error.message}`);
  }
}
