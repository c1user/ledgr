CREATE TABLE vendors (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id      UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name             VARCHAR(255) NOT NULL,
  ein              VARCHAR(20),
  address          TEXT,
  city             VARCHAR(100),
  state            VARCHAR(100),
  zip              VARCHAR(20),
  email            VARCHAR(255),
  phone            VARCHAR(50),
  is_1099_eligible BOOLEAN NOT NULL DEFAULT FALSE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_vendors_business ON vendors(business_id);

ALTER TABLE transactions
  ADD COLUMN vendor_id UUID REFERENCES vendors(id) ON DELETE SET NULL;
