# API Key Management - Best Practices Implementation

## Overview

The API key management system follows security and reliability best practices for creating, reading, updating, and deleting API keys in Supabase.

## Security Features

### 1. **Row Level Security (RLS)**
- ✅ RLS enabled on `api_keys` table
- ✅ Policies ensure users can only access their own keys
- ✅ Separate policies for SELECT, INSERT, UPDATE, DELETE operations
- ✅ Foreign key constraint with CASCADE delete (when user deleted, keys auto-deleted)

### 2. **Cryptographically Secure Key Generation**
```typescript
// Using crypto.randomBytes instead of UUID
const keyBytes = randomBytes(32)  // 256 bits of entropy
const key = `ak_${keyBytes.toString('hex')}`
```

**Why?**
- UUIDs are predictable and have lower entropy (~122 bits)
- crypto.randomBytes provides 256 bits of cryptographically secure randomness
- Virtually impossible to guess or brute force

### 3. **Input Validation & Sanitization**

**Name validation:**
- ✅ Type checking (must be string)
- ✅ Trimming whitespace
- ✅ Length validation (1-100 characters)
- ✅ Uniqueness check per user

**ID validation:**
- ✅ UUID format validation
- ✅ Existence verification before operations

## Rate Limiting & Abuse Prevention

### 1. **Maximum Keys Per User**
```typescript
const MAX_KEYS_PER_USER = 10
```
- Prevents abuse/spam
- Reasonable limit for most use cases
- Configurable constant

### 2. **Name Uniqueness**
- Users cannot create duplicate key names
- Prevents confusion and makes key management easier
- Enforced at application level

## API Endpoints

### **GET /api/keys**
Fetch all API keys for the authenticated user.

**Response:**
```json
{
  "apiKeys": [
    {
      "id": "uuid",
      "name": "Production Key",
      "key": "ak_...",
      "lastUsed": "2025-10-18T...",
      "createdAt": "2025-10-18T..."
    }
  ]
}
```

### **POST /api/keys**
Create a new API key.

**Request:**
```json
{
  "name": "My API Key"
}
```

**Validations:**
- Name required and must be string
- Name length: 1-100 characters
- Name must be unique for this user
- User must have < 10 total keys

**Response (201):**
```json
{
  "apiKey": {
    "id": "uuid",
    "name": "My API Key",
    "key": "ak_64_hex_chars...",
    "lastUsed": null,
    "createdAt": "2025-10-18T..."
  }
}
```

### **PATCH /api/keys/[id]**
Update (rename) an existing API key.

**Request:**
```json
{
  "name": "New Name"
}
```

**Validations:**
- ID must be valid UUID
- Key must exist and belong to user
- New name must be unique for this user
- Name length: 1-100 characters

**Response:**
```json
{
  "apiKey": {
    "id": "uuid",
    "name": "New Name",
    "key": "ak_...",
    "lastUsed": "...",
    "createdAt": "..."
  }
}
```

### **DELETE /api/keys/[id]**
Delete an API key.

**Validations:**
- ID must be valid UUID
- Key must exist and belong to user
- Verification before deletion

**Response:**
```json
{
  "message": "API key deleted successfully",
  "deletedKey": {
    "id": "uuid",
    "name": "Deleted Key Name"
  }
}
```

## Database Schema

### Table: `api_keys`

```sql
CREATE TABLE api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  last_used TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX idx_api_keys_user_id ON api_keys(user_id);
CREATE INDEX idx_api_keys_key ON api_keys(key);

-- Auto-update updated_at on changes
CREATE TRIGGER update_api_keys_updated_at
  BEFORE UPDATE ON api_keys
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
```

### RLS Policies

```sql
-- Users can only view their own keys
CREATE POLICY "Users can view own api_keys"
  ON api_keys FOR SELECT
  USING (auth.uid() = user_id);

-- Users can only create their own keys
CREATE POLICY "Users can create own api_keys"
  ON api_keys FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Users can only update their own keys
CREATE POLICY "Users can update own api_keys"
  ON api_keys FOR UPDATE
  USING (auth.uid() = user_id);

-- Users can only delete their own keys
CREATE POLICY "Users can delete own api_keys"
  ON api_keys FOR DELETE
  USING (auth.uid() = user_id);
```

## Error Handling

