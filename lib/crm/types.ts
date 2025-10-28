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
  properties: Record<string, unknown>
}

export interface DeleteCompanyParams {
  recordId: string
}

export interface GetCompanyResult {
  id: string
  properties: Record<string, unknown>
}

export interface CRMClient {
  updateCompany(params: UpdateCompanyParams): Promise<void>
  deleteCompany(params: DeleteCompanyParams): Promise<void>
  companyExists(recordId: string): Promise<boolean>
  getCompany(recordId: string): Promise<GetCompanyResult>
}
