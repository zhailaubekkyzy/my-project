# Тестовая копия SmartFlow и перенос базы во Франкфурт

Решение владелицы 16 окт. Зачем:
- **Скорость.** Сейчас сервер Railway в США (US West), а база Supabase в Сиднее: каждый запрос к базе
  идёт ~180 мс (`/api/health` → `database.pingMs`), а на одном экране таких запросов несколько.
  Если поставить и сервер, и базу в Европе рядом — будет 2–10 мс, а клиентам в Казахстане ближе.
- **Проверка до всех.** Новую версию сначала открываем в тестовом боте (своя база, свои данные), и только
  потом она уходит всем.

Что уже сделано в коде (одна программа на обе копии):
- переменная Railway `APP_ENV=staging` — сервер знает, что он тестовый: сверху каждого экрана полоска
  **«ТЕСТ · тестовая копия SmartFlow»**, `/api/health` → `appEnv: "staging"`;
- все ссылки (`t.me/<бот>/app?startapp=…`: SI-продавцы, приглашения, профиль, панель, кнопки бота) ведут
  в бота той копии, где их создали (`TELEGRAM_BOT_USERNAME`);
- в PostHog у каждого события есть `app_env` — цифры теста можно отфильтровать;
- в `wrangler.jsonc` есть вторая сборка фронтенда `my-project-staging` (`npx wrangler deploy --env staging`);
- **«сначала одному человеку»**: переменные `FEATURES` и `BETA_USERS` (ниже, часть В).

Порядок: **А** (перенос рабочей базы) → **Б** (тестовая копия). Каждая часть — минут 20–30.
Пароли и токены никуда не пересылайте и не пишите в чат — только в поля сервисов.

> Бесплатный тариф Supabase — **2 активных проекта**. Поэтому: сначала новая рабочая база (2-й проект),
> затем ставим на паузу старую в Сиднее, и только потом создаём тестовую базу.

---

## А. Перенос рабочей базы во Франкфурт

Настоящих данных пока нет (в Сиднее 4 человека и 3 пробных SI-продавца), поэтому ничего не копируем:
новая база начинается пустой, сервер сам создаёт в ней все таблицы (21 миграция, с закрытым RLS).

### А1. Новый проект Supabase (Франкфурт)
1. supabase.com → **New project**. Организация — SmartFlow.
2. Name: `smartflow-eu`. **Database Password** → Generate → сохраните в менеджере паролей (понадобится один раз).
3. **Region: Central EU (Frankfurt)** (`eu-central-1`). Create.
4. Когда проект готов: кнопка **Connect** (вверху) → вкладка **Connection String** → **Session pooler**
   (именно его, как сейчас). Скопируйте строку `postgresql://postgres.<…>:[YOUR-PASSWORD]@aws-…-eu-central-1.pooler.supabase.com:5432/postgres`
   и вставьте вместо `[YOUR-PASSWORD]` пароль из шага 2 (без квадратных скобок).

### А2. Сервер Railway — в Европу и на новую базу
1. Railway → проект → сервис `my-project` → **Settings** → **Deploy** → **Regions**:
   выберите **EU West (Amsterdam)** (рядом с Франкфуртом), уберите US West.
2. **Variables** → `DATABASE_URL` → вставьте строку из А1 (шаг 4). Остальное не трогайте.
3. Нажмите **Deploy** (фиолетовая кнопка «Apply changes» / «Deploy» вверху). Ждите 2–3 минуты.

### А3. Проверка
1. Откройте https://my-project-production-f83d.up.railway.app/api/health:
   - `database.driver: "postgres"`, `appliedMigrationsCount: 21`;
   - `database.pingMs` — **меньше 20** (было 180). Обновите страницу 2–3 раза, первое число бывает больше.
2. Откройте приложение в Telegram (`@smartflow_ai_support_bot`). Вы — новый человек в новой базе:
   - Профиль → внизу **новый номер `SF-…`** → Railway → Variables → `ADMIN_USERS` = новый номер → Deploy;
   - снова откройте приложение → Профиль → «Панель поддержки» видна;
   - в панели → «Команда» — заново добавьте студента по его новому номеру;
   - пробных SI-продавцов создайте заново (если нужны); «Уведомления в Telegram → Включить» в Профиле.

### А4. Старая база в Сиднее
Supabase → старый проект `SmartFlow's Project` → **Project Settings → General → Pause project**.
На паузе она ничего не делает и не считается в лимите 2 проектов; её можно вернуть (Restore) в течение 90 дней.
Удалить совсем — через 1–2 недели, если всё в порядке (вместе с ней уйдут и таблицы `backup_1010_…`).

---

## Б. Тестовая копия

Что получится: бот `@…_test_bot` → приложение на `https://test.techsmartflow.com` (полоска «ТЕСТ») →
тестовый сервер Railway (ветка `staging`) → тестовая база Supabase. С рабочей копией ничего не общего,
кроме кода: другие люди, другие данные, другой бот.

### Б1. Тестовый бот (Telegram → @BotFather)
1. `/newbot` → имя `SmartFlow ТЕСТ` → username, например `smartflow_test_bot` (должен кончаться на `bot`).
   BotFather пришлёт **токен** — сразу вставите его в Railway (Б4), никуда больше.
2. `/newapp` → выберите тестового бота → название `SmartFlow ТЕСТ`, описание, картинка 640×360 (можно ту же) →
   **Web App URL: `https://test.techsmartflow.com`** → short name: **`app`**.

### Б2. Ветка `staging` в GitHub
github.com/zhailaubekkyzy/my-project → **Branches** (или выпадающий список веток) → **New branch** →
имя `staging`, источник `main` → Create. (Или скажите Claude — он создаст.)

