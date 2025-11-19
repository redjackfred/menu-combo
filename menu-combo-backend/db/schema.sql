-- Menu Combo Application Database Schema
-- PostgreSQL

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. Users table - Store additional user information (Cognito sub as primary key)
CREATE TABLE IF NOT EXISTS users (
  user_id UUID PRIMARY KEY,  -- Cognito sub
  email VARCHAR(255) UNIQUE,  -- Email is optional since access token may not include it
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 2. Uploads table - Track all menu image uploads
CREATE TABLE IF NOT EXISTS uploads (
  upload_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(user_id) ON DELETE CASCADE,
  file_url TEXT NOT NULL,
  file_name VARCHAR(255),
  s3_key TEXT NOT NULL,
  file_size INTEGER,
  mime_type VARCHAR(100),
  upload_status VARCHAR(50) DEFAULT 'uploaded',  -- uploaded, processing, completed, failed
  ocr_status VARCHAR(50) DEFAULT 'pending',  -- pending, processing, completed, failed
  ocr_started_at TIMESTAMP,
  ocr_completed_at TIMESTAMP,
  ocr_error TEXT,
  items_count INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 3. Menu items table - OCR extracted menu items
CREATE TABLE IF NOT EXISTS menu_items (
  item_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  upload_id UUID REFERENCES uploads(upload_id) ON DELETE CASCADE,
  item_name VARCHAR(255) NOT NULL,
  price DECIMAL(10, 2),
  description TEXT,
  category VARCHAR(100),
  extracted_text JSONB,  -- Full OCR raw data
  bbox JSONB,  -- Bounding box from Textract: {left, top, width, height} in percentages (0-1)
  notes TEXT,  -- Additional notes like "price not found" or "estimated category"
  confidence_score DECIMAL(3, 2),  -- OCR confidence 0.00 - 1.00
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 4. User preferences table - User dietary preferences and constraints
CREATE TABLE IF NOT EXISTS user_preferences (
  preference_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(user_id) ON DELETE CASCADE,
  dietary_restrictions JSONB,   -- ["vegetarian", "no-seafood", "no-pork", "halal"]
  budget_min DECIMAL(10, 2),    -- Minimum budget
  budget_max DECIMAL(10, 2),    -- Maximum budget
  people_count INTEGER,          -- Number of people
  spice_level VARCHAR(50),       -- "any", "none", "mild", "medium", "hot"
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id)  -- One preference record per user
);

-- 5. Recommendations table - AI recommendation history
CREATE TABLE IF NOT EXISTS recommendations (
  recommendation_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(user_id) ON DELETE CASCADE,
  upload_ids JSONB NOT NULL,         -- Array of upload_id UUIDs used for this recommendation
  recommended_items JSONB NOT NULL,  -- Array of 3 recommended combos: [{name, items, totalPrice, reason, tags}]
  preferences JSONB,                 -- User preferences used: {people, budget, dietaryRestrictions, spicyLevel}
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_uploads_user_id ON uploads(user_id);
CREATE INDEX IF NOT EXISTS idx_uploads_created_at ON uploads(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_uploads_ocr_status ON uploads(ocr_status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_menu_items_upload_id ON menu_items(upload_id);
CREATE INDEX IF NOT EXISTS idx_recommendations_user_id ON recommendations(user_id);
CREATE INDEX IF NOT EXISTS idx_recommendations_created_at ON recommendations(created_at DESC);

-- Create updated_at trigger function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply updated_at trigger to relevant tables
DROP TRIGGER IF EXISTS update_users_updated_at ON users;
CREATE TRIGGER update_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_uploads_updated_at ON uploads;
CREATE TRIGGER update_uploads_updated_at
    BEFORE UPDATE ON uploads
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_preferences_updated_at ON user_preferences;
CREATE TRIGGER update_preferences_updated_at
    BEFORE UPDATE ON user_preferences
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