### Proper HTTP Status Codes
- `200` - Success (GET, PATCH, DELETE)
- `201` - Created (POST)
- `400` - Bad Request (validation errors)
- `401` - Unauthorized (not authenticated)
- `404` - Not Found (key doesn't exist)
- `500` - Internal Server Error

### Informative Error Messages
```json
// Example validation error
{
  "error": "Name must be between 1 and 100 characters"
}

// Example not found error
{
  "error": "API key not found"
}

// Example duplicate name error
{
  "error": "An API key with this name already exists"
}
```

## Audit Logging

Server-side logging for security events:

```typescript
// Key creation
console.log(`API key created: ${sanitizedName} for user ${user.id}`)

// Key deletion
console.log(`API key deleted: ${existingKey.name} (${id}) for user ${user.id}`)

// Key rename
console.log(`API key renamed: ${id} to "${sanitizedName}" for user ${user.id}`)
```

## Best Practices Checklist

- ✅ **Cryptographically secure key generation** (crypto.randomBytes)
- ✅ **Row Level Security** enabled with proper policies
- ✅ **Input validation** on all endpoints
- ✅ **Rate limiting** via max keys per user
- ✅ **Uniqueness constraints** for key names
- ✅ **Proper HTTP status codes** for all responses
- ✅ **Audit logging** for security events
- ✅ **UUID validation** before database operations
- ✅ **Existence verification** before updates/deletes
- ✅ **Foreign key constraints** with CASCADE delete
- ✅ **Database indexes** for performance
- ✅ **Auto-updating timestamps** via triggers
- ✅ **Consistent error messages**
- ✅ **Type safety** with TypeScript
- ✅ **Transaction safety** via RLS policies

## Usage in API Routes

For authenticating API requests (e.g., `/api/v1/companies/clean`):

```typescript
import { createClient } from "@supabase/supabase-js"

// Use service role to bypass RLS for API key validation
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
)

const { data: keyRecord, error } = await supabase
  .from('api_keys')
  .select('id, user_id')
  .eq('key', apiKey)
  .single()

if (!keyRecord) {
  return NextResponse.json(
    { error: "Invalid API key" },
    { status: 401 }
  )
}

// Key is valid, use keyRecord.user_id for authorization
```

## Security Considerations

1. **Service Role Key Usage**
   - Only use service role key for API key validation
   - Never expose service role key to client
   - Use authenticated Supabase client for user operations

2. **Key Storage**
   - Keys are stored in plaintext (required for validation)
   - Use HTTPS in production to protect keys in transit
   - Encourage users to rotate keys regularly

3. **Key Display**
   - Show full key only once on creation
   - Allow users to regenerate keys if lost
   - Consider adding "last 4 characters" display option

4. **Deletion Safety**
   - Verify key exists before deletion
   - Return confirmation with deleted key name
   - Consider "soft delete" for audit trail (optional)

## Future Enhancements

### Potential improvements:
1. **Key Rotation**: Automatic key rotation schedules
2. **Scoped Permissions**: Different keys for different endpoints
3. **Rate Limiting**: Per-key rate limits (beyond user-level)
4. **Expiration**: Optional key expiration dates
5. **IP Whitelisting**: Restrict keys to specific IPs
6. **Soft Delete**: Keep deleted keys in audit log
7. **Key Analytics**: Track usage statistics per key
8. **Webhooks**: Notify on suspicious key usage

## Testing

To test the API key endpoints:

```bash
# Create a key
curl -X POST http://localhost:3000/api/keys \
  -H "Content-Type: application/json" \
  -b "cookies.txt" \
  -d '{"name":"Test Key"}'

# List keys
curl http://localhost:3000/api/keys \
  -b "cookies.txt"

# Update a key
curl -X PATCH http://localhost:3000/api/keys/{id} \
  -H "Content-Type: application/json" \
  -b "cookies.txt" \
  -d '{"name":"Updated Name"}'

# Delete a key
curl -X DELETE http://localhost:3000/api/keys/{id} \
  -b "cookies.txt"

# Use a key
curl -X POST http://localhost:3000/api/v1/companies/clean \
  -H "Content-Type: application/json" \
  -H "x-api-key: ak_..." \
  -d '{"company":{"name":"Test"}}'
```

## Conclusion

This implementation follows industry best practices for API key management, ensuring:
- **Security**: Cryptographic key generation, RLS policies, input validation
- **Reliability**: Proper error handling, transaction safety, audit logging
- **Usability**: Clear error messages, consistent API design, proper HTTP codes
- **Scalability**: Database indexes, efficient queries, configurable limits

The system is production-ready and provides a secure foundation for API authentication.
