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
  companyData: Record<string, any>,
  jsonSchema: any
): Promise<any> {
  const client = getOpenAIClient()

  try {
    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
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
      temperature: 0.3,
      max_tokens: 4000
    })

    const responseContent = completion.choices[0]?.message?.content
    if (!responseContent) {
      throw new Error("No response from OpenAI")
    }

    return JSON.parse(responseContent)
  } catch (error: any) {
    console.error("OpenAI API error:", error)
    throw new Error(`OpenAI API error: ${error.message}`)
  }
}
