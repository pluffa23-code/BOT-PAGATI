import { randomUUID } from "node:crypto";
import { cleanText, formatBotMessage, formatEuro, formatTimestamp, parseEuroAmount } from "./format";
import { TelegramClient } from "./client";
import {
  addAdmin,
  addProduct,
  bootstrapSuperAdmin,
  clearSession,
  createProduction,
  createReceipt,
  deactivateProduct,
  getActiveProduct,
  getDashboardSummary,
  getProductStats,
  getSession,
  getTelegramUserProfile,
  isAdmin,
  isSuperAdmin,
  listActiveProducts,
  listAdmins,
  listProductions,
  listProductsPage,
  listReceipts,
  setSession,
  upsertTelegramUser,
} from "./store";
import type {
  BotLogger,
  InlineKeyboardButton,
  InlineKeyboardMarkup,
  SessionState,
  SqlClient,
  TelegramCallbackQuery,
  TelegramMessage,
  TelegramUpdate,
} from "./types";

const PAGE_SIZE = 6;

interface BotContext {
  api: TelegramClient;
  sql: SqlClient;
  logger: BotLogger;
}

interface EditTarget {
  messageId: number;
}

function keyboard(rows: InlineKeyboardButton[][]): InlineKeyboardMarkup {
  return { inline_keyboard: rows };
}

function formatTelegramIdentity(user: {
  username?: string | null;
  first_name?: string | null;
  last_name?: string | null;
}): string {
  if (user.username) {
    return `@${user.username.replace(/^@/, "")}`;
  }
  const name = [user.first_name, user.last_name]
    .filter((part): part is string => Boolean(part?.trim()))
    .join(" ");
  return name || "username non disponibile";
}

function menuKeyboard(admin: boolean): InlineKeyboardMarkup {
  const rows: InlineKeyboardButton[][] = [
    [{ text: "Nuovo scontrino", callback_data: "menu:receipt" }],
    [{ text: "Registra produzione", callback_data: "menu:production" }],
  ];
  if (admin) {
    rows.push([{ text: "Dashboard", callback_data: "menu:dashboard" }]);
  }
  return keyboard(rows);
}

function cancelKeyboard(): InlineKeyboardMarkup {
  return keyboard([[{ text: "Annulla", callback_data: "flow:cancel" }]]);
}

async function display(
  context: BotContext,
  chatId: string,
  action: string,
  emoji: string,
  detail: string,
  replyMarkup?: InlineKeyboardMarkup,
  editTarget?: EditTarget,
): Promise<void> {
  const text = formatBotMessage(action, emoji, detail);
  if (editTarget) {
    try {
      await context.api.editMessageText(
        chatId,
        editTarget.messageId,
        text,
        replyMarkup,
      );
      return;
    } catch (error) {
      context.logger.debug?.(
        { error: errorName(error) },
        "Could not edit Telegram message; sending a new one",
      );
    }
  }
  await context.api.sendMessage(chatId, text, replyMarkup);
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : "UnknownError";
}

async function showHome(
  context: BotContext,
  chatId: string,
  userId: string,
  target?: EditTarget,
): Promise<void> {
  await clearSession(context.sql, userId);
  const admin = await isAdmin(context.sql, userId);
  await display(
    context,
    chatId,
    "Menu principale",
    "👋",
    "Scegli cosa vuoi registrare.",
    menuKeyboard(admin),
    target,
  );
}

async function showNoProducts(
  context: BotContext,
  chatId: string,
  userId: string,
  target?: EditTarget,
): Promise<void> {
  await clearSession(context.sql, userId);
  const admin = await isAdmin(context.sql, userId);
  const buttons = admin
    ? keyboard([
        [{ text: "Aggiungi prodotto", callback_data: "product:add" }],
        [{ text: "Menu principale", callback_data: "menu:home" }],
      ])
    : keyboard([[{ text: "Menu principale", callback_data: "menu:home" }]]);
  await display(
    context,
    chatId,
    "Registrazione non avviata",
    "⚠️",
    "Non ci sono prodotti disponibili. Un amministratore deve aggiungerne uno prima di registrare scontrini o produzione.",
    buttons,
    target,
  );
}

async function beginReceipt(
  context: BotContext,
  chatId: string,
  userId: string,
  target?: EditTarget,
): Promise<void> {
  const products = await listActiveProducts(context.sql);
  if (products.length === 0) {
    await showNoProducts(context, chatId, userId, target);
    return;
  }
  const state: SessionState = {
    kind: "receipt",
    step: "amount",
    flowId: randomUUID(),
  };
  await setSession(context.sql, userId, state);
  await display(
    context,
    chatId,
    "Nuovo scontrino",
    "💶",
    "Inserisci l'importo in euro, ad esempio 12,50.",
    cancelKeyboard(),
    target,
  );
}

