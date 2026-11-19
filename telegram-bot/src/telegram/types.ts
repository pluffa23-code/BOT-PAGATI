export type SessionState =
  | {
      kind: "receipt";
      step: "amount" | "vendor" | "buyer" | "product" | "quantity" | "confirm";
      flowId: string;
      amount?: string;
      vendor?: string;
      buyer?: string;
      productId?: number;
      productName?: string;
      quantity?: number;
    }
  | {
      kind: "production";
      step: "product" | "quantity" | "employee" | "confirm";
      flowId: string;
      productId?: number;
      productName?: string;
      quantity?: number;
      employee?: string;
    }
  | { kind: "product_add"; step: "name" }
  | { kind: "admin_add"; step: "id" };

export interface SqlClient {
  query<Row extends object = Record<string, unknown>>(
    statement: string,
    values?: unknown[],
  ): Promise<{ rows: Row[] }>;
}

export interface BotLogger {
  info(fields: object, message: string): void;
  warn(fields: object, message: string): void;
  error(fields: object, message: string): void;
  debug?(fields: object, message: string): void;
}

export interface TelegramUser {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
}

export interface TelegramChat {
  id: number;
  type: string;
}

export interface TelegramMessage {
  message_id: number;
  chat: TelegramChat;
  from?: TelegramUser;
  text?: string;
}

export interface TelegramCallbackQuery {
  id: string;
  from: TelegramUser;
  data?: string;
  message?: TelegramMessage;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
}

export interface InlineKeyboardButton {
  text: string;
  callback_data: string;
}

export interface InlineKeyboardMarkup {
  inline_keyboard: InlineKeyboardButton[][];
}

export interface TelegramApiResult<T> {
  ok: boolean;
  result?: T;
  description?: string;
}

export interface TelegramBotOptions {
  token: string;
  superAdminId: string;
  sql: SqlClient;
  logger: BotLogger;
  signal: AbortSignal;
}
