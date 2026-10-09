# Agent Guide: MD Task Manager

This document serves as the primary instruction manual for AI agents and developers working on the `md-task-manager` repository. It outlines the project structure, development workflows, code standards, and architectural constraints.

## 1. Project Overview

**Stack**: TypeScript, Bun, Hono, grammY (Telegram Bot).
**Deployment**: Vercel (Serverless).
**Database**: GitHub Markdown File (No SQL/NoSQL DB).
**AI**: Gemini, OpenAI or Anthropic through the AI SDK; optional local faster-whisper transcription.

## 2. Environment & Setup

- **Runtime & Package Manager**: Bun.
- **Module System**: ESM (`type: "module"`).

### Installation

```bash
bun install
```

## 3. Development Commands

| Command             | Description                            | Notes                                          |
| :------------------ | :------------------------------------- | :--------------------------------------------- |
| `bun run dev`       | Start local dev server with hot-reload | Uses `bun --watch`. Best for active development. |
| `bun run build`     | Type-check the project                 | Uses `tsc --noEmit`. No output emitted.        |
| `bun run start`     | Run the app directly                   | Runs `bun run src/app.ts`.                     |
| `bun run lint`      | Run ESLint                             | Checks for code quality issues.                |
| `bun run lint:fix`  | Fix ESLint errors                      | Automatically fixes fixable issues.            |
| `bun run format`    | Run Prettier                           | Formats all source files.                      |

### Testing

**Status**: No automated test suite exists currently.

- **Verification**: Relies on `bun run lint`, `bun run build`, and manual verification via `bun run dev`.
- **Single Test**: If tests are added in the future, use `bun test <file>`.
- **Agent Action**: When refactoring, ensure `bun run build` passes.

## 4. Code Standards & Style

### TypeScript Configuration

- **Strict Mode**: Enabled. No implicit `any`.
- **Module Resolution**: `NodeNext`.
- **Extensions**: **MUST** use `.js` extension for local imports (e.g., `import { x } from './utils.js'`).
- **Type Safety**: Avoid `as any`. Use strict typing for all interfaces.

### Formatting (Prettier)

- **Quotes**: Single quotes (`'`).
- **Semi**: Yes.
- **Trailing Comma**: All (ES5+).
- **Width**: 80 characters.
- **Indentation**: 2 spaces.

### Naming Conventions

- **Files**: `camelCase.ts` (e.g., `markdownParser.ts`, `syncView.ts`).
- **Directories**: `camelCase` (e.g., `src/services`, `src/views`).
- **Variables/Functions**: `camelCase`.
- **Types/Interfaces**: `PascalCase` (e.g., `Task`, `Metadata`).
- **Constants**: `UPPER_SNAKE_CASE` (e.g., `TABLE_COLUMNS`).

### Error Handling

- **Logging**: **NEVER** use `console.log` or `console.error`.
  - **Use**: `import logger from '../core/logger.js';`
  - **Pattern**: `logger.infoWithContext({ op: 'OP_NAME', message: '...' })`.
- **User Feedback**: Catch errors and reply to the user with a friendly message.
- **Exceptions**: Custom errors should be typed or handled explicitly.

## 5. Architecture & Structure

The codebase is organized into modular layers to separate concerns:

```
src/
├── app.ts          # Application entry point & Middleware setup
├── clients/        # External API Wrappers (GitHub, Gemini, Google Calendar)
├── commands/       # Telegram Command Handlers (/add, /list, etc.)
├── core/           # Core Configuration, Types, Logger
├── middlewares/    # Express/Telegraf Middlewares (Auth, Webhooks)
├── services/       # Business Logic (Markdown Parsing, Task Querying)
├── utils/          # Shared Helpers & Validators
└── views/          # Presentation Layer (Response Formatting)
```

### Key Components

- **Views**: Located in `src/views/`. Contains pure functions that return formatted strings (MarkdownV2).
  - `generalView.ts`: General bot messages.
  - `syncView.ts`: GitHub Sync notifications.
- **Services**: Located in `src/services/`. Contains the core logic.
  - `markdownParser.ts`: Parses the task table.
  - `storage/`: Storage provider layer (`GitHubStorageProvider`, `NotionStorageProvider`, `factory.ts`).
  - `queryTasks.ts` & `saveTasks.ts`: Dispatches to active storage provider.
  - `githubWebhookHandler.ts`: Processes incoming webhooks.

## 6. Development Rules for Agents

1.  **Imports**: Always check for the `.js` extension in imports. The build will fail without it.
2.  **Linting**: Run `bun run lint` after making changes to ensure no regressions.
3.  **Refactoring**:
    - If moving files, update imports using `sed` or `ast-grep`.
    - Ensure file naming follows `camelCase`.
