-- SafeWorks Portal 2.0 schema.
--
-- A database created by the 1.x server (marked by its `closures` table) is not dropped: every 1.x table is moved
-- into the schema `v1_archive` so nothing is lost, and the 2.0 tables are created fresh. Photo blobs
-- (`file_blobs`, used when STORAGE_DRIVER=db) stay in place because they are storage, not domain data.
--
-- Conventions (brief §7.0): uuid keys; `client_uuid` on anything a phone can create (idempotency backstop);
-- times in UTC; soft delete on configuration tables; evidence tables are append-only and never deleted by the app.

do $$
declare t text;
begin
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'closures') then
    create schema if not exists v1_archive;
    for t in
      select table_name from information_schema.tables
       where table_schema = 'public' and table_type = 'BASE TABLE'
         and table_name not in ('schema_migrations', 'file_blobs')
    loop
      execute format('alter table public.%I set schema v1_archive', t);
    end loop;
    if exists (select 1 from pg_type where typname = 'role_t') then
      alter type public.role_t set schema v1_archive;
    end if;
    delete from schema_migrations where name in ('001_init.sql', '002_file_blobs.sql');
  end if;
end $$;

create extension if not exists pgcrypto;

-- Photos and files kept inside PostgreSQL when the host has no persistent disk (STORAGE_DRIVER=db).
create table if not exists file_blobs (
  key text primary key,
  mime text not null,
  data bytea not null,
  created_at timestamptz not null default now()
);

