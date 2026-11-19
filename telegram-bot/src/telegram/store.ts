import { normalizeProductName } from "./format";
import type { SessionState, SqlClient } from "./types";

export interface ProductRow {
  id: number;
  name: string;
}

export interface AdminRow {
  telegram_user_id: string;
  is_super_admin: boolean;
  created_at: string | Date;
  username: string | null;
  first_name: string | null;
  last_name: string | null;
}

export interface TelegramUserProfile {
  username: string | null;
  first_name: string | null;
  last_name: string | null;
}

export interface DashboardSummary {
  receipt_count: string;
  receipt_total: string;
  receipt_quantity: string;
  production_count: string;
  production_quantity: string;
}

export interface ProductStatsRow {
  name: string;
  receipt_count: string;
  receipt_total: string;
  receipt_quantity: string;
  production_quantity: string;
}

export interface ReceiptRow {
  id: number;
  amount: string;
  vendor: string;
  buyer: string;
  product_name: string;
  quantity: number;
  recorded_by: string;
  recorded_by_username: string | null;
  recorded_by_first_name: string | null;
  recorded_by_last_name: string | null;
  created_at: string | Date;
}

export interface ProductionRow {
  id: number;
  quantity: number;
  employee: string;
  product_name: string;
  recorded_by: string;
  recorded_by_username: string | null;
  recorded_by_first_name: string | null;
  recorded_by_last_name: string | null;
  created_at: string | Date;
}

export interface PageResult<Row> {
  rows: Row[];
  total: number;
}

export async function bootstrapSuperAdmin(
  sql: SqlClient,
  telegramUserId: string,
): Promise<void> {
  await sql.query(
    `INSERT INTO telegram_admins (telegram_user_id, is_super_admin, added_by)
     VALUES ($1, TRUE, $1)
     ON CONFLICT (telegram_user_id)
     DO UPDATE SET is_super_admin = TRUE`,
    [telegramUserId],
  );
}

