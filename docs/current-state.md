# SmartFlow — что есть сейчас

Снимок на 25 ноября 2026 (версия `main` `32637b4`, миграций базы — 38). Код при составлении не менялся.
Подробности по каждой части — `docs/ARCHITECTURE.md`; решения владелицы — `CLAUDE.md`.

Как всё связано:
- **Главная страница** `techsmartflow.com` — отдельная страница-витрина (Cloudflare Worker `smartflow-landing`, папка `landing/`).
- **Приложение** `app.techsmartflow.com` — одно и то же в Telegram (Mini App бота @smartflow_ai_support_bot) и в обычном браузере (Cloudflare Worker `my-project`).
- **Сервер** на Railway — все ключи и вся логика; приложение ходит только к нему.
- **База** — Supabase (PostgreSQL), Франкфурт.

---

## 1. Экраны и страницы

### Главная страница (techsmartflow.com)
- **`/` — английская версия (основная).** Оффер «SI-продавец ведёт разговоры с клиентами», «Знакомо?», три шага, возможности, для кого (эксперты, маркетологи, клиенты), «Без подвохов», частые вопросы. Кнопки «Start for free» / «Sign in» → приложение `?lang=en`, «Open in Telegram» → бот.
- **`/ru/` — русская версия**, то же самое; кнопки → приложение `?lang=ru`.
- Переключатель EN / RU вверху, страница «не найдено» (`404.html`) сразу ведёт на главную.

### Вход (только вне Telegram)
- **«Вход по почте»**: почта → «Получить код» → 6 цифр из письма → «Войти». Под формой «Войти через Google» (если в Railway есть `GOOGLE_CLIENT_ID`).
- В Telegram отдельного экрана входа нет: человек входит сам по подписи Telegram.
- Служебные экраны: «Нет связи с сервером», «Сессия устарела — перезапустите», заблокированный аккаунт, «сломанный экран» с кодом ошибки и кнопками «Написать в поддержку» / «Очистить данные на телефоне».

### Нижнее меню (5 вкладок)

**Комьюнити** — сообщества экспертов (как Skool):
- Список: мои сообщества + каталог открытых с поиском; у бизнес-профиля — «Создать сообщество».
- Сообщество: «О сообществе» и вступление (бесплатно / по заявке с вопросами / платно по ссылке автора, разово или месяц); внутри — лента, участники, о сообществе, «ждут ответа» (заявки и оплаты для автора и модераторов).
- Создание и настройки сообщества (название, для кого, правила, обложка, темы, кто пишет посты).
- Пост с комментариями и ответами, лайки, закреп, «Анонс всем».

**Маркетплейс** — только смотреть и покупать:
- «Специалисты»: карточки SI-продавцов плиткой (фото, цена, оффер, имя, оценка), поиск, фильтры «раздел → ниша».
- «Шаблоны ИИ-продавцов»: каталог шаблонов от маркетологов с фильтрами.
- Карточка SI-продавца: оффер, цена, описание, «Вопросы и ответы», отзывы, автор; кнопки «Спросить» (чат) и действие эксперта («Купить», «Записаться» и т. д.).
- Страница шаблона: описание, шаги, вопросы и ответы, видео, продавец шаблона, цена; «Купить» — в бизнес-режиме.
- Профиль человека (публичная страница), там же «Написать».

**Бадди** (центр, главный экран) — личный помощник:
- Сверху календарь «Месяц · Сегодня · Завтра · послезавтра», весь месяц по нажатию.
- Переписка с Бадди: планы и напоминания словами или голосом (лимит 30 сообщений в день, +10 за каждого приглашённого).
- Сюда приходят все уведомления (с кнопкой «Открыть»), подсказки «следующего шага», приглашение включить уведомления и установить приложение на экран.

