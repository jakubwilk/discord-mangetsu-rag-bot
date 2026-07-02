# 00 — Specyfikacja główna: Discord Mangetsu RAG Bot

## Opis projektu

Bot Discord służący jako interfejs użytkownika do bazy wiedzy forum RP Mangetsu.
Zastępuje frontendową część aplikacji webowej, zapewniając prostszy model dostępu przez Discord.
Bot komunikuje się z zewnętrznym API RAG, które przechowuje i przeszukuje bazę poradników forum.

## Architektura

```
Użytkownik (Discord)
    │
    ▼
Discord Bot (discord.js)
    │  prywatny wątek per sesja
    ▼
RAG API (zewnętrzny serwer HTTP)
    │
    ▼
Baza poradników forum Mangetsu
```

Bot **nie zarządza bazą wiedzy** — wyłącznie pośredniczy między użytkownikiem a API RAG.
Aktualizacje bazy wiedzy są poza zakresem bota.

## Stack technologiczny

| Warstwa        | Technologia               |
|----------------|---------------------------|
| Środowisko     | Node.js, TypeScript       |
| Discord        | discord.js v14            |
| HTTP           | axios                     |
| Konfiguracja   | dotenv                    |
| Testy          | Vitest                    |
| Proces         | PM2 (ecosystem.config.js) |

## Zmienne środowiskowe

| Zmienna            | Opis                                      |
|--------------------|-------------------------------------------|
| `DISCORD_TOKEN`    | Token bota Discord                        |
| `DISCORD_CLIENT_ID`| ID aplikacji Discord                      |
| `DISCORD_GUILD_ID` | ID serwera Discord                        |
| `RAG_API_URL`      | Bazowy URL zewnętrznego API RAG           |

> Klucz API RAG (`rag_api_key`) **nie jest** zmienną środowiskową — jest ustawiany komendą `/config` i przechowywany w tabeli `config` w SQLite bota. Zobacz [`02_access_spec.md`](./02_access_spec.md#autoryzacja-bot--api-rag).

## Struktura katalogów

```
src/
├── commands/       # Komendy slash
├── events/         # Obsługa zdarzeń Discord (ready, interactionCreate, messageCreate)
├── services/       # Logika biznesowa (RAG API, zarządzanie wątkami)
└── index.ts        # Punkt wejścia
spec/
├── 00_main_spec.md
├── 01_chat_spec.md
└── 02_access_spec.md
```

## Powiązane specyfikacje

- [01_chat_spec.md](./01_chat_spec.md) — interakcja z RAG przez prywatne wątki
- [02_access_spec.md](./02_access_spec.md) — kontrola dostępu oparta na rolach Discord
