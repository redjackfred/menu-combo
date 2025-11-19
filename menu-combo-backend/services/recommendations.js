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

/**
 * Build prompt for recommendation generation
 */
function buildRecommendationPrompt(menuItems, preferences) {
  const itemsList = menuItems.map((item, idx) =>
    `${idx + 1}. ${item.item_name} - $${item.price || 'N/A'} (${item.category || 'Uncategorized'})`
  ).join('\n');

  const budget = preferences?.budget
    ? `Budget: $${preferences.budget.min || 0} - $${preferences.budget.max || 100}`
    : 'Budget: Flexible';

  const people = preferences?.people || 1;
  const dietary = preferences?.dietaryRestrictions?.length > 0
    ? `Dietary restrictions: ${preferences.dietaryRestrictions.join(', ')}`
    : 'No dietary restrictions';

  const spicy = preferences?.spicyLevel
    ? `Spicy level preference: ${preferences.spicyLevel}`
    : 'Any spice level';

  return `You are a professional meal recommendation assistant. Based on the following menu items, create 3 different meal combo recommendations.

**Available Menu Items:**
${itemsList}

**User Preferences:**
- Number of people: ${people}
- ${budget}
- ${dietary}
- ${spicy}

**Task:**
Generate 3 diverse meal combo recommendations that:
1. Balance nutrition (protein, vegetables, carbs)
2. Fit within the budget
3. Respect dietary restrictions
4. Create a complete meal experience
5. Each combo should serve ${people} ${people > 1 ? 'people' : 'person'}

**CRITICAL**: Return ONLY valid JSON matching this exact format (no markdown, no code blocks):

{
  "recommendations": [
    {
      "name": "Combo name",
      "items": [
        {
          "item_name": "exact item name from menu",
          "price": number,
          "quantity": number
        }
      ],
      "totalPrice": number,
      "reason": "Why this combo is good (nutrition balance, value, variety)",
      "tags": ["balanced", "budget-friendly", "spicy", etc.]
    }
  ]
}

**Rules:**
- Only use items from the available menu
- Ensure item_name matches EXACTLY with menu items
- Total price = sum of (item price × quantity)
- Each combo should have 3-5 items
- Consider variety in categories (don't pick all the same type)`;
}

/**
 * Generate meal recommendations using OpenAI
 */
export async function generateRecommendations(menuItems, preferences = {}) {
  console.log(`Generating recommendations for ${menuItems.length} items`);

  try {
    const openai = await getOpenAiClient();
    const prompt = buildRecommendationPrompt(menuItems, preferences);

    console.log('Calling OpenAI for recommendations...');
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      max_tokens: 2000,
      temperature: 0.7, // More creative for varied recommendations
      messages: [
        {
          role: 'system',
          content: 'You are a helpful meal planning assistant. Always return valid JSON only.'
        },
        {
          role: 'user',
          content: prompt
        }
      ]
    });

    console.log('OpenAI response received');

    const responseText = response.choices[0].message.content;

    // Try to extract JSON from response
    let result;
    try {
      // Try parsing directly first
      result = JSON.parse(responseText.trim());
    } catch (e) {
      // Try extracting from code block
      const codeBlockMatch = responseText.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
      if (codeBlockMatch) {
        result = JSON.parse(codeBlockMatch[1].trim());
      } else {
        throw new Error('Failed to parse OpenAI response as JSON');
      }
    }

    // Validate response structure
    if (!result.recommendations || !Array.isArray(result.recommendations)) {
      throw new Error('Invalid response format: missing recommendations array');
    }

    console.log(`Generated ${result.recommendations.length} recommendations`);
    return result.recommendations;

  } catch (error) {
    console.error('Failed to generate recommendations:', error);
    throw new Error(`Recommendation generation failed: ${error.message}`);
  }
}
