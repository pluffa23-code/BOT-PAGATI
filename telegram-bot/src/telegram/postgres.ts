import { pool } from "@workspace/db";
import type { SqlClient } from "./types";

export const telegramSqlClient: SqlClient = {
  async query<Row extends object = Record<string, unknown>>(
    statement: string,
    values?: unknown[],
  ): Promise<{ rows: Row[] }> {
    const pgValues = values as never[] | undefined;
    const result = pgValues
      ? await pool.query(statement, pgValues)
      : await pool.query(statement);
    return { rows: result.rows as Row[] };
  },
};