**Чаты**:
- Список: чаты с SI-продавцами, личные переписки с людьми, группы, чат «Поддержка»; поиск людей.
- Чат с SI-продавцом: SI пишет первым; голосовые; «Связаться с человеком»; «Купить», «Отправить чек», «Поделиться контактом», «Записаться» — только когда разговор до этого дошёл; альтернативные SI-продавцы при возражении; отзыв после покупки; ответы эксперта — с его фото и галочкой.
- Личная переписка с человеком: текст, голосовые, фото, видео-кружки; «Принять / Заблокировать», «Пожаловаться».
- Группы: создание, приглашение и ссылка, участники и админы, ответы, закреп, @упоминания, реакции, «Без звука», «Кратко» (пересказ пропущенного).
- «Поддержка»: жалоба или предложение команде, ответ команды.

**Настройки** (бывший «Профиль»):
- Фото и имя → «Мой профиль» (публичная страница с «доверием») и «Редактировать профиль».
- Переключатель Личный / Бизнес, «Мои бизнесы» (до 3), язык, «Пригласить друзей» (свой текст, отправка в любое приложение), уведомления в Telegram, «Установить на экран» и «Выйти» (вне Telegram), «Очистить данные на этом устройстве», номер человека `SF-…`.
- Для команды — «Панель поддержки».

### Офис бизнеса (внутри Настроек → «Мои бизнесы»)
- **Мозг**: «О бизнесе», продукты (экран продукта), материалы SI-мозга (PDF, Word, текст).
- **Мои SI-продавцы**: список с полоской «Пазл N/8» и «ждут: N», кнопки «Создать» и «Найти готовый»; пункт «Шаблоны: купленные и мои».
- **Помощник**: пригласить одного помощника по номеру `SF-…`.
- **Новый SI-продавец**: «Быстрый старт» (цель → 2–4 вопроса → готов), обычный, или «Шаблон для продажи другим» (бриф из 5 разделов → ИИ собирает шаблон). Экран «SI-продавец готов» → «Поговорить как клиент».
- **SI-продавец** — 4 вкладки:
  - «Методология»: пазл, продукт, карточка (оффер, цена, кнопка, ссылка на оплату, ниша, вопросы и ответы, короткая ссылка), общее описание, шаги воронки, сценарии «если…, то…», дополнения, SI-мозг этого продавца; у шаблонов — «Пазл для покупателей» и «Проверить на примере бизнеса».
  - «Аналитика»: воронка по статусам и шагам за 7 / 30 дней / всё время, откуда пришли клиенты, отзывы.
  - «Клиенты»: «Мне написали», все клиенты (значок ⏸ у тех, где SI на паузе), календарь встреч бизнеса.
  - «Рассылки»: словами «кому и что» → SI готовит → подтвердить.
- **Клиент**: переписка, «Поставить на паузу» / «▶ Продолжить с SI», статус, возражение, шаг, «Купил» / «Отказ», чеки, телефон, журнал событий, ответ лично.
- **Шаблоны**: каталог, купленные (запустить новым SI-продавцом), мои (продажи, подтверждение оплаты), публикация шаблона.

### Панель поддержки (для владелицы и команды)
- Жалобы и ответы, поиск людей, карточка человека (SI-продавцы, материалы, чаты, ошибки, что уже делали), просмотр переписки (пишется в журнал), готовые исправления для одного человека.
- Ошибки по коду, журнал команды, команда (добавить помощника поддержки), «Как чинить».
- Состояние системы (проверка ключей, «Создать ключи для уведомлений», проверка уведомления), проверка микрофона.
- Партнёры (рейтинг приглашений), шаблоны (опубликованы / сняты), сообщества (скрыть по жалобе), ниши (переименовать, объединить).

### Куда ведут ссылки (`?startapp=…`)
- Без параметра — Бадди (новичок без ссылки — Маркетплейс).
- `<адрес>` — чат с SI-продавцом; `C_` — карточка; `P_` — профиль; `U_` — личная переписка; `G_` / `J_` — группа и приглашение; `K_` / `KP_` — сообщество и пост; `R_` — приглашение в SmartFlow; `F_` — шаблон; `I_` — «Мне написали»; `CAL` — календарь; `FSALES` — продажи моих шаблонов; `S_support` — поддержка; `A_`, `ADMIN`, `FREVIEW` — панель поддержки.

---

## 2. Способы входа и один аккаунт

