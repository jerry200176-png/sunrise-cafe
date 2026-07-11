-- Per-branch closed dates (公休日) for multi-store booking
ALTER TABLE branches ADD COLUMN IF NOT EXISTS closed_dates JSONB DEFAULT '[]';
