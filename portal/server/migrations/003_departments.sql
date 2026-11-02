-- 2.1: company-wide departments (Civil, Electrical, Maintenance, HSE, Stores …).
-- A person belongs to at most one department. Actions and observations keep a snapshot of the department at the moment the
-- owner (or the named reporter) was set, so department charts do not change history when someone later moves department.
create table if not exists departments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organisations(id),
  code text not null,
  name_i18n jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  sort int not null default 0,
  version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by uuid,
  delete_reason text
);
create unique index if not exists departments_org_code on departments (org_id, lower(code)) where deleted_at is null;

alter table people add column if not exists department_id uuid references departments(id);
create index if not exists people_department on people (department_id);
alter table actions add column if not exists department_id uuid references departments(id);
create index if not exists actions_department on actions (department_id, status);
-- null for anonymous and QR reports (reporter_user_id is null), so a department never narrows down an anonymous reporter
alter table observations add column if not exists reporter_department_id uuid references departments(id);
create index if not exists observations_reporter_department on observations (reporter_department_id);

create or replace function sw_department_of(uid uuid) returns uuid language sql stable as $$
  select p.department_id from users u join people p on p.id = u.person_id where u.id = uid
$$;

create or replace function sw_actions_department() returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' or new.owner_user_id is distinct from old.owner_user_id then
    new.department_id := sw_department_of(new.owner_user_id);
  end if;
  return new;
end $$;
drop trigger if exists actions_department on actions;
create trigger actions_department before insert or update of owner_user_id on actions for each row execute function sw_actions_department();

create or replace function sw_observations_department() returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' or new.reporter_user_id is distinct from old.reporter_user_id or new.anonymous is distinct from old.anonymous then
    new.reporter_department_id := case when new.anonymous or new.reporter_user_id is null then null else sw_department_of(new.reporter_user_id) end;
  end if;
  return new;
end $$;
drop trigger if exists observations_department on observations;
create trigger observations_department before insert or update of reporter_user_id, anonymous on observations for each row execute function sw_observations_department();