async function beginProduction(
  context: BotContext,
  chatId: string,
  userId: string,
  target?: EditTarget,
): Promise<void> {
  const products = await listActiveProducts(context.sql);
  if (products.length === 0) {
    await showNoProducts(context, chatId, userId, target);
    return;
  }
  const state: SessionState = {
    kind: "production",
    step: "product",
    flowId: randomUUID(),
  };
  await setSession(context.sql, userId, state);
  await showProductChoices(context, chatId, "production", products, target);
}

async function showProductChoices(
  context: BotContext,
  chatId: string,
  flow: "receipt" | "production",
  products: { id: number; name: string }[],
  target?: EditTarget,
): Promise<void> {
  const rows: InlineKeyboardButton[][] = [];
  for (let index = 0; index < products.length; index += 2) {
    const row = products.slice(index, index + 2).map((product) => ({
      text: product.name.slice(0, 60),
      callback_data: `${flow}:p:${product.id}`,
    }));
    rows.push(row);
  }
  rows.push([{ text: "Annulla", callback_data: "flow:cancel" }]);
  await display(
    context,
    chatId,
    flow === "receipt" ? "Nuovo scontrino · Prodotto" : "Nuova produzione · Prodotto",
    "📦",
    "Seleziona un prodotto.",
    keyboard(rows),
    target,
  );
}

async function askReceiptProduct(
  context: BotContext,
  chatId: string,
  userId: string,
  state: Extract<SessionState, { kind: "receipt" }>,
  target?: EditTarget,
): Promise<void> {
  const products = await listActiveProducts(context.sql);
  if (products.length === 0) {
    await showNoProducts(context, chatId, userId, target);
    return;
  }
  const nextState: SessionState = { ...state, step: "product" };
  await setSession(context.sql, userId, nextState);
  await showProductChoices(context, chatId, "receipt", products, target);
}

async function startProductAdd(
  context: BotContext,
  chatId: string,
  userId: string,
  target?: EditTarget,
): Promise<void> {
  if (!(await requireAdmin(context, chatId, userId))) {
    return;
  }
  await setSession(context.sql, userId, { kind: "product_add", step: "name" });
  await display(
    context,
    chatId,
    "Aggiungi prodotto",
    "✍️",
    "Scrivi il nome del prodotto. Gli utenti lo vedranno come pulsante nei moduli.",
    cancelKeyboard(),
    target,
  );
}

async function startProductDelete(
  context: BotContext,
  chatId: string,
  userId: string,
  productId: number,
  target?: EditTarget,
): Promise<void> {
  if (!(await requireAdmin(context, chatId, userId))) {
    return;
  }
  const product = await getActiveProduct(context.sql, productId);
  if (!product) {
    await display(
      context,
      chatId,
      "Prodotto non disponibile",
      "ℹ️",
      "Il prodotto è già stato rimosso oppure non esiste.",
      keyboard([[{ text: "Gestisci prodotti", callback_data: "page:products:0" }]]),
      target,
    );
    return;
  }
  await display(
    context,
    chatId,
    "Rimuovi prodotto",
    "🗑️",
    `Vuoi rimuovere ${product.name} dai moduli? Gli scontrini e le produzioni già registrati resteranno consultabili.`,
    keyboard([
      [{ text: "Conferma rimozione", callback_data: `product:delete-confirm:${product.id}` }],
      [{ text: "Annulla", callback_data: "product:delete-cancel" }],
    ]),
    target,
  );
}

async function confirmProductDelete(
  context: BotContext,
  chatId: string,
  userId: string,
  productId: number,
  target?: EditTarget,
): Promise<void> {
  if (!(await requireAdmin(context, chatId, userId))) {
    return;
  }
  const deleted = await deactivateProduct(context.sql, productId);
  await display(
    context,
    chatId,
    deleted ? "Prodotto rimosso" : "Prodotto già rimosso",
    deleted ? "✅" : "ℹ️",
    deleted
      ? "Non apparirà più nei moduli. I registri precedenti sono stati conservati."
      : "Nessun dato è stato modificato.",
    keyboard([
      [{ text: "Gestisci prodotti", callback_data: "page:products:0" }],
      [{ text: "Dashboard", callback_data: "menu:dashboard" }],
    ]),
    target,
  );
}

async function startAdminAdd(
  context: BotContext,
  chatId: string,
  userId: string,
  target?: EditTarget,
): Promise<void> {
  if (!(await requireSuperAdmin(context, chatId, userId))) {
    return;
  }
  await setSession(context.sql, userId, { kind: "admin_add", step: "id" });
  await display(
    context,
    chatId,
    "Aggiungi amministratore",
    "🛡️",
    "Inserisci l'ID numerico Telegram dell'utente. Può inviare /id al bot per visualizzarlo.",
    cancelKeyboard(),
    target,
  );
}

async function requireAdmin(
  context: BotContext,
  chatId: string,
  userId: string,
): Promise<boolean> {
  if (await isAdmin(context.sql, userId)) {
    return true;
  }
  await display(
    context,
    chatId,
    "Accesso non autorizzato",
    "🔒",
    "Questa funzione è riservata agli amministratori.",
  );
  return false;
}

