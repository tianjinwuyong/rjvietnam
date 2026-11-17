-- 048_procurement.sql
-- Procurement Management: Requisitions → PO → Contracts → Approval Workflow
-- Workflow: Requisition → Supplier Quote → PO → Contract → Multi-level Approval → WMS Receiving

-- ── Purchase Requisitions (internal material request) ────────────────────────
CREATE TABLE IF NOT EXISTS purchase_requisitions (
  id                bigserial PRIMARY KEY,
  requisition_no    varchar(60)  NOT NULL UNIQUE,
  requester_id       bigint      NOT NULL REFERENCES users(id),
  department        varchar(80),
  reason            text,
  urgency           varchar(20)  NOT NULL DEFAULT 'normal'
                    CHECK (urgency IN ('critical', 'urgent', 'normal', 'low')),
  target_date       date,
  status            varchar(20)  NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft', 'submitted', 'quoted', 'po_created', 'partially_received', 'closed', 'cancelled')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  submitted_at      timestamptz,
  closed_at         timestamptz
);

CREATE INDEX IF NOT EXISTS idx_pr_requester      ON purchase_requisitions(requester_id);
CREATE INDEX IF NOT EXISTS idx_pr_status        ON purchase_requisitions(status);
CREATE INDEX IF NOT EXISTS idx_pr_urgency       ON purchase_requisitions(urgency);

-- ── Purchase Requisition Lines ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS purchase_requisition_lines (
  id                    bigserial PRIMARY KEY,
  requisition_id        bigint NOT NULL REFERENCES purchase_requisitions(id) ON DELETE CASCADE,
  line_no                integer NOT NULL CHECK (line_no > 0),
  material_id           bigint REFERENCES materials(id),
  material_code         varchar(80) NOT NULL,
  material_name_zh      varchar(160),
  qty_requested         numeric(18,4) NOT NULL CHECK (qty_requested > 0),
  qty_ordered           numeric(18,4) DEFAULT 0,
  unit                  varchar(20),
  target_unit_cost      numeric(18,6),
  target_supplier_id   bigint REFERENCES suppliers(id),
  notes                text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE(requisition_id, line_no)
);

CREATE INDEX IF NOT EXISTS idx_prl_requisition ON purchase_requisition_lines(requisition_id);

