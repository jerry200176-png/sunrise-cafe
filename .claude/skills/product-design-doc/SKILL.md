---
name: product-design-doc
description: Design doc before code (RULEBOOK D0). Use before building any feature or non-trivial fix - search for existing features first, then write a short design doc (problem, existing-feature inventory, options, architecture, UX, acceptance, rollout, metrics) in the issue, like a software company shipping a product. Includes the duplication-search procedure and the UX checklist.
---

# Product design doc

Rule source: `governance/RULEBOOK.md` D0 and D3. Vendored byte-for-byte into product repos
together with `reference-first-design` (its 「參考做法」 section is part of this doc).
Models: Google design docs (alternatives considered), Amazon working backwards (start from the
user), Nielsen's 10 usability heuristics.

Write it as an issue comment before any code; link it in the PR (「設計文件」 line). A fix of
about 50 lines or less with no UI change uses the 5-line version at the end.

## 1. Duplication search (do first, record what you searched)

Goal: never build a second copy of something that exists.

1. Name the job in 3-5 words (Chinese and English) and list synonyms used in code and UI.
2. Search the code: `grep -rIl` / ripgrep for those words across routes, controllers, services,
   components, pages, migrations, tests and docs. Check similar route names, table and column
   names, API endpoints, and existing helpers or components with the same verb.
3. Search the UI: list the entry points where users already do this job or a close one (menus,
   buttons, pages, LINE messages) per role. Open them if a dev server is available.
4. Search open work: list open PRs and recent merged PRs touching the same files or words:
   `gh api "repos/<owner>/<repo>/pulls?state=open&per_page=100"` (REST; GraphQL is blocked) and
   `gh api "search/issues?q=repo:<owner>/<repo>+<words>+is:pr"`. Overlap means coordinate or
   extend that PR instead of starting another.
5. Write the result as `searched: <terms, paths>; found: <path - what it does>; reused: <what>`.
   If something close exists, extend it. Build new only with a stated reason.

## 2. Design doc template

```markdown
## 設計文件
### 1. 問題與使用者
誰（角色）、在哪個畫面、現在怎麼做、痛點與證據（issue / 回報 ID）。
### 2. 現有功能盤點
searched / found（檔案路徑）/ reused。
### 3. 方案與替代方案
至少 2 個方案，各自優缺點；選哪個、為什麼；刻意不做的事。
### 4. 架構
資料模型（表、欄位、migration 類別）、API／端點、動到的元件與服務。不得為既有功能另開平行路徑。
### 5. UX
每個角色的流程；手機優先；空／錯誤／載入狀態；用字與既有畫面一致；只用設計系統元件。
### 6. 驗收條件
可測的條件（Given/When/Then），對應測試。
### 7. 上線與回滾
Feature flag 或分階段、部署路徑、回滾步驟、資料相容。
### 8. 量測
怎麼知道有效：指標、事件、查詢、觀察期。
### 參考做法
（照 `reference-first-design`：競品／大公司、開源（含授權）、根因 vs 症狀）
```

## 3. UX checklist (Nielsen's 10 heuristics, applied)

- Visibility of status: loading, saving, success and failure are shown.
- Match the real world: wording and units match existing screens and the users' own terms.
- User control: undo, cancel, back; no dead ends; destructive actions confirm.
- Consistency: same component, spacing, label and flow as neighbouring screens; design-system
  components only, no one-off styles.
- Error prevention: validate early, disable impossible actions, sensible defaults.
- Recognition over recall: show options; keep context visible.
- Efficiency: fewest taps for the common case; mobile first, touch targets, keyboard use.
- Minimal design: remove what the job does not need.
- Errors in plain language with a next step.
- Help only where needed: empty states explain what to do.
Also check: each role's flow, empty / error / loading states, long text, permissions, and
accessibility basics (contrast, labels, focus order).

## 4. 5-line version (about 50 lines or less, no UI change)

1. Problem and who is affected. 2. searched / found / reused. 3. Chosen fix and one rejected
alternative. 4. Test that proves it. 5. Rollback.

Reviewers (D3) check the diff against this doc: duplication is P1; so is UX that departs from
the stated flow or existing wording.
