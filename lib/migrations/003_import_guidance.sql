-- Import Guidance: the reviewer's standing extraction instructions.
--
-- These lived in browser localStorage, which made them per-browser instead of
-- per-user: uploading from a phone silently dropped every correction rule the
-- desktop had accumulated. One row per user, same tenant key as every other
-- table.

create table if not exists import_guidance (
  user_id text primary key,
  guidance text not null default '',
  updated_at text not null default ''
);
