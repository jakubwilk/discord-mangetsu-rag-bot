# 01 — Specyfikacja czatu RAG

## Opis

Główna funkcjonalność bota. Użytkownik inicjuje rozmowę komendą `/chat`, podając pierwszą wiadomość jako argument. Bot tworzy prywatny wątek Discord, wysyła wiadomość do API RAG i strumieniuje odpowiedź. Każda kolejna wiadomość użytkownika w wątku jest obsługiwana analogicznie. Kontekst sesji (historia ostatnich 6 wiadomości) jest zarządzany przez API RAG na podstawie `sessionId`.

---

## Komendy slash

### `/chat`

| Pole        | Wartość                          |
|-------------|----------------------------------|
| Nazwa       | `chat`                           |
| Opis        | Rozpocznij rozmowę z asystentem  |
| Opcja       | `message` (string, wymagana)     |
| Opis opcji  | Twoje pytanie do asystenta       |

---

## Przepływ `/chat`

```
Użytkownik: /chat message: "pytanie"
  │
  ├─► deferReply({ ephemeral: true })          — natychmiastowe potwierdzenie interakcji
  │
  ├─► jeśli bot nie jest skonfigurowany (brak rag_api_key lub allowed_channel_id)
  │     └─► editReply("Bot nie jest jeszcze skonfigurowany...") → STOP
  │           (pełne zasady w spec/02_access_spec.md)
  │
  ├─► jeśli interaction.channelId !== config.allowed_channel_id
  │     └─► editReply("Ta komenda działa tylko na kanale #nazwa-kanału.") → STOP
  │           (pełne zasady w spec/02_access_spec.md)
  │
  ├─► GET /api/rate-limit?userId={discordUserId}
  │     └─► jeśli requestsUsed >= 20
  │           └─► editReply("Osiągnąłeś dzienny limit...") → STOP
  │
  ├─► utwórz prywatny wątek w kanale źródłowym
  │     name: "[{username}] {message}" przycinane do 100 znaków z "…" jeśli dłuższe
  │     type: PrivateThread
  │     autoArchiveDuration: 10080 (7 dni, w minutach)
  │     invitable: false
  │
  ├─► dodaj użytkownika do wątku (thread.members.add)
  │
  ├─► wygeneruj UUID v4 jako sessionId
  │
  ├─► zapisz { threadId, sessionId, userId } w bazie bota
  │
  ├─► wyślij wiadomość w wątku: "Generuję odpowiedź..."  ← ta wiadomość będzie edytowana
  │
  ├─► POST /api/chat { message, sessionId, discordUserId } → SSE stream
  │     └─► obsługa streamu → patrz sekcja "Streaming"
  │
  └─► editReply z linkiem do wątku: "Otwarto wątek: {threadLink}"
        (ephemeral — widoczne tylko dla użytkownika który użył komendy)
```

---

## Przepływ wiadomości w istniejącym wątku

Zdarzenie: `messageCreate`

```
Wiadomość przychodzi
  │
  ├─► ignoruj jeśli author.bot === true
  ├─► ignoruj jeśli channel.type !== PrivateThread
  ├─► ignoruj jeśli threadId nie istnieje w bazie bota  — nie nasz wątek
  │
  ├─► GET /api/rate-limit?userId={discordUserId}
  │     └─► jeśli requestsUsed >= 20
  │           └─► odpowiedz w wątku: "Osiągnąłeś dzienny limit..." → STOP
  │
  ├─► pobierz sessionId z bazy bota dla tego threadId
  │
  ├─► przytnij wiadomość do 1000 znaków jeśli dłuższa
  │
  ├─► wyślij wiadomość w wątku: "Generuję odpowiedź..."
  │
  └─► POST /api/chat { message, sessionId, discordUserId } → SSE stream
        └─► obsługa streamu → patrz sekcja "Streaming"
```

---

## Streaming SSE → Discord

Bot konsumuje SSE z API RAG i edytuje wiadomość `"Generuję odpowiedź..."` co ~1 sekundę.

```
Otwórz SSE stream
  │
  ├─► token event   → doklejaj do bufora
  │     co 1000ms   → edytuj wiadomość Discord (jeśli bufor niepusty)
  │
  ├─► done event    → finalna edycja wiadomości z pełną odpowiedzią
  │                    → inkrementuj `message_count` dla tego `thread_id` w tabeli `thread_sessions`
  │
  └─► error event   → edytuj wiadomość na treść błędu z API
```

**Limity edycji Discord:** ~5 edycji / 5 sekund per wiadomość. Edycja co 1s jest bezpieczna.

**Obsługa pustego bufora:** jeśli w oknie 1s nie wpłynęły żadne tokeny, nie edytuj — nie wysyłaj zbędnych requestów.

**Timeout streamu:** jeśli stream nie zamknie się przez 60 sekund, edytuj wiadomość: `"Przekroczono czas oczekiwania na odpowiedź."` i przerwij połączenie.

---

## Obsługa błędów

