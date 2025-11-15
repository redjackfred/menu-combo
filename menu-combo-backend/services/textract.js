import { TextractClient, DetectDocumentTextCommand } from '@aws-sdk/client-textract';

// Reuse client across invocations for better performance
const textractClient = new TextractClient({
  region: process.env.AWS_REGION || 'us-east-1'
});

/**
 * Extract text and bounding boxes from image using AWS Textract
 * @param {Buffer} imageBytes - Image binary data
 * @returns {Promise<Array<{id: number, text: string, confidence: number, bbox: {left: number, top: number, width: number, height: number}}>} Array of text blocks with coordinates
 * @throws {Error} If image is invalid or Textract API fails
 */
export async function extractTextWithCoordinates(imageBytes) {
  // Input validation
  if (!imageBytes || !Buffer.isBuffer(imageBytes) || imageBytes.length === 0) {
    throw new Error('Invalid image bytes: must be a non-empty Buffer');
  }

  try {
    const command = new DetectDocumentTextCommand({
      Document: { Bytes: imageBytes }
    });

    const response = await textractClient.send(command);

    // Filter for LINE blocks only (more semantic than WORD blocks)
    // Add null safety for response.Blocks
    const blocks = (response.Blocks || [])
      .filter(block => block?.BlockType === 'LINE')
      .map((block, index) => ({
        id: index,
        text: block.Text || '',
        confidence: block.Confidence || 0,
        bbox: {
          left: block.Geometry?.BoundingBox?.Left || 0,
          top: block.Geometry?.BoundingBox?.Top || 0,
          width: block.Geometry?.BoundingBox?.Width || 0,
          height: block.Geometry?.BoundingBox?.Height || 0
        }
      }));

    if (blocks.length === 0) {
      console.warn('Textract completed but found no LINE blocks in image');
    }

    return blocks;
  } catch (error) {
    console.error('Textract extraction failed:', error);

    // Handle specific Textract errors
    if (error.name === 'ProvisionedThroughputExceededException') {
      throw new Error('Textract rate limit exceeded - please retry later');
    }
    if (error.name === 'InvalidParameterException') {
      throw new Error('Invalid image format or size for Textract');
    }

    throw new Error(`Textract failed: ${error.message}`);
  }
}