async function requireSuperAdmin(
  context: BotContext,
  chatId: string,
  userId: string,
): Promise<boolean> {
  if (await isSuperAdmin(context.sql, userId)) {
    return true;
  }
  await display(
    context,
    chatId,
    "Accesso non autorizzato",
    "🔒",
    "Solo l'amministratore principale può gestire gli amministratori.",
  );
  return false;
}

async function showDashboard(
  context: BotContext,
  chatId: string,
  userId: string,
  target?: EditTarget,
): Promise<void> {
  if (!(await requireAdmin(context, chatId, userId))) {
    return;
  }
  const [summary, products, superAdmin] = await Promise.all([
    getDashboardSummary(context.sql),
    getProductStats(context.sql, 0, 4),
    isSuperAdmin(context.sql, userId),
  ]);
  const productLines = products.length
    ? products.map(
        (product) =>
          `• ${product.name}: ${product.receipt_count} scontrini · ${product.receipt_quantity} unità · ${formatEuro(product.receipt_total)} · ${product.production_quantity} prodotti`,
      )
    : ["• Nessun prodotto registrato"];
  const rows: InlineKeyboardButton[][] = [
    [
      { text: "Scontrini", callback_data: "page:receipts:0" },
      { text: "Produzione", callback_data: "page:production:0" },
    ],
    [{ text: "Prodotti", callback_data: "page:products:0" }],
  ];
  if (superAdmin) {
    rows.push([{ text: "Amministratori", callback_data: "page:admins:0" }]);
  }
  rows.push([
    { text: "Nuovo scontrino", callback_data: "menu:receipt" },
    { text: "Registra produzione", callback_data: "menu:production" },
  ]);
  rows.push([{ text: "Menu principale", callback_data: "menu:home" }]);
  await display(
    context,
    chatId,
    "Dashboard completa",
    "📊",
    `Scontrini: ${summary.receipt_count} · quantità ${summary.receipt_quantity} · totale ${formatEuro(summary.receipt_total)}\nProduzioni: ${summary.production_count} · quantità ${summary.production_quantity}\n\nRiepilogo prodotti:\n${productLines.join("\n")}\n\nPer consultare tutti i registri usa i pulsanti. Le liste sono consultabili a pagine.`,
    keyboard(rows),
    target,
  );
}

function pageKeyboard(
  kind: "receipts" | "production" | "products" | "admins",
  page: number,
  total: number,
  backCallback: string,
): InlineKeyboardMarkup {
  const lastPage = Math.max(0, Math.ceil(total / PAGE_SIZE) - 1);
  const navigation: InlineKeyboardButton[] = [];
  if (page > 0) {
    navigation.push({
      text: "‹ Precedente",
      callback_data: `page:${kind}:${page - 1}`,
    });
  }
  if (page < lastPage) {
    navigation.push({
      text: "Successiva ›",
      callback_data: `page:${kind}:${page + 1}`,
    });
  }
  const rows: InlineKeyboardButton[][] = [];
  if (navigation.length) {
    rows.push(navigation);
  }
  rows.push([{ text: "Indietro", callback_data: backCallback }]);
  return keyboard(rows);
}

async function showReceiptPage(
  context: BotContext,
  chatId: string,
  userId: string,
  requestedPage: number,
  target?: EditTarget,
): Promise<void> {
  if (!(await requireAdmin(context, chatId, userId))) {
    return;
  }
  const page = Math.max(0, Math.min(100_000, requestedPage));
  const result = await listReceipts(context.sql, page, PAGE_SIZE);
  const lastPage = Math.max(0, Math.ceil(result.total / PAGE_SIZE) - 1);
  const safePage = Math.min(page, lastPage);
  const data =
    safePage === page ? result : await listReceipts(context.sql, safePage, PAGE_SIZE);
  const lines = data.rows.map(
    (row) =>
      `#${row.id} · ${formatEuro(row.amount)} · ${row.product_name} · quantità ${row.quantity}\n  Venditore: ${row.vendor} · Acquirente: ${row.buyer}\n  Registrato da ${formatTelegramIdentity({ username: row.recorded_by_username, first_name: row.recorded_by_first_name, last_name: row.recorded_by_last_name })} · ${formatTimestamp(row.created_at)}`,
  );
  await display(
    context,
    chatId,
    `Registro scontrini · pagina ${safePage + 1}/${lastPage + 1}`,
    "🧾",
    lines.length ? lines.join("\n\n") : "Non ci sono scontrini registrati.",
    pageKeyboard("receipts", safePage, data.total, "menu:dashboard"),
    target,
  );
}