------------------------------------------------------------------------------------------------------------
-- Organisation, industries, sites, areas, assets, QR codes
------------------------------------------------------------------------------------------------------------
create table organisations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  legal_name text not null default '',
  address text not null default '',
  phone text not null default '',
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One row per industry (same codes as the SafeWorks India library's INDUSTRIES). Seeded from the library export.
create table industry_profiles (
  code text primary key,
  name_i18n jsonb not null,                       -- {"en":..,"hi":..,"ta":..,"kn":..}
  tagline text not null default '',
  icon text not null default '',
  establishment_types text[] not null default '{}',
  category_codes text[] not null default '{}',    -- categories pre-selected for a new site
  template_codes text[] not null default '{}',    -- inspection templates pre-enabled for a new site
  hazards text[] not null default '{}',
  ppe text[] not null default '{}',
  library jsonb not null default '{}'::jsonb,     -- {"regs":[..ids],"procs":[..],"cks":[..],"talks":[..],"tasks":[..]}
  sort int not null default 0,
  active boolean not null default true
);

create table risk_matrices (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organisations(id),
  name text not null,
  size smallint not null check (size in (3, 4, 5)),
  created_at timestamptz not null default now()
);

create table risk_matrix_versions (
  id uuid primary key default gen_random_uuid(),
  matrix_id uuid not null references risk_matrices(id),
  version int not null,
  likelihood_labels jsonb not null,               -- [{"v":1,"label_i18n":{..}}, ...]
  severity_labels jsonb not null,
  bands jsonb not null,                           -- [{"band":"low","min":1,"max":3,"colour":"green","response_i18n":{..}}, ...]
  status text not null default 'draft' check (status in ('draft', 'active', 'retired')),
  effective_from date,
  approved_by uuid,
  created_at timestamptz not null default now(),
  unique (matrix_id, version)
);

create table rule_sets (
  code text primary key,                          -- TN_FACTORY_LEGACY, BOCW_TN_LEGACY, KA_FACTORY_LEGACY, BOCW_KA_PROVISIONAL, OSH_CENTRAL, KA_OSH_DRAFT_2026, TN_OSH_DRAFT_2022
  name text not null,
  state text not null,                            -- TN, KA, ALL
  site_type text not null,                        -- factory, construction_site, any
  regime text not null check (regime in ('legacy', 'osh_state_final', 'osh_central', 'draft')),
  status text not null check (status in ('verified_primary', 'verified_secondary', 'draft_rule', 'unverified', 'provisional')),
  enabled boolean not null default false,
  version text not null default '1',
  effective_from date,
  reviewed_by text not null default '',
  reviewed_at timestamptz,
  notes text not null default ''
);

create table timer_rules (
  id uuid primary key default gen_random_uuid(),
  rule_set_code text not null references rule_sets(code),
  trigger jsonb not null,                         -- {"event_class":"injury_illness","conditions":["incapacity_48h"]}
  deadline_basis text not null check (deadline_basis in ('from_learned_at', 'from_condition_met')),
  deadline_minutes int,                           -- null blocks enabling
  recipient text not null,
  form_code text not null default '',
  status text not null check (status in ('verified_primary', 'verified_secondary', 'draft_rule', 'unverified', 'provisional')),
  source_note text not null default ''
);

create table sites (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organisations(id),
  code text not null check (code ~ '^[A-Z0-9]{2,6}$'),
  name_i18n jsonb not null,
  address text not null default '',
  state text not null default 'KA',               -- TN, KA, or another state code
  district text not null default '',
  lat double precision,
  lng double precision,
  geofence_radius_m int,
  industry_code text references industry_profiles(code),
  establishment_type text not null default 'factory'
    check (establishment_type in ('factory', 'hazardous_process_factory', 'construction_site', 'mine', 'port', 'plantation', 'office', 'other')),
  appropriate_government text not null default 'state' check (appropriate_government in ('state', 'centre')),
  rule_set_code text references rule_sets(code),
  rule_set_effective_from date,
  risk_matrix_version_id uuid references risk_matrix_versions(id),
  hazardous_process boolean not null default false,
  working_calendar jsonb not null default '{"weeklyOff":[0],"shiftStart":"08:00","shiftEnd":"17:00"}'::jsonb,
  worker_count int,
  timezone text not null default 'Asia/Kolkata',
  site_head_user_id uuid,
  active boolean not null default true,
  version int not null default 1,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  deleted_at timestamptz,
  deleted_by uuid,
  delete_reason text,
  unique (org_id, code)
);

create table areas (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites(id),
  parent_area_id uuid references areas(id),
  code text not null default '',
  name_i18n jsonb not null,
  area_type text not null default 'other'
    check (area_type in ('production', 'utilities', 'store', 'yard', 'scaffold_zone', 'excavation_zone', 'substation', 'office', 'canteen', 'gate', 'labour_camp', 'loading_bay', 'other')),
  hazardous_process boolean not null default false,
  owner_user_id uuid,                             -- default action owner suggested at triage
  sort int not null default 0,
  active boolean not null default true,
  version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by uuid,
  delete_reason text
);
create index areas_site on areas (site_id, parent_area_id);

create table contractors (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organisations(id),
  name text not null,
  is_own_company boolean not null default false,
  parent_id uuid references contractors(id),
  registration_no text not null default '',
  contact_name text not null default '',
  phone text not null default '',
  email text not null default '',
  trades text[] not null default '{}',
  active boolean not null default true,
  version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by uuid,
  delete_reason text,
  unique (org_id, name)
);

create table contractor_sites (
  contractor_id uuid not null references contractors(id),
  site_id uuid not null references sites(id),
  primary key (contractor_id, site_id)
);

create table assets (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organisations(id),
  site_id uuid not null references sites(id),
  area_id uuid references areas(id),
  asset_class text not null
    check (asset_class in ('lifting_appliance', 'lifting_gear', 'pressure_plant', 'boiler', 'extinguisher', 'first_aid_box', 'ladder', 'scaffold', 'harness', 'earth_pit', 'insulating_mat', 'rcd', 'earth_moving', 'vehicle', 'machine', 'other')),
  tag_no text not null,
  serial_no text not null default '',
  make_model text not null default '',
  material text not null default '',
  swl_kg numeric,
  owner_employer_id uuid references contractors(id),
  status text not null default 'in_service' check (status in ('in_service', 'do_not_use', 'retired')),
  status_reason text not null default '',
  next_exam_due date,
  version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by uuid,
  delete_reason text,
  unique (site_id, tag_no)
);
create index assets_site_class on assets (site_id, asset_class, status);

create table qr_codes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organisations(id),
  token text not null unique,                     -- random 128-bit, url-safe; never derived from ids
  target_type text not null check (target_type in ('site', 'area', 'asset')),
  target_id uuid not null,
  label text not null default '',
  prefill jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  rotated_from_id uuid references qr_codes(id),
  scan_count int not null default 0,
  last_scan_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid
);
create index qr_target on qr_codes (target_type, target_id) where active;

