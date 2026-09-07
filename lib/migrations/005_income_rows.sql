-- Income recognition: bank statements carry deposits that are not spending.
-- Payroll, interest, and third-party money received are stored here so the
-- month document can show income alongside expenses. Transfers between the
-- user's own accounts never land here; they are balance movements.
create table if not exists incomes (
  user_id text not null default '',
  month text not null,
  id text not null,
  position integer not null default 0,
  statement_id text not null default '',
  date text not null default '',
  source text not null default '',
  amount double precision not null default 0,
  currency text not null default '',
  kind text not null default 'other',
  confidence double precision not null default 0,
  notes text not null default '',
  primary key (user_id, month, id)
);

alter table incomes
  add constraint incomes_month_fkey
  foreign key (user_id, month) references months (user_id, month)
  on update cascade on delete cascade;

create index if not exists incomes_user_month_position_idx
  on incomes (user_id, month, position);
create index if not exists incomes_user_date_idx on incomes (user_id, date);