async function showProductionPage(
  context: BotContext,
  chatId: string,
  userId: string,
  requestedPage: number,
  target?: EditTarget,
): Promise<void> {
  if (!(await requireAdmin(context, chatId, userId))) {
    return;
  }
  const page = Math.max(0, Math.min(100_000, requestedPage));
  const result = await listProductions(context.sql, page, PAGE_SIZE);
  const lastPage = Math.max(0, Math.ceil(result.total / PAGE_SIZE) - 1);
  const safePage = Math.min(page, lastPage);
  const data =
    safePage === page
      ? result
      : await listProductions(context.sql, safePage, PAGE_SIZE);
  const lines = data.rows.map(
    (row) =>
      `#${row.id} · ${row.product_name} · quantità ${row.quantity}\n  Dipendente: ${row.employee}\n  Registrato da ${formatTelegramIdentity({ username: row.recorded_by_username, first_name: row.recorded_by_first_name, last_name: row.recorded_by_last_name })} · ${formatTimestamp(row.created_at)}`,
  );
  await display(
    context,
    chatId,
    `Registro produzione · pagina ${safePage + 1}/${lastPage + 1}`,
    "🏭",
    lines.length ? lines.join("\n\n") : "Non ci sono produzioni registrate.",
    pageKeyboard("production", safePage, data.total, "menu:dashboard"),
    target,
  );
}

async function showProductPage(
  context: BotContext,
  chatId: string,
  userId: string,
  requestedPage: number,
  target?: EditTarget,
): Promise<void> {
  if (!(await requireAdmin(context, chatId, userId))) {
    return;
  }
  const page = Math.max(0, Math.min(100_000, requestedPage));
  const [result, stats] = await Promise.all([
    listProductsPage(context.sql, page, PAGE_SIZE),
    getProductStats(context.sql, page, PAGE_SIZE),
  ]);
  const lastPage = Math.max(0, Math.ceil(result.total / PAGE_SIZE) - 1);
  const safePage = Math.min(page, lastPage);
  const data =
    safePage === page
      ? result
      : await listProductsPage(context.sql, safePage, PAGE_SIZE);
  const dataStats =
    safePage === page
      ? stats
      : await getProductStats(context.sql, safePage, PAGE_SIZE);
  const statsByName = new Map(dataStats.map((item) => [item.name, item]));
  const lines = data.rows.map((product) => {
    const statsForProduct = statsByName.get(product.name);
    return `• ${product.name}\n  Scontrini: ${statsForProduct?.receipt_count ?? "0"} · quantità ${statsForProduct?.receipt_quantity ?? "0"} · ${formatEuro(statsForProduct?.receipt_total ?? "0")}\n  Produzione: ${statsForProduct?.production_quantity ?? "0"}`;
  });
  const rows = [
    [{ text: "Aggiungi prodotto", callback_data: "product:add" }],
    ...data.rows.map((product) => [
      {
        text: `🗑️ Rimuovi ${product.name}`.slice(0, 60),
        callback_data: `product:delete:${product.id}`,
      },
    ]),
    ...pageKeyboard("products", safePage, data.total, "menu:dashboard")
      .inline_keyboard,
  ];
  await display(
    context,
    chatId,
    `Prodotti registrati · pagina ${safePage + 1}/${lastPage + 1}`,
    "📦",
    lines.length ? lines.join("\n\n") : "Nessun prodotto aggiunto.",
    keyboard(rows),
    target,
  );
}

async function showAdminPage(
  context: BotContext,
  chatId: string,
  userId: string,
  requestedPage: number,
  target?: EditTarget,
): Promise<void> {
  if (!(await requireSuperAdmin(context, chatId, userId))) {
    return;
  }
  const admins = await listAdmins(context.sql);
  const page = Math.max(0, Math.min(100_000, requestedPage));
  const lastPage = Math.max(0, Math.ceil(admins.length / PAGE_SIZE) - 1);
  const safePage = Math.min(page, lastPage);
  const pageAdmins = admins.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);
  const lines = pageAdmins.map(
    (admin) =>
      `${admin.is_super_admin ? "★ Principale" : "• Amministratore"} · ${formatTelegramIdentity(admin)}`,
  );
  const rows = [
    [{ text: "Aggiungi amministratore", callback_data: "admin:add" }],
    ...pageKeyboard("admins", safePage, admins.length, "menu:dashboard")
      .inline_keyboard,
  ];
  await display(
    context,
    chatId,
    `Amministratori · pagina ${safePage + 1}/${lastPage + 1}`,
    "🛡️",
    lines.length ? lines.join("\n") : "Nessun amministratore aggiunto.",
    keyboard(rows),
    target,
  );
}

