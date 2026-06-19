-- ============================================================
--  LEDGR — Migration 008: Inventory
--  Run with: psql $DATABASE_URL -f backend/migrations/008_inventory.sql
-- ============================================================

CREATE TABLE products (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id      UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name             VARCHAR(255) NOT NULL,
  sku              TEXT,
  description      TEXT,
  unit_cost        NUMERIC(10,2) NOT NULL DEFAULT 0,
  sell_price       NUMERIC(10,2),
  qty_on_hand      NUMERIC(10,3) NOT NULL DEFAULT 0,
  reorder_point    NUMERIC(10,3) NOT NULL DEFAULT 0,
  valuation_method VARCHAR(4) NOT NULL DEFAULT 'avg' CHECK (valuation_method IN ('fifo', 'avg')),
  category_id      UUID REFERENCES categories(id) ON DELETE SET NULL,
  is_active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_products_business ON products(business_id, is_active);
CREATE UNIQUE INDEX idx_products_sku ON products(business_id, sku) WHERE sku IS NOT NULL;

CREATE TABLE inventory_movements (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id    UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  product_id     UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  movement_type  VARCHAR(20) NOT NULL CHECK (movement_type IN ('receive', 'sale', 'adjustment', 'return')),
  quantity       NUMERIC(10,3) NOT NULL,
  unit_cost      NUMERIC(10,2),
  transaction_id UUID REFERENCES transactions(id) ON DELETE SET NULL,
  notes          TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_inv_movements_product  ON inventory_movements(product_id, created_at DESC);
CREATE INDEX idx_inv_movements_business ON inventory_movements(business_id, created_at DESC);

ALTER TABLE transactions
  ADD COLUMN product_id UUID REFERENCES products(id) ON DELETE SET NULL,
  ADD COLUMN qty        NUMERIC(10,3);
