// i18n.js - Languages of the client screens: Russian (the source) and English (owner's decision 15 Oct.:
// RU/EN for clients — Маркетплейс, Чаты, Бадди, Профиль; the Office and the support panel stay Russian).
//
// How it works: screens are written in Russian as before; after a screen is drawn, SF.translateDom()
// replaces the Russian phrases on it by the dictionary below (whole text pieces, placeholders, aria-labels).
// What people wrote (messages, names, the expert's offers and descriptions) is never translated:
// chat bubbles and [data-no-tr] are skipped. A phrase missing here simply stays Russian.
// The language: chosen in Профиль → «Язык», otherwise Telegram's language (ru, kk, uk… → Russian).

(function (window) {
  const SF = window.SF = window.SF || {};
  const RU_FAMILY = ['ru', 'kk', 'uk', 'be', 'uz', 'ky', 'tg', 'tk', 'az', 'hy', 'ka'];
  const STORE_KEY = 'sf_lang';

  function fromTelegram() {
    // Only Telegram's own language counts; unknown (e.g. outside Telegram) — Russian
    const code = String(window.Telegram?.WebApp?.initDataUnsafe?.user?.language_code || 'ru').slice(0, 2).toLowerCase();
    return RU_FAMILY.includes(code) ? 'ru' : 'en';
  }

  let lang = 'ru';
  try { lang = localStorage.getItem(STORE_KEY) || fromTelegram(); } catch (e) { lang = fromTelegram(); }
  if (lang !== 'en') lang = 'ru';

  // Exact phrases (trimmed). Keys are the Russian text as it appears on the screen.
  const EN = {
    // Navigation and common
    'Инкубатор': 'Incubator', 'Маркетплейс': 'Marketplace', 'Бадди': 'Buddy', 'Чаты': 'Chats', 'Профиль': 'Profile',
    'Назад': 'Back', 'Закрыть': 'Close', 'Отмена': 'Cancel', 'Отменить': 'Cancel', 'Сохранить': 'Save', 'Изменить': 'Edit',
    'Открыть': 'Open', 'Отправить': 'Send', 'Загружаю…': 'Loading…', 'Ищу…': 'Searching…', 'скоро': 'soon', 'Ещё': 'More',
    'Написать': 'Message', 'Создать': 'Create', 'Заполнить': 'Fill in', 'Не сейчас': 'Not now', 'Включить': 'Turn on',
    'Не получилось': 'Something went wrong', 'Не отправилось': 'Not sent', 'Не сохранилось': 'Not saved',
    'Не отправилось. Попробуйте ещё раз': 'Not sent. Please try again',
    'Не отправилось. Проверьте интернет и попробуйте ещё раз': 'Not sent. Check your connection and try again',
    'Ссылка скопирована': 'Link copied', 'печатает': 'typing', 'друг': 'friend', 'Эксперт': 'Expert', 'эксперт': 'expert',
    'эксперта': 'the expert', 'Автор': 'Author', 'Фото': 'Photo', 'Чат': 'Chat', 'Переписка': 'Conversation', 'Запись': 'Recording',
    'Бесплатно': 'Free', 'Пожаловаться': 'Report', 'Поддержка': 'Support',

    // Session / errors
    'Нет связи с сервером. Откройте приложение в Telegram или проверьте интернет.': 'No connection to the server. Open the app in Telegram or check your internet.',
    'Откройте приложение в Telegram': 'Open the app in Telegram',
    'Сессия Telegram завершена': 'Your Telegram session has ended',
    'Вход через Telegram действует 24 часа. Все ваши данные сохранены на сервере SmartFlow.': 'Telegram sign-in lasts 24 hours. All your data is saved on the SmartFlow server.',
    'Обновить вход через Telegram': 'Sign in with Telegram again', 'Войдите заново через Telegram': 'Sign in again via Telegram',
    'Обновляю вход через Telegram...': 'Signing in again…',
    'Этот экран не открылся': 'This screen did not open', 'Код ошибки': 'Error code',
    'Написать в поддержку': 'Write to support', 'Очистить данные на телефоне': 'Clear data on this phone',
    'Очистить данные на этом устройстве': 'Clear data on this device',
    'Очистить данные на этом устройстве? Всё сохранённое на сервере останется.': 'Clear data on this device? Everything saved on the server stays.',
    'Данные на устройстве очищены': 'Data on this device cleared',

    // Marketplace
    'Все': 'All', 'Продажи': 'Sales', 'Прогрев и заявки': 'Warm-up & leads',
    'Найти SI-продавца: имя, тема, эксперт': 'Find an SI-seller: name, topic, expert',
    'Создать своего SI-продавца': 'Create your own SI-seller', 'Мой Офис': 'My Office', 'Офис для бизнеса': 'Office for business',
    'Свой SI-продавец продаёт ваши услуги 24/7. Откройте бизнес-профиль — это бесплатно.': 'Your own SI-seller sells your services 24/7. Open a business profile — it is free.',
    'Ничего не нашли. Людей можно найти во вкладке «Чаты».': 'Nothing found. People can be found in the «Chats» tab.',
    'Витрина только открывается': 'The marketplace is just opening',
    'Здесь появятся SI-продавцы экспертов. Своего SI-продавца можно показать здесь из Офиса — включите «Показывать в Маркетплейсе».': 'Experts’ SI-sellers will appear here. You can show your own SI-seller from the Office — turn on «Show in Marketplace».',
    'Карточка не найдена': 'Card not found', 'Возможно, автор снял SI-продавца с витрины.': 'The author may have removed this SI-seller from the marketplace.',
    'Диалогов с клиентами': 'Conversations with clients', 'Отзывы': 'Reviews', 'Спросить': 'Ask', 'Купить': 'Buy',
    'Поделиться карточкой': 'Share card', 'Ответ автора:': 'Author’s reply:',
    'Пока нет отзывов. Оставить отзыв могут только клиенты, которые купили; видно только имя и первую букву фамилии.': 'No reviews yet. Only clients who bought can leave a review; only the first name and the first letter of the last name are shown.',
    'Оплата идёт напрямую автору по его ссылке. SmartFlow не принимает платежи и не берёт комиссию.': 'Payment goes directly to the author by their link. SmartFlow does not take payments or fees.',
    'Перейти к оплате': 'Go to payment', 'Скопировать ссылку на оплату': 'Copy payment link',
    'Автор пока не добавил ссылку на оплату. Задайте вопрос SI-продавцу или свяжитесь с автором.': 'The author has not added a payment link yet. Ask the SI-seller or contact the author.',
    'SI-продавец': 'SI-seller', 'SI-продавцы': 'SI-sellers', 'SI-консультант': 'SI-consultant', 'SI-продавец не найден': 'SI-seller not found',
    'Профиль не найден': 'Profile not found', 'Проверьте ссылку.': 'Please check the link.',
    'О себе': 'About', 'Регалии и сертификаты': 'Credentials and certificates', 'Результаты и кейсы': 'Results and cases',
    'Ссылка на оплату скопирована': 'Payment link copied', 'Ссылка на карточку скопирована': 'Card link copied',
    'Ссылка на профиль скопирована': 'Profile link copied',
    'Что не так с этим отзывом? Команда SmartFlow проверит.': 'What is wrong with this review? The SmartFlow team will check.',
    'Спасибо! Команда проверит отзыв': 'Thank you! The team will check the review',

    // Chats
    'Мои чаты': 'My chats', 'Люди в SmartFlow': 'People in SmartFlow', 'Поддержка SmartFlow': 'SmartFlow support',
    'Жалобы и предложения по платформе': 'Complaints and suggestions about the platform',
    'Жалобы, предложения и вопросы': 'Complaints, suggestions and questions', 'Жалоба, предложение или вопрос...': 'A complaint, suggestion or question…',
    'Найти чат или человека: имя, @ник, чем занимается': 'Find a chat or a person: name, @username, what they do',
    'Никого не нашли. Попробуйте имя, @ник или слово о том, чем человек занимается.': 'Nobody found. Try a name, @username or a word about what the person does.',
    'Пока нет переписок': 'No conversations yet',
    'Найдите человека по имени в поиске выше — и напишите ему. Или найдите SI-продавца в Маркетплейсе.': 'Find a person by name in the search above and message them. Or find an SI-seller in the Marketplace.',
    'Хочет с вами пообщаться': 'Wants to talk with you', 'хочет с вами пообщаться.': 'wants to talk with you.', 'Вы:': 'You:',
    'Напишите сообщение...': 'Write a message…', 'Сообщение...': 'Message…',
    'Записать голосовое': 'Record a voice message', 'Отправить голосовое': 'Send voice message', 'Записать видео-кружок': 'Record a video note',
    'Отправить фото': 'Send a photo', 'Отправить чек': 'Send receipt', 'Поделиться контактом': 'Share contact',
    'Записаться': 'Book a call', 'Моя встреча': 'My meeting', 'Ваша встреча': 'Your meeting', 'Запись на встречу': 'Book a meeting',
    'Перенести встречу': 'Reschedule the meeting', 'Перенести': 'Reschedule', 'Отменить запись': 'Cancel booking',
    'Ссылка на встречу': 'Meeting link', 'Ссылку на встречу пришлют в этот чат.': 'The meeting link will be sent to this chat.',
    'Загружаю свободное время…': 'Loading free time…', 'Готово, вы записаны': 'Done, you are booked',
    'Встреча отменена': 'The meeting is cancelled', 'Встреча перенесена': 'The meeting is rescheduled',
    'Не получилось записаться': 'Could not book', 'Не получилось отменить': 'Could not cancel',
    'Свободного времени в ближайшие две недели пока нет. Напишите в чат — эксперт подберёт время.': 'No free time in the next two weeks yet. Write in the chat — the expert will find a time.',
    'Перенести или отменить встречу можно через чат — напишите эксперту.': 'To reschedule or cancel, write to the expert in the chat.',
    'Перенести или отменить встречу теперь можно через чат — напишите эксперту.': 'To reschedule or cancel now, write to the expert in the chat.',
    'Связаться с человеком': 'Contact a person', 'Клиент нажал «Связаться с человеком»': 'The client asked to contact a person',
    'Эксперт получил ваш запрос в Telegram и ответит здесь': 'The expert got your request and will reply here',
    'Не получилось отправить запрос. Попробуйте ещё раз': 'Could not send the request. Please try again',
    '👤 Эксперт скоро ответит вам лично прямо здесь.': '👤 The expert will soon reply to you personally right here.',
    'SI ответил на всё, что мог. Нажмите «Связаться с человеком»': 'SI has answered all it could. Tap «Contact a person»',
    'Готовы начать?': 'Ready to start?', 'Голосовое сообщение': 'Voice message',
    'Голосовое не отправилось. Попробуйте ещё раз': 'The voice message was not sent. Please try again',
    'Не получилось включить микрофон': 'Could not turn on the microphone', 'Не получилось проиграть голосовое': 'Could not play the voice message',
    'Не получилось открыть запись': 'Could not open the recording',
    'Разрешите доступ к микрофону для Telegram в настройках телефона': 'Allow microphone access for Telegram in your phone settings',
    'Нет доступа к микрофону. Разрешите микрофон для Telegram в настройках телефона.': 'No microphone access. Allow the microphone for Telegram in your phone settings.',
    'Нет доступа к камере. Разрешите камеру и микрофон для Telegram в настройках телефона.': 'No camera access. Allow the camera and microphone for Telegram in your phone settings.',
    'Отправляю голосовое…': 'Sending voice message…', 'Отправляю фото…': 'Sending photo…', 'Отправляю видео…': 'Sending video…', 'Отправляю чек…': 'Sending receipt…',
    'Чек отправлен. Эксперт проверит оплату и напишет здесь': 'Receipt sent. The expert will check the payment and write here',
    'Файл больше 5 МБ. Сделайте снимок экрана с чеком': 'The file is larger than 5 MB. Take a screenshot of the receipt',
    'Готово: эксперт увидит ваш номер': 'Done: the expert will see your number',
    'Обновите Telegram, чтобы поделиться контактом': 'Update Telegram to share your contact',
    'Переписка с SI-продавцом доступна после входа через Telegram.': 'Chatting with an SI-seller is available after signing in with Telegram.',
    'Переписка доступна после входа через Telegram.': 'Chatting is available after signing in with Telegram.',
    'Откройте приложение в Telegram, чтобы писать людям': 'Open the app in Telegram to message people',
    'Человек не найден': 'Person not found', 'Возможно, ссылка устарела.': 'The link may be out of date.',
    'Возможно, ссылка устарела или эксперт выключил SI-продавца.': 'The link may be out of date, or the expert turned this SI-seller off.',
    'Принять': 'Accept', 'Заблокировать': 'Block', 'Разблокировать': 'Unblock', 'Заблокировано': 'Blocked', 'Разблокировано': 'Unblocked',
    'Переписка принята': 'Conversation accepted', 'Не интересно': 'Not interested',
    'Жалоба отправлена команде. Спасибо!': 'The complaint was sent to the team. Thank you!',
    'Спасибо, записал! Передам команде SmartFlow. Ответ придёт сюда и в Telegram.': 'Thank you, noted! I will pass it to the SmartFlow team. The answer will come here and to Telegram.',
    '👤 Команда SmartFlow': '👤 SmartFlow team',
    'Здравствуйте! Это поддержка SmartFlow. Напишите сюда жалобу, предложение или вопрос — передам команде и помогу разобраться.': 'Hello! This is SmartFlow support. Write a complaint, a suggestion or a question here — I will pass it to the team and help you figure it out.',
    'Поделитесь впечатлением — оставьте отзыв': 'Share your impression — leave a review',
    'Все увидят только ваше имя и первую букву фамилии. Отзыв можно изменить позже.': 'Everyone will see only your first name and the first letter of your last name. You can change the review later.',
    'Что понравилось, что получилось? Пара предложений поможет другим.': 'What did you like, what worked out? A couple of sentences will help others.',
    'Поставьте оценку — от 1 до 5 звёзд': 'Choose a rating — from 1 to 5 stars', 'Спасибо за отзыв!': 'Thank you for the review!', 'Отзыв обновлён': 'Review updated',
    'Не присылать рассылки': 'Do not send me announcements', 'Снова присылать рассылки': 'Send announcements again',
    'Больше не будем присылать рассылки. Переписка остаётся как была': 'No more announcements. The conversation stays as it was',
    'Рассылки снова включены': 'Announcements are on again',
    'Может подойти и это': 'This may suit you too', 'Скрыть': 'Hide',
    'Пригласить в SmartFlow': 'Invite to SmartFlow', 'Копировать': 'Copy',
    'Ваша личная ссылка. Кто впервые придёт в SmartFlow по ней или по ссылкам ваших SI-продавцов — засчитается вам.': 'Your personal link. Everyone who comes to SmartFlow for the first time by it or by your SI-sellers\u2019 links counts for you.',
    'Что вы получаете': 'What you get', '• Счётчик в профиле: сколько людей пришло от вас': '• A counter on your profile: how many people came from you',
    'Отправить приглашение': 'Send an invitation', 'Приглашение скопировано — вставьте его в чат': 'Invitation copied — paste it into a chat',
    'Скопировать': 'Copy', 'Приглашение со ссылкой скопировано': 'Invitation with the link copied',
    'Приглашение скопировано — вставьте его в любое приложение': 'Invitation copied — paste it into any app',
    '• В будущем — процент с каждого пришедшего, поэтому советуем начать собирать прямо сейчас': '• In the future — a percentage from everyone who came, so we advise you to start collecting right now',
    '• Ваши SI-продавцы — в верхних строках Маркетплейса, а знак повышает доверие клиентов': '• Your SI-sellers are in the top rows of the Marketplace, and the badge builds clients\u2019 trust',
    '• +10 сообщений Бадди в день за каждого пришедшего': '• +10 Buddy messages a day for everyone who came',
    'Текст с приглашением и ссылкой уже готов — отправьте в любое приложение: WhatsApp, Instagram, Telegram и другие. Друг попадёт сразу к своему Бадди.': 'The invitation text and link are ready — send them to any app: WhatsApp, Instagram, Telegram and others. Your friend lands right at their own Buddy.',
    'Откроется Telegram: выберите, кому отправить, — текст с приглашением и ссылкой уже готов. Друг попадёт сразу к своему Бадди.': 'Telegram will open: choose whom to send it to — the invitation text and link are ready. Your friend lands right at their own Buddy.',
    'Ваша личная ссылка. Кто впервые придёт в SmartFlow по ней или по ссылкам ваших SI-продавцов — засчитается вам. Самые активные получают знак «SMARTFLOW PARTNER» в профиле.': 'Your personal link. Everyone who comes to SmartFlow for the first time by it or by your SI-sellers’ links counts for you. The most active get the «SMARTFLOW PARTNER» badge on their profile.', '· скрыт командой': '· hidden by the team',

    // Buddy
    'Напишите Бадди: план, дело, напоминание…': 'Write to Buddy: a plan, a task, a reminder…',
    'Найдите SI-продавца под свою задачу в Маркетплейсе — он ответит за пару секунд.': 'Find an SI-seller for your task in the Marketplace — it replies in seconds.',
    'Открыть Маркетплейс': 'Open Marketplace', 'Открыть Офис': 'Open Office', 'Открыть Чаты': 'Open Chats', 'Открыть Профиль': 'Open Profile',
    'У меня свой продукт': 'I have my own product', 'Да, есть продукт': 'Yes, I have a product',
    'Хотите такого же SI-продавца, чтобы он общался с вашими клиентами? У вас есть свой продукт или услуга?': 'Would you like the same kind of SI-seller to talk to your clients? Do you have your own product or service?',
    'Заполните карточку SI-продавца: оффер, цену и свою ссылку на оплату. Потом отправьте его ссылку клиентам.': 'Fill in your SI-seller’s card: offer, price and your payment link. Then send its link to your clients.',
    'Заполните профиль, чтобы посетители вам доверяли. Покажу, что поднимет доверие быстрее всего.': 'Fill in your profile so visitors trust you. I will show what raises trust fastest.',
    'К профилю': 'To profile',
    'Всё готово: SI-продавец работает, профиль заполнен. Скоро здесь появится Инкубатор — группы с целью и серией дней.': 'All set: your SI-seller works and your profile is filled in. The Incubator — groups with a goal and a series of days — is coming soon.',
    'На сегодня сообщения Бадди закончились — продолжим завтра': 'Buddy’s messages for today are used up — let’s continue tomorrow',
    'Месяц': 'Month', 'Сегодня': 'Today', 'Завтра': 'Tomorrow', 'Открыть месяц': 'Open the month', 'Все планы дня': 'All plans of the day',
    'Прошлый месяц': 'Previous month', 'Следующий месяц': 'Next month',
    'На сегодня планов больше нет': 'No more plans for today',
    'Планов нет. Напишите Бадди, например: «завтра в 13:00 созвон»': 'No plans. Tell Buddy, e.g.: «tomorrow at 1 pm a call»',
    'В этот день планов нет. Напишите Бадди, что запланировать.': 'No plans on this day. Tell Buddy what to plan.',
    'Добавить, перенести или отменить можно словами у Бадди — текстом или голосом.': 'Add, move or cancel plans by telling Buddy — in text or by voice.',
    'Нажмите на день, чтобы увидеть планы. Точка — в этот день что-то есть.': 'Tap a day to see its plans. A dot means something is planned.',
    'Убрать из календаря?': 'Remove from the calendar?', 'Удалить из календаря': 'Remove from the calendar',
    'Не получилось убрать. Попробуйте ещё раз': 'Could not remove. Please try again',
    'Январь': 'January', 'Февраль': 'February', 'Март': 'March', 'Апрель': 'April', 'Май': 'May', 'Июнь': 'June',
    'Июль': 'July', 'Август': 'August', 'Сентябрь': 'September', 'Октябрь': 'October', 'Ноябрь': 'November', 'Декабрь': 'December',
    'Пн': 'Mo', 'Вт': 'Tu', 'Ср': 'We', 'Чт': 'Th', 'Пт': 'Fr', 'Сб': 'Sa', 'Вс': 'Su',

    // Profile
    'Редактировать': 'Edit', 'Редактировать профиль': 'Edit profile', 'Изменить фото': 'Change photo', 'Поделиться профилем': 'Share profile',
    'Что поднимет доверие': 'What raises trust', 'Заполнить профиль': 'Fill in the profile',
    'Добавьте своё фото': 'Add your photo', 'Добавьте регалии и сертификаты': 'Add credentials and certificates',
    'Добавьте результаты и кейсы': 'Add results and cases', 'Добавьте ссылки на соцсети': 'Add social media links',
    'Добавьте кнопку с вашим оффером': 'Add a button with your offer', 'Расскажите о себе': 'Tell about yourself',
    'Напишите, чем вы занимаетесь, одной строкой': 'Write what you do in one line',
    'Своё фото поднимает доверие сильнее всего. Его увидят клиенты в профиле и в Маркетплейсе.': 'Your own photo raises trust the most. Clients will see it in your profile and in the Marketplace.',
    'Имя': 'Name', 'Как вас называть': 'What to call you', 'Чем вы занимаетесь (одна строка)': 'What you do (one line)',
    'Например: нутрициолог, 8 лет практики': 'For example: nutritionist, 8 years of practice',
    'Коротко: кто вы, опыт, для кого работаете': 'Briefly: who you are, experience, whom you work for',
    'Образование, сертификаты, награды': 'Education, certificates, awards', 'Цифры и истории клиентов': 'Numbers and client stories',
    'Ссылки на соцсети': 'Social media links', 'Кнопка с оффером': 'Offer button', 'Мой оффер': 'My offer',
    'Например: Записаться на разбор': 'For example: Book a session', 'Ведёт на ссылку ниже': 'Leads to the link below',
    'https://... (ссылка на оплату или запись)': 'https://... (payment or booking link)',
    'Только ссылки, начинающиеся с https://': 'Only links that start with https://',
    'Ссылка кнопки оффера должна начинаться с https://': 'The offer button link must start with https://',
    'Профиль сохранён': 'Profile saved', 'Профиль сохранён на этом устройстве': 'Profile saved on this device',
    'Фото сохранено': 'Photo saved', 'Фото сохранено на этом устройстве': 'Photo saved on this device',
    'Не удалось загрузить фото': 'Could not upload the photo', 'Не удалось обработать фото.': 'Could not process the photo.',
    'Не удалось открыть фото. Попробуйте другое.': 'Could not open the photo. Try another one.',
    'Оставить как было': 'Keep as it was', 'Мои SI-продавцы': 'My SI-sellers', 'Панель поддержки': 'Support panel',
    'Уведомления в Telegram': 'Telegram notifications', 'Включены ✓': 'On ✓',
    'Без разрешения бот не сможет писать вам. Можно включить позже': 'Without permission the bot cannot write to you. You can turn it on later',
    'Готово! Уведомления будут приходить в Telegram': 'Done! Notifications will come to Telegram',
    'Показывать меня в поиске': 'Show me in search', 'Люди в SmartFlow найдут вас по имени и смогут написать.': 'People in SmartFlow can find you by name and message you.',
    'Вас снова можно найти в поиске': 'You can be found in search again', 'Вы скрыты из поиска': 'You are hidden from search',
    'Ваш номер для поддержки:': 'Your support number:', 'Номер скопирован': 'Number copied',
    'Язык интерфейса': 'Language', 'SI-брендолог': 'SI brand designer',
    'SI-брендолог проведёт короткое интервью и соберёт профиль сам — на следующем шаге': 'The SI brand designer will run a short interview and build the profile itself — in a next version'
  };

  // Phrases with numbers or names inside: [RegExp of the Russian, English with $1…]
  const PATTERNS = [
    [/^SI-продавцов: (\d+)(?: · ждут ответа: (\d+))?$/, (m) => `SI-sellers: ${m[1]}${m[2] ? ` · waiting for a reply: ${m[2]}` : ''}`],
    [/^(\d+) диалог\.$/, (m) => `${m[1]} conv.`],
    [/^Пробный период (\d+) дн\.$/, (m) => `Trial period ${m[1]} days`],
    [/^Доверие (\d+)%$/, (m) => `Trust ${m[1]}%`],
    [/^(\d+) из 5$/, (m) => `${m[1]} of 5`],
    [/^Привет, (.+)! Я Бадди — ваш помощник на каждый день\. Напишите, что запланировать или о чём напомнить, — я запомню\. Все уведомления тоже приходят сюда\.$/,
      (m) => `Hi, ${m[1] === 'друг' ? 'friend' : m[1]}! I’m Buddy — your helper for every day. Tell me what to plan or what to remind you about, and I’ll remember. All notifications come here too.`],
    [/^Сегодня Бадди ответит ещё на (\d+) сообщ\.$/, (m) => `Buddy will answer ${m[1]} more messages today`],
    [/^напомню в (.+)$/, (m) => `reminder at ${m[1]}`],
    [/^Ваш отзыв:$/, () => 'Your review:'],
    [/^Отзыв(?: о «(.+)»)?$/, (m) => (m[1] ? `Review of «${m[1]}»` : 'Review')],
    [/^📣 Рассылка · (.+)$/, (m) => `📣 Announcement · ${m[1]}`],
    [/^👤 (.+) лично$/, (m) => `👤 ${m[1]} personally`],
    [/^👤 Помощник (.+)$/, (m) => `👤 ${m[1]}’s assistant`],
    [/^(\d+) мин · время на вашем телефоне(.*)$/, (m) => `${m[1]} min · time on your phone${m[2].replace(' · сейчас: ', ' · now: ')}`],
    [/^(Перенести встречу на|Записаться на) (.+)\?$/, (m) => `${m[1] === 'Записаться на' ? 'Book' : 'Move the meeting to'} ${m[2]}?`],
    [/^Отменить встречу (.+)\?$/, (m) => `Cancel the meeting ${m[1]}?`],
    [/^Ваш номер в поддержке: (\S+)\. (.*)$/, (m) => `Your support number: ${m[1]}. The phone model, Telegram version and recent error codes are attached automatically — without your conversations.`],
    [/^Что-то пошло не так\. Код ошибки (\w+) — назовите его в поддержке$/, (m) => `Something went wrong. Error code ${m[1]} — tell it to support`],
    [/^(.+) \(код (\w+)\)$/, (m) => `${translate(m[1])} (code ${m[2]})`],
    [/^Заблокировать (.+)\? Он\(а\) больше не сможет вам писать и не найдёт вас в поиске\.$/, (m) => `Block ${m[1]}? They will no longer be able to message you or find you in search.`],
    [/^Вы заблокировали (.+)\.$/, (m) => `You blocked ${m[1]}.`],
    [/^Что случилось\? Жалоба на (.+) уйдёт команде SmartFlow вместе с последними сообщениями этой переписки, а человек будет заблокирован\.$/,
      (m) => `What happened? The complaint about ${m[1]} goes to the SmartFlow team with the last messages of this conversation, and the person will be blocked.`],
    [/^Напишите (.+) первым — например, поздоровайтесь и расскажите, чем вы занимаетесь 🙂$/, (m) => `Write to ${m[1]} first — say hello and tell what you do 🙂`],
    [/^(.+) увидит сообщение и решит, принять ли переписку\. До ответа можно отправить до (\d+) сообщений\.$/,
      (m) => `${m[1]} will see the message and decide whether to accept the conversation. Before they reply you can send up to ${m[2]} messages.`],
    [/^(.+) хочет с вами пообщаться\.$/, (m) => `${m[1]} wants to talk with you.`],
    [/^Ведёт в чат с моим SI: (.+)$/, (m) => `Leads to the chat with my SI: ${m[1]}`],
    [/^Ссылка «(.+)» должна начинаться с https:\/\/$/, (m) => `The link «${m[1]}» must start with https://`],
    [/^• (.+)$/, (m) => `• ${translate(m[1])}`],
    [/^• С (\d+) человек — знак «SMARTFLOW PARTNER» с медалью и вашим фото: его видят все в вашем профиле$/, (m) => `• From ${m[1]} people — the «SMARTFLOW PARTNER» badge with a medal and your photo, visible to everyone on your profile`],
    [/^• (\d+) человек перешли по ссылке — вы получаете знак «SMARTFLOW PARTNER»$/, (m) => `• ${m[1]} people came by your link — you get the «SMARTFLOW PARTNER» badge`],
    [/^Сообщений Бадди в день: (\d+)$/, (m) => `Buddy messages a day: ${m[1]}`],
    [/^Пришло по вашим ссылкам: (\d+)$/, (m) => `People who came by your links: ${m[1]}`],
    [/^· знак партнёра — с (\d+)$/, (m) => `· partner badge from ${m[1]}`],
    [/^(Январь|Февраль|Март|Апрель|Май|Июнь|Июль|Август|Сентябрь|Октябрь|Ноябрь|Декабрь) (\d{4})$/, (m) => `${EN[m[1]]} ${m[2]}`]
  ];

  function translate(text) {
    if (lang !== 'en' || !text) return text;
    const key = String(text).trim();
    if (!key || !/[А-Яа-яЁё]/.test(key)) return text;
    let out = EN[key];
    if (out === undefined) {
      for (const [re, fn] of PATTERNS) {
        const m = re.exec(key);
        if (m) { out = fn(m); break; }
      }
    }
    if (out === undefined) return text;
    // Keep the spaces around the phrase as they were
    const lead = String(text).match(/^\s*/)[0];
    const tail = String(text).match(/\s*$/)[0];
    return lead + out + tail;
  }

  // Not translated: what people wrote and screens that stay Russian
  const SKIP = '.chat-bubble-human, .chat-bubble-si, .chat-bubble-expert, [data-no-tr], textarea, script, style';
  const ATTRS = ['placeholder', 'aria-label', 'title'];

  function translateDom(root) {
    if (lang !== 'en' || !root) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => (node.parentElement && node.parentElement.closest(SKIP) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT)
    });
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const node of nodes) {
      const next = translate(node.nodeValue);
      if (next !== node.nodeValue) node.nodeValue = next;
    }
    root.querySelectorAll('[placeholder], [aria-label], [title]').forEach(el => {
      if (el.closest('[data-no-tr]')) return;
      for (const attr of ATTRS) {
        const v = el.getAttribute(attr);
        if (v) {
          const next = translate(v);
          if (next !== v) el.setAttribute(attr, next);
        }
      }
    });
  }

  // Dialogs of the client screens go through the same dictionary
  const nativeConfirm = window.confirm.bind(window);
  const nativePrompt = window.prompt.bind(window);
  const nativeAlert = window.alert.bind(window);
  window.confirm = (message) => nativeConfirm(translate(message));
  window.prompt = (message, value) => nativePrompt(translate(message), value);
  window.alert = (message) => nativeAlert(translate(message));

  function setLang(next, { remember = true } = {}) {
    lang = next === 'en' ? 'en' : 'ru';
    document.documentElement.lang = lang;
    if (remember) {
      try { localStorage.setItem(STORE_KEY, lang); } catch (e) {}
    }
  }
  document.documentElement.lang = lang;

  SF.lang = () => lang;
  SF.locale = () => (lang === 'en' ? 'en-GB' : 'ru-RU');
  SF.t = translate;
  SF.translateDom = translateDom;
  SF.setLang = setLang;
  SF.langFromTelegram = fromTelegram;
})(window);
