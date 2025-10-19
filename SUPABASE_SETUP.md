# Supabase + Autumn Integration Setup

This guide covers setting up Supabase Auth with Autumn billing for your API platform.

## Prerequisites

- Supabase account (free tier available)
- Autumn account at [useautumn.com](https://useautumn.com)

## 1. Create Supabase Project

### Option A: Production Setup

1. Go to [app.supabase.com](https://app.supabase.com)
2. Click "New Project"
3. Fill in:
   - **Name**: api-platform (or your choice)
   - **Database Password**: Generate a strong password
   - **Region**: Choose closest to your users
4. Wait for project to be created (~2 minutes)

### Option B: Local Development (Optional)

For local development, you can use **Supabase CLI** to run Supabase locally:

```bash
# Install Supabase CLI
npm install -g supabase

# Initialize Supabase in your project
supabase init

# Start local Supabase (Docker required)
supabase start
```

This gives you:
- Local Postgres database
- Local Auth server
- Local Edge Functions
- Separate from production data

**Note**: Each environment (local, staging, production) has its own API keys.

---

## 2. Get Your API Keys

### From Supabase Dashboard:

1. Go to **Project Settings** → **API**
2. Copy these values:

```bash
# Project URL
NEXT_PUBLIC_SUPABASE_URL=https://<project-id>.supabase.co

# Anon/Public Key (safe for client-side)
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGc...

# Service Role Key (NEVER expose to client!)
SUPABASE_SERVICE_ROLE_KEY=eyJhbGc...
```

### For Local Development:

If using `supabase start`, it will print:
```
API URL: http://localhost:54321
Anon key: eyJhbGc...
Service role key: eyJhbGc...
```

---

## 3. Configure Environment Variables

Create/update your `.env` file:

```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL="https://<project-id>.supabase.co"
NEXT_PUBLIC_SUPABASE_ANON_KEY="eyJhbGc..."

# For local dev, use:
# NEXT_PUBLIC_SUPABASE_URL="http://localhost:54321"
# NEXT_PUBLIC_SUPABASE_ANON_KEY="<local-anon-key>"

# PostgreSQL (Prisma)
DATABASE_URL="postgresql://postgres:your-password@db.<project-id>.supabase.co:5432/postgres"

# For local dev, use:
# DATABASE_URL="postgresql://postgres:postgres@localhost:54322/postgres"

# Autumn
AUTUMN_SECRET_KEY="am_sk_test_..."  # Test key for development
# AUTUMN_SECRET_KEY="am_sk_live_..."  # Live key for production

# OpenAI (for company cleaning API)
OPENAI_API_KEY="sk-proj-..."

# Upstash Redis (for rate limiting)
UPSTASH_REDIS_REST_URL="..."
UPSTASH_REDIS_REST_TOKEN="..."
```

---

## 4. Deploy Supabase Edge Function (Autumn Integration)

The Edge Function at `/supabase/functions/autumn/index.ts` handles Autumn billing.

### Deploy to Supabase:

```bash
# Install Supabase CLI if you haven't
npm install -g supabase

# Login to Supabase
supabase login

# Link your project
supabase link --project-ref <project-id>

# Deploy the edge function
supabase functions deploy autumn --no-verify-jwt

# Set the Autumn secret in Supabase
supabase secrets set AUTUMN_SECRET_KEY=am_sk_test_your_key
```

### Verify Deployment:

```bash
# Test the function
curl -i https://<project-id>.supabase.co/functions/v1/autumn \
  -H "Authorization: Bearer <your-anon-key>"
```

---

## 5. Run Database Migrations

Since we still use Prisma for API keys and transactions:

```bash
# Generate Prisma client
npx prisma generate

# Push schema to Supabase Postgres
npx prisma db push

# Or create/run migrations
npx prisma migrate dev --name init
```

**Note**: User authentication data is stored in Supabase's `auth.users` table, but API keys are stored in your Prisma schema.

---

## 6. Configure Autumn

In [Autumn Dashboard](https://app.useautumn.com):

1. **Create Feature**:
   - ID: `api_credits`
   - Name: API Credits
   - Type: Single-use credits

2. **Create Products** (examples):
   - Free: 100 credits/month
   - Starter: 1000 credits/month ($9.99)
   - Pro: 10000 credits/month ($49.99)
   - Pay-as-you-go packs: 100, 500, 1000 credits

3. **Connect Stripe**:
   - Go to Settings → Integrations
   - Connect your Stripe account
   - Products will sync automatically

---

## 7. Development vs Production Keys

### Development Mode

**Supabase**:
- Each project has its own keys
- Create a separate "Development" project in Supabase
- Use `supabase start` for fully local development

**Autumn**:
- Use test keys: `am_sk_test_...`
- Test mode in Stripe (use test cards)

### Production Mode

**Supabase**:
- Separate "Production" project with different keys
- Configure in Vercel/deployment platform environment variables

**Autumn**:
- Use live keys: `am_sk_live_...`
- Live mode in Stripe (real payments)

### Environment Strategy

```
Local Dev:
- Supabase local (via supabase CLI) or dev project
- Autumn test keys
- Stripe test mode

Staging:
- Supabase staging project
- Autumn test keys
- Stripe test mode

Production:
- Supabase production project
- Autumn live keys
- Stripe live mode
```

---

## 8. Testing the Integration

### Test Signup:
```bash
curl -X POST http://localhost:3000/auth/signup \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "password123",
    "name": "Test User"
  }'
```

### Verify in Supabase Dashboard:
1. Go to **Authentication** → **Users**
2. You should see the new user
3. User metadata should include `name`

### Test API with Credits:
```bash
# Create API key first via dashboard
# Then:
curl -X GET http://localhost:3000/api/v1/hello \
  -H "x-api-key: YOUR_API_KEY"
```

---

## 9. Deployment Checklist

- [ ] Create production Supabase project
- [ ] Deploy Edge Function to production
- [ ] Set `AUTUMN_SECRET_KEY` in Supabase secrets
- [ ] Update `.env` with production Supabase keys
- [ ] Run `npx prisma migrate deploy` in production
- [ ] Switch Autumn to live keys
- [ ] Test signup/signin flow
- [ ] Test API key creation
- [ ] Test credit purchases
- [ ] Test API usage with credits

---

## Troubleshooting

### "Invalid API key" errors
- Check that `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` are set
- Verify keys are for the correct project (dev vs prod)

### Edge Function 404
- Redeploy: `supabase functions deploy autumn`
- Check function name matches in `providers.tsx`

### Credits not tracking
- Verify Edge Function has `AUTUMN_SECRET_KEY` set
- Check Autumn dashboard for customer creation
- Check Edge Function logs: `supabase functions logs autumn`

### Users not saving
- Check Supabase Auth is enabled (it is by default)
- Verify `DATABASE_URL` points to correct database
- Check Prisma migrations ran: `npx prisma migrate status`

---

## Resources

- [Supabase Documentation](https://supabase.com/docs)
- [Supabase Auth](https://supabase.com/docs/guides/auth)
- [Supabase Edge Functions](https://supabase.com/docs/guides/functions)
- [Autumn Documentation](https://docs.useautumn.com)
- [Autumn + Supabase Guide](https://docs.useautumn.com/setup/ai-builders)
