# CLAUDE.md

Ten plik zawiera wytyczne dla Claude Code (claude.ai/code) dotyczące pracy w tym repozytorium.

## Zasady pracy — przeczytaj przed rozpoczęciem jakiegokolwiek zadania

### Źródła prawdy

Istnieją **dokładnie dwa** źródła prawdy dla decyzji technicznych i biznesowych w tym projekcie:

1. **Użytkownik** — bezpośrednie instrukcje w rozmowie.
2. **Dokumenty w `spec/`** — `spec/00_main_spec.md`, `spec/01_chat_spec.md`, `spec/02_access_spec.md`.

Jeśli coś nie wynika jasno z tych dwóch źródeł ani z istniejącego kodu — **nie zgaduj**. Nie wymyślaj zachowania, nie twórz własnej interpretacji specyfikacji, nie zakładaj "typowego" rozwiązania z innych projektów. Zapytaj użytkownika wprost i poczekaj na odpowiedź, zanim zaczniesz implementację.

Dotyczy to w szczególności:
- niejasności lub sprzeczności między `spec/` a istniejącym kodem,
- brakujących szczegółów w specyfikacji (np. dokładny format komunikatu błędu, edge case nieopisany w dokumencie),
- decyzji, które mają wpływ na kontrakt API RAG, schemat bazy danych lub uprawnienia Discorda.

### Planowanie przed implementacją

Przed rozpoczęciem pracy nad jakimkolwiek zadaniem (nawet małym):

1. Rozpisz plan działania — co dokładnie zostanie zmienione i dlaczego.
2. Przedstaw za i przeciw rozważanych podejść, jeśli istnieje więcej niż jedno sensowne rozwiązanie.
3. Przedstaw rezultat planu użytkownikowi i **poczekaj na akceptację** przed przejściem do implementacji.

Nie zaczynaj pisać kodu produkcyjnego "od razu", nawet jeśli zadanie wydaje się proste — użytkownik chce zobaczyć plan i mieć możliwość skorygowania kierunku zanim powstanie kod.

### Podział pracy na wyspecjalizowane subagenty

Nietrywialne zadania implementacyjne dziel na role i deleguj do subagentów zamiast robić wszystko w jednym wątku:

- **agent planujący** — analizuje zadanie, `spec/` i kod, proponuje plan (patrz sekcja wyżej),
- **agent implementujący** — wykonuje zaakceptowany plan,
- **agent do code review** — weryfikuje wynik implementacji pod kątem poprawności, zgodności ze `spec/` i jakości kodu (np. przez `/code-review`).

Nie łącz tych ról w jednym kroku dla większych zmian — każda z nich powinna być odrębnym, świadomym przejściem.

### Niepewność przy ważnej funkcjonalności

Jeśli podczas implementacji ważnej funkcjonalności (np. przepływ `/chat`, obsługa sesji, autoryzacja, płatny/limitowany zasób) pojawi się choć jedna niejasna kwestia — **zatrzymaj się i zapytaj użytkownika**. Nie podejmuj takiej decyzji samodzielnie, nawet jeśli wydaje się oczywista. Dotyczy to zwłaszcza zmian wpływających na kontrakt API RAG, bazę danych bota lub uprawnienia.

### Standard TypeScript / Node.js

Korzystaj wyłącznie z aktualnej (na 2026 rok) składni i dobrych praktyk TypeScript i Node.js — najnowsze stabilne wersje języka, unikanie przestarzałych wzorców (np. `var`, callbacki zamiast `async/await`, `require` zamiast ESM tam, gdzie projekt tego wymaga). Trzymaj się configu ESLint/TSConfig już obecnego w repo — nie wprowadzaj konkurencyjnych konwencji.

### Testowanie i formatowanie

- Każde rozwiązanie musi być przetestowane — uruchom odpowiednie testy (`npm run test` lub `npx vitest run <plik>`) przed uznaniem zadania za zakończone.
- Przed zakończeniem pracy uruchom `npm run lint` i `npm run format` (lub `lint:fix`), aby kod był zgodny ze stylem projektu.
- Nie zgłaszaj zadania jako ukończonego, jeśli testy lub lint nie przechodzą.

---

## Komendy

```bash
npm run dev          # tryb deweloperski (nodemon + ts-node, bez builda)
npm run build        # kompilacja TypeScript → dist/
npm run start        # uruchomienie skompilowanego bota (produkcja)
npm run deploy       # rejestracja komend slash na serwerze Discord
npm run lint         # ESLint
npm run lint:fix     # ESLint z automatyczną naprawą
npm run format       # Prettier
npm run test         # Vitest (pojedyncze uruchomienie)
npm run test:watch   # Vitest (tryb watch)
npm run test:coverage
```

