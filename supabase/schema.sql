-- Claude Delegate - Database Schema
-- Run this in your Supabase SQL editor to set up the database

-- Enable pgvector for semantic search
create extension if not exists vector;

-- Users table
create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  google_id text unique,
  email text unique not null,
  name text not null,
  voice_clone_id text,
  avatar_url text,
  onboarding_completed boolean default false,
  connectors jsonb default '{"github": false, "slack": false, "google": false}',
  telegram_chat_id bigint unique,
  telegram_link_token text unique,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Agent sessions (one per meeting the delegate joins)
create table if not exists agent_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete cascade,
  meeting_id text not null,
  meeting_title text,
  meeting_url text,
  recall_bot_id text,
  status text default 'pending' check (status in ('pending', 'joining', 'active', 'completed', 'failed')),
  transcript jsonb,
  summary text,
  action_items jsonb,
  created_at timestamptz default now(),
  completed_at timestamptz
);

-- Second brain entries (PARA knowledge base)
create table if not exists brain_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete cascade,
  category text not null check (category in ('projects', 'areas', 'resources', 'archive')),
  title text not null,
  content text,
  tags text[] default '{}',
  metadata jsonb default '{}',
  embedding vector(1536),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Connector tokens (OAuth tokens for GitHub/Slack)
create table if not exists connector_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete cascade,
  provider text not null check (provider in ('github', 'slack', 'google')),
  access_token text not null,
  refresh_token text,
  expires_at timestamptz,
  scopes text[],
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(user_id, provider)
);

-- Indexes
create index if not exists idx_agent_sessions_user on agent_sessions(user_id);
create index if not exists idx_agent_sessions_status on agent_sessions(status);
create index if not exists idx_brain_entries_user on brain_entries(user_id);
create index if not exists idx_brain_entries_category on brain_entries(user_id, category);

-- Semantic search function for brain entries
create or replace function match_brain_entries(
  query_embedding vector(1536),
  match_count int default 5,
  filter_user_id uuid default null,
  filter_category text default null
)
returns table (
  id uuid,
  title text,
  content text,
  category text,
  tags text[],
  similarity float
)
language plpgsql
as $$
begin
  return query
  select
    be.id,
    be.title,
    be.content,
    be.category,
    be.tags,
    1 - (be.embedding <=> query_embedding) as similarity
  from brain_entries be
  where
    (filter_user_id is null or be.user_id = filter_user_id)
    and (filter_category is null or be.category = filter_category)
    and be.embedding is not null
  order by be.embedding <=> query_embedding
  limit match_count;
end;
$$;

-- Updated_at trigger
create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists users_updated_at on users;
create trigger users_updated_at
  before update on users
  for each row execute function update_updated_at();

drop trigger if exists brain_entries_updated_at on brain_entries;
create trigger brain_entries_updated_at
  before update on brain_entries
  for each row execute function update_updated_at();

drop trigger if exists connector_tokens_updated_at on connector_tokens;
create trigger connector_tokens_updated_at
  before update on connector_tokens
  for each row execute function update_updated_at();