-- ── Supplier Quotes ──────────────────────────────────────────────────────────
-- Quotes received from suppliers in response to requisitions
-- `supplier_quotes` is already owned by the spare-parts module. Keep the
-- procurement RFQ quote model under an unambiguous table name.
CREATE TABLE IF NOT EXISTS procurement_supplier_quotes (
  id                  bigserial PRIMARY KEY,
  requisition_id      bigint REFERENCES purchase_requisitions(id) ON DELETE SET NULL,
  requisition_line_id bigint REFERENCES purchase_requisition_lines(id) ON DELETE SET NULL,
  supplier_id         bigint NOT NULL REFERENCES suppliers(id),
  quote_no            varchar(80),
  quoted_at           timestamptz DEFAULT now(),
  valid_until         date,
  currency_code       varchar(12) DEFAULT 'USD',
  unit_price          numeric(18,6) NOT NULL,
  qty_quoted          numeric(18,4),
  lead_time_days      integer,
  payment_terms       varchar(120),
  notes               text,
  status              varchar(20) NOT NULL DEFAULT 'active'
                      CHECK (status IN ('active', 'accepted', 'rejected', 'expired', 'superseded')),
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          bigint REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_proc_sq_requisition ON procurement_supplier_quotes(requisition_id);
CREATE INDEX IF NOT EXISTS idx_proc_sq_supplier ON procurement_supplier_quotes(supplier_id);
CREATE INDEX IF NOT EXISTS idx_proc_sq_status ON procurement_supplier_quotes(status);

-- ── Purchase Order Headers ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS purchase_order_headers (
  id                  bigserial PRIMARY KEY,
  po_no               varchar(60)  NOT NULL UNIQUE,
  requisition_id      bigint REFERENCES purchase_requisitions(id),
  supplier_id         bigint      NOT NULL REFERENCES suppliers(id),
  contact_id          bigint REFERENCES supplier_contacts(id),
  order_date          date        NOT NULL DEFAULT CURRENT_DATE,
  promised_date       date,
  payment_terms       varchar(120),
  delivery_terms      varchar(120) DEFAULT 'DAP',  -- DAP, DDP, FOB, CIF...
  currency_code      varchar(12) DEFAULT 'USD',
  exchange_rate      numeric(18,6) DEFAULT 1.0,
  subtotal           numeric(18,2) DEFAULT 0,
  tax_amount         numeric(18,2) DEFAULT 0,
  total_amount       numeric(18,2) DEFAULT 0,
  status             varchar(20) NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft', 'sent', 'acknowledged', 'partially_received', 'received', 'closed', 'cancelled')),
  sent_at            timestamptz,
  acknowledged_at    timestamptz,
  notes              text,
  raw_text           text,          -- full PO document text for contract generation
  created_at         timestamptz NOT NULL DEFAULT now(),
  created_by         bigint      NOT NULL REFERENCES users(id),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  closed_at          timestamptz
);

CREATE INDEX IF NOT EXISTS idx_po_supplier ON purchase_order_headers(supplier_id);
CREATE INDEX IF NOT EXISTS idx_po_status   ON purchase_order_headers(status);
CREATE INDEX IF NOT EXISTS idx_po_date    ON purchase_order_headers(order_date);

-- ── Purchase Order Lines ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS purchase_order_lines (
  id                bigserial PRIMARY KEY,
  po_header_id      bigint NOT NULL REFERENCES purchase_order_headers(id) ON DELETE CASCADE,
  line_no            integer NOT NULL CHECK (line_no > 0),
  requisition_line_id bigint REFERENCES purchase_requisition_lines(id),
  material_id       bigint REFERENCES materials(id),
  material_code     varchar(80) NOT NULL,
  description       varchar(240),
  qty_ordered       numeric(18,4) NOT NULL CHECK (qty_ordered > 0),
  qty_received      numeric(18,4) DEFAULT 0,
  unit_price        numeric(18,6) NOT NULL,
  unit              varchar(20),
  line_total        numeric(18,2) NOT NULL,
  lead_time_days    integer,
  promised_date     date,
  status            varchar(20) NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'partial', 'received', 'cancelled')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE(po_header_id, line_no)
);

CREATE INDEX IF NOT EXISTS idx_pol_header   ON purchase_order_lines(po_header_id);
CREATE INDEX IF NOT EXISTS idx_pol_material ON purchase_order_lines(material_id);

-- ── Procurement Contracts ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS procurement_contracts (
  id                  bigserial PRIMARY KEY,
  contract_no         varchar(60)  NOT NULL UNIQUE,
  po_header_id        bigint REFERENCES purchase_order_headers(id),
  supplier_id         bigint      NOT NULL REFERENCES suppliers(id),
  contact_id         bigint REFERENCES supplier_contacts(id),
  title              varchar(240) NOT NULL,
  contract_type      varchar(40)  NOT NULL DEFAULT 'purchase'
                    CHECK (contract_type IN ('purchase', 'framework', 'rate_agreement', 'service', 'nda')),
  raw_text           text,         -- full contract document content
  total_value        numeric(18,2),
  currency_code      varchar(12) DEFAULT 'USD',
  payment_terms      varchar(200),
  advance_pct        numeric(5,2) DEFAULT 0 CHECK (advance_pct BETWEEN 0 AND 100),
  delivery_terms     varchar(120) DEFAULT 'DAP',
  quality_clause     text,
  warranty_months    integer DEFAULT 12,
  penalty_clause     text,
  effective_date     date,
  expiry_date        date,
  auto_renew         boolean DEFAULT false,
  status             varchar(20) NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft', 'pending_approval', 'approved', 'rejected', 'active', 'expired', 'terminated', 'voided')),
  created_at         timestamptz NOT NULL DEFAULT now(),
  created_by         bigint      NOT NULL REFERENCES users(id),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  approved_at        timestamptz,
  approved_by        bigint REFERENCES users(id),
  rejected_at        timestamptz,
  rejected_by        bigint REFERENCES users(id),
  rejection_reason   text
);

