import { CRMClient, CRMCredentials, CRMProvider } from "./types"
import { HubSpotClient } from "./hubspot"

/**
 * Detect CRM provider from request headers
 * Header naming convention: x-{provider}-api-key
 */
export function detectCRMFromHeaders(headers: Headers): CRMCredentials | null {
  // Check for HubSpot
  const hubspotKey = headers.get("x-hubspot-api-key")
  if (hubspotKey) {
    return {
      provider: "hubspot",
      apiKey: hubspotKey,
    }
  }

  // Check for Attio (future)
  const attioKey = headers.get("x-attio-api-key")
  if (attioKey) {
    return {
      provider: "attio",
      apiKey: attioKey,
    }
  }

  // Check for Zoho (future)
  const zohoKey = headers.get("x-zoho-api-key")
  if (zohoKey) {
    return {
      provider: "zoho",
      apiKey: zohoKey,
    }
  }

  // Check for Salesforce (future)
  const salesforceKey = headers.get("x-salesforce-api-key")
  if (salesforceKey) {
    return {
      provider: "salesforce",
      apiKey: salesforceKey,
    }
  }

  return null
}

/**
 * Create CRM client based on provider
 */
export function createCRMClient(credentials: CRMCredentials): CRMClient {
  switch (credentials.provider) {
    case "hubspot":
      return new HubSpotClient(credentials.apiKey)

    case "attio":
      throw new Error("Attio integration coming soon")

    case "zoho":
      throw new Error("Zoho integration coming soon")

    case "salesforce":
      throw new Error("Salesforce integration coming soon")

    default:
      throw new Error(`Unsupported CRM provider: ${credentials.provider}`)
  }
}
