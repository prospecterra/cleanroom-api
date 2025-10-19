import { CRMClient, UpdateCompanyParams, DeleteCompanyParams } from "./types"

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

    const response = await fetch(
      `${this.baseUrl}/crm/v3/objects/companies/${recordId}`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({ properties }),
      }
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

    const response = await fetch(
      `${this.baseUrl}/crm/v3/objects/companies/${recordId}`,
      {
        method: "DELETE",
        headers: {
          "Authorization": `Bearer ${this.apiKey}`,
        },
      }
    )

    if (!response.ok) {
      const error = await response.text()
      throw new Error(
        `HubSpot API error (${response.status}): ${error}`
      )
    }
  }
}