------------------------------------------------------------------------------------------------------------
-- People, users, roles, sessions, devices
------------------------------------------------------------------------------------------------------------
create table people (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organisations(id),
  full_name text not null,
  employer_id uuid references contractors(id),
  phone_enc text not null default '',             -- AES-GCM, FIELD_ENCRYPTION_KEY
  phone_last4 text not null default '',
  preferred_language text not null default 'en' check (preferred_language in ('en', 'hi', 'ta', 'kn')),
  trade text not null default '',
  worker_type text not null default 'employee' check (worker_type in ('employee', 'contract', 'temporary', 'visitor')),
  date_hired date,
  active boolean not null default true,
  version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by uuid,
  delete_reason text
);
create index people_employer on people (employer_id);

create type role_t as enum ('reporter', 'action_owner', 'verifier', 'site_safety_officer', 'site_head', 'hse_manager', 'admin', 'auditor');

create table users (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organisations(id),
  person_id uuid references people(id) unique,
  login_type text not null default 'employee_code' check (login_type in ('employee_code', 'email', 'enrolment_code')),
  employee_code text not null default '',
  email text not null default '',
  password_hash text not null default '',
  must_change_password boolean not null default true,
  mfa_enabled boolean not null default false,
  mfa_secret_enc text not null default '',
  failed_attempts int not null default 0,
  locked_until timestamptz,
  status text not null default 'active' check (status in ('active', 'suspended', 'deactivated')),
  language text not null default 'en' check (language in ('en', 'hi', 'ta', 'kn')),
  expires_at timestamptz,                         -- auditors
  password_changed_at timestamptz,
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now()
);
create unique index users_org_employee_code on users (org_id, lower(employee_code)) where employee_code <> '';
create unique index users_email on users (lower(email)) where email <> '';

create table user_site_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  site_id uuid references sites(id),             -- null = every site (hse_manager, admin, auditor only)
  role role_t not null,
  medical_data boolean not null default false,
  granted_by uuid,
  granted_at timestamptz not null default now(),
  expires_at timestamptz
);
create unique index user_site_roles_unique on user_site_roles (user_id, coalesce(site_id, '00000000-0000-0000-0000-000000000000'::uuid), role);
create index user_site_roles_site_role on user_site_roles (site_id, role);
create index user_site_roles_user on user_site_roles (user_id);

create table sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  token_hash text not null unique,
  kind text not null check (kind in ('field', 'admin')),
  mfa_passed boolean not null default false,
  device_id uuid,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz,
  ip text not null default '',
  user_agent text not null default ''
);
create index sessions_user_active on sessions (user_id) where revoked_at is null;

create table devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  device_uuid text not null unique,
  platform text not null default '',
  app_version text not null default '',
  push_subscription jsonb,
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz
);
create index devices_user on devices (user_id);

create table enrolment_codes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organisations(id),
  user_id uuid not null references users(id),
  code_hash text not null unique,
  issued_by uuid not null references users(id),
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

------------------------------------------------------------------------------------------------------------
-- Configuration
------------------------------------------------------------------------------------------------------------
create table categories (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organisations(id),
  code text not null,
  parent_code text,
  name_i18n jsonb not null,
  icon text not null default '',
  applies_to jsonb not null default '{}'::jsonb,  -- {"industries":[..], "types":[..]}
  critical_capable boolean not null default false,
  incident_prompt text not null default '',
  is3786_default text not null default 'B-2',
  extra_fields jsonb not null default '[]'::jsonb,
  default_recipient_roles text[] not null default '{site_safety_officer}',
  email_detail text not null default 'summary' check (email_detail in ('private', 'summary', 'detailed')),
  sort int not null default 0,
  active boolean not null default true,
  version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by uuid,
  delete_reason text,
  unique (org_id, code)
);

create table due_date_rules (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organisations(id),
  site_id uuid references sites(id),             -- null = company default
  band text not null check (band in ('low', 'moderate', 'high', 'extreme')),
  due_amount int not null,
  due_unit text not null check (due_unit in ('hours', 'days', 'working_days')),
  interim_control_required boolean not null default false,
  verify_within_hours int not null default 72,
  status_label text not null default 'design default',
  updated_at timestamptz not null default now()
);
create unique index due_date_rules_unique on due_date_rules (org_id, coalesce(site_id, '00000000-0000-0000-0000-000000000000'::uuid), band);

