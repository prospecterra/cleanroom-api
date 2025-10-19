/**
 * Common types for CRM integrations
 */

export type CRMProvider = "hubspot" | "attio" | "zoho" | "salesforce"

export interface CRMCredentials {
  provider: CRMProvider
  apiKey: string
}

export interface UpdateCompanyParams {
  recordId: string
  properties: Record<string, any>
}

export interface DeleteCompanyParams {
  recordId: string
}

export interface CRMClient {
  updateCompany(params: UpdateCompanyParams): Promise<void>
  deleteCompany(params: DeleteCompanyParams): Promise<void>
}