async function handleMessage(
  context: BotContext,
  message: TelegramMessage,
): Promise<void> {
  if (message.chat.type !== "private" || !message.from) {
    return;
  }
  const chatId = String(message.chat.id);
  const userId = String(message.from.id);
  await upsertTelegramUser(context.sql, {
    telegramUserId: userId,
    username: message.from.username,
    firstName: message.from.first_name,
    lastName: message.from.last_name,
  });
  const text = message.text?.trim() ?? "";
  const command = text.split(/\s/, 1)[0]?.toLowerCase().replace(/@[^/]+$/, "");

  if (command === "/start") {
    await showHome(context, chatId, userId);
    return;
  }
  if (command === "/cancel") {
    await cancelFlow(context, chatId, userId);
    return;
  }
  if (command === "/id") {
    await display(
      context,
      chatId,
      "Dati per l'aggiunta admin",
      "🪪",
      `Utente: ${formatTelegramIdentity(message.from)}\nID numerico da fornire all'amministratore: ${userId}`,
    );
    return;
  }
  if (command === "/receipt" || command === "/scontrino" || text === "Nuovo scontrino") {
    await beginReceipt(context, chatId, userId);
    return;
  }
  if (
    command === "/production" ||
    command === "/produzione" ||
    text === "Registra produzione"
  ) {
    await beginProduction(context, chatId, userId);
    return;
  }
  if (command === "/dashboard" || text === "Dashboard") {
    await showDashboard(context, chatId, userId);
    return;
  }
  if (text === "Prodotti") {
    await showProductPage(context, chatId, userId, 0);
    return;
  }
  if (text === "Amministratori") {
    await showAdminPage(context, chatId, userId, 0);
    return;
  }

  const state = await getSession(context.sql, userId);
  if (!state) {
    await display(
      context,
      chatId,
      "Nessuna registrazione attiva",
      "💬",
      "Usa i pulsanti qui sotto oppure /start per aprire il menu.",
      menuKeyboard(await isAdmin(context.sql, userId)),
    );
    return;
  }

  if (state.kind === "receipt") {
    await handleReceiptInput(context, chatId, userId, text, state);
    return;
  }
  if (state.kind === "production") {
    await handleProductionInput(context, chatId, userId, text, state);
    return;
  }
  if (state.kind === "product_add") {
    if (!(await requireAdmin(context, chatId, userId))) {
      await clearSession(context.sql, userId);
      return;
    }
    const name = cleanText(text, 80);
    if (!name) {
      await display(
        context,
        chatId,
        "Nome prodotto non valido",
        "⚠️",
        "Inserisci un nome da 1 a 80 caratteri.",
        cancelKeyboard(),
      );
      return;
    }
    const created = await addProduct(context.sql, name, userId);
    await clearSession(context.sql, userId);
    await display(
      context,
      chatId,
      created ? "Prodotto aggiunto" : "Prodotto già presente",
      created ? "✅" : "ℹ️",
      created
        ? `${name} è disponibile come pulsante nei moduli.`
        : `Esiste già un prodotto chiamato ${name}.`,
      keyboard([
        [{ text: "Gestisci prodotti", callback_data: "page:products:0" }],
        [{ text: "Dashboard", callback_data: "menu:dashboard" }],
      ]),
    );
    return;
  }
  if (state.kind === "admin_add") {
    if (!(await requireSuperAdmin(context, chatId, userId))) {
      await clearSession(context.sql, userId);
      return;
    }
    const targetId = text.trim();
    if (!/^\d{1,20}$/.test(targetId)) {
      await display(
        context,
        chatId,
        "ID Telegram non valido",
        "⚠️",
        "Inserisci solo l'ID numerico, oppure invia /cancel.",
        cancelKeyboard(),
      );
      return;
    }
    if (targetId === userId) {
      await display(
        context,
        chatId,
        "Amministratore già attivo",
        "ℹ️",
        "Sei già l'amministratore principale.",
        keyboard([[{ text: "Amministratori", callback_data: "page:admins:0" }]]),
      );
      await clearSession(context.sql, userId);
      return;
    }
    const created = await addAdmin(context.sql, targetId, userId);
    await clearSession(context.sql, userId);
    await display(
      context,
      chatId,
      created ? "Amministratore aggiunto" : "Amministratore già presente",
      created ? "✅" : "ℹ️",
      created
        ? `Permessi assegnati a ${formatTelegramIdentity((await getTelegramUserProfile(context.sql, targetId)) ?? {})}. La persona deve avviare il bot con /start per essere riconosciuta.`
        : `L'utente richiesto è già amministratore.`,
      keyboard([[{ text: "Amministratori", callback_data: "page:admins:0" }]]),
    );
  }
}

