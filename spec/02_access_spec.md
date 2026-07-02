# 02 — Specyfikacja bezpieczeństwa i zarządzania

## Opis

Specyfikacja obejmuje: autoryzację bota do API RAG, walidację konfiguracji przy starcie, kontrolę dostępu do komend oraz komendy administracyjne i użytkownika.

---

## Model uprawnień

| Komenda        | Wymagane uprawnienie Discord       |
|----------------|------------------------------------|
| `/chat`        | Dostęp do kanału (bez wymagań)     |
| `/stats @user` | Dostęp do kanału (bez wymagań)     |
| `/config`      | `Administrator`                    |
| `/status`      | `Administrator`                    |
| `/stats`       | `Administrator`                    |

Uprawnienia są sprawdzane przez bota w handlerze każdej komendy przez `interaction.memberPermissions.has(PermissionFlagsBits.Administrator)`. Brak uprawnień → odpowiedź ephemeral z komunikatem o braku dostępu.

---

## Konfiguracja bota — `/config`

Jednorazowa komenda konfiguracyjna wykonywana przez administratora serwera po instalacji bota. Zapisuje konfigurację do tabeli `config` w SQLite bota. Może być wywołana ponownie w celu aktualizacji dowolnego parametru.

### Definicja komendy

| Opcja       | Typ     | Wymagana | Opis                              |
|-------------|---------|----------|-----------------------------------|
| `api_key`   | string  | tak      | Klucz do API RAG                  |
| `channel`   | channel | tak      | Kanał gdzie bot przyjmuje `/chat` |

```
/config api_key: xxx channel: #poradniki-bot
```

### Przepływ

```
/config api_key: xxx channel: #poradniki-bot
  │
  ├─► sprawdź uprawnienie Administrator → brak: odpowiedź ephemeral o braku dostępu
  │
  ├─► zapisz/zaktualizuj w tabeli config:
  │     { key: 'rag_api_key', value: api_key }
  │     { key: 'allowed_channel_id', value: channel.id }
  │
  └─► odpowiedź ephemeral: "Konfiguracja zapisana. Bot gotowy do użycia."
```

### Zachowanie przed konfiguracją

Jeśli bot nie ma zapisanego `rag_api_key` lub `allowed_channel_id`:
- `/chat`, `/status`, `/stats` → ephemeral: `"Bot nie jest jeszcze skonfigurowany. Administrator musi wykonać komendę /config."`
- `/config` → dostępna normalnie

---

## Autoryzacja bot → API RAG

Każdy request HTTP do API RAG zawiera nagłówek:

```
X-Api-Key: {rag_api_key}
```

Wartość pochodzi z tabeli `config` w SQLite bota (nie z `.env`).

### Wymagana zmiana w API RAG

API musi walidować nagłówek `X-Api-Key` na wszystkich endpointach:

| Status | Warunek                              |
|--------|--------------------------------------|
| 401    | Brakujący lub nieprawidłowy klucz    |

```json
{ "error": "Unauthorized" }
```

Klucz API jest konfigurowany po stronie serwera RAG (zmienna środowiskowa `API_KEY`). Nie jest zarządzany przez bota — bot tylko go przechowuje i wysyła.

Bot i API RAG działają na tym samym VPS — komunikacja odbywa się przez localhost, ruch sieciowy nie jest narażony na przechwycenie. Klucz **nigdy nie może trafiać do logów** (ani przez `console.log`, ani przez logger).

---

## Walidacja środowiska przy starcie

Bot weryfikuje wymagane zmienne środowiskowe przed próbą połączenia z Discordem. Brakująca zmienna → `process.exit(1)` z czytelnym komunikatem.

### Wymagane zmienne środowiskowe

| Zmienna             | Opis                                               |
|---------------------|----------------------------------------------------|
| `DISCORD_TOKEN`     | Token bota Discord                                 |
| `DISCORD_CLIENT_ID` | ID aplikacji Discord                               |
| `DISCORD_GUILD_ID`  | ID serwera Discord                                 |
| `RAG_API_URL`       | Bazowy URL API RAG (np. `http://localhost:8000`)   |

`RAG_API_KEY` i `ALLOWED_CHANNEL_ID` nie są zmiennymi środowiskowymi — są konfigurowane przez `/config` i przechowywane w SQLite.

---

## Ograniczenie do kanału

Bot obsługuje `/chat` wyłącznie z kanału zapisanego w konfiguracji (`allowed_channel_id`).

Sprawdzenie w handlerze `/chat`:
```
interaction.channelId !== config.allowed_channel_id
  → odpowiedź ephemeral: "Ta komenda działa tylko na kanale #nazwa-kanału."
```

Wiadomości `messageCreate` w wątkach nie wymagają tego sprawdzenia — wątki są tworzone przez bota tylko w dozwolonym kanale, więc zapis w `thread_sessions` już gwarantuje poprawny kontekst.

---

## Komendy administracyjne

### `/status`

Sprawdza czy API RAG odpowiada. Wykonuje `GET /api/rate-limit?userId=healthcheck` i mierzy czas odpowiedzi.

Odpowiedź ephemeral:

```
API RAG: ✓ online (142ms)
Kanał: #poradniki-bot
```

lub przy błędzie:

```
API RAG: ✗ niedostępne
Błąd: Connection refused
```

---

### `/stats`

Globalne statystyki z bazy bota. Odpowiedź ephemeral.

```
Statystyki bota
───────────────
Łączne wątki:    47
Łączne wiadomości: 312
```

Zapytania:
```sql
SELECT COUNT(*) FROM thread_sessions;
SELECT SUM(message_count) FROM thread_sessions;
```

---

### `/stats @user`

Statystyki konkretnego użytkownika. Dostępna dla wszystkich z dostępem do kanału. Odpowiedź ephemeral widoczna tylko dla osoby pytającej.

```
Statystyki użytkownika @username
─────────────────────────────────
Wątki:      5
Wiadomości: 38
```

Zapytanie:
```sql
SELECT COUNT(*), SUM(message_count)
FROM thread_sessions
WHERE user_id = ?;
```

---

## Model danych bota — uzupełnienie

### Tabela `config`

```sql
CREATE TABLE IF NOT EXISTS config (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
```

Przechowuje pary klucz-wartość konfiguracji bota. Klucze używane przez aplikację:

| Klucz                | Ustawiany przez |
|----------------------|-----------------|
| `rag_api_key`        | `/config`       |
| `allowed_channel_id` | `/config`       |

### Tabela `thread_sessions`

Pełna definicja (włącznie z kolumną `message_count` używaną przez `/stats` poniżej) znajduje się w [`01_chat_spec.md`](./01_chat_spec.md#model-danych-bota) — ten dokument jej nie redefiniuje, jedynie z niej korzysta.

---

## Struktura komend — uzupełnienie

```
src/
├── commands/
│   ├── chat.ts      # /chat
│   ├── config.ts    # /config
│   ├── status.ts    # /status
│   └── stats.ts     # /stats, /stats @user
└── services/
    └── configService.ts  # odczyt/zapis tabeli config, walidacja przy starcie
```
