import path from 'node:path';

import Database from 'better-sqlite3';

let db: Database.Database | undefined;

/**
 * Zwraca ścieżkę do pliku bazy danych bota.
 * Domyślnie `<repo>/data/bot.db` (zakotwiczone względem __dirname, nie process.cwd()).
 * Można nadpisać zmienną środowiskową `BOT_DB_PATH` (używane w testach, np. `:memory:`).
 */
function resolveDbPath(): string {
  return process.env.BOT_DB_PATH ?? path.join(__dirname, '..', '..', 'data', 'bot.db');
}

function bootstrapSchema(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS config (
      key        TEXT PRIMARY KEY,
      value      TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);

  database.exec(`
    CREATE TABLE IF NOT EXISTS thread_sessions (
      thread_id     TEXT    PRIMARY KEY,
      session_id    TEXT    NOT NULL,
      user_id       TEXT    NOT NULL,
      created_at    INTEGER NOT NULL,
      message_count INTEGER NOT NULL DEFAULT 0
    );
  `);
}

/**
 * Zwraca współdzielone połączenie do bazy SQLite bota (lazy-open, singleton).
 * Wykorzystywane również przez threadService, aby operować na tej samej bazie.
 */
export function getDb(): Database.Database {
  if (!db) {
    db = new Database(resolveDbPath());
    bootstrapSchema(db);
  }
  return db;
}

/** Wyłącznie na potrzeby testów — resetuje singleton, aby kolejny getDb() otworzył nowe połączenie. */
export function resetDbForTests(): void {
  if (db) {
    db.close();
    db = undefined;
  }
}

export function getConfigValue(key: string): string | undefined {
  const row = getDb().prepare('SELECT value FROM config WHERE key = ?').get(key) as
    { value: string } | undefined;
  return row?.value;
}

export function setConfigValue(key: string, value: string): void {
  getDb()
    .prepare(
      `INSERT INTO config (key, value, updated_at)
       VALUES (@key, @value, @updatedAt)
       ON CONFLICT(key) DO UPDATE SET value = @value, updated_at = @updatedAt`
    )
    .run({ key, value, updatedAt: Date.now() });
}

export function isConfigured(): boolean {
  return Boolean(getConfigValue('rag_api_key')) && Boolean(getConfigValue('allowed_channel_id'));
}

const REQUIRED_ENV_VARS = ['DISCORD_TOKEN', 'DISCORD_CLIENT_ID', 'DISCORD_GUILD_ID', 'RAG_API_URL'];

export function validateEnv(): void {
  const missing = REQUIRED_ENV_VARS.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    console.error(
      `Brak wymaganych zmiennych środowiskowych: ${missing.join(', ')}. Uzupełnij plik .env i spróbuj ponownie.`
    );
    process.exit(1);
  }
}
