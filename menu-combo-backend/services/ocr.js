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