- **Telegram** (внутри бота): вход сам, по подписи Telegram. Связь — запись `auth_identities` с `provider = 'telegram'` и номером Telegram. Имя и фото берутся из Telegram при каждом входе (своё имя из приложения хранится отдельно и не теряется). Сессия — 7 дней, при каждом открытии бота Telegram входит заново сам.
- **Почта** (вне Telegram): код из письма. Новая почта — новый аккаунт; `provider = 'email'`, адрес в `users.email`. Сессия 90 дней.
- **Google** (вне Telegram): `provider = 'google'`.
  - Тот же аккаунт Google → тот же аккаунт SmartFlow.
  - Почта, с которой уже входили по коду, → тот же аккаунт (к нему добавляется Google).
  - Вошёл сначала через Google → потом по коду на ту же почту — тоже тот же аккаунт (при регистрации через Google сразу записывается и почта).
- **Telegram и почта/Google между собой НЕ связаны** (решение владелицы: в Telegram пока никого). Один и тот же человек в Telegram и в браузере — это два разных аккаунта, со своими SI-продавцами, перепиской и номером `SF-…`.
- На компьютере разработчика есть быстрый вход `dev-login`; на Railway и в тестовой копии он выключен.
- Защита: 10 минут на код, 5 попыток, письмо не чаще раза в минуту и 5 в час на почту, 20 в час с одного адреса; заблокированный человек войти не может.

---

## 3. Таблицы в Supabase (62)

Все таблицы с включённым RLS без правил: снаружи Supabase их не читает никто, работает только сервер.
Поля перечислены как есть.

### Люди и вход

- **users** — человек (один аккаунт); имя из приложения — в profile.displayName.
  Поля: id, display_name, username, avatar_url, roles, status, is_demo, created_at, updated_at, photo_media_id, profile, support_code, last_seen_at, telegram_write_allowed, client_reset_at, tz_offset_minutes, hidden_from_search, lang, tg_lang, referred_by_link, invite_text, email, email_notify, buddy_welcome_due_at, buddy_welcome_sent_at
- **auth_identities** — способы входа человека: telegram / email / google, у одного человека может быть несколько.
  Поля: id, user_id, provider, provider_user_id, metadata, created_at, updated_at
- **email_codes** — коды из письма для входа по почте (хранится только отпечаток кода).
  Поля: id, email, code_hash, attempts, expires_at, used_at, ip, created_at
- **push_subscriptions** — устройства, которым разрешены уведомления из браузера.
  Поля: id, user_id, endpoint, p256dh, auth, device, failures, last_ok_at, created_at
- **email_notifications** — когда уходили письма о важном (только время, для лимита 20 в сутки).
  Поля: id, user_id, created_at
- **media** — фото: человека, SI-продавца, обложки сообществ.
  Поля: id, owner_id, kind, mime_type, size_bytes, data_base64, created_at
- **staff** — команда поддержки (кроме владелицы — она из ADMIN_USERS).
  Поля: user_id, role, added_by, created_at
- **admin_actions** — журнал команды: что исправляли и у кого.
  Поля: id, staff_user_id, target_user_id, action, details, created_at
- **error_log** — ошибки с кодом вида K7P2 (хранятся 60 дней).
  Поля: id, code, source, user_id, method, path, status, message, context, created_at
- **feedback** — жалобы и предложения людей, ответ команды.
  Поля: id, user_id, text, status, created_at, context, note, reply, replied_at, replied_by, updated_at

### Бизнес и Офис

- **businesses** — бизнесы человека (до 3, один главный).
  Поля: id, owner_id, name, created_at, updated_at, about, niche, is_primary
- **business_members** — кто в бизнесе: владелец и помощник.
  Поля: id, business_id, user_id, role, status, invited_by, created_at, updated_at
- **products** — продукты бизнеса (что продаётся, цена, рассрочка, ссылки).
  Поля: id, business_id, name, description, result, format, duration, price_mode, price_label, installment, guarantee, payment_url, access_url, status, position, created_at, updated_at
