import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';

// Reuse client across invocations for better performance
const bedrockClient = new BedrockRuntimeClient({
  region: process.env.AWS_REGION || 'us-east-1'
});

const CLAUDE_MODEL_ID = process.env.BEDROCK_MODEL_ID || 'anthropic.claude-3-5-sonnet-20241022-v2:0';

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

**CRITICAL**: Return ONLY valid JSON matching the format above. Do NOT wrap the JSON in markdown code blocks or add any other text.

**Rules**:
- If both Chinese and English names exist, keep only English or translate to English
- If price is unclear, set to null and explain in notes
- Confidence based on text clarity and information completeness
- Try to identify all items, don't miss any
- Handle edge cases: empty menus, non-menu images, unclear text
- All items MUST have a "name" field (required)`;
}

/**
 * Extract JSON from Claude's response, handling markdown code blocks
 * @param {string} text - Claude's response text
 * @returns {Object} Parsed JSON object
 * @throws {Error} If JSON parsing fails
 */
function extractJsonFromResponse(text) {
  console.log('Extracting JSON from Claude response...');

  // Try to extract JSON from markdown code blocks (```json or ```)
  const codeBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (codeBlockMatch) {
    console.log('Found JSON in markdown code block');
    return JSON.parse(codeBlockMatch[1].trim());
  }

  // If no code block, try parsing the entire text as JSON
  console.log('No markdown code block found, parsing entire response as JSON');
  return JSON.parse(text.trim());
}

/**
 * Validate menu item structure
 * @param {Object} item - Menu item to validate
 * @param {number} index - Item index for error messages
 * @throws {Error} If validation fails
 */
function validateMenuItem(item, index) {
  // Required field: name
  if (!item.name || typeof item.name !== 'string' || item.name.trim() === '') {
    throw new Error(`Item ${index}: missing or invalid "name" field (required)`);
  }

  // Optional fields validation
  if (item.price !== null && item.price !== undefined && typeof item.price !== 'number') {
    throw new Error(`Item ${index}: "price" must be a number or null`);
  }

  if (item.description !== null && item.description !== undefined && typeof item.description !== 'string') {
    throw new Error(`Item ${index}: "description" must be a string or null`);
  }

  if (item.category !== null && item.category !== undefined && typeof item.category !== 'string') {
    throw new Error(`Item ${index}: "category" must be a string or null`);
  }

  if (item.blockIds !== undefined && !Array.isArray(item.blockIds)) {
    throw new Error(`Item ${index}: "blockIds" must be an array`);
  }

  if (item.confidence !== null && item.confidence !== undefined) {
    if (typeof item.confidence !== 'number' || item.confidence < 0 || item.confidence > 1) {
      throw new Error(`Item ${index}: "confidence" must be a number between 0 and 1`);
    }
  }

  if (item.notes !== null && item.notes !== undefined && typeof item.notes !== 'string') {
    throw new Error(`Item ${index}: "notes" must be a string or null`);
  }
}

/**
 * Analyze menu image and Textract results using Bedrock Claude
 * @param {Buffer} imageBytes - Image binary data
 * @param {Array} textractBlocks - Text blocks from Textract
 * @param {string} imageFormat - Image MIME type (default: 'image/jpeg')
 * @returns {Promise<Object>} Structured menu data with items array
 * @throws {Error} If validation fails or Bedrock API fails
 */
export async function analyzeMenuWithClaude(imageBytes, textractBlocks, imageFormat = 'image/jpeg') {
  // Input validation
  if (!imageBytes || !Buffer.isBuffer(imageBytes) || imageBytes.length === 0) {
    throw new Error('Invalid image bytes: must be a non-empty Buffer');
  }

  if (!textractBlocks || !Array.isArray(textractBlocks) || textractBlocks.length === 0) {
    throw new Error('Invalid textractBlocks: must be a non-empty array');
  }

  console.log(`Starting Bedrock Claude analysis with ${textractBlocks.length} Textract blocks`);

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
                media_type: imageFormat,
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

    console.log(`Invoking Bedrock model: ${CLAUDE_MODEL_ID}`);
    const command = new InvokeModelCommand({
      modelId: CLAUDE_MODEL_ID,
      body: JSON.stringify(claudeRequest)
    });

    const response = await bedrockClient.send(command);
    const responseBody = JSON.parse(new TextDecoder().decode(response.body));

    console.log('Bedrock response received, parsing content...');

    // Extract JSON from Claude's response (handle markdown code blocks)
    const responseText = responseBody.content[0].text;
    const menuData = extractJsonFromResponse(responseText);

    // Validate response structure
    if (!menuData.items || !Array.isArray(menuData.items)) {
      throw new Error('Invalid response format from Claude: missing or invalid "items" array');
    }

    if (menuData.items.length === 0) {
      console.warn('Claude returned zero menu items');
    }

    console.log(`Claude identified ${menuData.items.length} menu items, validating...`);

    // Validate each menu item
    menuData.items.forEach((item, index) => {
      validateMenuItem(item, index);
    });

    console.log(`Successfully validated ${menuData.items.length} menu items`);

    return menuData;
  } catch (error) {
    console.error('Bedrock Claude analysis failed:', error);

    // Handle specific Bedrock errors
    if (error.name === 'ThrottlingException') {
      throw new Error('Bedrock rate limit exceeded - please retry later');
    }
    if (error.name === 'ModelNotReadyException') {
      throw new Error('Bedrock model is not ready - please retry later');
    }
    if (error.name === 'ValidationException') {
      throw new Error(`Bedrock validation error: ${error.message}`);
    }

    // Re-throw with context
    throw new Error(`Bedrock failed: ${error.message}`);
  }
}
