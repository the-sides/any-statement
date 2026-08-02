-- Statement Ledger schema, as it stood before the ledger became multi-tenant.
-- Kept verbatim so a fresh database replays the same history an existing one
-- went through; 002_multi_tenant.sql rewrites the keys below.
--
-- A month is stored relationally rather than as a JSON blob so the ledger can
-- be queried across months in SQL. Writes stay whole-document: `writeStoredMonth`
-- replaces a month's statements and expenses in one transaction, matching the
-- file-per-month semantics the app was built around.

create table if not exists months (
  month text primary key,
  active_statement_id text not null default '',
  saved_at text not null default ''
);

create table if not exists statements (
  month text not null references months (month) on delete cascade,
  id text not null,
  position integer not null default 0,
  source_file_name text not null default '',
  imported_at text not null default '',
  month_source text not null default '',
  institution text not null default '',
  account_mask text not null default '',
  statement_type text not null default '',
  period_start text not null default '',
  period_end text not null default '',
  currency text not null default '',
  opening_balance numeric,
  closing_balance numeric,
  confidence double precision not null default 0,
  primary key (month, id)
);

-- Expense ids are only unique within a month: the fallback parser derives them
-- from date + merchant + amount, which can repeat across statements.
create table if not exists expenses (
  month text not null references months (month) on delete cascade,
  id text not null,
  position integer not null default 0,
  statement_id text not null default '',
  selected boolean not null default false,
  date text not null default '',
  posted_date text not null default '',
  description text not null default '',
  merchant text not null default '',
  amount numeric not null default 0,
  currency text not null default '',
  category text not null default '',
  subcategory text not null default '',
  payment_method text not null default '',
  statement_section text not null default '',
  confidence double precision not null default 0,
  notes text not null default '',
  primary key (month, id)
);

create index if not exists expenses_month_position_idx on expenses (month, position);
create index if not exists expenses_date_idx on expenses (date);
create index if not exists expenses_category_idx on expenses (category);
create index if not exists statements_month_position_idx on statements (month, position);

-- The category catalog is a single-row document: it is small, read whole, and
-- written whole, so splitting it into rows would buy nothing.
create table if not exists category_catalog (
  id boolean primary key default true,
  categories jsonb not null default '[]'::jsonb,
  source_data_source_id text,
  imported_at text,
  updated_at text not null default '',
  constraint category_catalog_single_row check (id)
);
