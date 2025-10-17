# Autumn Integration Setup Guide

This document outlines the steps needed to complete the Autumn billing integration for this API platform.

## Overview

The application has been migrated from a custom credit system + Stripe integration to **Autumn** (useautumn.com), which provides:
- User-level billing and subscription management
- Usage-based tracking with credits
- Stripe integration (managed by Autumn)
- BetterAuth integration for seamless authentication

## What's Been Done

### 1. Dependencies Installed
- `autumn-js` - Autumn SDK for JavaScript/TypeScript
- `better-auth` - Modern authentication library with Autumn plugin support

### 2. Database Schema Updated
- Added BetterAuth required models: `Account`, `Session`, `VerificationToken`
- Updated `User` model to support BetterAuth fields (`emailVerified`, `image`, etc.)
- Kept legacy `credits` and `creditsReserved` fields (set to default 0) for backward compatibility

### 3. Authentication System Migrated
- **Created** `/lib/better-auth.ts` - BetterAuth configuration with Autumn plugin
- **Created** `/app/api/auth/better-auth/[...all]/route.ts` - BetterAuth API handler
- **Created** `/app/api/autumn/[...all]/route.ts` - Autumn API handler for billing operations
- **Updated** `/app/api/auth/signup/route.ts` - Now uses BetterAuth for signup
- **Kept** `/app/api/auth/[...nextauth]/route.ts` - Legacy NextAuth route (can be removed after testing)

### 4. API Endpoints Updated
- **Created** `/lib/autumn.ts` - Autumn helper functions for feature access and usage tracking
- **Updated** `/app/api/v1/companies/clean/route.ts`:
  - Removed credit reservation/deduction logic
  - Added Autumn `checkFeatureAccess()` before processing
  - Added Autumn `trackFeatureUsage()` after successful completion
  - Removed transaction creation in database

### 5. Removed Stripe Integration
- Deleted `/app/api/billing/webhook/route.ts`
- Deleted `/app/api/billing/create-checkout/route.ts`
- Stripe is now managed entirely through Autumn's dashboard

## What You Need to Do in Autumn Dashboard

### Step 1: Create a Feature

