create table if not exists public.chats (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  messages jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.files (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  size bigint not null,
  storage_path text not null,
  uploaded_at timestamptz not null default now()
);

alter table public.chats enable row level security;
alter table public.files enable row level security;

create policy "Users manage their chats" on public.chats
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Users manage their files" on public.files
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

insert into storage.buckets (id, name, public)
values ('alif-files', 'alif-files', false)
on conflict (id) do nothing;
