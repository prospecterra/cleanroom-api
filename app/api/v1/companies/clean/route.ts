import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { checkRateLimit } from "@/lib/ratelimit"
import { callOpenAIWithStructuredOutput } from "@/lib/openai"
import { checkFeatureAccess, trackFeatureUsage } from "@/lib/autumn"

// Base JSON schema template for company data cleaning
const BASE_SCHEMA = {
  "type": "object",
  "description": "Schema for CRM company data cleaning to standardize and improve data quality for company identification, location, and digital presence properties",
  "properties": {
    "name": {
      "type": "object",
      "description": "General description: The common or trade name of the company. This field should be cleaned for proper case formatting, excessive whitespace removal, and standardization of common abbreviations while preserving intentional stylization (e.g., 'eBay', 'iPhone'). Test or fake company names (e.g., 'Test Company', 'Demo Inc', 'Fake Company Name Inc.') should be identified and removed.",
      "properties": {
        "currentValue": {
          "type": ["string", "null"],
          "description": "The current/original value of the company name field as it exists in the source data before cleaning"
        },
        "recommendedValue": {
          "type": ["string", "null"],
          "description": "The cleaned and standardized company name value, or null if the current value should be removed"
        },
        "reasoning": {
          "type": "string",
          "description": "Detailed explanation of what cleaning operations were performed (or why the value was kept unchanged), including specific transformations applied and the rationale behind the recommendation"
        },
        "confidence": {
          "type": "string",
          "enum": ["LOW", "MEDIUM", "HIGH"],
          "description": "Confidence level in the cleaning recommendation. HIGH: clear, unambiguous cleaning with standard patterns. MEDIUM: reasonable assumptions made, multiple valid options existed. LOW: significant guesswork or uncertain transformations"
        },
        "recommendedAction": {
          "type": "string",
          "enum": ["ADD", "FIX", "REMOVE", "KEEP"],
          "description": "The type of action recommended. ADD: previously empty/null field now has a value. FIX: existing value was modified. REMOVE: existing value should be cleared. KEEP: value remains unchanged"
        }
      },
      "required": ["currentValue", "recommendedValue", "reasoning", "confidence", "recommendedAction"],
      "additionalProperties": false
    },
    "legalName": {
      "type": "object",
      "description": "General description: The official registered legal name of the company including appropriate corporate suffixes (Inc., LLC, Ltd., AB, GmbH, etc.). Should be cleaned for proper case formatting and standardization while maintaining legal accuracy. Must include the correct jurisdiction-specific corporate designation.",
      "properties": {
        "currentValue": {
          "type": ["string", "null"],
          "description": "The current/original legal name as it exists in the source data before cleaning"
        },
        "recommendedValue": {
          "type": ["string", "null"],
          "description": "The cleaned and standardized legal name with proper corporate suffix, or null if the current value should be removed"
        },
        "reasoning": {
          "type": "string",
          "description": "Detailed explanation of what cleaning operations were performed, including verification of corporate suffixes and legal naming conventions"
        },
        "confidence": {
          "type": "string",
          "enum": ["LOW", "MEDIUM", "HIGH"],
          "description": "Confidence level in the cleaning recommendation. HIGH: clear, unambiguous cleaning with standard patterns. MEDIUM: reasonable assumptions made, multiple valid options existed. LOW: significant guesswork or uncertain transformations"
        },
        "recommendedAction": {
          "type": "string",
          "enum": ["ADD", "FIX", "REMOVE", "KEEP"],
          "description": "The type of action recommended. ADD: previously empty/null field now has a value. FIX: existing value was modified. REMOVE: existing value should be cleared. KEEP: value remains unchanged"
        }
      },
      "required": ["currentValue", "recommendedValue", "reasoning", "confidence", "recommendedAction"],
      "additionalProperties": false
    },
    "description": {
      "type": "object",
      "description": "General description: A brief description of the company's primary business activities, products, or services. Should be cleaned for proper grammar, punctuation, professional tone, and excessive marketing language. Should be concise yet informative.",
      "properties": {
        "currentValue": {
          "type": ["string", "null"],
          "description": "The current/original company description as it exists in the source data before cleaning"
        },
        "recommendedValue": {
          "type": ["string", "null"],
          "description": "The cleaned and professionally formatted description, or null if the current value should be removed"
        },
        "reasoning": {
          "type": "string",
          "description": "Detailed explanation of what cleaning operations were performed, including grammar corrections, tone adjustments, and content improvements"
        },
        "confidence": {
          "type": "string",
          "enum": ["LOW", "MEDIUM", "HIGH"],
          "description": "Confidence level in the cleaning recommendation. HIGH: clear, unambiguous cleaning with standard patterns. MEDIUM: reasonable assumptions made, multiple valid options existed. LOW: significant guesswork or uncertain transformations"
        },
        "recommendedAction": {
          "type": "string",
          "enum": ["ADD", "FIX", "REMOVE", "KEEP"],
          "description": "The type of action recommended. ADD: previously empty/null field now has a value. FIX: existing value was modified. REMOVE: existing value should be cleared. KEEP: value remains unchanged"
        }
      },
      "required": ["currentValue", "recommendedValue", "reasoning", "confidence", "recommendedAction"],
      "additionalProperties": false
    },
    "industry": {
      "type": "object",
      "description": "General description: The primary industry or sector classification for the company. Should be cleaned to use standard industry naming conventions, fix spelling errors, and map to recognized classification systems (e.g., NAICS, SIC). Should be consistent and specific.",
      "properties": {
        "currentValue": {
          "type": ["string", "null"],
          "description": "The current/original industry classification as it exists in the source data before cleaning"
        },
        "recommendedValue": {
          "type": ["string", "null"],
          "description": "The cleaned and standardized industry name using recognized conventions, or null if the current value should be removed"
        },
        "reasoning": {
          "type": "string",
          "description": "Detailed explanation of what cleaning operations were performed, including mapping to standard categories and spelling corrections"
        },
        "confidence": {
          "type": "string",
          "enum": ["LOW", "MEDIUM", "HIGH"],
          "description": "Confidence level in the cleaning recommendation. HIGH: clear, unambiguous cleaning with standard patterns. MEDIUM: reasonable assumptions made, multiple valid options existed. LOW: significant guesswork or uncertain transformations"
        },
        "recommendedAction": {
          "type": "string",
          "enum": ["ADD", "FIX", "REMOVE", "KEEP"],
          "description": "The type of action recommended. ADD: previously empty/null field now has a value. FIX: existing value was modified. REMOVE: existing value should be cleared. KEEP: value remains unchanged"
        }
      },
      "required": ["currentValue", "recommendedValue", "reasoning", "confidence", "recommendedAction"],
      "additionalProperties": false
    },
    "address": {
      "type": "object",
      "description": "General description: The street address including building number, street name, and suite/unit information for the company's headquarters. Should be cleaned for proper case formatting, standardized abbreviations (St., Ave., etc.), and address format consistency. Test addresses (e.g., '123 Fake Street', 'Test Address') should be identified and removed.",
      "properties": {
        "currentValue": {
          "type": ["string", "null"],
          "description": "The current/original street address as it exists in the source data before cleaning"
        },
        "recommendedValue": {
          "type": ["string", "null"],
          "description": "The cleaned and standardized street address with proper formatting, or null if the current value should be removed"
        },
        "reasoning": {
          "type": "string",
          "description": "Detailed explanation of what cleaning operations were performed, including address standardization and identification of test/fake data"
        },
        "confidence": {
          "type": "string",
          "enum": ["LOW", "MEDIUM", "HIGH"],
          "description": "Confidence level in the cleaning recommendation. HIGH: clear, unambiguous cleaning with standard patterns. MEDIUM: reasonable assumptions made, multiple valid options existed. LOW: significant guesswork or uncertain transformations"
        },
        "recommendedAction": {
          "type": "string",
          "enum": ["ADD", "FIX", "REMOVE", "KEEP"],
          "description": "The type of action recommended. ADD: previously empty/null field now has a value. FIX: existing value was modified. REMOVE: existing value should be cleared. KEEP: value remains unchanged"
        }
      },
      "required": ["currentValue", "recommendedValue", "reasoning", "confidence", "recommendedAction"],
      "additionalProperties": false
    },
    "city": {
      "type": "object",
      "description": "General description: The city or locality where the company's main headquarters is located. Should be cleaned for proper case formatting and standardization. Test city names (e.g., 'Test City', 'Demo City', 'Anytown') should be identified and removed.",
      "properties": {
        "currentValue": {
          "type": ["string", "null"],
          "description": "The current/original city name as it exists in the source data before cleaning"
        },
        "recommendedValue": {
          "type": ["string", "null"],
          "description": "The cleaned and standardized city name with proper case formatting, or null if the current value should be removed"
        },
        "reasoning": {
          "type": "string",
          "description": "Detailed explanation of what cleaning operations were performed, including case standardization and identification of test/fake data"
        },
        "confidence": {
          "type": "string",
          "enum": ["LOW", "MEDIUM", "HIGH"],
          "description": "Confidence level in the cleaning recommendation. HIGH: clear, unambiguous cleaning with standard patterns. MEDIUM: reasonable assumptions made, multiple valid options existed. LOW: significant guesswork or uncertain transformations"
        },
        "recommendedAction": {
          "type": "string",
          "enum": ["ADD", "FIX", "REMOVE", "KEEP"],
          "description": "The type of action recommended. ADD: previously empty/null field now has a value. FIX: existing value was modified. REMOVE: existing value should be cleared. KEEP: value remains unchanged"
        }
      },
      "required": ["currentValue", "recommendedValue", "reasoning", "confidence", "recommendedAction"],
      "additionalProperties": false
    },
    "stateOrProvince": {
      "type": "object",
      "description": "General description: The state, province, or administrative region where the company is located. For US addresses, should use full state names (e.g., 'California', 'New York') not abbreviations (e.g., 'CA', 'NY'). Should be standardized to proper case formatting.",
      "properties": {
        "currentValue": {
          "type": ["string", "null"],
          "description": "The current/original state or province name/abbreviation as it exists in the source data before cleaning"
        },
        "recommendedValue": {
          "type": ["string", "null"],
          "description": "The cleaned and standardized state/province name, with US state abbreviations expanded to full names, or null if the current value should be removed"
        },
        "reasoning": {
          "type": "string",
          "description": "Detailed explanation of what cleaning operations were performed, including expansion of abbreviations for US states and standardization"
        },
        "confidence": {
          "type": "string",
          "enum": ["LOW", "MEDIUM", "HIGH"],
          "description": "Confidence level in the cleaning recommendation. HIGH: clear, unambiguous cleaning with standard patterns. MEDIUM: reasonable assumptions made, multiple valid options existed. LOW: significant guesswork or uncertain transformations"
        },
        "recommendedAction": {
          "type": "string",
          "enum": ["ADD", "FIX", "REMOVE", "KEEP"],
          "description": "The type of action recommended. ADD: previously empty/null field now has a value. FIX: existing value was modified. REMOVE: existing value should be cleared. KEEP: value remains unchanged"
        }
      },
      "required": ["currentValue", "recommendedValue", "reasoning", "confidence", "recommendedAction"],
      "additionalProperties": false
    },
    "country": {
      "type": "object",
      "description": "General description: The primary country where the company is headquartered or registered. Should use common country names (e.g., 'United States', 'United Kingdom') not abbreviations or full official names. Can be enriched/inferred from state/province data when empty.",
      "properties": {
        "currentValue": {
          "type": ["string", "null"],
          "description": "The current/original country name or code as it exists in the source data before cleaning"
        },
        "recommendedValue": {
          "type": ["string", "null"],
          "description": "The cleaned and standardized country name using common naming conventions, or null if the current value should be removed"
        },
        "reasoning": {
          "type": "string",
          "description": "Detailed explanation of what cleaning operations were performed, including standardization to common country names and any enrichment from location context"
        },
        "confidence": {
          "type": "string",
          "enum": ["LOW", "MEDIUM", "HIGH"],
          "description": "Confidence level in the cleaning recommendation. HIGH: clear, unambiguous cleaning with standard patterns. MEDIUM: reasonable assumptions made, multiple valid options existed. LOW: significant guesswork or uncertain transformations"
        },
        "recommendedAction": {
          "type": "string",
          "enum": ["ADD", "FIX", "REMOVE", "KEEP"],
          "description": "The type of action recommended. ADD: previously empty/null field now has a value. FIX: existing value was modified. REMOVE: existing value should be cleared. KEEP: value remains unchanged"
        }
      },
      "required": ["currentValue", "recommendedValue", "reasoning", "confidence", "recommendedAction"],
      "additionalProperties": false
    },
    "continent": {
      "type": "object",
      "description": "General description: The continental region where the company is located (e.g., 'North America', 'Europe', 'Asia', 'South America', 'Africa', 'Oceania', 'Antarctica'). Should be standardized to proper case formatting and can be inferred from country data when empty.",
      "properties": {
        "currentValue": {
          "type": ["string", "null"],
          "description": "The current/original continent name as it exists in the source data before cleaning"
        },
        "recommendedValue": {
          "type": ["string", "null"],
          "description": "The cleaned and standardized continent name, or null if the current value should be removed"
        },
        "reasoning": {
          "type": "string",
          "description": "Detailed explanation of what cleaning operations were performed, including derivation from country data if applicable"
        },
        "confidence": {
          "type": "string",
          "enum": ["LOW", "MEDIUM", "HIGH"],
          "description": "Confidence level in the cleaning recommendation. HIGH: clear, unambiguous cleaning with standard patterns. MEDIUM: reasonable assumptions made, multiple valid options existed. LOW: significant guesswork or uncertain transformations"
        },
        "recommendedAction": {
          "type": "string",
          "enum": ["ADD", "FIX", "REMOVE", "KEEP"],
          "description": "The type of action recommended. ADD: previously empty/null field now has a value. FIX: existing value was modified. REMOVE: existing value should be cleared. KEEP: value remains unchanged"
        }
      },
      "required": ["currentValue", "recommendedValue", "reasoning", "confidence", "recommendedAction"],
      "additionalProperties": false
    },
    "municipality": {
      "type": "object",
      "description": "General description: Additional administrative subdivision below city level (e.g., borough, district, county), if applicable. Should be cleaned for proper case formatting and standardization. Only include if meaningful for the location.",
      "properties": {
        "currentValue": {
          "type": ["string", "null"],
          "description": "The current/original municipality name as it exists in the source data before cleaning"
        },
        "recommendedValue": {
          "type": ["string", "null"],
          "description": "The cleaned and standardized municipality name, or null if the current value should be removed"
        },
        "reasoning": {
          "type": "string",
          "description": "Detailed explanation of what cleaning operations were performed, including whether the municipality is meaningful for the location"
        },
        "confidence": {
          "type": "string",
          "enum": ["LOW", "MEDIUM", "HIGH"],
          "description": "Confidence level in the cleaning recommendation. HIGH: clear, unambiguous cleaning with standard patterns. MEDIUM: reasonable assumptions made, multiple valid options existed. LOW: significant guesswork or uncertain transformations"
        },
        "recommendedAction": {
          "type": "string",
          "enum": ["ADD", "FIX", "REMOVE", "KEEP"],
          "description": "The type of action recommended. ADD: previously empty/null field now has a value. FIX: existing value was modified. REMOVE: existing value should be cleared. KEEP: value remains unchanged"
        }
      },
      "required": ["currentValue", "recommendedValue", "reasoning", "confidence", "recommendedAction"],
      "additionalProperties": false
    },
    "domain": {
      "type": "object",
      "description": "General description: The primary domain name without protocol or subdomain (e.g., 'example.com'). Should be cleaned to extract from full URLs if needed, remove protocols and paths, and fix common typos. Test domains (e.g., 'example.com', 'test.com', 'demo.com') should be identified and removed.",
      "properties": {
        "currentValue": {
          "type": ["string", "null"],
          "description": "The current/original domain value as it exists in the source data before cleaning"
        },
        "recommendedValue": {
          "type": ["string", "null"],
          "description": "The cleaned domain without protocol or subdomain, or null if the current value should be removed"
        },
        "reasoning": {
          "type": "string",
          "description": "Detailed explanation of what cleaning operations were performed, including URL parsing and test domain identification"
        },
        "confidence": {
          "type": "string",
          "enum": ["LOW", "MEDIUM", "HIGH"],
          "description": "Confidence level in the cleaning recommendation. HIGH: clear, unambiguous cleaning with standard patterns. MEDIUM: reasonable assumptions made, multiple valid options existed. LOW: significant guesswork or uncertain transformations"
        },
        "recommendedAction": {
          "type": "string",
          "enum": ["ADD", "FIX", "REMOVE", "KEEP"],
          "description": "The type of action recommended. ADD: previously empty/null field now has a value. FIX: existing value was modified. REMOVE: existing value should be cleared. KEEP: value remains unchanged"
        }
      },
      "required": ["currentValue", "recommendedValue", "reasoning", "confidence", "recommendedAction"],
      "additionalProperties": false
    },
    "website": {
      "type": "object",
      "description": "General description: The primary website URL including protocol (e.g., 'https://www.example.com'). Should be cleaned to add missing protocols, remove trailing slashes, normalize URLs, and fix common typos. Test domains should be identified and removed.",
      "properties": {
        "currentValue": {
          "type": ["string", "null"],
          "description": "The current/original website URL value as it exists in the source data before cleaning"
        },
        "recommendedValue": {
          "type": ["string", "null"],
          "description": "The cleaned and standardized website URL with proper protocol, or null if the current value should be removed"
        },
        "reasoning": {
          "type": "string",
          "description": "Detailed explanation of what cleaning operations were performed, including URL transformations and validation"
        },
        "confidence": {
          "type": "string",
          "enum": ["LOW", "MEDIUM", "HIGH"],
          "description": "Confidence level in the cleaning recommendation. HIGH: clear, unambiguous cleaning with standard patterns. MEDIUM: reasonable assumptions made, multiple valid options existed. LOW: significant guesswork or uncertain transformations"
        },
        "recommendedAction": {
          "type": "string",
          "enum": ["ADD", "FIX", "REMOVE", "KEEP"],
          "description": "The type of action recommended. ADD: previously empty/null field now has a value. FIX: existing value was modified. REMOVE: existing value should be cleared. KEEP: value remains unchanged"
        }
      },
      "required": ["currentValue", "recommendedValue", "reasoning", "confidence", "recommendedAction"],
      "additionalProperties": false
    },
    "employees": {
      "type": "object",
      "description": "General description: The exact number of employees (e.g., '150', '1250'). Must be a specific number, not a range. Should be cleaned to ensure numeric format and remove any range indicators. Ranges should be moved to the size field instead.",
      "properties": {
        "currentValue": {
          "type": ["string", "number", "null"],
          "description": "The current/original employee count as it exists in the source data before cleaning"
        },
        "recommendedValue": {
          "type": ["string", "number", "null"],
          "description": "The cleaned exact employee number, or null if the current value should be removed or moved to size field"
        },
        "reasoning": {
          "type": "string",
          "description": "Detailed explanation of what cleaning operations were performed, including conversion to exact number and handling of ranges"
        },
        "confidence": {
          "type": "string",
          "enum": ["LOW", "MEDIUM", "HIGH"],
          "description": "Confidence level in the cleaning recommendation. HIGH: clear, unambiguous cleaning with standard patterns. MEDIUM: reasonable assumptions made, multiple valid options existed. LOW: significant guesswork or uncertain transformations"
        },
        "recommendedAction": {
          "type": "string",
          "enum": ["ADD", "FIX", "REMOVE", "KEEP"],
          "description": "The type of action recommended. ADD: previously empty/null field now has a value. FIX: existing value was modified. REMOVE: existing value should be cleared. KEEP: value remains unchanged"
        }
      },
      "required": ["currentValue", "recommendedValue", "reasoning", "confidence", "recommendedAction"],
      "additionalProperties": false
    },
    "size": {
      "type": "object",
      "description": "General description: Employee count ranges using standard brackets (e.g., '1-10', '11-50', '51-200', '201-500', '501-1000', '1001-5000', '5001-10000', '10001+'). Should be cleaned to standardize format and ensure proper categorization.",
      "properties": {
        "currentValue": {
          "type": ["string", "null"],
          "description": "The current/original size range as it exists in the source data before cleaning"
        },
        "recommendedValue": {
          "type": ["string", "null"],
          "description": "The cleaned and standardized size range, or null if the current value should be removed"
        },
        "reasoning": {
          "type": "string",
          "description": "Detailed explanation of what cleaning operations were performed, including standardization to proper brackets"
        },
        "confidence": {
          "type": "string",
          "enum": ["LOW", "MEDIUM", "HIGH"],
          "description": "Confidence level in the cleaning recommendation. HIGH: clear, unambiguous cleaning with standard patterns. MEDIUM: reasonable assumptions made, multiple valid options existed. LOW: significant guesswork or uncertain transformations"
        },
        "recommendedAction": {
          "type": "string",
          "enum": ["ADD", "FIX", "REMOVE", "KEEP"],
          "description": "The type of action recommended. ADD: previously empty/null field now has a value. FIX: existing value was modified. REMOVE: existing value should be cleared. KEEP: value remains unchanged"
        }
      },
      "required": ["currentValue", "recommendedValue", "reasoning", "confidence", "recommendedAction"],
      "additionalProperties": false
    },
    "region": {
      "type": "object",
      "description": "General description: Business region classification. Must be exactly one of: 'APAC' (Asia-Pacific), 'EMEA' (Europe, Middle East, Africa), 'NAM' (North America), or 'LATAM' (Latin America). Should be standardized and can be inferred from country data when empty.",
      "properties": {
        "currentValue": {
          "type": ["string", "null"],
          "description": "The current/original region code as it exists in the source data before cleaning"
        },
        "recommendedValue": {
          "type": ["string", "null"],
          "description": "The cleaned and standardized region code (APAC/EMEA/NAM/LATAM), or null if the current value should be removed"
        },
        "reasoning": {
          "type": "string",
          "description": "Detailed explanation of what cleaning operations were performed, including mapping to standard codes and inference from location"
        },
        "confidence": {
          "type": "string",
          "enum": ["LOW", "MEDIUM", "HIGH"],
          "description": "Confidence level in the cleaning recommendation. HIGH: clear, unambiguous cleaning with standard patterns. MEDIUM: reasonable assumptions made, multiple valid options existed. LOW: significant guesswork or uncertain transformations"
        },
        "recommendedAction": {
          "type": "string",
          "enum": ["ADD", "FIX", "REMOVE", "KEEP"],
          "description": "The type of action recommended. ADD: previously empty/null field now has a value. FIX: existing value was modified. REMOVE: existing value should be cleared. KEEP: value remains unchanged"
        }
      },
      "required": ["currentValue", "recommendedValue", "reasoning", "confidence", "recommendedAction"],
      "additionalProperties": false
    },
    "postalOrZipCode": {
      "type": "object",
      "description": "General description: The postal code or ZIP code for the company's address. Should be cleaned for proper formatting based on country standards (e.g., US ZIP codes, Canadian postal codes, UK postcodes). Invalid or placeholder codes should be identified.",
      "properties": {
        "currentValue": {
          "type": ["string", "null"],
          "description": "The current/original postal or ZIP code as it exists in the source data before cleaning"
        },
        "recommendedValue": {
          "type": ["string", "null"],
          "description": "The cleaned and standardized postal/ZIP code following country-specific formatting, or null if the current value should be removed"
        },
        "reasoning": {
          "type": "string",
          "description": "Detailed explanation of what cleaning operations were performed, including format standardization and validation"
        },
        "confidence": {
          "type": "string",
          "enum": ["LOW", "MEDIUM", "HIGH"],
          "description": "Confidence level in the cleaning recommendation. HIGH: clear, unambiguous cleaning with standard patterns. MEDIUM: reasonable assumptions made, multiple valid options existed. LOW: significant guesswork or uncertain transformations"
        },
        "recommendedAction": {
          "type": "string",
          "enum": ["ADD", "FIX", "REMOVE", "KEEP"],
          "description": "The type of action recommended. ADD: previously empty/null field now has a value. FIX: existing value was modified. REMOVE: existing value should be cleared. KEEP: value remains unchanged"
        }
      },
      "required": ["currentValue", "recommendedValue", "reasoning", "confidence", "recommendedAction"],
      "additionalProperties": false
    },
    "timezone": {
      "type": "object",
      "description": "General description: IANA timezone identifier for the company's primary location (e.g., 'America/New_York', 'Europe/London', 'Asia/Tokyo'). Should be cleaned to use proper IANA format and can be inferred from city/country data when empty.",
      "properties": {
        "currentValue": {
          "type": ["string", "null"],
          "description": "The current/original timezone value as it exists in the source data before cleaning"
        },
        "recommendedValue": {
          "type": ["string", "null"],
          "description": "The cleaned IANA timezone identifier, or null if the current value should be removed"
        },
        "reasoning": {
          "type": "string",
          "description": "Detailed explanation of what cleaning operations were performed, including standardization to IANA format and inference from location"
        },
        "confidence": {
          "type": "string",
          "enum": ["LOW", "MEDIUM", "HIGH"],
          "description": "Confidence level in the cleaning recommendation. HIGH: clear, unambiguous cleaning with standard patterns. MEDIUM: reasonable assumptions made, multiple valid options existed. LOW: significant guesswork or uncertain transformations"
        },
        "recommendedAction": {
          "type": "string",
          "enum": ["ADD", "FIX", "REMOVE", "KEEP"],
          "description": "The type of action recommended. ADD: previously empty/null field now has a value. FIX: existing value was modified. REMOVE: existing value should be cleared. KEEP: value remains unchanged"
        }
      },
      "required": ["currentValue", "recommendedValue", "reasoning", "confidence", "recommendedAction"],
      "additionalProperties": false
    },
    "linkedIn": {
      "type": "object",
      "description": "General description: The full URL to the company's official LinkedIn page (e.g., 'https://www.linkedin.com/company/companyname'). Should be cleaned to standardize URL format, add missing protocols, and ensure proper LinkedIn URL structure.",
      "properties": {
        "currentValue": {
          "type": ["string", "null"],
          "description": "The current/original LinkedIn URL or handle as it exists in the source data before cleaning"
        },
        "recommendedValue": {
          "type": ["string", "null"],
          "description": "The cleaned and standardized LinkedIn URL, or null if the current value should be removed"
        },
        "reasoning": {
          "type": "string",
          "description": "Detailed explanation of what cleaning operations were performed, including URL standardization and validation"
        },
        "confidence": {
          "type": "string",
          "enum": ["LOW", "MEDIUM", "HIGH"],
          "description": "Confidence level in the cleaning recommendation. HIGH: clear, unambiguous cleaning with standard patterns. MEDIUM: reasonable assumptions made, multiple valid options existed. LOW: significant guesswork or uncertain transformations"
        },
        "recommendedAction": {
          "type": "string",
          "enum": ["ADD", "FIX", "REMOVE", "KEEP"],
          "description": "The type of action recommended. ADD: previously empty/null field now has a value. FIX: existing value was modified. REMOVE: existing value should be cleared. KEEP: value remains unchanged"
        }
      },
      "required": ["currentValue", "recommendedValue", "reasoning", "confidence", "recommendedAction"],
      "additionalProperties": false
    },
    "facebook": {
      "type": "object",
      "description": "General description: The full URL to the company's official Facebook page (e.g., 'https://www.facebook.com/companyname'). Should be cleaned to standardize URL format, add missing protocols, and ensure proper Facebook URL structure.",
      "properties": {
        "currentValue": {
          "type": ["string", "null"],
          "description": "The current/original Facebook URL or handle as it exists in the source data before cleaning"
        },
        "recommendedValue": {
          "type": ["string", "null"],
          "description": "The cleaned and standardized Facebook URL, or null if the current value should be removed"
        },
        "reasoning": {
          "type": "string",
          "description": "Detailed explanation of what cleaning operations were performed, including URL standardization and validation"
        },
        "confidence": {
          "type": "string",
          "enum": ["LOW", "MEDIUM", "HIGH"],
          "description": "Confidence level in the cleaning recommendation. HIGH: clear, unambiguous cleaning with standard patterns. MEDIUM: reasonable assumptions made, multiple valid options existed. LOW: significant guesswork or uncertain transformations"
        },
        "recommendedAction": {
          "type": "string",
          "enum": ["ADD", "FIX", "REMOVE", "KEEP"],
          "description": "The type of action recommended. ADD: previously empty/null field now has a value. FIX: existing value was modified. REMOVE: existing value should be cleared. KEEP: value remains unchanged"
        }
      },
      "required": ["currentValue", "recommendedValue", "reasoning", "confidence", "recommendedAction"],
      "additionalProperties": false
    },
    "instagram": {
      "type": "object",
      "description": "General description: The full URL to the company's official Instagram account (e.g., 'https://www.instagram.com/companyname'). Should be cleaned to standardize URL format, add missing protocols, and ensure proper Instagram URL structure.",
      "properties": {
        "currentValue": {
          "type": ["string", "null"],
          "description": "The current/original Instagram URL or handle as it exists in the source data before cleaning"
        },
        "recommendedValue": {
          "type": ["string", "null"],
          "description": "The cleaned and standardized Instagram URL, or null if the current value should be removed"
        },
        "reasoning": {
          "type": "string",
          "description": "Detailed explanation of what cleaning operations were performed, including URL standardization and validation"
        },
        "confidence": {
          "type": "string",
          "enum": ["LOW", "MEDIUM", "HIGH"],
          "description": "Confidence level in the cleaning recommendation. HIGH: clear, unambiguous cleaning with standard patterns. MEDIUM: reasonable assumptions made, multiple valid options existed. LOW: significant guesswork or uncertain transformations"
        },
        "recommendedAction": {
          "type": "string",
          "enum": ["ADD", "FIX", "REMOVE", "KEEP"],
          "description": "The type of action recommended. ADD: previously empty/null field now has a value. FIX: existing value was modified. REMOVE: existing value should be cleared. KEEP: value remains unchanged"
        }
      },
      "required": ["currentValue", "recommendedValue", "reasoning", "confidence", "recommendedAction"],
      "additionalProperties": false
    },
    "twitter": {
      "type": "object",
      "description": "General description: The full URL to the company's official Twitter/X account (e.g., 'https://twitter.com/companyname' or 'https://x.com/companyname'). Should be cleaned to standardize URL format, add missing protocols, and ensure proper Twitter/X URL structure.",
      "properties": {
        "currentValue": {
          "type": ["string", "null"],
          "description": "The current/original Twitter/X URL or handle as it exists in the source data before cleaning"
        },
        "recommendedValue": {
          "type": ["string", "null"],
          "description": "The cleaned and standardized Twitter/X URL, or null if the current value should be removed"
        },
        "reasoning": {
          "type": "string",
          "description": "Detailed explanation of what cleaning operations were performed, including URL standardization and validation"
        },
        "confidence": {
          "type": "string",
          "enum": ["LOW", "MEDIUM", "HIGH"],
          "description": "Confidence level in the cleaning recommendation. HIGH: clear, unambiguous cleaning with standard patterns. MEDIUM: reasonable assumptions made, multiple valid options existed. LOW: significant guesswork or uncertain transformations"
        },
        "recommendedAction": {
          "type": "string",
          "enum": ["ADD", "FIX", "REMOVE", "KEEP"],
          "description": "The type of action recommended. ADD: previously empty/null field now has a value. FIX: existing value was modified. REMOVE: existing value should be cleared. KEEP: value remains unchanged"
        }
      },
      "required": ["currentValue", "recommendedValue", "reasoning", "confidence", "recommendedAction"],
      "additionalProperties": false
    }
  },
  "required": [],
  "additionalProperties": false
}