export async function isAdmin(
  sql: SqlClient,
  telegramUserId: string,
): Promise<boolean> {
  const result = await sql.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM telegram_admins WHERE telegram_user_id = $1
     ) AS exists`,
    [telegramUserId],
  );
  return result.rows[0]?.exists === true;
}

export async function isSuperAdmin(
  sql: SqlClient,
  telegramUserId: string,
): Promise<boolean> {
  const result = await sql.query<{ is_super_admin: boolean }>(
    `SELECT is_super_admin
     FROM telegram_admins
     WHERE telegram_user_id = $1`,
    [telegramUserId],
  );
  return result.rows[0]?.is_super_admin === true;
}

export async function addAdmin(
  sql: SqlClient,
  telegramUserId: string,
  addedBy: string,
): Promise<boolean> {
  const result = await sql.query<{ telegram_user_id: string }>(
    `INSERT INTO telegram_admins (telegram_user_id, is_super_admin, added_by)
     VALUES ($1, FALSE, $2)
     ON CONFLICT (telegram_user_id) DO NOTHING
     RETURNING telegram_user_id`,
    [telegramUserId, addedBy],
  );
  return result.rows.length > 0;
}

export async function listAdmins(sql: SqlClient): Promise<AdminRow[]> {
  const result = await sql.query<AdminRow>(
    `SELECT a.telegram_user_id, a.is_super_admin, a.created_at,
            u.username, u.first_name, u.last_name
     FROM telegram_admins a
     LEFT JOIN telegram_users u ON u.telegram_user_id = a.telegram_user_id
     ORDER BY is_super_admin DESC, created_at ASC`,
  );
  return result.rows;
}

export async function upsertTelegramUser(
  sql: SqlClient,
  user: {
    telegramUserId: string;
    username?: string;
    firstName?: string;
    lastName?: string;
  },
): Promise<void> {
  await sql.query(
    `INSERT INTO telegram_users
       (telegram_user_id, username, first_name, last_name, updated_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (telegram_user_id)
     DO UPDATE SET username = EXCLUDED.username,
                   first_name = EXCLUDED.first_name,
                   last_name = EXCLUDED.last_name,
                   updated_at = NOW()`,
    [
      user.telegramUserId,
      user.username ?? null,
      user.firstName ?? null,
      user.lastName ?? null,
    ],
  );
}

export async function getTelegramUserProfile(
  sql: SqlClient,
  telegramUserId: string,
): Promise<TelegramUserProfile | null> {
  const result = await sql.query<TelegramUserProfile>(
    `SELECT username, first_name, last_name
     FROM telegram_users
     WHERE telegram_user_id = $1`,
    [telegramUserId],
  );
  return result.rows[0] ?? null;
}

export async function getSession(
  sql: SqlClient,
  telegramUserId: string,
): Promise<SessionState | null> {
  const result = await sql.query<{ state: SessionState }>(
    `SELECT state FROM telegram_bot_sessions WHERE telegram_user_id = $1`,
    [telegramUserId],
  );
  return result.rows[0]?.state ?? null;
}

export async function setSession(
  sql: SqlClient,
  telegramUserId: string,
  state: SessionState,
): Promise<void> {
  await sql.query(
    `INSERT INTO telegram_bot_sessions (telegram_user_id, state, updated_at)
     VALUES ($1, $2::jsonb, NOW())
     ON CONFLICT (telegram_user_id)
     DO UPDATE SET state = EXCLUDED.state, updated_at = NOW()`,
    [telegramUserId, JSON.stringify(state)],
  );
}

export async function clearSession(
  sql: SqlClient,
  telegramUserId: string,
): Promise<void> {
  await sql.query(
    `DELETE FROM telegram_bot_sessions WHERE telegram_user_id = $1`,
    [telegramUserId],
  );
}

export async function listActiveProducts(sql: SqlClient): Promise<ProductRow[]> {
  const result = await sql.query<ProductRow>(
    `SELECT id, name
     FROM telegram_products
     WHERE is_active = TRUE
     ORDER BY name ASC, id ASC`,
  );
  return result.rows;
}

export async function listProductsPage(
  sql: SqlClient,
  page: number,
  pageSize: number,
): Promise<PageResult<ProductRow>> {
  const offset = page * pageSize;
  const [countResult, rowsResult] = await Promise.all([
    sql.query<{ total: string }>(
      `SELECT COUNT(*)::text AS total
       FROM telegram_products
       WHERE is_active = TRUE`,
    ),
    sql.query<ProductRow>(
      `SELECT id, name
       FROM telegram_products
       WHERE is_active = TRUE
       ORDER BY name ASC, id ASC
       LIMIT $1 OFFSET $2`,
      [pageSize, offset],
    ),
  ]);
  return {
    rows: rowsResult.rows,
    total: Number(countResult.rows[0]?.total ?? "0"),
  };
}

export async function getActiveProduct(
  sql: SqlClient,
  productId: number,
): Promise<ProductRow | null> {
  const result = await sql.query<ProductRow>(
    `SELECT id, name
     FROM telegram_products
     WHERE id = $1 AND is_active = TRUE`,
    [productId],
  );
  return result.rows[0] ?? null;
}

export async function addProduct(
  sql: SqlClient,
  name: string,
  createdBy: string,
): Promise<boolean> {
  const result = await sql.query<{ id: number }>(
    `INSERT INTO telegram_products (name, normalized_name, created_by)
     VALUES ($1, $2, $3)
     ON CONFLICT (normalized_name)
     DO UPDATE SET name = EXCLUDED.name, is_active = TRUE
       WHERE telegram_products.is_active = FALSE
     RETURNING id`,
    [name, normalizeProductName(name), createdBy],
  );
  return result.rows.length > 0;
}

export async function deactivateProduct(
  sql: SqlClient,
  productId: number,
): Promise<boolean> {
  const result = await sql.query<{ id: number }>(
    `UPDATE telegram_products
     SET is_active = FALSE
     WHERE id = $1 AND is_active = TRUE
     RETURNING id`,
    [productId],
  );
  return result.rows.length > 0;
}

export async function createReceipt(
  sql: SqlClient,
  input: {
    flowId: string;
    amount: string;
    vendor: string;
    buyer: string;
    quantity: number;
    productId: number;
    recordedBy: string;
  },
): Promise<{ id: number | null; productUnavailable: boolean }> {
  const inserted = await sql.query<{ id: number }>(
    `INSERT INTO telegram_receipts
       (idempotency_key, amount, vendor, buyer, quantity, product_id, recorded_by)
     SELECT $1, $2::numeric, $3, $4, $5, p.id, $6
     FROM telegram_products p
     WHERE p.id = $7 AND p.is_active = TRUE
     ON CONFLICT (idempotency_key) DO NOTHING
     RETURNING id`,
    [
      input.flowId,
      input.amount,
      input.vendor,
      input.buyer,
      input.quantity,
      input.recordedBy,
      input.productId,
    ],
  );
  if (inserted.rows[0]) {
    return { id: inserted.rows[0].id, productUnavailable: false };
  }

  const existing = await sql.query<{ id: number }>(
    `SELECT id FROM telegram_receipts WHERE idempotency_key = $1`,
    [input.flowId],
  );
  if (existing.rows[0]) {
    return { id: existing.rows[0].id, productUnavailable: false };
  }
  return { id: null, productUnavailable: true };
}

export async function createProduction(
  sql: SqlClient,
  input: {
    flowId: string;
    productId: number;
    quantity: number;
    employee: string;
    recordedBy: string;
  },
): Promise<{ id: number | null; productUnavailable: boolean }> {
  const inserted = await sql.query<{ id: number }>(
    `INSERT INTO telegram_productions
       (idempotency_key, product_id, quantity, employee, recorded_by)
     SELECT $1, p.id, $2, $3, $4
     FROM telegram_products p
     WHERE p.id = $5 AND p.is_active = TRUE
     ON CONFLICT (idempotency_key) DO NOTHING
     RETURNING id`,
    [
      input.flowId,
      input.quantity,
      input.employee,
      input.recordedBy,
      input.productId,
    ],
  );
  if (inserted.rows[0]) {
    return { id: inserted.rows[0].id, productUnavailable: false };
  }

  const existing = await sql.query<{ id: number }>(
    `SELECT id FROM telegram_productions WHERE idempotency_key = $1`,
    [input.flowId],
  );
  if (existing.rows[0]) {
    return { id: existing.rows[0].id, productUnavailable: false };
  }
  return { id: null, productUnavailable: true };
}

export async function getDashboardSummary(
  sql: SqlClient,
): Promise<DashboardSummary> {
  const result = await sql.query<DashboardSummary>(
    `SELECT
       (SELECT COUNT(*)::text FROM telegram_receipts) AS receipt_count,
       COALESCE((SELECT SUM(amount)::text FROM telegram_receipts), '0') AS receipt_total,
       COALESCE((SELECT SUM(quantity)::text FROM telegram_receipts), '0') AS receipt_quantity,
       (SELECT COUNT(*)::text FROM telegram_productions) AS production_count,
       COALESCE((SELECT SUM(quantity)::text FROM telegram_productions), '0') AS production_quantity`,
  );
  return (
    result.rows[0] ?? {
      receipt_count: "0",
      receipt_total: "0",
      receipt_quantity: "0",
      production_count: "0",
      production_quantity: "0",
    }
  );
}

export async function getProductStats(
  sql: SqlClient,
  page = 0,
  pageSize = 5,
): Promise<ProductStatsRow[]> {
  const result = await sql.query<ProductStatsRow>(
    `SELECT
       p.name,
       (SELECT COUNT(*)::text
        FROM telegram_receipts r
        WHERE r.product_id = p.id) AS receipt_count,
        COALESCE((SELECT SUM(r.quantity)::text
                  FROM telegram_receipts r
                  WHERE r.product_id = p.id), '0') AS receipt_quantity,
       COALESCE((SELECT SUM(r.amount)::text
                 FROM telegram_receipts r
                 WHERE r.product_id = p.id), '0') AS receipt_total,
       COALESCE((SELECT SUM(pr.quantity)::text
                 FROM telegram_productions pr
                 WHERE pr.product_id = p.id), '0') AS production_quantity
     FROM telegram_products p
     WHERE p.is_active = TRUE
     ORDER BY p.name ASC
     LIMIT $1 OFFSET $2`,
    [pageSize, page * pageSize],
  );
  return result.rows;
}

export async function listReceipts(
  sql: SqlClient,
  page: number,
  pageSize: number,
): Promise<PageResult<ReceiptRow>> {
  const offset = page * pageSize;
  const [countResult, rowsResult] = await Promise.all([
    sql.query<{ total: string }>(
      `SELECT COUNT(*)::text AS total FROM telegram_receipts`,
    ),
    sql.query<ReceiptRow>(
      `SELECT
         r.id, r.amount::text AS amount, r.vendor, r.buyer, r.quantity,
         p.name AS product_name, r.recorded_by,
         u.username AS recorded_by_username,
         u.first_name AS recorded_by_first_name,
         u.last_name AS recorded_by_last_name, r.created_at
       FROM telegram_receipts r
       JOIN telegram_products p ON p.id = r.product_id
       LEFT JOIN telegram_users u ON u.telegram_user_id = r.recorded_by
       ORDER BY r.created_at DESC, r.id DESC
       LIMIT $1 OFFSET $2`,
      [pageSize, offset],
    ),
  ]);
  return {
    rows: rowsResult.rows,
    total: Number(countResult.rows[0]?.total ?? "0"),
  };
}

export async function listProductions(
  sql: SqlClient,
  page: number,
  pageSize: number,
): Promise<PageResult<ProductionRow>> {
  const offset = page * pageSize;
  const [countResult, rowsResult] = await Promise.all([
    sql.query<{ total: string }>(
      `SELECT COUNT(*)::text AS total FROM telegram_productions`,
    ),
    sql.query<ProductionRow>(
      `SELECT
         pr.id, pr.quantity, pr.employee, p.name AS product_name, pr.recorded_by,
         u.username AS recorded_by_username,
         u.first_name AS recorded_by_first_name,
         u.last_name AS recorded_by_last_name, pr.created_at
       FROM telegram_productions pr
       JOIN telegram_products p ON p.id = pr.product_id
       LEFT JOIN telegram_users u ON u.telegram_user_id = pr.recorded_by
       ORDER BY pr.created_at DESC, pr.id DESC
       LIMIT $1 OFFSET $2`,
      [pageSize, offset],
    ),
  ]);
  return {
    rows: rowsResult.rows,
    total: Number(countResult.rows[0]?.total ?? "0"),
  };
}
