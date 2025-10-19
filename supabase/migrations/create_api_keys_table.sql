-- Create api_keys table
CREATE TABLE IF NOT EXISTS api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  last_used TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create index on user_id for faster queries
CREATE INDEX IF NOT EXISTS idx_api_keys_user_id ON api_keys(user_id);

-- Create index on key for faster lookups
CREATE INDEX IF NOT EXISTS idx_api_keys_key ON api_keys(key);

-- Enable Row Level Security
ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;

-- Create policies for api_keys
-- Users can only see their own API keys
CREATE POLICY "Users can view own api_keys"
  ON api_keys
  FOR SELECT
  USING (auth.uid() = user_id);

-- Users can only create their own API keys
CREATE POLICY "Users can create own api_keys"
  ON api_keys
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Users can only delete their own API keys
CREATE POLICY "Users can delete own api_keys"
  ON api_keys
  FOR DELETE
  USING (auth.uid() = user_id);

-- Users can only update their own API keys
CREATE POLICY "Users can update own api_keys"
  ON api_keys
  FOR UPDATE
  USING (auth.uid() = user_id);

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to automatically update updated_at
CREATE TRIGGER update_api_keys_updated_at
  BEFORE UPDATE ON api_keys
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
