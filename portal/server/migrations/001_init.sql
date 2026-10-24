-- SafeWorks Portal: initial schema (Phase 1)
-- One company with many sites. Every row keeps org_id so a second company could be added later.

create table organisations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table business_units (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organisations(id),
  name text not null,
  active boolean not null default true,
  unique (org_id, name)
);

create table sites (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organisations(id),
  bu_id uuid references business_units(id),
  code text not null,
  name text not null,
  site_type text not null default 'construction',
  state text not null default 'Karnataka',
  address text not null default '',
  lat double precision,
  lng double precision,
  registrations jsonb not null default '{}'::jsonb,
  site_head_name text not null default '',
  site_head_phone text not null default '',
  site_head_email text not null default '',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (org_id, code)
);

create table areas (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites(id),
  name text not null,
  active boolean not null default true,
  unique (site_id, name)
);

create table contractors (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organisations(id),
  name text not null,
  contact text not null default '',
  active boolean not null default true,
  unique (org_id, name)
);

create table contractor_sites (
  contractor_id uuid not null references contractors(id),
  site_id uuid not null references sites(id),
  primary key (contractor_id, site_id)
);

create table users (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organisations(id),
  employee_id text not null,
  name text not null,
  designation text not null default '',
  phone text not null default '',
  email text not null default '',
  contractor_id uuid references contractors(id),
  password_hash text not null,
  must_change_password boolean not null default true,
  failed_attempts int not null default 0,
  locked_until timestamptz,
  active boolean not null default true,
  password_changed_at timestamptz,
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid
);
create unique index users_org_employee on users (org_id, lower(employee_id));

create type role_t as enum ('platform_admin', 'org_admin', 'viewer', 'safety_officer', 'supervisor', 'auditor');

create table memberships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  org_id uuid not null references organisations(id),
  site_id uuid references sites(id),          -- null = whole company
  role role_t not null,
  created_at timestamptz not null default now()
);
create unique index memberships_unique on memberships (user_id, coalesce(site_id, '00000000-0000-0000-0000-000000000000'::uuid), role);
create index memberships_site_role on memberships (site_id, role);
create index memberships_user on memberships (user_id);

create table sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  token_hash text not null unique,
  kind text not null check (kind in ('portal', 'admin')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz,
  ip text not null default '',
  user_agent text not null default ''
);
create index sessions_user_active on sessions (user_id) where revoked_at is null;

create table master_items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references organisations(id),
  list text not null,
  code text not null,
  label text not null,
  parent_code text,
  sort int not null default 0,
  version text not null default '2026.10',
  active boolean not null default true,
  updated_at timestamptz not null default now()
);
create unique index master_items_unique on master_items (coalesce(org_id, '00000000-0000-0000-0000-000000000000'::uuid), list, code);

create table code_counters (
  scope text primary key,
  next_no int not null
);

create table rounds (
  id uuid primary key,
  org_id uuid not null references organisations(id),
  site_id uuid not null references sites(id),
  code text not null unique,
  observer_id uuid not null references users(id),
  round_type text not null,
  shift text not null,
  area_names text[] not null default '{}',
  accompanied_by text not null default '',
  weather text not null default '',
  persons_on_site int,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  status text not null default 'open' check (status in ('open', 'finished'))
);
create index rounds_site on rounds (site_id, started_at desc);
create index rounds_observer on rounds (observer_id, started_at desc);