4.  **New Features**:
    - Add new commands to `src/commands/`.
    - Register them in `src/app.ts`.
    - Add localized strings to `src/views/`.
5.  **Documentation**:
    - Update `README.md` if environment variables change.
    - Update this file (`AGENTS.md`) if architecture changes.

## 7. Configuration Reference

| File            | Purpose                                 |
| :-------------- | :-------------------------------------- |
| `package.json`  | Scripts and dependencies.               |
| `tsconfig.json` | TS compiler options (ES2020, NodeNext). |
| `eslint.config.mjs` | Linting rules (TS + Prettier).     |
| `.prettierrc`   | Formatting rules.                       |
| `.env.example`  | Template for environment variables.     |

---

**Note**: This project follows the **Business Source License (BUSL-1.1)**.

## Personal copilot additions

- `services/eisenhower.ts` provides independent importance/urgency and legacy priority mapping; `views/eisenhowerView.ts` renders numbered sections and chunks Telegram messages.
- `commands/quadrant.ts` allows explicit quadrant overrides by exact task name.
- `services/reminders.ts` sends configured daily digests; `commands/reminders.ts` controls times. Polling runs a minute timer; webhook mode requires a frequent external cron. Settings and last-sent slot use GitHub Markdown frontmatter.
- GitHub task tables append Important/Urgent columns without changing earlier column positions. Notion does not yet store these additions.

- `services/taskNumbers.ts` stores user/chat-scoped snapshots of displayed saved-task lists; `commands/removeSelected.ts` handles confirmed numeric and voice deletion, rejecting stale fingerprints. IDs in list output are display indices only.

### Button menu

`commands/menu.ts` routes persistent keyboard and inline task/settings actions before add/edit scenes, behind allowlist. `views/menuView.ts` owns keyboard layouts. Menu snapshots expire after 30 minutes; task mutation verifies fingerprints. `reminder_saved_times` preserves schedules while reminders are off. `/menu` and `/start` reset pending menu input and scenes.

### AI priority preferences

`commands/aiSettings.ts` manages private-chat preferences and confirmed reclassification. `services/aiPriorities.ts` builds priority-only personal instructions and validates immutable task proposals. `ai_auto_priority` and JSON-encoded `ai_priority_rules` persist in Markdown frontmatter. Task `priorityLocked` column protects manual quadrant choices; new columns append to maintain legacy row compatibility. `/add`, `/brain` and name editing pass metadata into AI generation. Register AI settings before menu/scenes so rule entry and cancellation route correctly.

### Clean chat panels

`services/chatPanel.ts` tracks private-chat UI message groups in memory. Use `panelReply` for transient screens and `beginPanel` between progress and results within one update. It edits one-message panels or replaces multipart panels after successful send; cleanup is best effort. Errors and scheduled reminders use ordinary replies and remain in history. Voice input is removed only after a successful confirmation preview. Do not globally intercept sendMessage or sweep untracked chat history.

### Navigation

`panelReply` ensures inline screens have Back and Home controls, while persistent keyboard includes a Back key. Supply explicit parent callbacks where needed: time selection, task cards, importance, edit fields and confirmation flows. Home cancels unsaved brain/removal drafts and input/scenes. Validate ownership and draft expiry before navigation or confirmation; stale buttons must not save after Home.

### Context reply keyboards

`services/contextKeyboard.ts` translates callback-backed inline screen definitions into contextual reply keyboards and maps their text taps back to the validated handlers. Mount it behind allowlist and before commands/scenes. `panelReply` remembers mappings only after successful send, clears them for the main keyboard and replaces old panels because Telegram reply keyboards cannot be edited into a message. Main keyboard has five sections and no navigation/task mutation shortcuts. Preserve actual callback ownership/expiry validation; synthetic callbacks must never call Telegram answerCallbackQuery.

### Voice failures

`commands/voice.ts` removes its own transient status on every exit. `services/voiceError.ts` exposes only fixed stage/code/status diagnostics, never raw download errors (URLs can contain Telegram tokens). Keep the original voice on failures; forwarding it retries without recording again. `removePanelMessage` removes a specific status without deleting a newer menu.

`services/localVoice.ts` runs `scripts/transcribeVoice.py` with audio on stdin, shell disabled, bounded output/time and one worker. Python uses CPU int8 faster-whisper. Never log process stderr or send audio to an API in local mode. Existing configurations without `VOICE_TRANSCRIPTION_PROVIDER` retain Gemini transcription. See `docs/LOCAL_VOICE.md` for setup.

