import OpenAI from 'openai';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';

const sm = new SecretsManagerClient({ region: 'us-east-1' });

// Cache OpenAI client and API key
let openaiClient = null;
let cachedApiKey = null;

/**
 * Get OpenAI API key from AWS Secrets Manager
 */
async function getOpenAiApiKey() {
  if (cachedApiKey) {
    return cachedApiKey;
  }

  const secretArn = process.env.CLAUDE_API_KEY || 'menu-claude-api-key';
  const secretResponse = await sm.send(new GetSecretValueCommand({ SecretId: secretArn }));

  if (!secretResponse.SecretString) {
    throw new Error('OpenAI API key secret is empty');
  }

  cachedApiKey = secretResponse.SecretString;
  return cachedApiKey;
}

/**
 * Get or create OpenAI client
 */
async function getOpenAiClient() {
  if (openaiClient) {
    return openaiClient;
  }

  const apiKey = await getOpenAiApiKey();
  openaiClient = new OpenAI({ apiKey });
  return openaiClient;
}

const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o';

/**
 * Build prompt for AI to structure menu items from Textract blocks
 * @param {Array} textractBlocks - Blocks from Textract
 * @returns {string} Prompt for AI analysis
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
- All items MUST have a "name" field (required)

**IMPORTANT - blockIds selection**:
- blockIds should ONLY include the text blocks that contain the item's NAME and PRICE
- DO NOT include block IDs for descriptions, category labels, section headers, or other supplementary text
- The bounding box will be drawn around these blocks, so only include the essential identifying information
- Example: If a menu item has blocks [0: "Burger", 1: "A delicious beef burger", 2: "$12.99"],
  only include blockIds: [0, 2] (name and price), NOT [0, 1, 2]`;
}

/**
 * Extract JSON from AI response, handling markdown code blocks
 * @param {string} text - AI response text
 * @returns {Object} Parsed JSON object
 * @throws {Error} If JSON parsing fails
 */
function extractJsonFromResponse(text) {
  console.log('Extracting JSON from AI response...');

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
 * Analyze menu image and Textract results using OpenAI
 * @param {Buffer} imageBytes - Image binary data
 * @param {Array} textractBlocks - Text blocks from Textract
 * @param {string} imageFormat - Image MIME type (default: 'image/jpeg')
 * @returns {Promise<Object>} Structured menu data with items array
 * @throws {Error} If validation fails or OpenAI API fails
 */
export async function analyzeMenuWithOpenAI(imageBytes, textractBlocks, imageFormat = 'image/jpeg') {
  // Input validation
  if (!imageBytes || !Buffer.isBuffer(imageBytes) || imageBytes.length === 0) {
    throw new Error('Invalid image bytes: must be a non-empty Buffer');
  }

  if (!textractBlocks || !Array.isArray(textractBlocks) || textractBlocks.length === 0) {
    throw new Error('Invalid textractBlocks: must be a non-empty array');
  }

  console.log(`Starting OpenAI analysis with ${textractBlocks.length} Textract blocks`);

  try {
    const openai = await getOpenAiClient();
    const prompt = buildMenuAnalysisPrompt(textractBlocks);

    // Convert image to base64 data URL
    const base64Image = imageBytes.toString('base64');
    const dataUrl = `data:${imageFormat};base64,${base64Image}`;

    console.log(`Invoking OpenAI model: ${OPENAI_MODEL}`);
    const response = await openai.chat.completions.create({
      model: OPENAI_MODEL,
      max_tokens: 4096,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: {
                url: dataUrl
              }
            },
            {
              type: 'text',
              text: prompt
            }
          ]
        }
      ]
    });

    console.log('OpenAI response received, parsing content...');

    // Extract JSON from OpenAI's response (handle markdown code blocks)
    const responseText = response.choices[0].message.content;
    const menuData = extractJsonFromResponse(responseText);

    // Validate response structure
    if (!menuData.items || !Array.isArray(menuData.items)) {
      throw new Error('Invalid response format from OpenAI: missing or invalid "items" array');
    }

    if (menuData.items.length === 0) {
      console.warn('OpenAI returned zero menu items');
    }

    console.log(`OpenAI identified ${menuData.items.length} menu items, validating...`);

    // Validate each menu item
    menuData.items.forEach((item, index) => {
      validateMenuItem(item, index);
    });

    console.log(`Successfully validated ${menuData.items.length} menu items`);

    return menuData;
  } catch (error) {
    console.error('OpenAI analysis failed:', error);

    // Handle specific OpenAI errors
    if (error.status === 429) {
      throw new Error('OpenAI rate limit exceeded - please retry later');
    }
    if (error.status === 401) {
      throw new Error('OpenAI authentication failed - invalid API key');
    }
    if (error.status === 400) {
      throw new Error(`OpenAI validation error: ${error.message}`);
    }

    // Re-throw with context
    throw new Error(`OpenAI failed: ${error.message}`);
  }
}
