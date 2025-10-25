import OpenAI from "openai"

let openaiClient: OpenAI | null = null

export function getOpenAIClient(): OpenAI {
  if (!openaiClient) {
    const apiKey = process.env.OPENAI_API_KEY
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY is not configured in environment variables")
    }
    openaiClient = new OpenAI({ apiKey })
  }
  return openaiClient
}

export async function callOpenAIWithStructuredOutput(
  companyData: Record<string, unknown>,
  jsonSchema: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const client = getOpenAIClient()

  try {
    const completion = await client.chat.completions.create({
      model: "gpt-5-nano-2025-08-07",
      messages: [
        {
          role: "user",
          content: JSON.stringify(companyData)
        }
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "company_data_cleaning",
          schema: jsonSchema,
          strict: true
        }
      },
      max_completion_tokens: 16000
    })

    const responseContent = completion.choices[0]?.message?.content
    if (!responseContent) {
      throw new Error("No response from OpenAI")
    }

    return JSON.parse(responseContent) as Record<string, unknown>
  } catch (error) {
    console.error("OpenAI API error:", error)
    const message = error instanceof Error ? error.message : "Unknown error"
    throw new Error(`OpenAI API error: ${message}`)
  }
}