`services/pendingInputs.ts` persists failed brain/removal text for 24 hours in an ignored local runtime file. Ownership/chat checks apply to retries; background polling checks the allowlist. Only temporary failures receive at most two background retries. Billing/auth errors require manual retry. Menu cancellation pauses retries and suppresses late drafts. Every retry produces a confirmation preview, never an automatic storage mutation. Schema fallback requests must not retry provider quota errors; `services/aiFailure.ts` classifies errors without exposing raw payloads.

### Draft category review

`commands/brain.ts` previews AI category proposals as unreviewed and supports sequential review or paginated selection before storage. Draft indices stay stable across category changes (do not renumber by quadrant). Manual selections call `setQuadrant` and persist `priorityLocked`; callbacks enforce owner, chat, expiry and saving state. Review requires no extra AI requests.

### Completion picker continuity

`showCompletePicker` refreshes the pending-task keyboard after each confirmed save, clamping pagination when the last page becomes empty. Completion moves the task from uncompleted to completed. `panelNotice` sends a tracked inline Back notice without replacing the persistent keyboard or its action mapping; later screen cleanup removes the notice with its picker. Task-card completion similarly returns to the remaining scoped task picker.

### Compact keyboards and domain tags

`buildContextKeyboard` lays out two action buttons per row and paginates more than six actions with chat-bound expiring `kbd` callbacks. Navigation stays available across pages; abbreviated label collisions are disambiguated. Pass message text/options from `panelReply` so keyboard-page navigation retains the full screen and parse mode. Task pickers use six items per page. `returnToTaskList` refreshes live tasks and preserves the Today filter after deletion; calendar prompts can use tracked inline notices to preserve the list keyboard.

`services/taskTags.ts` owns the domain taxonomy, AI prompt and whitelist normalization. AI-generated task tags use the existing generation request; explicit user hashtags remain supported. New list/single tasks and edited names use these tags. Display tags in the matrix, draft and task card. Vocabulary validation does not guarantee semantic correctness; users can edit Tags. Do not automatically overwrite existing tags in storage when changing the vocabulary. See `docs/BOT_UI.md` for message/button editing.

### Conversational assistant

`commands/assistant.ts` and `/talk` open a private-chat conversation with live task context. `services/assistantHistory.ts` stores at most six exchanges per owner/chat in an ignored runtime file, expiring after seven days. The model returns discussion or a suggested add/remove input, never executes writes. Suggested operations go through existing confirmation drafts. Menu/command navigation cancels late responses; history reset must leave tasks intact. Voice routes to this mode only while active. Log only safe diagnostics. See `docs/SHARED_ASSISTANT.md` for tone settings and shared GitHub access from ChatGPT; this does not synchronize ChatGPT account history.

### User profiles

`services/userScope.ts` uses AsyncLocalStorage around allowlisted private updates.
Explicit `BOT_OWNER_ID` retains the owner's FILE_PATH; other users resolve to sibling
users/<id>.md files. Never mutate process.env for request routing. Missing storage
scope fails closed in profile mode. Wrap every background task (reminders, retries,
GitHub notifications) with runForUser. Multiple allowlisted users require an explicit
owner, and profile mode rejects Notion. Google Calendar is owner-only at the client
operation boundary; do not expose its prompts to testers.

### Test usage statistics

`services/usageStats.ts` counts allowlisted non-owner private interactions in an
ignored local aggregate store. Mount after user scope and before keyboard/scene
routing; `/stats` must remain owner-only. A first-use notice precedes collection.
Never persist message text, task content, audio, callback payloads or raw errors in
statistics. Logger hooks deduplicate errors per AsyncLocalStorage interaction;
`saveTasks` counts successful writes only. Background jobs must not inherit usage
interaction scopes. `checkReminders` prunes 30-day inactive rows.

Draft deletion uses `Draft.removed` tombstones in `commands/brain.ts`. Keep original
indices stable, skip removed entries in previews/pickers/sequential review and saves,
and reject old category/delete callbacks for removed entries. Removing the final
entry invalidates the entire draft without writing storage.

### Task-list refresh after mutations

Task-card completion, field edits, quadrant changes and lock toggles return through
`returnToTaskList` after confirmed storage saves. Re-query live tasks, preserve the
Today filter, regenerate display numbers and invalidate prior menu IDs. Back-to-list
and pagination also render the full live list. `showCompletePicker` includes a
chunked matrix while retaining completion controls; keep calendar prompts as
`panelNotice` so they do not replace the refreshed list keyboard.
