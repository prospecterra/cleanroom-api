# Claude Code Instructions

## Commit Message Guidelines

When making commits to this repository, follow these conventions:

### Format
```
<type>(<scope>): <subject>

<body>

<footer>
```

### Types
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `style`: Code style changes (formatting, missing semicolons, etc)
- `refactor`: Code refactoring
- `perf`: Performance improvements
- `test`: Adding or updating tests
- `chore`: Maintenance tasks (dependencies, build config, etc)
- `ci`: CI/CD changes

### Scopes
- `auth`: Authentication related
- `api`: API endpoints
- `db`: Database/Prisma related
- `ui`: User interface components
- `billing`: Stripe/payment integration
- `config`: Configuration files

### Examples
```
feat(api): add hello world endpoint with credit consumption

Implement GET /api/v1/hello endpoint that:
- Validates API key
- Checks user credits
- Deducts 1 credit per request
- Returns hello world message

feat(auth): implement user signup and signin

Add NextAuth.js integration with credentials provider
Include signup endpoint with bcrypt password hashing

fix(billing): correct credit calculation in webhook

The webhook was not properly incrementing credits after successful payment

chore(deps): update Next.js to v15.5
```

### Best Practices
- Use present tense ("add feature" not "added feature")
- Keep subject line under 72 characters
- Capitalize first letter of subject
- Don't end subject with a period
- Separate subject from body with blank line
- Use body to explain what and why, not how
- Reference issues/PRs in footer if applicable

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
│   ├── auth.ts           # NextAuth configuration
│   └── prisma.ts         # Prisma client
├── prisma/
│   └── schema.prisma     # Database schema
└── types/                # TypeScript type definitions
```

## Development Workflow

1. Make changes to code
2. Test locally
3. Run database migrations if schema changed: `npx prisma migrate dev`
4. Generate Prisma client: `npx prisma generate`
5. **Commit regularly** - Don't wait until everything is done
6. Push to GitHub when milestone is reached

### When to Commit

**IMPORTANT**: Commit changes incrementally as you work, not just at the end. Good times to commit:

- ✅ After completing a logical unit of work (e.g., one feature, one bug fix)
- ✅ After fixing a bug or error
- ✅ After refactoring a component or module
- ✅ After updating configuration or environment setup
- ✅ Before switching to work on a different feature or area
- ✅ When the code is in a working state (tests pass, no errors)

**Don't wait** to commit everything at once. Small, focused commits make it easier to:
- Track progress and changes over time
- Revert specific changes if needed
- Understand what was changed and why
- Collaborate with others

### Commit Frequency Guidelines

- Aim for commits every 15-30 minutes during active development
- Each commit should represent one logical change
- Commit message should clearly explain what changed and why

## Database Migrations

When making schema changes:
```bash
npx prisma migrate dev --name descriptive_migration_name
```

## Environment Variables

Required variables in `.env`:
- `DATABASE_URL`: PostgreSQL connection string
- `NEXTAUTH_SECRET`: Secret for NextAuth.js
- `NEXTAUTH_URL`: Application URL
- `STRIPE_SECRET_KEY`: Stripe secret key
- `STRIPE_PUBLISHABLE_KEY`: Stripe publishable key
- `STRIPE_WEBHOOK_SECRET`: Stripe webhook secret
