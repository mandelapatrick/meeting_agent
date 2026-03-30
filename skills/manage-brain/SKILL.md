---
name: manage-brain
description: Add, search, or organize entries in your second brain (PARA structure). Use when the user wants to manage their knowledge base, add context, or search their notes.
argument-hint: <action> [content]
disable-model-invocation: false
allowed-tools:
  - Read
  - Write
  - Glob
  - Grep
  - mcp__meeting-agent__search_brain
  - mcp__meeting-agent__add_brain_entry
---

# Manage Second Brain

Add, search, and organize entries in the user's PARA-structured second brain. This knowledge base provides context to the delegate agent during meetings.

## PARA Structure

- **Projects** — Active projects with goals, timelines, and notes
- **Areas** — Ongoing responsibilities (team info, processes, domains)
- **Resources** — Reference material (tech docs, meeting templates, guides)
- **Archive** — Completed or inactive items

## Actions

### Add an entry
Create a markdown file in the appropriate PARA category under `second-brain/`.

### Search entries
Use `search_brain` for semantic search across all entries, or use Grep/Glob for exact matches in local files.

### Organize
Move entries between categories, update content, or archive completed items.

## File Format

Each entry is a markdown file with YAML frontmatter:
```markdown
---
title: Entry Title
category: projects | areas | resources | archive
tags: [tag1, tag2]
created: 2024-01-01
---

Content here...
```