| Sytuacja                          | Zachowanie bota                                                     |
|-----------------------------------|---------------------------------------------------------------------|
| API rate limit (429)              | Wyświetl komunikat zwrócony przez API                               |
| API błąd (400, 500, 503)          | Wyświetl komunikat zwrócony przez API                               |
| Błąd SSE (error event w streamie) | Edytuj wiadomość na treść błędu z API                              |
| Timeout 60s                       | `"Przekroczono czas oczekiwania na odpowiedź."`                    |
| Brak uprawnień do wątku           | `editReply` ephemeral z informacją o błędzie uprawnień             |
| Wiadomość > 1000 znaków           | Przytnij po cichu przed wysłaniem do API (bez informowania usera)  |

---

## Wymagane zmiany w API RAG

### POST /api/chat — zmiana body

```json
{
  "message": "string",
  "sessionId": "string (UUID)",
  "discordUserId": "string"
}
```

`discordUserId` zastępuje IP jako identyfikator dla rate limitingu. Pole wymagane.

### GET /api/rate-limit — zmiana

```
GET /api/rate-limit?userId={discordUserId}
```

Odpowiedź:
```json
{ "requestsUsed": 3, "dailyLimit": 20 }
```

Dodanie pola `dailyLimit` do odpowiedzi pozwala botowi wyświetlać czytelny komunikat bez hardkodowania limitu.

### Tabela `rate_limits` — zmiana schematu

```sql
-- Zamiana kolumny ip na discord_user_id
CREATE TABLE rate_limits (
  discord_user_id TEXT NOT NULL,
  request_date    DATE NOT NULL,
  count           INTEGER NOT NULL DEFAULT 0,
  UNIQUE(discord_user_id, request_date)
);
```

Unikalny constraint i logika upsert pozostają takie same — zmienia się tylko klucz identyfikujący użytkownika.

### Endpoint /api/sessions

Endpoint `/api/sessions` nie jest używany przez bota — może pozostać lub zostać usunięty.

---

## Model danych bota

Bot potrzebuje własnej bazy SQLite do przechowywania mapowania wątek → sesja.

**Plik:** `data/bot.db`

```sql
CREATE TABLE IF NOT EXISTS thread_sessions (
  thread_id     TEXT    PRIMARY KEY,
  session_id    TEXT    NOT NULL,
  user_id       TEXT    NOT NULL,
  created_at    INTEGER NOT NULL,
  message_count INTEGER NOT NULL DEFAULT 0
);
```

| Kolumna         | Typ     | Opis                                          |
|-----------------|---------|------------------------------------------------|
| `thread_id`     | TEXT PK | ID wątku Discord                              |
| `session_id`    | TEXT    | UUID przekazywany do API RAG jako `sessionId` |
| `user_id`       | TEXT    | Discord ID właściciela wątku                  |
| `created_at`    | INTEGER | Unix timestamp (ms) momentu utworzenia wątku  |
| `message_count` | INTEGER | Liczba wiadomości wysłanych w wątku; inkrementowana po każdym zdarzeniu `done` w streamie SSE (patrz sekcja "Streaming SSE → Discord"). Używana przez `/stats` — zobacz [`02_access_spec.md`](./02_access_spec.md). |

Ta sama tabela jest jedynym źródłem prawdy o sesjach wątków — `02_access_spec.md` z niej korzysta, ale jej nie redefiniuje.

Zależność npm: `better-sqlite3` + `@types/better-sqlite3`

---

## Wymagane uprawnienia bota (Discord)

### Intenty (GatewayIntentBits)

| Intent           | Powód                                              |
|------------------|----------------------------------------------------|
| `Guilds`         | Podstawowe działanie, dostęp do kanałów            |
| `GuildMessages`  | Odczyt wiadomości w wątkach                        |
| `MessageContent` | Odczyt treści wiadomości (**privileged intent**)   |

> `MessageContent` musi być włączony ręcznie w Discord Developer Portal → Bot → Privileged Gateway Intents.

### Uprawnienia bota na serwerze

| Uprawnienie        | Powód                            |
|--------------------|----------------------------------|
| `Send Messages`    | Wysyłanie odpowiedzi w wątkach   |
| `Create Private Threads` | Tworzenie prywatnych wątków |
| `Manage Threads`   | Dodawanie użytkownika do wątku   |
| `Read Message History` | Odczyt wiadomości w wątkach  |

---

## Struktura eventów i komend

```
src/
├── commands/
│   └── chat.ts          # Definicja i handler komendy /chat
├── events/
│   ├── ready.ts         # Logowanie przy starcie
│   ├── interactionCreate.ts  # Router komend slash
│   └── messageCreate.ts      # Handler wiadomości w wątkach
└── services/
    ├── ragService.ts    # Komunikacja z API RAG (POST /api/chat, GET /api/rate-limit)
    ├── threadService.ts # Tworzenie wątków, zapis/odczyt z thread_sessions
    └── streamService.ts # Konsumowanie SSE i edytowanie wiadomości Discord
```
