# Claude Code skills

Claude Code loads project skills from `.claude/skills/<name>/SKILL.md`.

## Linked skills (single source of truth)

`design-taste-frontend`, `high-end-visual-design` and `redesign-existing-projects` are installed from `Leonxlnx/taste-skill` into `.agents/skills/<name>/` (pinned in `skills-lock.json`). The copies under `.claude/skills/` and `.cursor/skills/` are relative symlinks to that directory, so Claude Code, Cursor and Codex read the same file. To change a skill, edit or update `.agents/skills/<name>/SKILL.md` and its `skills-lock.json` hash, not the links.

`grill-me` and `grilling` are vendored here directly (see `VENDORED.md`).

## Cursor-only references

These skills contain no Cursor-only commands, `.mdc` rules or `/home/jerry` paths. If a later version adds them, follow the same mapping as AllTrue (`.claude/skills/README.md` there): read `.mdc` rules as plain files, and replace local WSL paths and `agent-start` with a cloud branch from `origin/main`.
