# Главная страница techsmartflow.com (лендинг)

Файлы: `landing/public/` — `index.html` (английская, основная, `techsmartflow.com`), `ru/index.html` (русская, `techsmartflow.com/ru/`),
общее оформление `styles.css`, картинки, `404.html`; настройки — `landing/wrangler.jsonc`.
Язык основной — английский, русский дополнительный (решение владелицы 24 нояб.): переключатель EN / RU в шапке.
Меняя текст, правьте **обе** страницы.
Это отдельный Cloudflare Worker `smartflow-landing`: с приложением (`my-project`) не связан, сборки и ключей не нужно.
Кнопки «Начать бесплатно» / «Войти» ведут на `https://app.techsmartflow.com/` (вход по почте или Google),
«Открыть в Telegram» — на `t.me/smartflow_ai_support_bot/app`.

## Подключение (сделано 24 нояб.; так выглядит Cloudflare сейчас)
1. Cloudflare → **Workers & Pages** → **Create application** → **Continue with GitHub** → репозиторий `my-project`.
2. Project name: `smartflow-landing`. Build command — пусто. Deploy command: `npx wrangler deploy`.
   **Enable Preview builds** — выключить.
3. **Advanced settings** → **Path**: `landing` (самое важное). API token — любой из списка. Variable name — пусто.
4. **Deploy**. Адрес `…workers.dev` может быть выключен («Disabled») — это не важно.
5. Worker `smartflow-landing` → **Domains** → **+ Add Domain**: Subdomain пусто (= `techsmartflow.com`), Production → Add domain.
   Ещё раз с Subdomain `www`.

Если сборка ругается на `SMARTFLOW_API_URL` — значит, не указан Path `landing` (собирается приложение).

## Язык со страницы в приложение (24 нояб.)
Кнопки английской страницы ведут на `https://app.techsmartflow.com/?lang=en`, русской — `?lang=ru`.
Приложение берёт этот язык (и запоминает на устройстве), экран входа и письмо с кодом — на нём,
новый аккаунт из браузера сохраняет язык на сервере: приветствие Бадди и уведомления приходят на нём же.
Новая кнопка на странице — с тем же `?lang=…`.

## Правки
Текст — прямо в `landing/public/index.html` и `landing/public/ru/index.html`. После вливания в `main` Cloudflare обновляет страницу сам.
Никаких выдуманных цифр, отзывов и клиентов — только правда о продукте.
