import type {
  InlineKeyboardMarkup,
  TelegramApiResult,
  TelegramMessage,
  TelegramUpdate,
  TelegramUser,
} from "./types";

interface TelegramWebhookInfo {
  url: string;
}

interface TelegramCommand {
  command: string;
  description: string;
}

export class TelegramClient {
  private readonly baseUrl: string;

  constructor(token: string) {
    this.baseUrl = `https://api.telegram.org/bot${token}`;
  }

  private async request<T>(
    method: string,
    payload?: object,
    signal?: AbortSignal,
  ): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/${method}`, {
        method: payload ? "POST" : "GET",
        headers: payload ? { "content-type": "application/json" } : undefined,
        body: payload ? JSON.stringify(payload) : undefined,
        signal,
      });
    } catch (error) {
      if (signal?.aborted) {
        throw error;
      }
      throw new Error(`Telegram request failed (${method})`);
    }

    let body: TelegramApiResult<T>;
    try {
      body = (await response.json()) as TelegramApiResult<T>;
    } catch {
      throw new Error(`Telegram returned an unreadable response (${method})`);
    }

    if (!response.ok || !body.ok || body.result === undefined) {
      const description = body.description?.slice(0, 240) ?? "unknown error";
      throw new Error(`Telegram request failed (${method}): ${description}`);
    }

    return body.result;
  }

  async getMe(): Promise<TelegramUser> {
    return this.request<TelegramUser>("getMe");
  }

  async getWebhookInfo(): Promise<TelegramWebhookInfo> {
    return this.request<TelegramWebhookInfo>("getWebhookInfo");
  }

  async setMyCommands(commands: TelegramCommand[]): Promise<void> {
    await this.request<boolean>("setMyCommands", {
      commands,
      scope: { type: "all_private_chats" },
    });
  }

  async getUpdates(
    offset: number,
    shutdownSignal: AbortSignal,
  ): Promise<TelegramUpdate[]> {
    const signal = AbortSignal.any([
      AbortSignal.timeout(55_000),
      shutdownSignal,
    ]);
    return this.request<TelegramUpdate[]>(
      "getUpdates",
      {
        offset,
        timeout: 45,
        allowed_updates: ["message", "callback_query"],
      },
      signal,
    );
  }

  async sendMessage(
    chatId: string,
    text: string,
    replyMarkup?: InlineKeyboardMarkup,
  ): Promise<TelegramMessage> {
    return this.request<TelegramMessage>("sendMessage", {
      chat_id: chatId,
      text,
      ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
    });
  }

  async editMessageText(
    chatId: string,
    messageId: number,
    text: string,
    replyMarkup?: InlineKeyboardMarkup,
  ): Promise<TelegramMessage | true> {
    return this.request<TelegramMessage | true>("editMessageText", {
      chat_id: chatId,
      message_id: messageId,
      text,
      ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
    });
  }

  async answerCallbackQuery(
    callbackQueryId: string,
    text?: string,
    showAlert = false,
  ): Promise<void> {
    await this.request<boolean>("answerCallbackQuery", {
      callback_query_id: callbackQueryId,
      ...(text ? { text } : {}),
      ...(showAlert ? { show_alert: true } : {}),
    });
  }
}