create table reminder_ladders (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organisations(id),
  band text not null check (band in ('low', 'moderate', 'high', 'extreme')),
  steps jsonb not null,                           -- [{"offsetMinutes":-10080,"recipient":"owner","channel":"push"}, ...]; negative = before due
  daily_cap int not null default 5,
  status_label text not null default 'design default',
  updated_at timestamptz not null default now(),
  unique (org_id, band)
);

create table translations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references organisations(id),       -- null = repo pack override not allowed; always set
  key text not null,
  lang text not null check (lang in ('en', 'hi', 'ta', 'kn')),
  text text not null,
  updated_by uuid,
  updated_at timestamptz not null default now(),
  unique (org_id, key, lang)
);

create table privacy_notices (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organisations(id),
  version int not null,
  lang text not null check (lang in ('en', 'hi', 'ta', 'kn')),
  body text not null,
  effective_from date not null,
  status text not null default 'active' check (status in ('draft', 'active', 'retired')),
  created_at timestamptz not null default now(),
  unique (org_id, version, lang)
);

create table privacy_acks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  notice_version int not null,
  acked_at timestamptz not null default now(),
  channel text not null default 'app'
);
create index privacy_acks_user on privacy_acks (user_id);

create table privacy_requests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organisations(id),
  person_name text not null,
  identifier text not null,                       -- employee code or masked phone
  type text not null check (type in ('access', 'correction', 'erasure', 'nomination', 'grievance')),
  details text not null default '',
  received_at timestamptz not null default now(),
  due_at timestamptz not null,
  status text not null default 'open' check (status in ('open', 'in_progress', 'answered', 'rejected')),
  handled_by uuid,
  response text not null default '',
  closed_at timestamptz
);

create table retention_policies (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organisations(id),
  record_type text not null,
  retention_years int not null,
  basis_note text not null default '',
  end_action text not null default 'anonymise' check (end_action in ('erase', 'anonymise')),
  status_label text not null default 'design default',
  unique (org_id, record_type)
);

create table legal_holds (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organisations(id),
  scope_type text not null,
  scope_id uuid,
  reason text not null,
  placed_by uuid not null,
  placed_at timestamptz not null default now(),
  released_at timestamptz,
  released_by uuid
);

------------------------------------------------------------------------------------------------------------
-- Observations, media, triage
------------------------------------------------------------------------------------------------------------
create table code_counters (
  scope text primary key,                         -- '<site code>:<OBS|ACT|INS>:<year>'
  next_no int not null
);

create table incidents (                          -- Phase 2 module; Phase 1 only records the escalation
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organisations(id),
  site_id uuid not null references sites(id),
  case_no text not null unique,
  observation_id uuid,
  event_class text not null default 'near_miss',
  learned_at timestamptz not null,
  status text not null default 'reported',
  created_by uuid,
  created_at timestamptz not null default now()
);