Uruchomienie pojedynczego pliku testowego:
```bash
npx vitest run src/services/ragService.test.ts
```

Menedżer procesów produkcyjnych:
```bash
pm2 start ecosystem.config.js
pm2 restart mangetsu-bot
pm2 logs mangetsu-bot
```

## Architektura

Bot Discord pełniący funkcję frontendu dla zewnętrznego API RAG (`RAG_API_URL`). Użytkownicy zadają pytania dotyczące poradników forum RP poprzez prywatne wątki Discord; bot przekazuje wiadomości do API RAG i strumieniuje odpowiedzi z powrotem.

Pełny opis architektury: [`spec/00_main_spec.md`](./spec/00_main_spec.md).

### Kluczowe przepływy

**`/chat message: "..."`** → tworzy prywatny wątek → wysyła wiadomość do `POST /api/chat` → konsumuje strumień SSE → edytuje wiadomość Discord co ~1s zbuforowanymi tokenami.

**Kolejne wiadomości w wątku** → zdarzenie `messageCreate` → ten sam pipeline SSE co wyżej, z ponownym użyciem zapisanego `sessionId` dla danego wątku.

**Komendy slash uruchomione przed konfiguracją bota** → zablokowane do czasu wykonania `/config` przez administratora.

Pełny opis: [`spec/01_chat_spec.md`](./spec/01_chat_spec.md).

### Struktura zdarzeń i komend

- `src/events/interactionCreate.ts` — routing wszystkich komend slash do ich handlerów
- `src/events/messageCreate.ts` — obsługa wiadomości użytkownika w wątkach RAG
- `src/commands/chat.ts` — `/chat`: tworzy prywatny wątek, inicjuje pierwsze zapytanie do RAG
- `src/commands/config.ts` — `/config`: jednorazowa konfiguracja (api_key + kanał), wymaga `Administrator`
- `src/commands/status.ts` — `/status`: health check API RAG, wymaga `Administrator`
- `src/commands/stats.ts` — `/stats` (admin) oraz `/stats @user` (wszyscy użytkownicy kanału)

### Serwisy

- `src/services/ragService.ts` — `POST /api/chat` (SSE) oraz `GET /api/rate-limit`; dołącza nagłówek `X-Api-Key` z konfiguracji do każdego requestu; nigdy nie loguje klucza
- `src/services/streamService.ts` — konsumuje SSE, buforuje tokeny, edytuje wiadomość Discord co 1s; obsługuje typy zdarzeń `token` / `done` / `error`
- `src/services/threadService.ts` — tworzy prywatne wątki, odczytuje/zapisuje tabelę `thread_sessions`
- `src/services/configService.ts` — odczytuje/zapisuje tabelę `config`; waliduje wymagane zmienne środowiskowe przy starcie (`DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, `DISCORD_GUILD_ID`, `RAG_API_URL`)

### Baza danych SQLite (`data/bot.db`)

Dwie tabele — pełne DDL w [`spec/02_access_spec.md`](./spec/02_access_spec.md).

**`config`** — magazyn klucz/wartość konfiguracji runtime (`rag_api_key`, `allowed_channel_id`). Wypełniana przez `/config`, odczytywana przez każdą inną komendę.

**`thread_sessions`** — mapuje ID wątku Discord → `sessionId` RAG (UUID) + `user_id` + `message_count`. Używana przez `messageCreate` do kierowania wiadomości do właściwej sesji RAG oraz przez `/stats` do liczenia użycia.

### Kontrakt API RAG

`POST /api/chat` body: `{ message, sessionId, discordUserId }` — odpowiedź to strumień SSE.
`GET /api/rate-limit?userId={discordUserId}` — zwraca `{ requestsUsed, dailyLimit }`.
Wszystkie requesty niosą nagłówek `X-Api-Key`. Dzienny limit: 20 wiadomości na użytkownika Discord.

Pełna specyfikacja API (włącznie z wymaganymi zmianami po stronie API): [`spec/01_chat_spec.md`](./spec/01_chat_spec.md), [`spec/02_access_spec.md`](./spec/02_access_spec.md).

### Istotne reguły ESLint

- `@typescript-eslint/explicit-function-return-type: error` — wszystkie funkcje wymagają jawnego typu zwracanego
- `@typescript-eslint/no-floating-promises: error` — każdy Promise musi być zaawaitowany lub jawnie obsłużony przez `void`
- `simple-import-sort` — importy są automatycznie sortowane; uruchom `lint:fix`, jeśli ESLint zgłasza problem z kolejnością importów

### Intenty Discord

`Guilds`, `GuildMessages`, `MessageContent` (privileged — musi być włączony w Discord Developer Portal → Bot → Privileged Gateway Intents).
