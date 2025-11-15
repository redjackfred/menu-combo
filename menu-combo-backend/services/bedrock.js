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