CREATE INDEX IF NOT EXISTS idx_pc_supplier  ON procurement_contracts(supplier_id);
CREATE INDEX IF NOT EXISTS idx_pc_po        ON procurement_contracts(po_header_id);
CREATE INDEX IF NOT EXISTS idx_pc_status   ON procurement_contracts(status);

-- ── Contract Approval Tasks (workflow per contract) ───────────────────────────
CREATE TABLE IF NOT EXISTS contract_approval_tasks (
  id                  bigserial PRIMARY KEY,
  contract_id         bigint      NOT NULL REFERENCES procurement_contracts(id) ON DELETE CASCADE,
  step                integer     NOT NULL CHECK (step >= 1),
  approver_role       varchar(60) NOT NULL,  -- 'purchasing_supervisor', 'finance_manager', 'plant_director', 'gm'
  approver_id         bigint REFERENCES users(id),
  status              varchar(20) NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'approved', 'rejected', 'skipped')),
  decision           varchar(20),             -- 'approve', 'reject', 'request_info'
  notes              text,
  submitted_at        timestamptz NOT NULL DEFAULT now(),
  decided_at         timestamptz,
  UNIQUE(contract_id, step)
);

CREATE INDEX IF NOT EXISTS idx_cat_contract ON contract_approval_tasks(contract_id);
CREATE INDEX IF NOT EXISTS idx_cat_approver ON contract_approval_tasks(approver_id);

