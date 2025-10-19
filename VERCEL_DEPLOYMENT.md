# Deploying to Vercel

This guide covers deploying your API platform to Vercel with Supabase Auth and Autumn billing.

## Prerequisites

- Vercel account (free tier available)
- Supabase project (production)
- Autumn account with products configured

## 1. Prepare Your Project

### Update Supabase Edge Function URL

In your production environment, the Autumn Edge Function needs to be deployed. Make sure you've deployed it:

```bash
supabase functions deploy autumn --no-verify-jwt
supabase secrets set AUTUMN_SECRET_KEY=am_sk_live_your_production_key
```

## 2. Deploy to Vercel

### Option A: Deploy via CLI

```bash
# Install Vercel CLI
npm i -g vercel

# Login
vercel login

# Deploy
vercel

# Follow prompts to create new project
```

### Option B: Deploy via GitHub

1. Push your code to GitHub
2. Go to [vercel.com](https://vercel.com)
3. Click "Add New" → "Project"
4. Import your GitHub repository
5. Vercel will auto-detect Next.js

## 3. Set Environment Variables

In Vercel Dashboard → Settings → Environment Variables, add:

### Required Variables:

```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://nqgaooprvgrmkvfslofh.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_...

# Database (Supabase Postgres)
DATABASE_URL=postgresql://postgres:[PASSWORD]@db.nqgaooprvgrmkvfslofh.supabase.co:5432/postgres

# Autumn (PRODUCTION KEYS!)
AUTUMN_SECRET_KEY=am_sk_live_your_production_key

# OpenAI
OPENAI_API_KEY=sk-proj-...
```

### Optional (Old/Unused):
```bash
# These are not needed anymore:
# NEXTAUTH_SECRET (removed - using Supabase)
# BETTER_AUTH_SECRET (removed - using Supabase)
# STRIPE_* (removed - using Autumn)
```

## 4. Add Vercel KV for Rate Limiting

This is **optional** but recommended for production rate limiting.

### Setup:

1. Go to Vercel Dashboard → **Storage** tab
2. Click **Create Database**
3. Select **KV** (Redis)
4. Name it: `api-platform-kv`
5. Click **Create**

Vercel automatically adds these environment variables:
- `KV_REST_API_URL`
- `KV_REST_API_TOKEN`
- `KV_REST_API_READ_ONLY_TOKEN`

**Local Development:**
- If KV env vars are missing, the app uses in-memory rate limiting
- This works fine for local dev, no setup needed

## 5. Run Database Migrations

After deploying, run migrations in production:

```bash
# Option A: Via Vercel CLI
vercel env pull .env.production
npx prisma migrate deploy

# Option B: Add to Build Command (recommended)
# In Vercel Dashboard → Settings → Build & Development Settings
# Build Command: npm run build && npx prisma migrate deploy
```

Or add a postbuild script to `package.json`:

```json
{
  "scripts": {
    "postbuild": "prisma generate && prisma migrate deploy"
  }
}
```

## 6. Verify Deployment

Test your deployed app:

### Test Authentication:
```bash
curl -X POST https://your-app.vercel.app/api/auth/signup \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"test123","name":"Test"}'
```

### Test API:
```bash
# Create API key via dashboard first
curl https://your-app.vercel.app/api/v1/hello \
  -H "x-api-key: YOUR_API_KEY"
```

## 7. Custom Domain (Optional)

1. Go to Vercel Dashboard → Settings → Domains
2. Add your custom domain
3. Follow DNS configuration instructions
4. Update Supabase allowed URLs:
   - Go to Supabase Dashboard → Authentication → URL Configuration
   - Add your domain to **Redirect URLs**

## 8. Production Checklist

- [ ] Deployed to Vercel
- [ ] Environment variables set (Supabase, Autumn, OpenAI)
- [ ] Vercel KV created and linked
- [ ] Database migrations run in production
- [ ] Supabase Edge Function deployed
- [ ] Autumn using **live keys** (not test)
- [ ] Tested signup/signin flow
- [ ] Tested API key creation
- [ ] Tested API endpoint with credits
- [ ] Tested credit purchases via Autumn
- [ ] Custom domain configured (if applicable)

## Troubleshooting

### "Unable to connect to database"
- Check `DATABASE_URL` is set correctly in Vercel
- Verify Supabase database is accessible (not paused)
- Check if IP is whitelisted in Supabase (should allow all for Vercel)

### "Unauthorized" on API requests
- Verify Supabase project URL and anon key are correct
- Check if session cookies are being set (check browser dev tools)
- Ensure middleware is running (check deployment logs)

### Rate limiting not working
- If you want persistent rate limits, add Vercel KV
- Without KV, it uses in-memory (resets on each deployment)
- Check KV environment variables are set

### Autumn integration failing
- Verify Edge Function is deployed: `supabase functions list`
- Check Edge Function has correct secret: `supabase secrets list`
- Test Edge Function directly:
  ```bash
  curl https://nqgaooprvgrmkvfslofh.supabase.co/functions/v1/autumn \
    -H "Authorization: Bearer YOUR_ANON_KEY"
  ```

### Database schema out of sync
- Run: `npx prisma migrate deploy`
- Or redeploy with migrations in build command

## Performance Optimization

### Enable Edge Runtime (Optional)

For faster cold starts, you can use Edge Runtime for API routes:

```typescript
// app/api/v1/hello/route.ts
export const runtime = 'edge'
```

**Note**: Not all libraries work with Edge Runtime (Prisma requires Node.js runtime)

### Caching

Vercel automatically caches:
- Static assets
- API routes with `cache` headers
- ISR (Incremental Static Regeneration) pages

For API routes that don't change often, add cache headers:

```typescript
return NextResponse.json(data, {
  headers: {
    'Cache-Control': 's-maxage=60, stale-while-revalidate'
  }
})
```

## Monitoring

- **Vercel Analytics**: Enable in Dashboard → Analytics
- **Vercel Logs**: Dashboard → Deployments → [deployment] → Functions
- **Supabase Logs**: Dashboard → Logs (for auth issues)
- **Autumn Dashboard**: Monitor credit usage and purchases

## Cost Estimate

**Free Tier Usage:**
- Vercel: 100GB bandwidth, 100 GB-hours compute
- Vercel KV: 256MB storage, 10K commands/day
- Supabase: 500MB database, 2GB bandwidth, 50K monthly active users
- Autumn: Free (Stripe fees apply to payments)

**Typical Monthly Cost (after free tier):**
- Small app (< 10K users): $0-20/month
- Medium app (10K-100K users): $20-100/month

---

## Next Steps

After deployment:
1. Monitor your Vercel Analytics for traffic
2. Set up error tracking (e.g., Sentry)
3. Configure production Stripe products in Autumn
4. Test payment flow end-to-end
5. Set up alerts for failed payments
