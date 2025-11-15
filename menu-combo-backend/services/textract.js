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