async function handleReceiptInput(
  context: BotContext,
  chatId: string,
  userId: string,
  text: string,
  state: Extract<SessionState, { kind: "receipt" }>,
): Promise<void> {
  if (state.step === "amount") {
    const amount = parseEuroAmount(text);
    if (!amount) {
      await display(
        context,
        chatId,
        "Importo non valido",
        "⚠️",
        "Inserisci un importo positivo, con al massimo due decimali. Esempio: 12,50.",
        cancelKeyboard(),
      );
      return;
    }
    await setSession(context.sql, userId, { ...state, amount, step: "vendor" });
    await display(context, chatId, "Nuovo scontrino · Venditore", "🏪", "Inserisci il venditore.", cancelKeyboard());
    return;
  }
  if (state.step === "vendor") {
    const vendor = cleanText(text);
    if (!vendor) {
      await display(context, chatId, "Venditore non valido", "⚠️", "Inserisci un nome da 1 a 120 caratteri.", cancelKeyboard());
      return;
    }
    await setSession(context.sql, userId, { ...state, vendor, step: "buyer" });
    await display(context, chatId, "Nuovo scontrino · Acquirente", "👤", "Inserisci l'acquirente.", cancelKeyboard());
    return;
  }
  if (state.step === "buyer") {
    const buyer = cleanText(text);
    if (!buyer) {
      await display(context, chatId, "Acquirente non valido", "⚠️", "Inserisci un nome da 1 a 120 caratteri.", cancelKeyboard());
      return;
    }
    await askReceiptProduct(context, chatId, userId, { ...state, buyer });
    return;
  }
  if (state.step === "product") {
    await display(context, chatId, "Seleziona il prodotto", "👇", "Usa uno dei pulsanti disponibili, oppure annulla la registrazione.", cancelKeyboard());
    return;
  }
  if (state.step === "quantity") {
    const normalized = text.trim();
    if (!/^\d{1,9}$/.test(normalized) || Number(normalized) < 1) {
      await display(
        context,
        chatId,
        "Quantità non valida",
        "⚠️",
        "Inserisci una quantità intera maggiore di zero.",
        cancelKeyboard(),
      );
      return;
    }
    const next: SessionState = {
      ...state,
      quantity: Number(normalized),
      step: "confirm",
    };
    await setSession(context.sql, userId, next);
    await display(
      context,
      chatId,
      "Riepilogo scontrino",
      "🧾",
      `Importo: ${formatEuro(next.amount ?? "0")}\nVenditore: ${next.vendor}\nAcquirente: ${next.buyer}\nProdotto: ${next.productName}\nQuantità: ${next.quantity}\n\nConfermi il salvataggio?`,
      keyboard([
        [{ text: "Conferma", callback_data: "receipt:confirm" }],
        [{ text: "Annulla", callback_data: "flow:cancel" }],
      ]),
    );
    return;
  }
  await display(context, chatId, "Conferma in attesa", "👇", "Conferma o annulla usando i pulsanti del riepilogo.", cancelKeyboard());
}

async function handleProductionInput(
  context: BotContext,
  chatId: string,
  userId: string,
  text: string,
  state: Extract<SessionState, { kind: "production" }>,
): Promise<void> {
  if (state.step === "product") {
    await display(context, chatId, "Seleziona il prodotto", "👇", "Usa uno dei pulsanti disponibili, oppure annulla la registrazione.", cancelKeyboard());
    return;
  }
  if (state.step === "quantity") {
    const normalized = text.trim();
    if (!/^\d{1,9}$/.test(normalized) || Number(normalized) < 1) {
      await display(context, chatId, "Quantità non valida", "⚠️", "Inserisci una quantità intera maggiore di zero.", cancelKeyboard());
      return;
    }
    await setSession(context.sql, userId, {
      ...state,
      quantity: Number(normalized),
      step: "employee",
    });
    await display(context, chatId, "Produzione · Dipendente", "👷", "Inserisci il nome del dipendente.", cancelKeyboard());
    return;
  }
  if (state.step === "employee") {
    const employee = cleanText(text);
    if (!employee) {
      await display(context, chatId, "Dipendente non valido", "⚠️", "Inserisci un nome da 1 a 120 caratteri.", cancelKeyboard());
      return;
    }
    const next: SessionState = { ...state, employee, step: "confirm" };
    await setSession(context.sql, userId, next);
    await display(
      context,
      chatId,
      "Riepilogo produzione",
      "🏭",
      `Prodotto: ${next.productName}\nQuantità: ${next.quantity}\nDipendente: ${next.employee}\n\nConfermi la registrazione?`,
      keyboard([
        [{ text: "Conferma", callback_data: "production:confirm" }],
        [{ text: "Annulla", callback_data: "flow:cancel" }],
      ]),
    );
    return;
  }
  await display(context, chatId, "Conferma in attesa", "👇", "Conferma o annulla usando i pulsanti del riepilogo.", cancelKeyboard());
}