create table observations (
  id uuid primary key,
  org_id uuid not null references organisations(id),
  site_id uuid not null references sites(id),
  code text not null unique,
  round_id uuid references rounds(id),
  area_id uuid references areas(id),
  location text not null default '',
  lat double precision,
  lng double precision,
  observed_at timestamptz not null,
  raised_by uuid not null references users(id),
  raised_at timestamptz not null default now(),
  obs_type text not null check (obs_type in ('unsafe_act', 'unsafe_condition', 'near_miss', 'safe_behaviour')),
  category_code text not null default '',
  category text not null default '',
  item_code text not null default '',
  item text not null default '',
  hazard text not null default '',
  activity text not null default '',
  lsr text not null default '',
  permit_type text not null default '',
  permit_no text not null default '',
  equipment text not null default '',
  person_observed text not null default '',
  contractor_id uuid references contractors(id),
  crew_size int,
  severity smallint,
  likelihood smallint,
  risk_score smallint,
  risk_level text check (risk_level in ('Low', 'Medium', 'High', 'Critical')),
  work_stopped boolean not null default false,
  description text not null,
  immediate_action text not null default '',
  root_cause text not null default '',
  corrective_action text not null default '',
  control_level text not null default '',
  corrected_on_spot boolean not null default false,
  owner_id uuid references users(id),
  assigned_at timestamptz,
  due_at timestamptz,
  original_due_at timestamptz,
  legal_ref text not null default '',
  status text not null check (status in ('open', 'in_progress', 'closure_submitted', 'closed', 'cancelled', 'noted')),
  repeat_of uuid references observations(id),
  closure_submitted_at timestamptz,
  closed_at timestamptz,
  closed_by uuid references users(id),
  cancel_reason text not null default '',
  version int not null default 1,
  updated_at timestamptz not null default now()
);
create index obs_site_status_due on observations (site_id, status, due_at);
create index obs_site_raised on observations (site_id, raised_at desc);
create index obs_owner_status on observations (owner_id, status);
create index obs_raised_by on observations (raised_by, raised_at desc);
create index obs_round on observations (round_id);
create index obs_repeat on observations (site_id, item_code, area_id, raised_at desc);
create index obs_org_raised on observations (org_id, raised_at desc);

create table closures (
  id uuid primary key default gen_random_uuid(),
  observation_id uuid not null references observations(id),
  attempt int not null,
  comment text not null,
  completed_on date not null,
  control_level text not null default '',
  submitted_by uuid not null references users(id),
  submitted_at timestamptz not null default now(),
  decision text not null default 'pending' check (decision in ('pending', 'approved', 'rejected')),
  decided_by uuid references users(id),
  decided_at timestamptz,
  remarks text not null default '',
  onsite_verified boolean not null default false,
  unique (observation_id, attempt)
);
create index closures_pending on closures (observation_id) where decision = 'pending';

create table observation_photos (
  id uuid primary key default gen_random_uuid(),
  observation_id uuid not null references observations(id),
  closure_id uuid references closures(id),
  kind text not null check (kind in ('evidence', 'closure')),
  storage_key text not null,
  mime text not null,
  bytes int not null,
  width int,
  height int,
  uploaded_by uuid not null references users(id),
  uploaded_at timestamptz not null default now(),
  withdrawn boolean not null default false,
  withdrawn_reason text not null default ''
);
create index photos_obs on observation_photos (observation_id);

create table observation_versions (
  id bigserial primary key,
  observation_id uuid not null references observations(id),
  version int not null,
  actor_id uuid references users(id),
  at timestamptz not null default now(),
  action text not null,
  changes jsonb not null default '{}'::jsonb,
  reason text not null default '',
  snapshot jsonb
);
create index versions_obs on observation_versions (observation_id, id);

create table comments (
  id uuid primary key default gen_random_uuid(),
  observation_id uuid not null references observations(id),
  user_id uuid not null references users(id),
  body text not null,
  created_at timestamptz not null default now()
);
create index comments_obs on comments (observation_id, created_at);

create table notifications (
  id bigserial primary key,
  user_id uuid not null references users(id),
  observation_id uuid references observations(id),
  kind text not null,
  title text not null,
  body text not null default '',
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index notifications_user on notifications (user_id, created_at desc);
create index notifications_unread on notifications (user_id) where read_at is null;

create table email_outbox (
  id bigserial primary key,
  to_addr text not null,
  subject text not null,
  body text not null,
  created_at timestamptz not null default now(),
  next_try_at timestamptz not null default now(),
  sent_at timestamptz,
  attempts int not null default 0,
  last_error text not null default ''
);
create index outbox_pending on email_outbox (next_try_at) where sent_at is null;

create table job_marks (
  key text primary key,
  at timestamptz not null default now()
);

create table audit_log (
  id bigserial primary key,
  org_id uuid,
  actor_id uuid,
  at timestamptz not null default now(),
  action text not null,
  entity text not null default '',
  entity_id text not null default '',
  ip text not null default '',
  details jsonb not null default '{}'::jsonb
);
create index audit_org_at on audit_log (org_id, at desc);
