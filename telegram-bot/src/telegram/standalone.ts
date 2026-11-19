import pino from "pino";
import { startTelegramBot } from "./bot";
import { telegramSqlClient } from "./postgres";

const token = process.env["TELEGRAM_BOT_TOKEN"];
const superAdminId = process.env["SUPER_ADMIN_TELEGRAM_ID"];

if (!token || !superAdminId) {
  throw new Error(
    "TELEGRAM_BOT_TOKEN and SUPER_ADMIN_TELEGRAM_ID are required.",
  );
}

const logger = pino({
  level: process.env["LOG_LEVEL"] ?? "info",
  redact: ["req.headers.authorization", "req.headers.cookie"],
});
const shutdown = new AbortController();

process.once("SIGINT", () => shutdown.abort());
process.once("SIGTERM", () => shutdown.abort());

startTelegramBot({
  token,
  superAdminId,
  sql: telegramSqlClient,
  logger,
  signal: shutdown.signal,
}).catch((error: unknown) => {
  logger.error(
    { error: error instanceof Error ? error.message : "Unknown error" },
    "Telegram bot stopped unexpectedly",
  );
  process.exitCode = 1;
});
