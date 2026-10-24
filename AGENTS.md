# Agent Guide: MD Task Manager

This document serves as the primary instruction manual for AI agents and developers working on the `md-task-manager` repository. It outlines the project structure, development workflows, code standards, and architectural constraints.

## 1. Project Overview

**Stack**: TypeScript, Bun, Hono, grammY (Telegram Bot).
**Deployment**: Vercel (Serverless).
**Database**: GitHub Markdown File (No SQL/NoSQL DB).
**AI**: Google Gemini (via `@google/genai`).

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

**Runner**: `bun test`; tests cover storage, planning, Telegram flows and reminders.

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
- `personal.ts`: Validated personal state, planning, summaries and reminder eligibility.
- `personalStore.ts`: Private GitHub state with owner/schema checks and SHA conflict handling.
- `personalNotifications.ts`: Persistent claims and delivery for personal reminders.
- `calendarLinks.ts`: Reconciles returned event IDs against fresh task snapshots without recreating events.
- `commands/personal.ts` and `views/personalView.ts`: Owner-only private-chat workflows.
- `poll.ts`: Local long polling with a minute scheduler, including Windows.
  - `githubWebhookHandler.ts`: Processes incoming webhooks.

## 6. Development Rules for Agents

For personal-system changes, read `docs/personal-system-ru.md` for privacy,
storage migration and deployment contracts. Mount authorization before scenes;
preserve export consent and explicit aggregate field selection. Keep personal
state in the private data repository. Task snapshot writes use the SHA observed
on read; a stale task snapshot must fail instead of overwriting newer data.

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
