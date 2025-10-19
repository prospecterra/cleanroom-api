# Deploying Autumn Edge Function to Supabase

For **production**, you need to deploy the Autumn Edge Function to Supabase. For **local development**, the app uses a Next.js API route at `/api/autumn` instead (no deployment needed).

## Why Two Approaches?

| Environment | Autumn Backend | Why |
|-------------|----------------|-----|
| **Local Dev** | Next.js API route (`/api/autumn`) | No deployment needed, easier debugging |
| **Production** | Supabase Edge Function | Better performance, globally distributed |

---

## Local Development (No Setup Needed)

The app automatically uses `/api/autumn/[...path]` route in development:
- ✅ No Edge Function deployment needed
- ✅ Runs on your Next.js server
- ✅ Uses your local `AUTUMN_SECRET_KEY`
- ✅ Works with Supabase Auth session

**Just run:**
```bash
npm run dev
```

---

## Production Deployment (Required for Vercel/Production)

### Prerequisites

1. **Supabase CLI installed:**
```bash
npm install -g supabase
```

2. **Login to Supabase:**
```bash
supabase login
```

3. **Link your project:**
```bash
supabase link --project-ref nqgaooprvgrmkvfslofh
```

---

### Step 1: Deploy the Edge Function

From your project root:

```bash
cd /Users/eliasstravik/dev/cleanroom-api/api-platform

# Deploy the function
supabase functions deploy autumn --no-verify-jwt
```

**Expected output:**
```
Deploying function autumn...
Deployed function autumn on project nqgaooprvgrmkvfslofh
```

---

### Step 2: Set Environment Secrets

The Edge Function needs access to your Autumn secret key:

```bash
# Set production Autumn key
supabase secrets set AUTUMN_SECRET_KEY=am_sk_live_your_production_key

# Or for testing
supabase secrets set AUTUMN_SECRET_KEY=am_sk_test_iQklY6eSshdVAHvYqfqaLbI2DjTNYB0TumrTVfeSyO
```

**Verify secrets:**
```bash
supabase secrets list
```

---

### Step 3: Test the Edge Function

```bash
# Get your Supabase anon key
export SUPABASE_ANON_KEY="sb_publishable_vTfC2E6_tacYWi6OcHPCdw_ICfusiQh"

# Test the function
curl -i https://nqgaooprvgrmkvfslofh.supabase.co/functions/v1/autumn/api/autumn/products \
  -H "Authorization: Bearer $SUPABASE_ANON_KEY"
```

**Expected response:**
- Status: `200 OK` or `401 Unauthorized` (if not logged in)
- Should NOT be `404 Not Found`

---

### Step 4: Update Environment Variables (Production Only)

When deploying to Vercel/production, the app automatically uses the Edge Function instead of the local route.

No additional environment variables needed - it uses:
- `NEXT_PUBLIC_SUPABASE_URL` (already set)
- The Edge Function at `/functions/v1/autumn`

---

## Troubleshooting

### "Function not found" (404)

**Cause:** Edge Function not deployed

**Fix:**
```bash
supabase functions deploy autumn --no-verify-jwt
```

---

### "Unauthorized" (401)

**Cause:** Missing or invalid Autumn secret key

**Fix:**
```bash
# Check secrets
supabase secrets list

# Set the secret
supabase secrets set AUTUMN_SECRET_KEY=am_sk_test_...
```

---

### CORS errors in browser

**Cause:** Edge Function CORS headers missing

**Fix:** Already fixed in `/supabase/functions/autumn/index.ts`

The Edge Function includes:
```typescript
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}
```

---

### "Customer not created" in Autumn

**Cause:** User info not being passed correctly

**Fix:** Check the Edge Function logs:
```bash
supabase functions logs autumn --tail
```

The Edge Function should pass:
- `customerId`: Supabase user ID
- `customerData.email`: User's email
- `customerData.name`: User's name

---

## Viewing Logs

```bash
# Real-time logs
supabase functions logs autumn --tail

# Recent logs
supabase functions logs autumn
```

---

## Updating the Edge Function

After making changes to `/supabase/functions/autumn/index.ts`:

```bash
# Redeploy
supabase functions deploy autumn --no-verify-jwt

# Check logs
supabase functions logs autumn --tail
```

---

## Local Testing with Supabase CLI (Optional)

You can test Edge Functions locally with Supabase CLI:

```bash
# Start Supabase locally (includes Edge Functions)
supabase start

# Deploy function to local instance
supabase functions deploy autumn --no-verify-jwt

# Test locally
curl http://localhost:54321/functions/v1/autumn/api/autumn/products \
  -H "Authorization: Bearer <local-anon-key>"
```

**But for this project, it's easier to just use the Next.js API route in development!**

---

## Deployment Checklist

For production deployment:

- [ ] Supabase CLI installed: `npm install -g supabase`
- [ ] Logged in: `supabase login`
- [ ] Project linked: `supabase link --project-ref nqgaooprvgrmkvfslofh`
- [ ] Edge Function deployed: `supabase functions deploy autumn`
- [ ] Autumn secret set: `supabase secrets set AUTUMN_SECRET_KEY=am_sk_live_...`
- [ ] Tested: `curl https://nqgaooprvgrmkvfslofh.supabase.co/functions/v1/autumn/...`
- [ ] Logs checked: `supabase functions logs autumn`
- [ ] Deployed Next.js app to Vercel
- [ ] Verified Autumn integration works in production

---

## Quick Reference

```bash
# Deploy
supabase functions deploy autumn --no-verify-jwt

# Set secret
supabase secrets set AUTUMN_SECRET_KEY=your_key

# View logs
supabase functions logs autumn --tail

# Delete (if needed)
supabase functions delete autumn
```

---

## Cost

Supabase Edge Functions are included in the free tier:
- **Free tier**: 500K function invocations/month
- **Beyond free tier**: $2 per 1M invocations

For most applications, you'll stay within the free tier.