create table observations (
  id uuid primary key default gen_random_uuid(),
  client_uuid uuid not null unique,
  org_id uuid not null references organisations(id),
  site_id uuid not null references sites(id),
  area_id uuid references areas(id),
  asset_id uuid references assets(id),
  case_no text not null unique,
  lat double precision,
  lng double precision,
  accuracy_m real,
  captured_at timestamptz not null,
  received_at timestamptz not null default now(),
  device_id text not null default '',
  channel text not null check (channel in ('app', 'web', 'qr', 'on_behalf')),
  reporter_type text not null default 'employee' check (reporter_type in ('employee', 'contractor', 'temporary', 'visitor')),
  reporter_user_id uuid references users(id),     -- null when anonymous or QR
  anonymous boolean not null default false,
  reporter_contact_enc text not null default '',  -- named QR reports: {"name","phone"} encrypted
  type text not null check (type in ('good_practice', 'unsafe_act', 'unsafe_condition', 'near_miss')),
  category_codes text[] not null default '{}',
  task_observed text not null default '',
  description text not null default '' check (char_length(description) <= 500),
  description_lang text not null default 'en',
  fixed_on_spot boolean not null default false,
  immediate_action text not null default '',
  imminent_danger boolean not null default false,
  employer_involved_id uuid references contractors(id),
  trade text not null default '',
  status text not null default 'submitted'
    check (status in ('submitted', 'returned', 'merged', 'discarded', 'closed', 'action_assigned', 'escalated')),
  likelihood smallint,
  severity smallint,
  risk_score smallint,
  risk_band text check (risk_band in ('low', 'moderate', 'high', 'extreme')),
  risk_matrix_version_id uuid references risk_matrix_versions(id),
  is3786_code text not null default '',
  triaged_by uuid references users(id),
  triaged_at timestamptz,
  master_observation_id uuid references observations(id),
  escalated_incident_id uuid references incidents(id),
  learned_at timestamptz,
  closed_at timestamptz,
  closure_summary text not null default '',
  closure_feedback_sent_at timestamptz,
  status_secret text not null default '',        -- QR reporters: /public/status/<case_no>?s=<secret>
  critical_acked_at timestamptz,
  critical_acked_by uuid,
  version int not null default 1,
  updated_at timestamptz not null default now()
);
create index observations_site_status on observations (site_id, status, received_at desc);
create index observations_site_area on observations (site_id, area_id, received_at desc);
create index observations_reporter on observations (reporter_user_id) where reporter_user_id is not null;
create index observations_open_band on observations (site_id, risk_band) where status in ('submitted', 'returned', 'action_assigned');

-- Who sent an anonymous report, readable only by the server for "my reports" and the closure notice.
create table observation_reporter_seals (
  observation_id uuid primary key references observations(id),
  reporter_user_id_enc text not null,
  reporter_user_hash text not null                -- hmac(user id) so "my reports" can be found without decrypting
);
create index reporter_seals_hash on observation_reporter_seals (reporter_user_hash);

create table media (
  id uuid primary key default gen_random_uuid(),
  client_uuid uuid not null unique,
  org_id uuid not null references organisations(id),
  owner_type text not null check (owner_type in ('observation', 'action_event', 'inspection_answer', 'inspection_run', 'incident', 'asset', 'comment')),
  owner_id uuid not null,
  kind text not null check (kind in ('photo', 'audio', 'pdf', 'signature', 'html')),
  purpose text not null default 'evidence' check (purpose in ('before', 'after', 'evidence', 'signature', 'voice', 'report')),
  storage_key text not null,
  mime text not null,
  bytes int not null,
  width int,
  height int,
  duration_s real,
  sha256_capture text not null default '',
  sha256_server text not null default '',
  hash_match boolean,
  captured_at timestamptz,
  received_at timestamptz not null default now(),
  device_id text not null default '',
  lat double precision,
  lng double precision,
  annotation jsonb,
  redacted boolean not null default false,
  upload_status text not null default 'uploaded' check (upload_status in ('pending', 'uploaded', 'verified', 'failed')),
  created_by uuid
);
create index media_owner on media (owner_type, owner_id);

create table triage_decisions (                   -- append-only
  id uuid primary key default gen_random_uuid(),
  client_uuid uuid unique,
  observation_id uuid not null references observations(id),
  decision text not null
    check (decision in ('accept_assign', 'accept_fixed_on_spot', 'return_to_reporter', 'reviewed_no_action', 'merge_duplicate', 'discard', 'escalate_incident', 'reopen')),
  reason_code text not null default '',
  reason_text text not null default '',
  likelihood smallint,
  severity smallint,
  band text,
  risk_matrix_version_id uuid,
  decided_by uuid not null references users(id),
  decided_at timestamptz not null default now(),
  device_id text not null default '',
  superseded_by uuid references triage_decisions(id)
);
create index triage_obs on triage_decisions (observation_id, decided_at);

create table comments (                           -- append-only addenda on observations and inspection runs
  id uuid primary key default gen_random_uuid(),
  client_uuid uuid unique,
  owner_type text not null check (owner_type in ('observation', 'inspection_run', 'incident')),
  owner_id uuid not null,
  user_id uuid references users(id),              -- null = system
  kind text not null default 'comment' check (kind in ('comment', 'return_question', 'reporter_reply', 'system', 'rejected_offline_decision')),
  body text not null,
  captured_at timestamptz,
  created_at timestamptz not null default now()
);
create index comments_owner on comments (owner_type, owner_id, created_at);

