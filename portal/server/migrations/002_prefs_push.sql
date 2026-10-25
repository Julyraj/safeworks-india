-- 2.0 additions: user preferences, deferred push sending (quiet hours), email ↔ notification link, superseded reports.
alter table users add column if not exists preferences jsonb not null default '{}'::jsonb;
alter table notifications add column if not exists send_after timestamptz;
alter table email_outbox add column if not exists notification_id bigint;
alter table inspection_runs add column if not exists report_superseded boolean not null default false;
create index if not exists notifications_push_queue on notifications (send_after) where status = 'queued' and channel = 'push';
