-- Photos kept inside PostgreSQL (STORAGE_DRIVER=db), for hosts without a persistent disk
-- such as free test servers. The disk driver remains the default.
create table if not exists file_blobs (
  key text primary key,
  mime text not null,
  data bytea not null,
  created_at timestamptz not null default now()
);