- **projects** — SI-продавцы (карточка, методология, оффер, цена, купленный шаблон, пазл, FAQ).
  Поля: id, owner_id, template_id, name, slug, status, niche, custom_ai_settings, pricing_options, stats, is_demo, created_at, updated_at, photo_media_id, role_title, offer, description, price_label, payment_url, trial_days, category, is_listed, business_id, access_url, hidden_by_staff, price_mode, cta_kind, cta_label, funnel_settings, funnel_until, funnel_purchase_id, product_id, knows_business, knows_profile, funnel_released, funnel_brain_access, puzzle_material_id, niche_id, faq
- **project_slug_aliases** — старые короткие адреса SI-продавца, чтобы ссылки не ломались.
  Поля: slug, project_id, created_at
- **niches** — ниши для фильтров Маркетплейса.
  Поля: id, section, name, name_key, created_by, merged_into, created_at
- **seller_answers** — ответы эксперта на вопросы пазла купленного шаблона.
  Поля: project_id, question_id, piece_id, answer, created_at, updated_at
- **seller_notes** — «Дополнения»: тема → как SI отвечает.
  Поля: id, project_id, step_id, topic, text, source, created_at, updated_at
- **card_views** — кто открывал карточку SI-продавца.
  Поля: project_id, user_id, views, first_at, last_at
- **tracked_links** — ссылки с меткой источника и ссылки-приглашения в SmartFlow.
  Поля: id, kind, owner_user_id, project_id, code, label, created_at, archived_at
- **link_visits** — переходы по этим ссылкам.
  Поля: id, link_id, user_id, is_new_user, created_at

### SI-мозг

- **brain_materials** — материалы SI-мозга (PDF, Word, текст) — только текст.
  Поля: id, owner_id, title, source_type, char_count, chunk_count, created_at, business_id
- **brain_chunks** — кусочки материалов для поиска по смыслу.
  Поля: id, material_id, position, text, embedding
- **consultant_materials** — какой материал знает какой SI-продавец.
  Поля: project_id, material_id, created_at

### Клиенты и переписка с SI-продавцом

- **clients** — клиенты SI-продавца: статус воронки, шаг, кто отвечает (SI или человек), контакт.
  Поля: id, project_id, external_client_id, name, username, avatar_url, status, funnel_step, deal_value, tags, qualification_answers, last_message, last_activity, is_demo, created_at, updated_at, business_id, responsible_type, responsible_user_id, funnel_status, offer_answered_at, funnel_updated_at, last_objection, objection_at, contact_consent_at, contact_phone, step_id, step_at, broadcasts_off_at, alt_offers, alt_offers_at, source_link_id, entry, demo_id
- **conversations** — сообщения в чате клиента с SI-продавцом (SI, клиент, эксперт, помощник).
  Поля: id, project_id, client_id, sender, text, is_voice, voice_duration, voice_transcription, created_at, business_id, author_type, author_user_id, voice_id, voice_seconds, is_broadcast
- **direct_inquiries** — «Мне написали»: обращения к эксперту.
  Поля: id, project_id, client_id, lead_name, lead_username, lead_avatar, reason, urgency, status, last_user_voice_transcription, is_demo, created_at, updated_at, business_id
- **client_events** — журнал событий клиента (оффер, возражение, передан человеку, купил…).
  Поля: id, business_id, project_id, client_id, type, actor_type, actor_user_id, data, created_at
- **voice_messages** — голосовые в чате с SI-продавцом и их расшифровка.
  Поля: id, business_id, project_id, client_id, user_id, mime_type, size_bytes, duration_seconds, data_base64, transcript, created_at
- **payment_receipts** — чеки об оплате, которые прислал клиент.
  Поля: id, business_id, project_id, client_id, uploaded_by, mime_type, size_bytes, data_base64, status, reviewed_by, reviewed_at, created_at
- **reviews** — отзывы клиентов, купивших у эксперта.
  Поля: id, project_id, business_id, client_id, author_user_id, rating, text, reply_text, reply_at, hidden_at, created_at, updated_at
- **broadcasts** — рассылки SI-продавца.
  Поля: id, business_id, project_id, created_by, approved_by, status, request, audience, text, total, sent, created_at, started_at, finished_at
- **broadcast_recipients** — кому ушла рассылка.
  Поля: broadcast_id, client_id, status, sent_at

### Календарь встреч