------------------------------------------------------------------------------------------------------------
-- Corrective actions
------------------------------------------------------------------------------------------------------------
create table actions (
  id uuid primary key default gen_random_uuid(),
  client_uuid uuid not null unique,
  org_id uuid not null references organisations(id),
  site_id uuid not null references sites(id),
  area_id uuid references areas(id),
  case_no text not null unique,
  source_type text not null check (source_type in ('observation', 'inspection_answer', 'incident', 'root_cause', 'examination', 'committee_recommendation', 'permit_audit', 'manual')),
  source_id uuid,
  title text not null,
  problem text not null default '',
  cause_addressed text not null default '',
  action_type text not null default 'corrective' check (action_type in ('correction', 'corrective', 'preventive', 'improvement')),
  control_level text not null default 'administrative' check (control_level in ('elimination', 'substitution', 'engineering', 'administrative', 'ppe')),
  owner_user_id uuid not null references users(id),
  responsible_employer_id uuid references contractors(id),
  band text not null check (band in ('low', 'moderate', 'high', 'extreme')),
  original_due_at timestamptz not null,
  due_at timestamptz not null,
  interim_control text not null default '',
  interim_review_at timestamptz,
  statutory_clock text not null default '',
  status text not null default 'open' check (status in ('open', 'in_progress', 'completed', 'verified', 'reopened', 'disputed', 'cancelled')),
  completed_at timestamptz,
  completed_by uuid references users(id),
  completion_note text not null default '',
  verification_method text not null default '' check (verification_method in ('', 're_inspection', 'observation_sampling', 'recurrence_check', 'audit')),
  verifier_user_id uuid references users(id),
  verified_at timestamptz,
  verification_result text not null default '' check (verification_result in ('', 'effective', 'not_effective')),
  verification_reason text not null default '',
  reopen_count int not null default 0,
  escalation_level int not null default 0,
  ladder_paused_until timestamptz,
  cancel_reason text not null default '',
  cancel_approved_by uuid references users(id),
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version int not null default 1
);
create index actions_site_status_due on actions (site_id, status, due_at);
create index actions_owner_status on actions (owner_user_id, status);
create index actions_source on actions (source_type, source_id);

create table action_events (                      -- append-only timeline
  id bigserial primary key,
  action_id uuid not null references actions(id),
  client_uuid uuid unique,
  event_type text not null
    check (event_type in ('created', 'comment', 'status_change', 'attachment', 'date_change_requested', 'date_change_decided', 'dispute_raised', 'dispute_decided', 'reassigned', 'reminder_sent', 'escalated', 'verification')),
  from_status text,
  to_status text,
  body text not null default '',
  payload jsonb not null default '{}'::jsonb,
  actor_user_id uuid references users(id),        -- null = system
  captured_at timestamptz,
  received_at timestamptz not null default now(),
  device_id text not null default ''
);
create index action_events_action on action_events (action_id, id);

create table action_requests (
  id uuid primary key default gen_random_uuid(),
  action_id uuid not null references actions(id),
  type text not null check (type in ('date_change', 'dispute')),
  requested_by uuid not null references users(id),
  proposed_due_at timestamptz,
  reason_code text not null default '',
  reason text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'reassigned', 'cancelled')),
  decided_by uuid references users(id),
  decided_at timestamptz,
  decision_note text not null default '',
  created_at timestamptz not null default now()
);
create index action_requests_pending on action_requests (action_id) where status = 'pending';

------------------------------------------------------------------------------------------------------------
-- Inspections
------------------------------------------------------------------------------------------------------------
create table inspection_templates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organisations(id),
  code text not null,
  name_i18n jsonb not null,
  type text not null default 'site_walk'
    check (type in ('site_walk', 'scaffold', 'excavation', 'lifting', 'electrical', 'fire_extinguisher', 'housekeeping', 'ppe', 'hot_work', 'ptw_audit', 'regulatory_audit', 'vehicle', 'machine', 'chemical', 'process', 'other')),
  applies_to jsonb not null default '{}'::jsonb,  -- {"industries":[..],"areaTypes":[..],"assetClasses":[..]}
  owner_user_id uuid references users(id),
  active_version_id uuid,
  version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by uuid,
  delete_reason text,
  unique (org_id, code)
);