-- ── Contract Approval History ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS contract_approval_history (
  id                  bigserial PRIMARY KEY,
  contract_id         bigint      NOT NULL REFERENCES procurement_contracts(id) ON DELETE CASCADE,
  step               integer     NOT NULL,
  approver_role       varchar(60) NOT NULL,
  approver_id         bigint REFERENCES users(id),
  action             varchar(20) NOT NULL,  -- 'submit', 'approve', 'reject', 'request_info', 'forward', 'delegate'
  notes              text,
  acted_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cah_contract ON contract_approval_history(contract_id);

-- ═══════════════════════════════════════════════════════════════════
-- 供应商询价报价体系 (Supplier RFQ / Quote System)
-- ═══════════════════════════════════════════════════════════════════

-- ── RFQ: Request for Quotation (发给供应商的询价单) ────────────────────────────
CREATE TABLE IF NOT EXISTS rfq_headers (
  id                  bigserial PRIMARY KEY,
  rfq_no              varchar(60)  NOT NULL UNIQUE,
  requisition_id      bigint REFERENCES purchase_requisitions(id),
  title              varchar(240) NOT NULL,
  description        text,
  priority           varchar(20) NOT NULL DEFAULT 'normal'
                    CHECK (priority IN ('critical', 'urgent', 'normal', 'low')),
  response_deadline  timestamptz,
  requested_by       bigint      NOT NULL REFERENCES users(id),
  department         varchar(80),
  status             varchar(20) NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft', 'sent', 'quotes_received', 'comparing', 'awarded', 'cancelled')),
  awarded_supplier_id bigint REFERENCES suppliers(id),
  awarded_at        timestamptz,
  notes             text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  sent_at           timestamptz
);

CREATE INDEX IF NOT EXISTS idx_rfq_status    ON rfq_headers(status);
CREATE INDEX IF NOT EXISTS idx_rfq_requester ON rfq_headers(requested_by);
CREATE INDEX IF NOT EXISTS idx_rfq_deadline ON rfq_headers(response_deadline);

-- ── RFQ Line Items ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS rfq_lines (
  id                bigserial PRIMARY KEY,
  rfq_header_id    bigint NOT NULL REFERENCES rfq_headers(id) ON DELETE CASCADE,
  line_no          integer NOT NULL CHECK (line_no > 0),
  material_id       bigint REFERENCES materials(id),
  material_code     varchar(80) NOT NULL,
  material_name_zh  varchar(160),
  qty_requested    numeric(18,4) NOT NULL CHECK (qty_requested > 0),
  unit             varchar(20),
  target_unit_price numeric(18,6),
  target_total     numeric(18,2),
  delivery_date     date,
  notes            text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE(rfq_header_id, line_no)
);

CREATE INDEX IF NOT EXISTS idx_rfql_header ON rfq_lines(rfq_header_id);

-- ── Supplier Quotes per RFQ ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS supplier_quote_headers (
  id                  bigserial PRIMARY KEY,
  rfq_header_id      bigint      NOT NULL REFERENCES rfq_headers(id) ON DELETE CASCADE,
  supplier_id         bigint      NOT NULL REFERENCES suppliers(id),
  quote_no            varchar(80),
  contact_id         bigint REFERENCES supplier_contacts(id),
  currency_code       varchar(12) DEFAULT 'USD',
  valid_until         date,
  lead_time_days      integer,
  payment_terms       varchar(120),
  delivery_terms      varchar(120) DEFAULT 'DAP',
  total_amount        numeric(18,2) DEFAULT 0,
  tax_amount          numeric(18,2) DEFAULT 0,
  grand_total         numeric(18,2) DEFAULT 0,
  notes               text,
  status              varchar(20) NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft', 'submitted', 'accepted', 'rejected', 'superseded')),
  submitted_at        timestamptz,
  is_winner          boolean DEFAULT false,
  rank_position       integer,
  created_at         timestamptz NOT NULL DEFAULT now(),
  created_by         bigint REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_sqh_rfq      ON supplier_quote_headers(rfq_header_id);
CREATE INDEX IF NOT EXISTS idx_sqh_supplier ON supplier_quote_headers(supplier_id);
CREATE INDEX IF NOT EXISTS idx_sqh_winner   ON supplier_quote_headers(rfq_header_id) WHERE is_winner = true;

-- ── Supplier Quote Lines (per material line) ────────────────────────────────────
CREATE TABLE IF NOT EXISTS supplier_quote_lines (
  id                    bigserial PRIMARY KEY,
  quote_header_id       bigint NOT NULL REFERENCES supplier_quote_headers(id) ON DELETE CASCADE,
  rfq_line_id           bigint REFERENCES rfq_lines(id),
  material_code         varchar(80) NOT NULL,
  qty_quoted           numeric(18,4) NOT NULL CHECK (qty_quoted > 0),
  unit_price           numeric(18,6) NOT NULL CHECK (unit_price >= 0),
  line_total           numeric(18,2) NOT NULL,
  lead_time_days        integer,
  delivery_date         date,
  notes                 text,
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sql_header ON supplier_quote_lines(quote_header_id);

-- ── Quote Comparison Matrix ────────────────────────────────────────────────────
-- Denormalized comparison view for AI evaluation
CREATE TABLE IF NOT EXISTS quote_comparisons (
  id                  bigserial PRIMARY KEY,
  rfq_header_id       bigint      NOT NULL REFERENCES rfq_headers(id) ON DELETE CASCADE,
  supplier_id         bigint      NOT NULL REFERENCES suppliers(id),
  total_amount        numeric(18,2) NOT NULL,
  lead_time_days      integer,
  payment_terms       varchar(120),
  delivery_terms       varchar(120),
  quality_score       numeric(3,2),   -- 0.00–1.00
  price_score         numeric(3,2),   -- 0.00–1.00
  overall_score       numeric(3,2) DEFAULT 0,
  rank_position       integer,
  recommendation      varchar(20) DEFAULT 'hold'
                    CHECK (recommendation IN ('award', 'consider', 'hold', 'reject')),
  rationale           text,
  evaluated_at        timestamptz DEFAULT now(),
  evaluated_by        bigint REFERENCES users(id),
  UNIQUE(rfq_header_id, supplier_id)
);

CREATE INDEX IF NOT EXISTS idx_qc_rfq ON quote_comparisons(rfq_header_id);

-- ── Price History (per material + supplier) ─────────────────────────────────
-- Aggregated historical price for analytics
CREATE TABLE IF NOT EXISTS price_history (
  id                  bigserial PRIMARY KEY,
  material_id         bigint REFERENCES materials(id),
  material_code       varchar(80) NOT NULL,
  supplier_id         bigint REFERENCES suppliers(id),
  currency_code       varchar(12) DEFAULT 'USD',
  unit_price         numeric(18,6) NOT NULL,
  qty_min            numeric(18,4),
  qty_max            numeric(18,4),
  effective_from      date NOT NULL,
  effective_to        date,
  source_doc         varchar(40),   -- 'PO' | 'RFQ' | 'CONTRACT' | 'MANUAL'
  source_id          bigint,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ph_material  ON price_history(material_id);
CREATE INDEX IF NOT EXISTS idx_ph_supplier ON price_history(supplier_id);
CREATE INDEX IF NOT EXISTS idx_ph_effective ON price_history(effective_from DESC);

-- ── Supplier Scorecard ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS supplier_scorecards (
  id                  bigserial PRIMARY KEY,
  supplier_id         bigint      NOT NULL REFERENCES suppliers(id),
  period_start        date NOT NULL,
  period_end          date NOT NULL,
  on_time_delivery_rate numeric(5,2) DEFAULT 0 CHECK (on_time_delivery_rate BETWEEN 0 AND 100),
  quality_accept_rate  numeric(5,2) DEFAULT 0 CHECK (quality_accept_rate BETWEEN 0 AND 100),
  avg_lead_time_days  numeric(10,2) DEFAULT 0,
  price_competitiveness numeric(3,2) DEFAULT 0.5,
  complaint_count      integer DEFAULT 0,
  return_rate         numeric(5,2) DEFAULT 0,
  overall_score       numeric(3,2) DEFAULT 0 CHECK (overall_score BETWEEN 0 AND 1),
  grade               varchar(4),   -- 'A', 'B', 'C', 'D'
  evaluated_by        bigint REFERENCES users(id),
  evaluated_at        timestamptz NOT NULL DEFAULT now(),
  notes               text,
  UNIQUE(supplier_id, period_start, period_end)
);

CREATE INDEX IF NOT EXISTS idx_ssc_supplier ON supplier_scorecards(supplier_id);
CREATE INDEX IF NOT EXISTS idx_ssc_period  ON supplier_scorecards(period_start DESC);

-- ── Standard approval routing config ────────────────────────────────────────
-- Defines the approval chain by contract value threshold
CREATE TABLE IF NOT EXISTS approval_routing_rules (
  id                  bigserial PRIMARY KEY,
  contract_type       varchar(40)  NOT NULL DEFAULT 'purchase',
  min_value           numeric(18,2) DEFAULT 0,
  max_value           numeric(18,2),
  currency_code       varchar(12) DEFAULT 'USD',
  step_1_role        varchar(60) NOT NULL DEFAULT 'purchasing_supervisor',
  step_2_role        varchar(60),
  step_3_role        varchar(60),
  step_4_role        varchar(60),
  step_5_role        varchar(60),
  active             boolean DEFAULT true,
  created_at         timestamptz NOT NULL DEFAULT now()
);

-- Default routing: low-value (<5M) = 2 steps, high-value (>=5M) = 3 steps
INSERT INTO approval_routing_rules (contract_type, min_value, max_value, step_1_role, step_2_role, step_3_role, step_4_role)
VALUES
  ('purchase', 0,        5000000, 'purchasing_supervisor', 'plant_director', NULL,        NULL),
  ('purchase', 5000000,  NULL,    'purchasing_supervisor', 'finance_manager', 'plant_director', NULL),
  ('framework', 0,       NULL,    'purchasing_supervisor', 'plant_director', NULL,        NULL)
ON CONFLICT DO NOTHING;

-- ── PO received qty tracking trigger helper ──────────────────────────────────
-- When all lines fully received → close PO
CREATE OR REPLACE FUNCTION close_po_if_complete()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM purchase_order_lines pol
    JOIN purchase_order_headers poh ON poh.id = pol.po_header_id
    WHERE pol.po_header_id = NEW.po_header_id
      AND pol.status NOT IN ('received', 'cancelled')
  ) THEN
    UPDATE purchase_order_headers
    SET status = 'received', closed_at = now()
    WHERE id = NEW.po_header_id AND status NOT IN ('received', 'closed', 'cancelled');
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_close_po_if_complete
  AFTER UPDATE OF qty_received ON purchase_order_lines
  FOR EACH ROW
  WHEN (NEW.qty_received >= OLD.qty_ordered AND NEW.status = 'pending')
  EXECUTE FUNCTION close_po_if_complete();