async function handleCallback(
  context: BotContext,
  callback: TelegramCallbackQuery,
): Promise<void> {
  const message = callback.message;
  if (!message || message.chat.type !== "private") {
    return;
  }
  await context.api.answerCallbackQuery(callback.id);
  const chatId = String(message.chat.id);
  const userId = String(callback.from.id);
  await upsertTelegramUser(context.sql, {
    telegramUserId: userId,
    username: callback.from.username,
    firstName: callback.from.first_name,
    lastName: callback.from.last_name,
  });
  const data = callback.data ?? "";
  const target = { messageId: message.message_id };

  if (data === "flow:cancel") {
    await cancelFlow(context, chatId, userId, target);
    return;
  }
  if (data === "menu:home") {
    await showHome(context, chatId, userId, target);
    return;
  }
  if (data === "menu:receipt") {
    await beginReceipt(context, chatId, userId, target);
    return;
  }
  if (data === "menu:production") {
    await beginProduction(context, chatId, userId, target);
    return;
  }
  if (data === "menu:dashboard") {
    await clearSession(context.sql, userId);
    await showDashboard(context, chatId, userId, target);
    return;
  }
  if (data === "product:add") {
    await startProductAdd(context, chatId, userId, target);
    return;
  }
  const deleteProductMatch = /^product:delete:(\d+)$/.exec(data);
  if (deleteProductMatch) {
    await startProductDelete(context, chatId, userId, Number(deleteProductMatch[1]), target);
    return;
  }
  const confirmDeleteMatch = /^product:delete-confirm:(\d+)$/.exec(data);
  if (confirmDeleteMatch) {
    await confirmProductDelete(context, chatId, userId, Number(confirmDeleteMatch[1]), target);
    return;
  }
  if (data === "product:delete-cancel") {
    await showProductPage(context, chatId, userId, 0, target);
    return;
  }
  if (data === "admin:add") {
    await startAdminAdd(context, chatId, userId, target);
    return;
  }
  if (data.startsWith("receipt:p:")) {
    await selectReceiptProduct(context, chatId, userId, data, target);
    return;
  }
  if (data.startsWith("production:p:")) {
    await selectProductionProduct(context, chatId, userId, data, target);
    return;
  }
  if (data === "receipt:confirm") {
    await confirmReceipt(context, chatId, userId, target);
    return;
  }
  if (data === "production:confirm") {
    await confirmProduction(context, chatId, userId, target);
    return;
  }
  const pageMatch = /^page:(receipts|production|products|admins):(\d{1,6})$/.exec(data);
  if (pageMatch) {
    const kind = pageMatch[1];
    const page = Number(pageMatch[2]);
    if (kind === "receipts") {
      await showReceiptPage(context, chatId, userId, page, target);
    } else if (kind === "production") {
      await showProductionPage(context, chatId, userId, page, target);
    } else if (kind === "products") {
      await showProductPage(context, chatId, userId, page, target);
    } else {
      await showAdminPage(context, chatId, userId, page, target);
    }
    return;
  }
  await display(
    context,
    chatId,
    "Pulsante non più attivo",
    "ℹ️",
    "Usa /start per aprire il menu aggiornato.",
    menuKeyboard(await isAdmin(context.sql, userId)),
    target,
  );
}

async function selectReceiptProduct(
  context: BotContext,
  chatId: string,
  userId: string,
  data: string,
  target: EditTarget,
): Promise<void> {
  const state = await getSession(context.sql, userId);
  const match = /^receipt:p:(\d+)$/.exec(data);
  if (!match || !state || state.kind !== "receipt" || state.step !== "product") {
    await display(context, chatId, "Selezione scaduta", "ℹ️", "Avvia di nuovo la registrazione con /scontrino.", undefined, target);
    return;
  }
  const product = await getActiveProduct(context.sql, Number(match[1]));
  if (!product) {
    await askReceiptProduct(context, chatId, userId, state, target);
    return;
  }
  const next: SessionState = {
    ...state,
    step: "quantity",
    productId: product.id,
    productName: product.name,
  };
  await setSession(context.sql, userId, next);
  await display(
    context,
    chatId,
    "Nuovo scontrino · Quantità",
    "🔢",
    "Inserisci la quantità acquistata come numero intero.",
    cancelKeyboard(),
    target,
  );
}

async function selectProductionProduct(
  context: BotContext,
  chatId: string,
  userId: string,
  data: string,
  target: EditTarget,
): Promise<void> {
  const state = await getSession(context.sql, userId);
  const match = /^production:p:(\d+)$/.exec(data);
  if (!match || !state || state.kind !== "production" || state.step !== "product") {
    await display(context, chatId, "Selezione scaduta", "ℹ️", "Avvia di nuovo la registrazione con /produzione.", undefined, target);
    return;
  }
  const product = await getActiveProduct(context.sql, Number(match[1]));
  if (!product) {
    await beginProduction(context, chatId, userId, target);
    return;
  }
  await setSession(context.sql, userId, {
    ...state,
    step: "quantity",
    productId: product.id,
    productName: product.name,
  });
  await display(
    context,
    chatId,
    "Registrazione produzione · Quantità",
    "🔢",
    "Inserisci la quantità prodotta come numero intero.",
    cancelKeyboard(),
    target,
  );
}

async function confirmReceipt(
  context: BotContext,
  chatId: string,
  userId: string,
  target: EditTarget,
): Promise<void> {
  const state = await getSession(context.sql, userId);
  if (
    !state ||
    state.kind !== "receipt" ||
    state.step !== "confirm" ||
    !state.amount ||
    !state.vendor ||
    !state.buyer ||
    !state.productId ||
    !(state.quantity ?? 1)
  ) {
    await display(context, chatId, "Riepilogo scaduto", "ℹ️", "Avvia un nuovo scontrino con /scontrino.", undefined, target);
    return;
  }
  const result = await createReceipt(context.sql, {
    flowId: state.flowId,
    amount: state.amount,
    vendor: state.vendor,
    buyer: state.buyer,
    quantity: state.quantity ?? 1,
    productId: state.productId,
    recordedBy: userId,
  });
  if (result.productUnavailable || result.id === null) {
    await askReceiptProduct(context, chatId, userId, { ...state, step: "buyer" }, target);
    return;
  }
  await clearSession(context.sql, userId);
  await display(
    context,
    chatId,
    "Scontrino salvato",
    "✅",
    `Registrazione n. ${result.id} · ${formatEuro(state.amount)} · ${state.productName} · quantità ${state.quantity ?? 1}.`,
    menuKeyboard(await isAdmin(context.sql, userId)),
    target,
  );
}