create table inspection_template_versions (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references inspection_templates(id),
  version int not null,
  status text not null default 'draft' check (status in ('draft', 'in_review', 'active', 'retired')),
  title_fields jsonb not null default '["site","area","asset","date","inspector","document_no"]'::jsonb,
  scoring jsonb not null default '{"anyFailRule":true,"passMarkPct":80}'::jsonb,
  required_competence_type text not null default '',
  author_id uuid references users(id),
  approved_by uuid references users(id),
  approved_at timestamptz,
  change_note text not null default '',
  created_at timestamptz not null default now(),
  unique (template_id, version)
);
alter table inspection_templates add constraint inspection_templates_active_version_fk
  foreign key (active_version_id) references inspection_template_versions(id);

create table inspection_sections (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null references inspection_template_versions(id),
  sort int not null default 0,
  title_i18n jsonb not null,
  repeatable boolean not null default false,
  repeat_label text not null default ''
);
create index inspection_sections_version on inspection_sections (version_id, sort);

create table inspection_questions (
  id uuid primary key default gen_random_uuid(),
  section_id uuid not null references inspection_sections(id),
  sort int not null default 0,
  code text not null default '',
  text_i18n jsonb not null,
  guidance_i18n jsonb not null default '{}'::jsonb,
  guidance_media_id uuid,
  answer_type text not null default 'pass_fail_na'
    check (answer_type in ('pass_fail_na', 'number', 'text', 'photo', 'signature', 'date', 'single_choice', 'multi_choice')),
  response_set jsonb not null default '[]'::jsonb,-- [{"value":"pass","label_i18n":{..},"colour":"green","flag":false,"score":1}, ...]
  unit text not null default '',
  min numeric,
  max numeric,
  pass_min numeric,
  pass_max numeric,
  required boolean not null default true,
  photo_on_fail boolean not null default true,
  note_on_fail boolean not null default true,
  action_on_fail boolean not null default true,
  action_defaults jsonb not null default '{}'::jsonb, -- {"ownerRole":"site_safety_officer","band":"high","dueOffsetHours":168}
  show_if jsonb,                                  -- {"questionCode":"Q3","equals":"fail"}
  reference_text text not null default '',
  reference_status text not null default 'reference_to_confirm'
    check (reference_status in ('verified_primary', 'verified_secondary', 'voluntary_standard', 'company_standard', 'reference_to_confirm'))
);
create index inspection_questions_section on inspection_questions (section_id, sort);

