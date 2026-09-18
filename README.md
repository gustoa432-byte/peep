# Peepland

🎮 **Play Demo:** [peepland.ru](https://peepland.ru)  
📱 **Telegram:** [t.me/peepland](https://t.me/peepland)

---

**Воксельная UGC-платформа для Telegram.**  
Клиент–сервер (WebSockets по GDD/TZ 2.0), эфемерные RAM-комнаты, zero-friction вход за **1 секунду**: ссылка в чате → клик → ты уже с киркой на арене.

На экране игра называется **Peep**. Продуктовая истина — [GDD.md](GDD.md); техника — [TZ.md](TZ.md) **v2.0**.

## Почему это существует

3D в мессенджере без лаунчеров и гигабайтных загрузок. Криэйторы бесплатно собирают **Чертежи** (Blueprints), игроки врываются по ссылке в живую сессию, фанятся, взрывают и тратят Telegram Stars. Когда все вышли — комната исчезает из RAM; чертёж остаётся для следующего запуска.

## Цикл продукта

1. **Создание** — криэйтор строит карту → сохраняет Чертёж → получает TG-ссылку  
2. **Дистрибуция** — ссылка в чаты и каналы  
3. **Сессия** — клик → спавн в эфемерной комнате → геймплей  
4. **Смерть сессии** — все вышли → RAM очищен; чертёж готов к рестарту  

## Tech Stack

| Layer | Stack |
|-------|--------|
| Client | React 19, Three.js, TanStack Start/Router |
| Network (цель GDD/TZ 2.0) | WebSockets, tick **20 Hz** (50 ms), Lerp/Slerp |
| Persistence | SQLite — только чертежи и метаданные, не поток блоков матча |
| Platform | Telegram Mini Apps (TMA) |

> **Статус сети:** целевая архитектура — client–server WebSockets + RAM-rooms (`src/lib/multiplayer/rooms/`). Живой прототип на peepland.ru пока синхронизирует пиров через WebRTC DataChannels + HTTP signaling (`/api/rtc`); npm-зависимостей `peerjs` / `simple-peer` нет. Полный вырез P2P — отдельный сетевой рефакторинг после wiring rooms в прод.

## Как играть

1. Открой [peepland.ru](https://peepland.ru) в Telegram Mini App или браузере  
2. Создай / открой мир по ссылке  
3. WASD + мышь (Pointer Lock) или тач-джойстики  
4. Камера — от первого лица (кроме катсцен)  

## Локальный запуск

Node ≥ 22:

```bash
npm install
npm run dev
```

- Dev: `http://127.0.0.1:5173/`
- Typecheck: `npm run typecheck`
- Build: `npm run build` · VPS: `npm run build:vps` + `npm start`

## Продакшн (VPS)

Долгоживущий Node + PM2 + Nginx (`scripts/vps-*.sh`, `ecosystem.config.cjs`).  
Домен: **peepland.ru**.

## Лицензия

MIT © 2026 Nonse — см. [LICENSE](LICENSE).
