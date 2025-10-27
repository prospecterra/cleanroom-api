import { CRMClient, UpdateCompanyParams, DeleteCompanyParams, GetCompanyResult } from "./types"

// Timeout for CRM API calls (15 seconds)
const CRM_TIMEOUT_MS = 15000

/**
 * Helper to create fetch with timeout
 */
function fetchWithTimeout(url: string, options: RequestInit, timeoutMs: number = CRM_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  return fetch(url, {
    ...options,
    signal: controller.signal
  }).finally(() => clearTimeout(timeout))
}

/**
 * HubSpot CRM client
 * Docs: https://developers.hubspot.com/docs/api/crm/companies
 */
export class HubSpotClient implements CRMClient {
  private apiKey: string
  private baseUrl = "https://api.hubapi.com"

  constructor(apiKey: string) {
    this.apiKey = apiKey
  }

  /**
   * Update a company record in HubSpot
   * PATCH /crm/v3/objects/companies/{companyId}
   */
  async updateCompany(params: UpdateCompanyParams): Promise<void> {
    const { recordId, properties } = params

    const response = await fetchWithTimeout(
      `${this.baseUrl}/crm/v3/objects/companies/${recordId}`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({ properties }),
      },
      CRM_TIMEOUT_MS
    )

    if (!response.ok) {
      const error = await response.text()
      throw new Error(
        `HubSpot API error (${response.status}): ${error}`
      )
    }
  }

  /**
   * Delete a company record in HubSpot
   * DELETE /crm/v3/objects/companies/{companyId}
   */
  async deleteCompany(params: DeleteCompanyParams): Promise<void> {
    const { recordId } = params

    const response = await fetchWithTimeout(
      `${this.baseUrl}/crm/v3/objects/companies/${recordId}`,
      {
        method: "DELETE",
        headers: {
          "Authorization": `Bearer ${this.apiKey}`,
        },
      },
      CRM_TIMEOUT_MS
    )

    if (!response.ok) {
      const error = await response.text()
      throw new Error(
        `HubSpot API error (${response.status}): ${error}`
      )
    }
  }

  /**
   * Check if a company record exists in HubSpot
   * GET /crm/v3/objects/companies/{companyId}
   */
  async companyExists(recordId: string): Promise<boolean> {
    try {
      const response = await fetchWithTimeout(
        `${this.baseUrl}/crm/v3/objects/companies/${recordId}`,
        {
          method: "GET",
          headers: {
            "Authorization": `Bearer ${this.apiKey}`,
          },
        },
        CRM_TIMEOUT_MS
      )

      return response.ok
    } catch (error) {
      console.error("Error checking company existence:", error)
      return false
    }
  }

  /**
   * Get a company record from HubSpot
   * GET /crm/v3/objects/companies/{companyId}?properties=...
   */
  async getCompany(recordId: string): Promise<GetCompanyResult> {
    // Request all relevant properties including date fields
    const properties = [
      "name", "domain", "website", "phone", "city", "state", "zip",
      "country", "address", "linkedin", "createdate", "hs_lastmodifieddate"
    ].join(",")

    const response = await fetchWithTimeout(
      `${this.baseUrl}/crm/v3/objects/companies/${recordId}?properties=${properties}`,
      {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${this.apiKey}`,
        },
      },
      CRM_TIMEOUT_MS
    )

    if (!response.ok) {
      const error = await response.text()
      throw new Error(
        `HubSpot API error (${response.status}): ${error}`
      )
    }

    const data = await response.json()
    return {
      id: data.id,
      properties: data.properties || {}
    }
  }
}
