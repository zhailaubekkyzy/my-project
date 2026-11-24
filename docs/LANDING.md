# Главная страница techsmartflow.com (лендинг)

Файлы: `landing/public/` — `index.html` (английская, основная, `techsmartflow.com`), `ru/index.html` (русская, `techsmartflow.com/ru/`),
общее оформление `styles.css`, картинки, `404.html`; настройки — `landing/wrangler.jsonc`.
Язык основной — английский, русский дополнительный (решение владелицы 24 нояб.): переключатель EN / RU в шапке.
Меняя текст, правьте **обе** страницы.
Это отдельный Cloudflare Worker `smartflow-landing`: с приложением (`my-project`) не связан, сборки и ключей не нужно.
Кнопки «Начать бесплатно» / «Войти» ведут на `https://app.techsmartflow.com/` (вход по почте или Google),
«Открыть в Telegram» — на `t.me/smartflow_ai_support_bot/app`.

## Подключение (один раз, делает владелица в Cloudflare)
1. Cloudflare → **Workers & Pages** → **Create** → **Import a repository** → `my-project`.
2. Project name: `smartflow-landing`.
3. **Advanced settings → Root directory**: `landing`.
4. Build command — пусто. Deploy command: `npx wrangler deploy`. Переменные не нужны.
5. **Deploy**. Откроется адрес вида `smartflow-landing.<…>.workers.dev` — проверить страницу.
6. Worker `smartflow-landing` → **Settings → Domains & Routes → Add → Custom domain** → `techsmartflow.com` → Add.
   (По желанию так же `www.techsmartflow.com`.)
7. Через 1–5 минут `https://techsmartflow.com` показывает страницу.

Если сборка ругается на `SMARTFLOW_API_URL` — значит, не указан Root directory `landing` (собирается приложение).

## Правки
Текст — прямо в `landing/public/index.html` и `landing/public/ru/index.html`. После вливания в `main` Cloudflare обновляет страницу сам.
Никаких выдуманных цифр, отзывов и клиентов — только правда о продукте.
