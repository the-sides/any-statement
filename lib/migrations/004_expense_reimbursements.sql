-- Reimbursements live on the expense row itself. `amount` keeps the gross
-- statement value so rows still reconcile against the source document, and
-- `reimbursed_amount` accumulates what came back -- partial or in full. Net is
-- always derived (amount - reimbursed_amount), never stored.
alter table expenses
  add column if not exists reimbursed_amount double precision not null default 0;
