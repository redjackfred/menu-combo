-- Migration: Add OCR status tracking to uploads table and bbox to menu_items

-- Update uploads table
ALTER TABLE uploads
ADD COLUMN IF NOT EXISTS ocr_status VARCHAR(50) DEFAULT 'pending',
ADD COLUMN IF NOT EXISTS ocr_started_at TIMESTAMP,
ADD COLUMN IF NOT EXISTS ocr_completed_at TIMESTAMP,
ADD COLUMN IF NOT EXISTS ocr_error TEXT,
ADD COLUMN IF NOT EXISTS items_count INTEGER DEFAULT 0;

-- Add index for faster status queries
CREATE INDEX IF NOT EXISTS idx_uploads_ocr_status
ON uploads(ocr_status, created_at DESC);

-- Update menu_items table
ALTER TABLE menu_items
ADD COLUMN IF NOT EXISTS bbox JSONB,
ADD COLUMN IF NOT EXISTS notes TEXT;

-- Add comments
COMMENT ON COLUMN menu_items.bbox IS 'Bounding box from Textract: {left, top, width, height} in percentages (0-1)';
COMMENT ON COLUMN menu_items.notes IS 'Additional notes like "price not found" or "estimated category"';