### Б3. Тестовая база Supabase
(Сначала А4 — пауза Сиднея.) New project → Name `smartflow-test` → свой пароль → **Central EU (Frankfurt)** →
Connect → Session pooler → строка, как в А1.

### Б4. Тестовый сервер Railway
1. Railway → проект → вверху выпадающий список **production** → **+ New Environment** → имя `staging` →
   **Duplicate production** (скопирует сервис и все переменные). Дальше всё — внутри окружения `staging`
   (проверьте, что вверху написано `staging`).
2. Сервис → **Settings → Source** → Branch: **`staging`**. **Regions** — EU West.
3. **Variables** (в `staging`) — поменять / добавить:

   | Имя | Значение |
   |---|---|
   | `APP_ENV` | `staging` |
   | `TELEGRAM_BOT_TOKEN` | токен тестового бота (Б1) |
   | `TELEGRAM_BOT_USERNAME` | username тестового бота без `@`, например `smartflow_test_bot` |
   | `DATABASE_URL` | строка тестовой базы (Б3) |
   | `JWT_SECRET` | **другой**, не как в рабочем: любая длинная строка (40+ случайных букв и цифр) |
   | `CORS_ORIGINS` | `https://test.techsmartflow.com,https://my-project-staging.gzhailaubekkyzy.workers.dev` |
   | `ADMIN_USERS` | пока оставьте пустым; свой тестовый номер впишете после первого входа (Б6) |
   | `POSTHOG_API_KEY` | **удалить** (чтобы проверки не смешивались с настоящими цифрами) |

   `NODE_ENV=production`, `DB_DRIVER=postgres`, `OPENAI_API_KEY` — оставить как скопировалось.
   Если хотите видеть расходы теста отдельно: в OpenAI → Projects → новый проект `smartflow-test` со своим
   ключом и маленьким лимитом, и этот ключ — в `OPENAI_API_KEY` тестового сервера.
4. **Settings → Networking → Generate Domain** — получите адрес вида `https://my-project-staging.up.railway.app`.
   **Deploy**. Проверка: `<этот адрес>/api/health` → `appEnv: "staging"`, `appliedMigrationsCount: 21`.

### Б5. Тестовый фронтенд в Cloudflare
1. Cloudflare → **Workers & Pages** → **Create** → **Import a repository** → `my-project`.
2. Project name: **`my-project-staging`** (ровно так — это имя записано в `wrangler.jsonc`).
3. Build command: `npm run build:pages`. Deploy command: **`npx wrangler deploy --env staging`**.
4. Build variables: `SMARTFLOW_API_URL` = адрес тестового сервера из Б4 (с `https://`, без `/` в конце).
5. После создания: **Settings → Build → Branch control** → Production branch: **`staging`**;
   сборку других веток (non-production branch builds) — выключить.
6. **Settings → Domains & Routes → Add → Custom domain** → `test.techsmartflow.com` → Add
   (домен уже в Cloudflare, запись создастся сама; ждать 1–5 минут).

### Б6. Проверка
1. Откройте `t.me/<тестовый бот>/app` → сверху оранжевая полоска **«ТЕСТ · тестовая копия SmartFlow»**.
2. Профиль → номер `SF-…` (в тестовой копии свой) → Railway (окружение `staging`) → `ADMIN_USERS` = этот номер → Deploy.
3. Ссылка SI-продавца из тестовой копии открывает тестового бота, а не рабочего.

---

## В. Как теперь работать

**Обычные небольшие правки** — как раньше: pull request в `main`, вливаете, всё.

**Рискованные изменения** (вход, база, деньги, уведомления, большие новые экраны):
1. Claude делает pull request **в `staging`** (а не в `main`).
2. Вы вливаете его → через 2–3 минуты новая версия в тестовом боте. Проверяете там.
3. Всё хорошо → в GitHub **New pull request: `staging` → `main`** → вливаете. Теперь у всех.
   Что-то не так → пишете Claude, он исправляет тоже через `staging`.

Ветка `staging` не должна отставать от `main`: если что-то влили сразу в `main`, Claude при следующей
тестовой задаче сначала подтянет `main` в `staging`.

**«Сначала одному человеку»** (в рабочей копии, без второго бота). Новое рискованное поведение в коде
прячется за флажком с именем (например `new-chat`). Railway → рабочий сервис → Variables:
- `FEATURES` = `new-chat:beta` — включено только людям из `BETA_USERS`;
- `BETA_USERS` = `SF-48213` (номера из Профиля через запятую; можно и Telegram id);
- проверили — `FEATURES` = `new-chat:all` (у всех); выключить у всех — `new-chat:off` или убрать.
- Deploy после каждого изменения переменных. Флажок, которого нет в `FEATURES`, выключен.

Для разработчика: на сервере `await appInfo.isOn('new-chat', userId)` (`server/services/app-info.js`),
на телефоне `SF.feature('new-chat')`. Список флажков человека приходит при входе (`/api/auth/*` → `app.features`).
Когда изменение у всех и работает — флажок убираем из кода.

## Что в каждой копии

| | Рабочая | Тестовая |
|---|---|---|
| Бот | `@smartflow_ai_support_bot` | `@<тестовый>_bot` |
| Фронтенд | `app.techsmartflow.com`, Worker `my-project`, ветка `main` | `test.techsmartflow.com`, Worker `my-project-staging`, ветка `staging` |
| Сервер | Railway, окружение `production`, EU West | Railway, окружение `staging`, EU West, `APP_ENV=staging` |
| База | Supabase `smartflow-eu`, Франкфурт | Supabase `smartflow-test`, Франкфурт |
| PostHog | включён | выключен |