- **calendar_settings** — правила календаря бизнеса (длительность, кто может перенести/отменить).
  Поля: business_id, tz_offset_minutes, duration_minutes, client_can_cancel, client_can_reschedule, change_hours_before, updated_at
- **calendar_hosts** — кто принимает встречи: окна и ссылка Zoom.
  Поля: business_id, user_id, active, zoom_url, windows, updated_at
- **meetings** — встречи клиентов с экспертом.
  Поля: id, business_id, project_id, client_id, host_user_id, starts_at, ends_at, status, zoom_url, booked_by, cancelled_by, cancelled_at, reminded_at, recording_url, transcript, analysis, created_at, updated_at

### Бадди

- **notifications** — сообщения Бадди: все уведомления и переписка с Бадди.
  Поля: id, user_id, text, start_param, read_at, created_at, sender, kind
- **buddy_reminders** — планы и напоминания из календаря Бадди.
  Поля: id, user_id, text, remind_at, sent_at, cancelled_at, created_at, kind, starts_at, notify

### Люди пишут друг другу

- **dm_threads** — личные переписки двух людей.
  Поля: id, user_a, user_b, started_by, status, blocked_by, last_message, last_sender, last_activity, a_read_at, b_read_at, created_at
- **dm_messages** — сообщения в них.
  Поля: id, thread_id, sender_id, text, kind, file_id, seconds, created_at
- **dm_files** — фото, голосовые и кружки в личных переписках.
  Поля: id, thread_id, sender_id, mime_type, size_bytes, data_base64, created_at

### Группы в «Чатах»

- **chat_groups** — группы в «Чатах».
  Поля: id, name, photo_media_id, owner_id, invite_code, pinned_message_id, last_message, last_sender, last_activity, changed_at, created_at
- **chat_group_members** — участники группы.
  Поля: group_id, user_id, role, status, invited_by, muted, read_at, notified_at, unread_from, marks_seen_at, joined_at, created_at
- **chat_group_messages** — сообщения группы.
  Поля: id, group_id, sender_id, text, kind, file_id, seconds, reply_to, deleted_at, created_at
- **chat_group_files** — файлы в группах.
  Поля: id, group_id, sender_id, mime_type, size_bytes, data_base64, created_at
- **chat_group_mentions** — @упоминания.
  Поля: message_id, group_id, user_id, created_at
- **chat_group_reactions** — реакции.
  Поля: message_id, user_id, group_id, emoji, created_at
- **chat_group_summaries** — кто и когда нажимал «Кратко».
  Поля: id, group_id, user_id, created_at

### Комьюнити

- **communities** — сообщества в «Комьюнити».
  Поля: id, owner_id, name, about, rules, cover_media_id, visibility, join_mode, price_type, price_label, payment_url, questions, posting, categories, hidden_by_staff, changed_at, created_at, updated_at
- **community_members** — участники, заявки, оплата месяца.
  Поля: community_id, user_id, role, status, answers, payment_note, decline_reason, paid_until, renewal_requested_at, renewal_note, read_at, joined_at, last_active_at, created_at, updated_at
- **community_posts** — посты ленты.
  Поля: id, community_id, author_id, category, text, file_id, announcement, pinned, deleted_at, last_activity, created_at
- **community_comments** — комментарии и ответы.
  Поля: id, post_id, community_id, author_id, parent_id, text, deleted_at, created_at
- **community_likes** — лайки.
  Поля: target_id, user_id, community_id, created_at
- **community_files** — фото в постах.
  Поля: id, community_id, sender_id, mime_type, size_bytes, data_base64, created_at

### Шаблоны ИИ-продавцов (в коде «готовые воронки»)

- **ready_funnels** — шаблоны ИИ-продавцов, опубликованные авторами.
  Поля: id, author_id, source_project_id, title, niche, description, result, price_type, price_label, payment_url, snapshot, status, review_note, reviewed_by, reviewed_at, submitted_at, created_at, updated_at, seller_project_id, video_url, product_id, niche_id, faq