interface CompanyInput {
  company: Record<string, unknown>
  cleanRules?: string
  cleanPropertyRules?: Record<string, string>
}

function buildDynamicSchema(input: CompanyInput) {
  // Deep clone the base schema
  const schema = JSON.parse(JSON.stringify(BASE_SCHEMA))

  // Update top-level description with cleanRules if provided
  if (input.cleanRules) {
    schema.description = `${schema.description}\n\nIMPORTANT: Always prioritize the user-provided instructions below over the general description above.\n\nUser instructions: ${input.cleanRules}`
  }

  // Add user-specific property rules if provided
  if (input.cleanPropertyRules) {
    for (const [key, userRule] of Object.entries(input.cleanPropertyRules)) {
      // Only add rules for properties that exist in the base schema
      if (schema.properties[key]) {
        const currentDescription = schema.properties[key].description
        schema.properties[key].description = `${currentDescription}\n\nIMPORTANT: Always prioritize the user-provided instructions below over the general description above.\n\nUser instructions: ${userRule}`
      }
    }
  }

  // For OpenAI strict mode, all properties must be in the required array
  schema.required = Object.keys(schema.properties)

  return schema
}

export async function POST(req: NextRequest) {
  let userId: string | undefined

  try {
    // Get API key from header
    const apiKey = req.headers.get("x-api-key")

    if (!apiKey) {
      return NextResponse.json(
        { error: "API key is required" },
        { status: 401 }
      )
    }

    // Parse request body
    let body: CompanyInput
    try {
      body = await req.json() as CompanyInput
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON in request body" },
        { status: 400 }
      )
    }

    // Validate request body structure
    if (!body.company || typeof body.company !== 'object') {
      return NextResponse.json(
        { error: "Request body must include a 'company' object" },
        { status: 400 }
      )
    }

    // Check that at least one company property is provided
    const companyKeys = Object.keys(body.company)
    if (companyKeys.length === 0) {
      return NextResponse.json(
        { error: "Company object must contain at least one property" },
        { status: 400 }
      )
    }

    // Validate API key and get user
    const keyRecord = await prisma.apiKey.findUnique({
      where: { key: apiKey },
      include: {
        user: {
          select: {
            id: true
          }
        }
      }
    })

    if (!keyRecord) {
      return NextResponse.json(
        { error: "Invalid API key" },
        { status: 401 }
      )
    }

    userId = keyRecord.user.id

    // Check rate limits BEFORE doing anything else
    const rateLimitResult = await checkRateLimit(userId, "clean-endpoint")

    if (!rateLimitResult.allowed) {
      const resetDate = new Date(rateLimitResult.reset!)
      return NextResponse.json(
        {
          error: `Rate limit exceeded (${rateLimitResult.limitType})`,
          limit: rateLimitResult.limit,
          remaining: rateLimitResult.remaining,
          reset: resetDate.toISOString()
        },
        {
          status: 429,
          headers: {
            'X-RateLimit-Limit': rateLimitResult.limit!.toString(),
            'X-RateLimit-Remaining': rateLimitResult.remaining!.toString(),
            'X-RateLimit-Reset': resetDate.toISOString()
          }
        }
      )
    }

    // Check feature access with Autumn
    const featureAccess = await checkFeatureAccess(userId, "company-cleaning")

    if (!featureAccess.allowed) {
      return NextResponse.json(
        {
          error: "Feature access denied. Please upgrade your plan or purchase additional credits.",
          remaining: featureAccess.remaining,
          limit: featureAccess.limit
        },
        { status: 402 }
      )
    }

    // Build the dynamic schema based on input
    const dynamicSchema = buildDynamicSchema(body)

    // Call OpenAI with structured output
    let cleanedData
    try {
      cleanedData = await callOpenAIWithStructuredOutput(body.company, dynamicSchema)
    } catch (openaiError) {
      console.error("OpenAI error:", openaiError)
      const details = openaiError instanceof Error ? openaiError.message : "Unknown error"

      return NextResponse.json(
        { error: "Failed to process company data", details },
        { status: 500 }
      )
    }

    // Success! Track usage with Autumn
    try {
      await trackFeatureUsage(userId, "company-cleaning", 1)
    } catch (trackError) {
      console.error("Failed to track usage with Autumn:", trackError)
      // Continue - don't fail the request if tracking fails
    }

    // Update API key last used
    await prisma.apiKey.update({
      where: { id: keyRecord.id },
      data: {
        lastUsed: new Date()
      }
    })

    return NextResponse.json({
      data: cleanedData,
      remaining: featureAccess.remaining ? featureAccess.remaining - 1 : undefined
    })

  } catch (error) {
    console.error("API error:", error)

    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}
