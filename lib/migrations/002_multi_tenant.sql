-- Multi-tenant ledger: every row belongs to exactly one WorkOS user.
--
-- The original schema was single-tenant down to its primary keys -- a month was
-- identified by its month key alone -- so this rewrites those keys rather than
-- adding a filter column beside them. Making `user_id` part of every primary key
-- means a missing `where user_id = ...` in a future query is a uniqueness error
-- rather than a silent cross-user read.
--
-- Existing rows are left with an empty `user_id` here. `scripts/migrate.ts`
-- claims them for STATEMENT_LEDGER_LEGACY_USER_ID afterwards, because that id
-- identifies one deployment's owner and does not belong in checked-in SQL.

alter table months add column if not exists user_id text not null default '';
alter table statements add column if not exists user_id text not null default '';
alter table expenses add column if not exists user_id text not null default '';

-- The child foreign keys have to go before the parent key can be rewritten.
alter table statements drop constraint if exists statements_month_fkey;
alter table expenses drop constraint if exists expenses_month_fkey;

alter table months drop constraint if exists months_pkey;
alter table months add primary key (user_id, month);

alter table statements drop constraint if exists statements_pkey;
alter table statements add primary key (user_id, month, id);

alter table expenses drop constraint if exists expenses_pkey;
alter table expenses add primary key (user_id, month, id);

-- Children reference (user_id, month), so a month can never adopt another
-- user's rows. `on update cascade` is what lets the claim step below rewrite a
-- month's owner and carry its statements and expenses with it.
alter table statements
  add constraint statements_month_fkey
  foreign key (user_id, month) references months (user_id, month)
  on update cascade on delete cascade;

alter table expenses
  add constraint expenses_month_fkey
  foreign key (user_id, month) references months (user_id, month)
  on update cascade on delete cascade;

drop index if exists expenses_month_position_idx;
drop index if exists statements_month_position_idx;

create index if not exists expenses_user_month_position_idx
  on expenses (user_id, month, position);
create index if not exists statements_user_month_position_idx
  on statements (user_id, month, position);
create index if not exists expenses_user_date_idx on expenses (user_id, date);
create index if not exists expenses_user_category_idx on expenses (user_id, category);

drop index if exists expenses_date_idx;
drop index if exists expenses_category_idx;

-- The category catalog stops being a single-row document and becomes one row
-- per user; `user_id` replaces the constant `id` column that enforced that.
alter table category_catalog add column if not exists user_id text not null default '';
alter table category_catalog drop constraint if exists category_catalog_single_row;
alter table category_catalog drop constraint if exists category_catalog_pkey;
alter table category_catalog drop column if exists id;
alter table category_catalog add primary key (user_id);

-- Each user connects their own Notion workspace. The integration token is a
-- third-party credential belonging to that user, so it is stored encrypted
-- (see lib/secrets.ts) rather than as readable text in a shared database.
create table if not exists notion_connections (
  user_id text primary key,
  api_key_encrypted text not null default '',
  data_source_id text not null default '',
  category_data_source_id text not null default '',
  updated_at text not null default ''
);