- **funnel_purchases** — покупки шаблонов: кто купил, подтвердил ли автор, к какому продавцу подключено.
  Поля: id, funnel_id, expert_id, marketer_id, price_type, price_label, snapshot, status, note, reason, paid_until, renewal_requested_at, renewal_note, project_id, applied_at, confirmed_at, created_at, updated_at

### Служебные

- **scheduler_jobs** — «будильник» сервера: задачи раз в минуту.
  Поля: name, locked_until, locked_by, last_started_at, last_finished_at, last_error, last_result, runs
- **schema_migrations** — какие миграции базы уже применены.
  Поля: version, name, applied_at

### Остались от первой версии

- **funnel_templates** — старые «шаблоны маркетологов» первой версии (сейчас вместо них ready_funnels).
  Поля: id, creator_id, title, niche, tagline, description, monthly_price, currency, trial_days, badge, ai_clone_settings, steps, is_published, is_demo, created_at, updated_at
- **funnel_subscriptions** — старые подписки на эти шаблоны (не используются экранами).
  Поля: id, expert_user_id, marketer_user_id, funnel_template_id, status, price, currency, trial_ends_at, current_period_starts_at, current_period_ends_at, auto_renew, custom_payment_url, cancellation_reason, created_at, updated_at
- **platform_subscriptions** — «пробный тариф» платформы, создаётся при регистрации; оплаты за платформу нет.
  Поля: id, user_id, plan_code, status, trial_ends_at, current_period_starts_at, current_period_ends_at, auto_renew, created_at, updated_at
- **project_members** — старые приглашённые к SI-продавцу (сейчас — помощник через business_members).
  Поля: id, project_id, user_id, role, permissions, invited_by, status, created_at, updated_at

---

## 4. Внешние сервисы и ключи (только имена)

**Где что настраивается**
- **Railway** (сервер) — почти все ключи ниже, в Variables.
- **Cloudflare** — два Worker: `my-project` (приложение, переменная сборки `SMARTFLOW_API_URL`) и `smartflow-landing` (главная, без переменных); домены `app.`, корень и `www.`.
- **Supabase** — база `smartflow-eu`; сервер подключается строкой `DATABASE_URL`.
- **GitHub** — код, автоматические проверки на каждый PR; Railway и Cloudflare обновляются сами после вливания в `main`.

**Сервисы и их ключи на Railway**
- **Telegram Bot API** (вход в Mini App, уведомления в Telegram): `TELEGRAM_BOT_TOKEN`; необязательно `TELEGRAM_BOT_USERNAME` (для тестового бота), `TELEGRAM_APP_SHORT_NAME`.
- **База Supabase / PostgreSQL**: `DATABASE_URL`, `DB_DRIVER` (= `postgres`); необязательно `PGSSLMODE`. Локально вместо неё SQLite (`DB_FILE`).
- **OpenAI** (ответы SI, Бадди, «Кратко» в группах, конструктор шаблона, расшифровка голоса, поиск по SI-мозгу): `OPENAI_API_KEY` (понимает и `OPEN_API_KEY`); модели — `OPENAI_MODEL`, `BUDDY_MODEL`, `GROUP_SUMMARY_MODEL`, `TEMPLATE_MODEL`, `TRANSCRIBE_MODEL`.
- **Resend** (письма с кодом входа и письма о важном): `RESEND_API_KEY`, `MAIL_FROM`.
- **Google** (вход через Google): `GOOGLE_CLIENT_ID`.
- **Web Push** (уведомления в браузере и в приложении на экране): `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, необязательно `VAPID_SUBJECT`.
- **PostHog** (цифры без личных данных): `POSTHOG_API_KEY`, `POSTHOG_HOST`.
- **Amplitude** (те же цифры): `AMPLITUDE_API_KEY`, `AMPLITUDE_REGION`.
- **Zoom** — ключа нет: эксперт вписывает свою постоянную ссылку на встречи.

**Настройки сервера (не ключи)**
- `JWT_SECRET` — секрет для сессий (это ключ, хранить в тайне).
- `NODE_ENV=production`, `CORS_ORIGINS` (адреса приложения), `WEB_APP_URL` (адрес для ссылок в письмах), `DEFAULT_TZ_OFFSET_MINUTES` (часовой пояс по умолчанию, Алматы), `PORT`.
- `ADMIN_USERS` — кто владелица (открывает панель поддержки).
- `FEATURES` и `BETA_USERS` — включить новое всем или сначала одному человеку (сейчас под флагами: `funnels` — шаблоны, `quick-start` — быстрый старт, `card-cta` — кнопка эксперта на карточке).
- `APP_ENV=staging` — только у тестовой копии (полоска «ТЕСТ»).
- Railway сам передаёт `RAILWAY_GIT_COMMIT_SHA` и подобные — по ним `/api/health` показывает версию.

**Есть в настройках, но не используются кодом**
- `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` — остались с первой версии; сервер работает с базой напрямую через `DATABASE_URL`. Если они заданы в Railway — их можно не трогать, но и задавать не нужно.

**Проверка, что всё подключено:** `https://my-project-production-f83d.up.railway.app/api/health` — по каждому сервису `configured: true`, `commit` — версия, `database.pingMs` — скорость базы.