async function confirmProduction(
  context: BotContext,
  chatId: string,
  userId: string,
  target: EditTarget,
): Promise<void> {
  const state = await getSession(context.sql, userId);
  if (
    !state ||
    state.kind !== "production" ||
    state.step !== "confirm" ||
    !state.productId ||
    !state.quantity ||
    !state.employee
  ) {
    await display(context, chatId, "Riepilogo scaduto", "ℹ️", "Avvia una nuova registrazione con /produzione.", undefined, target);
    return;
  }
  const result = await createProduction(context.sql, {
    flowId: state.flowId,
    productId: state.productId,
    quantity: state.quantity,
    employee: state.employee,
    recordedBy: userId,
  });
  if (result.productUnavailable || result.id === null) {
    await beginProduction(context, chatId, userId, target);
    return;
  }
  await clearSession(context.sql, userId);
  await display(
    context,
    chatId,
    "Produzione salvata",
    "✅",
    `Registrazione n. ${result.id} · ${state.quantity} · ${state.productName} · ${state.employee}.`,
    menuKeyboard(await isAdmin(context.sql, userId)),
    target,
  );
}

async function cancelFlow(
  context: BotContext,
  chatId: string,
  userId: string,
  target?: EditTarget,
): Promise<void> {
  await clearSession(context.sql, userId);
  await display(
    context,
    chatId,
    "Registrazione annullata",
    "↩️",
    "Non è stato salvato alcun dato.",
    menuKeyboard(await isAdmin(context.sql, userId)),
    target,
  );
}

async function dispatchUpdate(
  context: BotContext,
  update: TelegramUpdate,
): Promise<void> {
  if (update.message) {
    await handleMessage(context, update.message);
  }
  if (update.callback_query) {
    await handleCallback(context, update.callback_query);
  }
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

export async function startTelegramBot(options: {
  token: string;
  superAdminId: string;
  sql: SqlClient;
  logger: BotLogger;
  signal: AbortSignal;
}): Promise<void> {
  const { token, superAdminId, sql, logger, signal } = options;
  if (!token.trim()) {
    throw new Error("TELEGRAM_BOT_TOKEN is required.");
  }
  if (!/^\d{1,20}$/.test(superAdminId)) {
    throw new Error("SUPER_ADMIN_TELEGRAM_ID must be a numeric Telegram user ID.");
  }

  const api = new TelegramClient(token.trim());
  await bootstrapSuperAdmin(sql, superAdminId);

  const webhook = await api.getWebhookInfo();
  if (webhook.url) {
    throw new Error(
      "This Telegram bot already has a webhook configured. Remove it before starting long polling.",
    );
  }

  const botInfo = await api.getMe();
  await api.setMyCommands([
    { command: "start", description: "Apri il menu" },
    { command: "scontrino", description: "Registra uno scontrino" },
    { command: "produzione", description: "Registra una produzione" },
    { command: "dashboard", description: "Dashboard amministratori" },
    { command: "cancel", description: "Annulla la registrazione" },
    { command: "id", description: "Mostra il tuo ID Telegram" },
  ]);
  logger.info({ botId: botInfo.id, botUsername: botInfo.username }, "Telegram bot started");

  const context: BotContext = { api, sql, logger };
  let offset = 0;
  while (!signal.aborted) {
    let updates: TelegramUpdate[];
    try {
      updates = await api.getUpdates(offset, signal);
    } catch (error) {
      if (signal.aborted) {
        break;
      }
      logger.warn(
        { error: error instanceof Error ? error.message : "Unknown error" },
        "Telegram polling failed; retrying",
      );
      await wait(2_000, signal);
      continue;
    }

    for (const update of updates) {
      offset = update.update_id + 1;
      try {
        await dispatchUpdate(context, update);
      } catch (error) {
        logger.error(
          {
            updateId: update.update_id,
            error: error instanceof Error ? error.message : "Unknown error",
          },
          "Could not process Telegram update",
        );
        const message = update.message;
        if (message?.chat.type === "private") {
          try {
            await display(
              context,
              String(message.chat.id),
              "Operazione non completata",
              "⚠️",
              "Si è verificato un errore. Riprova oppure invia /start.",
            );
          } catch {
            logger.warn({ updateId: update.update_id }, "Could not send Telegram error response");
          }
        } else if (
          update.callback_query?.message?.chat.type === "private"
        ) {
          try {
            await display(
              context,
              String(update.callback_query.message.chat.id),
              "Operazione non completata",
              "⚠️",
              "Si è verificato un errore. Riprova oppure invia /start.",
            );
          } catch {
            logger.warn({ updateId: update.update_id }, "Could not send Telegram error response");
          }
        }
      }
    }
  }
  logger.info({}, "Telegram bot polling stopped");
}