create table inspection_schedules (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organisations(id),
  template_id uuid not null references inspection_templates(id),
  site_id uuid not null references sites(id),
  area_id uuid references areas(id),
  asset_id uuid references assets(id),
  frequency jsonb not null,                       -- {"every":1,"unit":"day|week|month","weekdays":[1,2,3,4,5],"time":"08:00"}
  assignee_user_id uuid references users(id),
  assignee_role role_t,
  lead_days int not null default 1,
  grace_hours int not null default 24,
  next_due_at timestamptz,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index inspection_schedules_due on inspection_schedules (next_due_at) where active;

create table inspection_runs (
  id uuid primary key default gen_random_uuid(),
  client_uuid uuid not null unique,
  org_id uuid not null references organisations(id),
  case_no text not null unique,
  template_version_id uuid not null references inspection_template_versions(id),
  site_id uuid not null references sites(id),
  area_id uuid references areas(id),
  asset_id uuid references assets(id),
  schedule_id uuid references inspection_schedules(id),
  trigger text not null default 'spot' check (trigger in ('scheduled', 'spot', 'after_incident', 'after_change', 'weather_event')),
  due_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  status text not null default 'scheduled' check (status in ('scheduled', 'in_progress', 'completed', 'closed', 'missed', 'cancelled', 'reopened')),
  inspector_user_id uuid references users(id),
  header jsonb not null default '{}'::jsonb,
  signature_media_id uuid,
  start_lat double precision,
  start_lng double precision,
  submit_lat double precision,
  submit_lng double precision,
  score_pct numeric,
  result text check (result in ('pass', 'fail')),
  immediate_action text not null default '',
  tag_status text check (tag_status in ('safe_to_use', 'do_not_use')),
  report_media_id uuid,
  reopen_reason text not null default '',
  version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index inspection_runs_site_status on inspection_runs (site_id, status, due_at);
create index inspection_runs_asset on inspection_runs (asset_id, completed_at desc);
create index inspection_runs_inspector on inspection_runs (inspector_user_id, status);

create table inspection_answers (
  id uuid primary key default gen_random_uuid(),
  client_uuid uuid unique,
  run_id uuid not null references inspection_runs(id),
  question_id uuid not null references inspection_questions(id),
  repeat_index int not null default 0,
  value jsonb,
  flag boolean not null default false,
  score numeric,
  note text not null default '',
  likelihood smallint,
  severity smallint,
  action_id uuid references actions(id),
  answered_at timestamptz,
  lat double precision,
  lng double precision,
  device_id text not null default '',
  repeat_finding boolean not null default false,
  unique (run_id, question_id, repeat_index)
);

------------------------------------------------------------------------------------------------------------
-- Notifications, escalation, audit, sync, jobs
------------------------------------------------------------------------------------------------------------
create table notifications (
  id bigserial primary key,
  org_id uuid not null references organisations(id),
  event_type text not null,
  record_type text not null default '',
  record_id uuid,
  recipient_user_id uuid not null references users(id),
  channel text not null default 'inapp' check (channel in ('inapp', 'push', 'email', 'whatsapp', 'sms')),
  template_code text not null default '',
  language text not null default 'en',
  title text not null,
  body text not null default '',
  link text not null default '',
  critical boolean not null default false,
  status text not null default 'queued' check (status in ('queued', 'sent', 'delivered', 'failed', 'acknowledged')),
  provider_message_id text not null default '',
  cost_estimate_inr numeric not null default 0,
  attempts int not null default 0,
  sent_at timestamptz,
  acked_at timestamptz,
  read_at timestamptz,
  error text not null default '',
  created_at timestamptz not null default now()
);
create index notifications_recipient on notifications (recipient_user_id, created_at desc);
create index notifications_unread on notifications (recipient_user_id) where read_at is null and channel = 'inapp';
create index notifications_record on notifications (record_type, record_id);
create index notifications_queued on notifications (status, channel) where status = 'queued';

create table escalations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organisations(id),
  record_type text not null,
  record_id uuid not null,
  level int not null,
  reason text not null check (reason in ('overdue_t1', 'overdue_t3', 'critical_unacknowledged', 'triage_sla', 'verification_sla', 'timer_overdue', 'exam_overdue')),
  target_user_ids uuid[] not null default '{}',
  triggered_at timestamptz not null default now(),
  resolved_at timestamptz,
  unique (record_type, record_id, reason, level)
);

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

-- Tamper-evident log: every row carries the SHA-256 of (prev_hash || canonical row); /api/v1/admin/audit-log/verify re-computes the chain.
create table audit_log (
  id bigserial primary key,
  at timestamptz not null default now(),
  org_id uuid,
  actor_user_id uuid,
  actor_role text not null default '',
  site_id uuid,
  device_id text not null default '',
  ip_hash text not null default '',
  action text not null
    check (action in ('create', 'update', 'transition', 'delete', 'view_sensitive', 'export', 'login', 'login_failed', 'logout', 'permission_change', 'config_change', 'mfa_enrol', 'password_reset', 'sync')),
  record_type text not null default '',
  record_id text not null default '',
  changes jsonb not null default '{}'::jsonb,
  reason text not null default '',
  prev_hash text not null default '',
  hash text not null default ''
);
create index audit_org_at on audit_log (org_id, at desc);
create index audit_record on audit_log (record_type, record_id);

create table sync_commands (
  command_id text primary key,
  device_id text not null,
  user_id uuid,
  entity_type text not null,
  entity_client_uuid uuid,
  op text not null,
  received_at timestamptz not null default now(),
  result_status text not null check (result_status in ('applied', 'duplicate', 'rejected', 'conflict_saved_as_comment')),
  result jsonb not null default '{}'::jsonb,
  server_record_id uuid
);
create index sync_commands_received on sync_commands (received_at);

-- Public QR rate-limit counters (salted IP hashes, 24 h retention)
create table public_rate_counters (
  key text primary key,
  window_start timestamptz not null,
  count int not null default 0
);