---

## 5. Что начато, но не доделано

**Бизнес-режим 2.0 (8 шагов, сделано 5)**
- Шаг 6 — цифры продавца (деньги, вопросы, совет AI) и публичные цифры шаблона с рейтингом — не начат.
- Шаг 7 — версии шаблона (автор выпускает версии, эксперт выбирает любую) — не начат.
- Шаг 8 — «AI» вместо «SI» во всём интерфейсе — решено 22 нояб., не сделано; пока везде «SI».

**Комьюнити**
- Часть 1 (сообщества, лента, вступление, модераторы) — сделана.
- Часть 2 — курсы и уроки, баллы, уровни, лидеры, напоминания Бадди, аналитика сообщества — не начата.
- Упоминания «@» в постах сервер принимает, а подсказок при наборе в приложении нет.
- У Бадди обещана «своя функция» для групп и сообществ (их уведомления сейчас только на телефон) — не сделано.

**Тестовая копия (staging)**
- Код готов (полоска «ТЕСТ», `APP_ENV`, свой бот), но сама копия не поднята: нет второго бота, второго сервера Railway и второй базы (отложено владелицей 16 окт.). Рискованные изменения пока идут сразу в рабочее приложение.

**Отложено владелицей**
- Видео-вебинар (решения и ТЗ — `docs/WEBINAR.md`).
- Профиль-лендинг для соцсетей (страница эксперта с превью для ссылок).
- Оплата через платформу — сейчас только ссылки эксперта, деньги идут ему напрямую; подписки платформы (`platform_subscriptions`) создаются, но ни на что не влияют.
- Своё приложение в App Store / Google Play.
- Разные модели ИИ для разных функций и сравнение моделей для Бадди — обсуждено, частично (переменные моделей есть).

**Нужно проверить или решить владелице**
- Голосовые и видео-кружки на iPhone и Android (на iPad микрофон работает).
- Вход через Google по ссылке SI-продавца (исправлено 24 нояб., вживую не проверено).
- Строку `FEATURES` в Railway: включены ли всем шаблоны и быстрый старт.
- Где бронировать встречи — у Бадди или в чате SI-продавца: решить по цифрам PostHog.
- Пользовательское соглашение и политика данных (ссылок в приложении пока нет), пункт о показе SI-продавцов клиентам других экспертов.
- Юрист: хранение данных граждан РК на серверах в РК.
- Месячный лимит расходов в OpenAI, резервные копии базы.
- Удалить старую базу в Сиднее и таблицы `backup_1010_…` (если ещё не удалены).

**Хвосты в коде**
- Таблицы и адреса первой версии: `funnel_templates`, `funnel_subscriptions`, `project_members`, `/api/templates`, `/api/subscriptions` — экранами не используются, оставлены, чтобы ничего не сломать. Демо-записи первой версии (`is_demo = 1`) лежат в базе, в интерфейсе не видны.
- Поиск по SI-мозгу считается на сервере; при большом объёме материалов — перенести в pgvector.
- Telegram-аккаунты и аккаунты из браузера не связываются (см. раздел 2) — если людям понадобится один аккаунт в обоих местах, это отдельная задача.
