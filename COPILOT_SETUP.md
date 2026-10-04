# Personal Telegram Copilot

First version: `/now` recommends one available task and two alternatives.
`/now 30` supplies available minutes. It does not create calendar blocks.
Ranking uses priority, planned date and duration. Dates are not deadlines.
Future scheduled tasks are excluded; long tasks can be suggested as partial work.
AI is used by the existing `/add` parser, not by `/now`.

## First local run

1. Install Bun and clone this repository, then check out `feature/daily-copilot-now`.
2. Run `bun install` and copy `.env.example` to `.env`.
3. Set `TELEGRAM_BOT_TOKEN` from BotFather and `TELEGRAM_BOT_ALLOWLIST` to your numeric Telegram **user ID**.
4. Create a separate **private** GitHub repository for personal tasks. The code repository is public. Set `FILE_PATH` to `https://github.com/OWNER/PRIVATE-REPO/blob/main/task-table.md`. The bot initializes the file if missing.
5. Set `PROVIDER_API_KEY` to a fine-grained GitHub token limited to that private repository with Contents read/write. The ChatGPT connector credentials do not carry over to the bot.
6. Select an AI provider/model and set its key for `/add`. For Gemini, the correct name is `GOOGLE_GENERATIVE_AI_API_KEY`. For OpenAI, use `OPENAI_API_KEY` with `AI_PROVIDER=openai` and a model available on your API account.
7. Run `bun run start:polling`. No hosting, public URL or Google Calendar is required for this trial. Run only one polling process. The process refuses to start when a webhook is active.
8. In Telegram: `/settimezone Europe/Berlin`, `/add Изучить одну тему сопромата #study`, `/list`, `/now`, `/now 30`, then `/complete` with the task name.

Keep keys in `.env` or a hosting service's secret settings; never commit them or send them in chat. API billing is separate from a ChatGPT subscription. Local polling works while the computer and process are running. For continuous use, deploy the existing webhook app to a hosting provider later.

## Verification

`bun run typecheck`, `bun run lint`, `bun test src/services/priorityEngine.test.ts`.