1. Go to [Autumn Dashboard](https://app.useautumn.com/)
2. Navigate to **Features**
3. Create a new feature with:
   - **Feature ID**: `company-cleaning`
   - **Name**: Company Data Cleaning
   - **Description**: AI-powered company data cleaning and standardization
   - **Type**: Usage-based (pay per use) or Quota-based (monthly limit)

### Step 2: Create Products

Create subscription products that grant access to the feature:

#### Example: Free Tier
- **Product Name**: Free
- **Price**: $0/month
- **Features**:
  - `company-cleaning`: 10 requests/month (quota)

#### Example: Pro Tier
- **Product Name**: Pro
- **Price**: $29/month
- **Features**:
  - `company-cleaning`: 1000 requests/month (quota)

#### Example: Pay-Per-Use
- **Product Name**: Pay-Per-Use Credits
- **Price**: $10 for 1000 credits
- **Type**: One-time purchase
- **Features**:
  - `company-cleaning`: 1000 requests (credit-based)

### Step 3: Configure Stripe

1. In Autumn Dashboard, go to **Settings** → **Integrations**
2. Connect your Stripe account
3. Autumn will automatically create products in Stripe
4. Configure webhook endpoints (Autumn handles this automatically)

### Step 4: Test the Integration

Use the test scenarios below to verify everything works.

## Environment Variables

The following environment variables are configured:

```bash
# BetterAuth
BETTER_AUTH_SECRET="your-secret-key-change-this-in-production"
BETTER_AUTH_URL="http://localhost:3000"
NEXT_PUBLIC_BETTER_AUTH_URL="http://localhost:3000"

# Autumn
AUTUMN_SECRET_KEY="am_sk_live_BOLs9kOksoiUkHYRF4wMYzaeKe1pKTZ6qH5GnTcpK2"
```

**Important**: Update `BETTER_AUTH_SECRET` with a secure random string for production.

## API Flow with Autumn

### 1. User Signs Up
```typescript
POST /api/auth/signup
{
  "email": "user@example.com",
  "password": "securepassword",
  "name": "John Doe"
}
```

BetterAuth creates the user, and Autumn automatically creates a customer record.

### 2. User Subscribes to a Plan
Frontend should use Autumn's React components:

```tsx
import { AttachDialog } from "autumn-js/react";

<AttachDialog productId="pro-plan-id" />
```

This opens Autumn's checkout flow, which uses Stripe under the hood.

### 3. User Makes API Request
```bash
curl -X POST http://localhost:3000/api/v1/companies/clean \
  -H "Content-Type: application/json" \
  -H "x-api-key: YOUR_API_KEY" \
  -d '{
    "company": {
      "name": "acme corp",
      "city": "NEW YORK"
    }
  }'
```

The endpoint:
1. Validates API key
2. Checks rate limits
3. **Calls Autumn to check feature access** (`checkFeatureAccess`)
4. Processes the request with OpenAI
5. **Tracks usage in Autumn** (`trackFeatureUsage`)
6. Returns cleaned data with remaining quota

### 4. Check Usage and Billing
Users can:
- View usage: Autumn automatically tracks this
- Manage subscriptions: Use Autumn's `BillingPortal` component
- Purchase more credits: Use Autumn's `AttachDialog` component

## Testing the Integration

### Test 1: Create a User
```bash
curl -X POST http://localhost:3000/api/auth/signup \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "testpassword123",
    "name": "Test User"
  }'
```

### Test 2: Verify Feature Access Denial (No Subscription)
```bash
curl -X POST http://localhost:3000/api/v1/companies/clean \
  -H "Content-Type: application/json" \
  -H "x-api-key: YOUR_API_KEY" \
  -d '{
    "company": {
      "name": "test company"
    }
  }'
```

Expected response: `402 Payment Required` - Feature access denied

### Test 3: Subscribe to a Plan
Use Autumn's dashboard or frontend components to subscribe the user to a plan.

### Test 4: Verify Feature Access Success
Run the same API request from Test 2. It should now succeed and return cleaned data.

### Test 5: Track Usage Limits
Make multiple requests until you hit the quota. The API should return a 402 error when the limit is reached.

## Frontend Integration (TODO)

To complete the frontend integration, you'll need to:

### 1. Add AutumnProvider
```tsx
// app/layout.tsx
import { AutumnProvider } from "autumn-js/react";

export default function RootLayout({ children }) {
  return (
    <html>
      <body>
        <AutumnProvider betterAuthUrl={process.env.NEXT_PUBLIC_BETTER_AUTH_URL}>
          {children}
        </AutumnProvider>
      </body>
    </html>
  );
}
```

### 2. Add Billing Components
```tsx
import { AttachDialog, BillingPortal, UsageWidget } from "autumn-js/react";

// Show subscription options
<AttachDialog productId="pro-plan-id" />

// Show billing portal for managing subscriptions
<BillingPortal />

// Show current usage
<UsageWidget featureId="company-cleaning" />
```

### 3. Check Feature Access Client-Side
```tsx
import { useAutumn } from "autumn-js/react";

function MyComponent() {
  const { check } = useAutumn();
  const { allowed, remaining } = check({ featureId: "company-cleaning" });

  if (!allowed) {
    return <AttachDialog productId="pro-plan-id" />;
  }

  return <div>Remaining: {remaining}</div>;
}
```

## Migration Notes

### Legacy Credit System
The old `credits` and `creditsReserved` fields in the User model have been kept for backward compatibility but are no longer used. They default to 0 for new users.

The `Transaction` model and enum are also kept for historical data but won't be created for new API calls.

After confirming the Autumn integration works correctly, you can:
1. Create a migration to remove these fields
2. Remove the Transaction model if no longer needed for reporting

### NextAuth to BetterAuth
The old NextAuth route at `/api/auth/[...nextauth]/route.ts` is still present. After testing that BetterAuth works correctly:
1. Update frontend to use BetterAuth endpoints
2. Delete the NextAuth route and `/lib/auth.ts`
3. Remove `next-auth` from package.json

### Stripe Environment Variables
The following Stripe env vars are no longer used and can be removed:
- `STRIPE_SECRET_KEY`
- `STRIPE_PUBLISHABLE_KEY`
- `STRIPE_WEBHOOK_SECRET`

Autumn manages Stripe integration through its own dashboard.

## Troubleshooting

### Issue: "Feature access denied" even with active subscription
- **Solution**: Verify the feature ID in Autumn dashboard matches `"company-cleaning"`
- Check that the user has an active subscription in Autumn dashboard

### Issue: Usage not being tracked
- **Solution**: Check server logs for Autumn API errors
- Verify `AUTUMN_SECRET_KEY` is correct
- Ensure Autumn handler is mounted at `/api/autumn/[...all]`

### Issue: Authentication not working
- **Solution**: Verify BetterAuth is properly configured
- Check that `BETTER_AUTH_SECRET` and `BETTER_AUTH_URL` are set
- Ensure database schema includes BetterAuth models

## Resources

- [Autumn Documentation](https://docs.useautumn.com/)
- [BetterAuth Documentation](https://www.better-auth.com/docs)
- [Autumn + BetterAuth Plugin](https://www.better-auth.com/docs/plugins/autumn)
- [Autumn Dashboard](https://app.useautumn.com/)

## Support

For Autumn-specific issues, contact their support or check their documentation.
For application-specific issues, refer to the main README.md.
