import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// ── Extract data from a receipt image using Claude ────────────
export const extractReceiptData = async (imageBuffer, mimeType) => {
  // Convert buffer to base64
  const base64Image = imageBuffer.toString("base64");

  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1024,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: mimeType,
              data: base64Image,
            },
          },
          {
            type: "text",
            text: `Extract the following information from this receipt image and return it as a valid JSON object only, with no extra text or markdown:
 
{
  "merchant": "store or business name",
  "date": "YYYY-MM-DD format or null if not found",
  "total": number or null,
  "subtotal": number or null,
  "tax": number or null,
  "line_items": [
    { "description": "item name", "quantity": number, "unit_price": number, "total": number }
  ],
  "confidence": number between 0 and 1 indicating how confident you are in the extraction
}
 
Rules:
- All monetary values must be numbers, not strings
- If a field cannot be determined, use null
- line_items should be an empty array if no items are visible
- confidence should reflect overall quality: 0.9+ for clear receipts, 0.5-0.9 for partial, below 0.5 for poor quality
- Return ONLY the JSON object, no explanation`,
          },
        ],
      },
    ],
  });

  // Parse the JSON response from Claude
  const text = response.content[0].text
    .trim()
    .replace(/^```json\n?/, "")
    .replace(/^```\n?/, "")
    .replace(/```$/, "")
    .trim();

  try {
    const data = JSON.parse(text);
    return {
      merchant: data.merchant || null,
      date: data.date || null,
      total: data.total || null,
      subtotal: data.subtotal || null,
      tax: data.tax || null,
      lineItems: data.line_items || [],
      confidence: data.confidence || 0.5,
    };
  } catch (err) {
    // If Claude returns something unexpected, return a low confidence result
    console.error("Failed to parse Claude receipt response:", text);
    return {
      merchant: null,
      date: null,
      total: null,
      subtotal: null,
      tax: null,
      lineItems: [],
      confidence: 0.1,
    };
  }
};
