-- Per-user workspace settings that used to live only in the browser.
--
-- The cash flow inputs/outputs and the AI categorization notes are a user's
-- own configuration, not a per-month document, so they get one row per user
-- rather than being folded into `months`. Keeping them in localStorage meant a
-- second browser or a phone saw a stranger's-looking blank workspace and a
-- cleared site data wiped the plan for good.
create table if not exists user_settings (
  user_id text primary key,
  cash_flow_entries jsonb not null default '[]'::jsonb,
  categorization_notes text not null default '',
  updated_at text not null default ''
);
