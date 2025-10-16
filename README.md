# API Platform

A minimalistic API product built with Next.js, TypeScript, and PostgreSQL. Users can sign up, manage API keys, track credits, and make API calls with usage-based billing.

## Features

- User authentication (signup/signin) with NextAuth.js
- API key generation and management
- Credit-based API usage tracking
- Stripe integration for purchasing credits
- Simple "Hello World" API endpoint
- Responsive dashboard UI

## Tech Stack

- **Framework**: Next.js 15 with App Router
- **Language**: TypeScript
- **Database**: PostgreSQL with Prisma ORM
- **Authentication**: NextAuth.js
- **Payments**: Stripe
- **Styling**: Tailwind CSS

## Getting Started

### Prerequisites

- Node.js 18+ installed
- PostgreSQL database (or use Prisma's hosted database)
- Stripe account for payments

### Installation

1. Clone the repository:
```bash
git clone <your-repo-url>
cd api-platform
```

2. Install dependencies:
```bash
npm install
```

3. Set up environment variables:
Create a `.env` file in the root directory with the following:
```env
DATABASE_URL="your_postgresql_connection_string"
NEXTAUTH_SECRET="your_secret_key"
NEXTAUTH_URL="http://localhost:3000"
STRIPE_SECRET_KEY="sk_test_your_stripe_key"
STRIPE_PUBLISHABLE_KEY="pk_test_your_stripe_key"
STRIPE_WEBHOOK_SECRET="whsec_your_webhook_secret"
```

4. Run database migrations:
```bash
npx prisma migrate dev
npx prisma generate
```

5. Start the development server:
```bash
npm run dev
```

6. Open [http://localhost:3000](http://localhost:3000) in your browser

## Project Structure

```
api-platform/
├── app/
│   ├── api/              # API routes
│   │   ├── auth/         # Authentication endpoints
│   │   ├── keys/         # API key management
│   │   ├── billing/      # Stripe integration
│   │   ├── user/         # User data endpoints
│   │   └── v1/           # Versioned API endpoints
│   ├── auth/             # Auth pages (signin/signup)
│   ├── dashboard/        # Dashboard page
│   └── layout.tsx        # Root layout
├── components/           # React components
├── lib/                  # Utility libraries
├── prisma/               # Database schema
└── types/                # TypeScript types
```

## API Usage

### Authentication
1. Sign up at `/auth/signup`
2. Sign in at `/auth/signin`
3. Access dashboard at `/dashboard`

### API Key Management
- Create API keys from the dashboard
- Copy and use in your API requests

### Making API Calls

```bash
curl -X GET http://localhost:3000/api/v1/hello \
  -H "x-api-key: YOUR_API_KEY"
```

Response:
```json
{
  "message": "Hello World",
  "creditsRemaining": 99
}
```

Each API call consumes 1 credit.

## Database Schema

- **User**: Stores user information, email, password hash, and credit balance
- **ApiKey**: API keys associated with users
- **Transaction**: Tracks all credit purchases and API usage

## Development

### Running Migrations
```bash
npx prisma migrate dev --name migration_name
```

### Generating Prisma Client
```bash
npx prisma generate
```

### Viewing Database
```bash
npx prisma studio
```

## Deployment

1. Deploy to Vercel or your preferred platform
2. Set up environment variables
3. Run database migrations in production
4. Configure Stripe webhook endpoint

## License

MIT
