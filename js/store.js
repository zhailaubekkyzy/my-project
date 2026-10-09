// store.js - Central State Management for SmartFlow Telegram Mini App

const STORAGE_KEY = 'smartflow_tma_v4'; // v4: new structure (Marketplace, Buddy, Chats, Profile)

const defaultData = {
  appName: 'SmartFlow',
  appSlogan: 'From idea to selling. Faster.',

  // Telegram Authentication & Core Backend Identity
  auth: {
    status: 'checking', // 'checking' | 'authenticated' | 'expired' | 'offline_demo'
    internalUserId: null,
    telegramUser: null,
    token: null,
    error: null
  },

  // Navigation: the open tab and a stack of screens inside every tab (last = visible).
  ui: {
    tab: 'buddy',
    routes: {
      marketplace: [{ screen: 'list' }],
      buddy: [{ screen: 'home' }],
      chats: [{ screen: 'list' }],
      profile: [{ screen: 'view' }]
    },
    marketplaceFilter: 'all'
  },

  // The person using the app. Filled from the server after login (setAuth); demo values offline.
  me: {
    displayName: 'Гость SmartFlow',
    username: null,
    photoUrl: null,
    hasUploadedPhoto: false,
    profile: {
      displayName: '',
      headline: '',
      bio: '',
      regalia: '',
      results: '',
      links: [],
      offerButton: null,
      language: 'ru'
    },
    // Business profile: the Office opens in the Marketplace after the person accepts the terms
    business: { active: false, agreedAt: null }
  },

  // Marketplace of SI-consultants (demo until the catalog comes from the server)
  marketplace: {
    consultants: [
      {
        id: 'mc-elena',
        name: 'Елена Смирнова',
        roleTitle: 'SI-консультант',
        photoUrl: 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?auto=format&fit=crop&w=150&q=80',
        category: 'sales',
        offer: 'Выйти из операционки за 8 недель без падения выручки',
        description: 'Менторство для фаундеров и топ-менеджеров. SI-консультант разберёт вашу ситуацию, ответит на вопросы о программе и запишет на стратегический разбор.',
        stats: { conversion: '14.6%', dialogs: 392, sales: 36 },
        rating: 4.9,
        reviews: [
          { author: 'Марк Л***', stars: 5, text: 'Ответил на все вопросы за 5 минут, записался на разбор в тот же вечер.' },
          { author: 'Анна Б***', stars: 5, text: 'Понравилось, что без давления и честно про рассрочку.' }
        ],
        price: 25000,
        priceLabel: 'Стратегический разбор — 25 000 ₽',
        trialDays: 0,
        benefits: ['Разбор архитектуры бизнеса 1-на-1', 'План делегирования на 8 недель', '25 000 ₽ зачитываются в программу'],
        process: ['Оплата напрямую эксперту', 'Выбор времени созвона', 'Созвон 90 минут в Zoom'],
        paymentUrl: 'https://pay.prodamus.ru/elena_smirnova',
        author: { name: 'Елена Смирнова', trust: 86 },
        chatId: 'si-elena'
      },
      {
        id: 'mc-elena-mini',
        name: 'Мини-курс «Делегирование»',
        roleTitle: 'SI-помощник',
        photoUrl: 'https://images.unsplash.com/photo-1580489944761-15a19d654956?auto=format&fit=crop&w=150&q=80',
        category: 'sales',
        offer: 'Освободить 10 часов в неделю за 14 дней',
        description: 'Короткий курс для тех, кому пока рано в менторство. SI-помощник подберёт уроки под вашу команду.',
        stats: { conversion: '22.1%', dialogs: 518, sales: 114 },
        rating: 4.8,
        reviews: [{ author: 'Ирина К***', stars: 5, text: 'Сделала первые 3 шага за выходные.' }],
        price: 4900,
        priceLabel: 'Мини-курс — 4 900 ₽',
        trialDays: 3,
        benefits: ['7 уроков по 15 минут', 'Шаблоны регламентов', 'Проверка домашних заданий SI-помощником'],
        process: ['Оплата напрямую автору', 'Доступ к урокам сразу', 'SI-помощник ведёт по шагам'],
        paymentUrl: 'https://pay.prodamus.ru/delegation_mini',
        author: { name: 'Олег Ветров', trust: 74 },
        closesObjection: 'дорого'
      },
      {
        id: 'mc-nutri',
        name: 'Айгерим Нурланова',
        roleTitle: 'SI-помощник',
        photoUrl: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&w=150&q=80',
        category: 'warmup',
        offer: 'Бесплатная диагностика питания за 10 минут',
        description: 'Задаст несколько вопросов о привычках и пришлёт персональный разбор. Цель — записать на консультацию нутрициолога.',
        stats: { conversion: '31.0%', dialogs: 240, sales: 74 },
        rating: 4.7,
        reviews: [{ author: 'Дана С***', stars: 4, text: 'Полезный разбор, дальше пошла на консультацию.' }],
        price: 0,
        priceLabel: 'Бесплатно',
        trialDays: 0,
        benefits: ['Персональный разбор рациона', 'Список продуктов на неделю'],
        process: ['Ответить на 7 вопросов', 'Получить разбор в чат'],
        paymentUrl: null,
        author: { name: 'Айгерим Нурланова', trust: 69 }
      },
      {
        id: 'mc-gromov-sales',
        name: 'Продавец для экспертов',
        roleTitle: 'SI-менеджер',
        photoUrl: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=150&q=80',
        category: 'sales',
        offer: 'Готовый SI-консультант: квалифицирует и доводит до оплаты',
        description: 'Внутри методология маркетолога и продавца. Вы даёте доступ к своему SI-мозгу — он продаёт ваши услуги. Ваши клиенты остаются вашими.',
        stats: { conversion: '19.4%', dialogs: 3120, sales: 605 },
        rating: 4.9,
        reviews: [{ author: 'Елена С***', stars: 5, text: 'Подключила за вечер, первые заявки на следующий день.' }],
        price: 9900,
        priceLabel: '9 900 ₽ в месяц',
        trialDays: 7,
        benefits: ['Методология квалификации и закрытия возражений', 'Обновления от автора', 'Аналитика воронки'],
        process: ['Оплата напрямую автору', 'Распаковка: ответы на вопросы о продукте', 'Ссылка на вашего SI-консультанта'],
        paymentUrl: 'https://tribute.tg/gromov_sales',
        author: { name: 'Александр Громов', trust: 91 },
        isTemplate: true
      }
    ]
  },

  // Office = business profile: my SI-consultants, my SI-brain, "Мне написали"
  office: {
    section: 'consultants',
    consultants: [
      {
        id: 'oc-elena',
        serverProjectId: null,
        name: 'Елена · менторство',
        roleTitle: 'SI-консультант',
        photoUrl: null,
        source: 'created',
        author: null,
        category: 'sales',
        link: 'https://t.me/smartflow_ai_support_bot/app?startapp=elena-mentor',
        goal: 'Записать на стратегический разбор за 25 000 ₽',
        instructions: 'Не больше 3 вопросов до пользы. Не обещать результат в цифрах. Если спрашивают про договор с юрлицом — передать Елене.',
        clientLimit: 40,
        scenarios: [
          { when: 'Клиент говорит «дорого»', then: 'Рассказать про рассрочку 15 000 ₽/мес и зачёт разбора' },
          { when: 'Оборот меньше 1,5 млн ₽/мес', then: 'Предложить мини-курс вместо менторства' },
          { when: 'Просит созвон с Еленой', then: 'Передать в «Мне написали»' }
        ],
        brainAccess: ['m1', 'm2', 'm3']
      }
    ],
    brain: {
      materials: [
        { id: 'm1', title: 'Гайд «5 скрытых утечек времени фаундера»', type: 'PDF', topic: 'Лид-магнит', size: '1,2 МБ' },
        { id: 'm2', title: 'Программа менторства на 8 недель', type: 'PDF', topic: 'Продукт', size: '0,8 МБ' },
        { id: 'm3', title: 'Ответы на частые возражения', type: 'Текст', topic: 'Продажи', size: '12 КБ' },
        { id: 'm4', title: 'Интервью с резидентом: рост с 2 до 7 млн ₽', type: 'Видео', topic: 'Кейсы', size: '240 МБ' }
      ]
    }
  },

  // Chats tab: SI chats (soft red) and chats with people (Tiffany)
  chats: {
    list: [
      { id: 'si-elena', kind: 'si', consultantId: 'mc-elena', title: 'Елена Смирнова', roleTitle: 'SI-консультант', photoUrl: 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?auto=format&fit=crop&w=150&q=80', unread: 1 },
      { id: 'si-assistant', kind: 'si', title: 'SmartFlow', roleTitle: 'SI-ассистент', photoUrl: 'images/mascots/si-assistant.webp', subtitle: 'Жалобы и предложения по платформе', unread: 0 },
      { id: 'h-elena', kind: 'human', title: 'Елена Смирнова', roleTitle: 'Эксперт', photoUrl: 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?auto=format&fit=crop&w=150&q=80', unread: 0 }
    ],
    // Messages of chats other than the main SI chat (that one lives in clientSession)
    threads: {
      'si-assistant': [
        { id: 't-a1', sender: 'ai', text: 'Привет! Я SI-ассистент SmartFlow. Сюда можно написать жалобу на SI или человека, предложение или вопрос по платформе — я передам команде.', time: 'Сегодня' }
      ],
      'h-elena': [
        { id: 't-h1', sender: 'them', text: 'Здравствуйте! Видела, что вы спрашивали про программу. Если удобно, созвонимся в четверг?', time: '12:40' }
      ]
    },
    // Platform offer shown above an SI chat: one at a time, can be hidden ("Не интересно")
    banner: { 'si-elena': null }
  },

  // Expert Workplace State
  expert: {
    id: 'exp-elena',
    name: 'Елена Смирнова',
    title: 'Executive & Life Coach',
    avatar: 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?auto=format&fit=crop&w=150&q=80',
    niche: 'Психология & Коучинг для фаундеров и топ-менеджеров',
    funnelId: 'funnel-ht',
    botUsername: 'SmartFlowBot',
    sellerLink: 'https://t.me/SmartFlowBot?start=elena_coach_ht',
    billingProvider: 'Tribute (@tribute)',
    expertPaymentLink: 'https://pay.prodamus.ru/elena_smirnova',
    subscriptionStatus: 'active',
    subscriptionNextBilling: '24 октября 2026',
    subscriptionPrice: 9900,
    cardLast4: '4242',
    allTags: ['#не_купил_миникурс', '#горячий_лид', '#ждёт_созвон', '#b2b_сегмент', '#сомнения_цена', '#купил_флагман'],

    // AI Natural Language Broadcasts & Segmentation
    aiBroadcast: {
      prompt: '',
      targetTag: '#не_купил_миникурс',
      matchingLeadsCount: 42,
      clarificationStep: false,
      clarificationQuestion: '',
      readyPost: null,
      history: [
        {
          id: 'bc-1',
          date: 'Вчера в 17:30',
          title: 'Живой мастер-класс в кофейне «Раф»',
          targetTag: '#не_купил_миникурс',
          sentCount: 42,
          openRate: '92%',
          replies: 16,
          status: 'Отправлено'
        }
      ]
    },

    // NEW SECTION REQUIRED: «Кто написал лично» (Нажавшие «Связаться с человеком»)
    directHumanInquiries: [
      {
        id: 'inq-1',
        leadName: 'Ксения Макарова',
        leadAvatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=120&q=80',
        leadUsername: '@ksenia_makarova',
        timeAgo: '4 мин назад',
        urgency: 'Срочно 🔥',
        dealValue: '350,000 ₽',
        sourceStep: 'Шаг 4: Оффер & Корпоративный тренинг',
        summary: 'Нажала «Связаться с человеком». Запрос на 2-дневный офлайн интенсив для 40 топ-менеджеров.',
        audioUrl: null,
        hasAudio: false,
        lastDirectMessage: 'Здравствуйте, Елена! Нам нужно согласовать программу корпоративного тренинга и договор с юрлицом.',
        status: 'waiting',
        botState: 'paused', // 'paused' | 'standby'
        tags: ['#b2b_сегмент', '#горячий_лид']
      },
      {
        id: 'inq-2',
        leadName: 'Марк Левин',
        leadAvatar: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=120&q=80',
        leadUsername: '@mark_levin_it',
        timeAgo: '14 мин назад',
        urgency: 'Горячий лид',
        dealValue: '180,000 ₽',
        sourceStep: 'Шаг 5: Запись на созвон',
        summary: 'Отправил аудиосообщение с вопросом о личном участии Елены и нажал «Написать человеку».',
        audioUrl: 'sample-voice.mp3',
        hasAudio: true,
        audioDuration: '0:18',
        audioTranscription: '«Здравствуйте! Я основатель IT-аутсорсинга, оборот 3.2 миллиона. Скажите, Елена лично ведет спринт делегирования или через кураторов? Хочу подтвердить слот на четверг.»',
        lastDirectMessage: 'Аудиосообщение (расшифровано SI)',
        status: 'waiting',
        botState: 'paused',
        tags: ['#не_купил_миникурс', '#ждёт_созвон']
      },
      {
        id: 'inq-3',
        leadName: 'Виктор Захаров',
        leadAvatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=120&q=80',
        leadUsername: '@victor_zakharov',
        timeAgo: '1 час назад',
        urgency: 'Стандарт',
        dealValue: '180,000 ₽',
        sourceStep: 'Шаг 4: Возражение по рассрочке',
        summary: 'Нажал «Связаться с человеком». Интересуется индивидуальным графиком платежей на 6 месяцев.',
        audioUrl: null,
        hasAudio: false,
        lastDirectMessage: 'Хочу уточнить, можно ли разбить оплату на 3 транша напрямую через счет ИП без участия банка?',
        status: 'replied',
        botState: 'standby',
        tags: ['#сомнения_цена', '#не_купил_миникурс']
      }
    ],

    // PMF Interview State (Between AI-Marketer & Expert)
    pmfInterview: {
      completed: true,
      pmfScore: 96,
      lastUpdated: 'Сегодня в 10:15',
      questionsAndAnswers: [
        {
          id: 'q1',
          question: 'В чем суть вашего ключевого продукта и какую трансформацию получает клиент?',
          answer: 'Флагманская 8-недельная программа "Антивыгорание и системный рост". Помогаю собственникам бизнеса выйти из операционки без падения выручки, вернуть энергию и делегировать ключевые процессы за 60 дней.',
          category: 'Продукт & Обещание'
        },
        {
          id: 'q2',
          question: 'Кто ваш идеальный клиент (платит легче всего), а с кем вы категорически НЕ работаете?',
          answer: 'Идеальный аватар: Фаундеры и руководители компаний с оборотом от 1.5 млн ₽/мес, команда от 5 человек. Не работаю с теми, кто ищет "волшебную таблетку", в долгах без стабильного дохода или ожидает, что я сделаю работу за них.',
          category: 'Целевая аудитория'
        },
        {
          id: 'q3',
          question: 'Какие тарифы, форматы работы и цены на данный момент?',
          answer: '1) Стратегический разбор 1-на-1 — 25,000 ₽ (зачитывается в стоимость программы при покупке). 2) 8 недель индивидуального менторства — 180,000 ₽ (есть рассрочка 15,000 ₽/мес).',
          category: 'Ценообразование'
        },
        {
          id: 'q4',
          question: 'Какие 3 главных возражения вы чаще всего слышите и как их закрываете?',
          answer: '1) "У меня нет времени на коучинг" -> Ответ: Программа как раз освобождает 10-15 часов в неделю с первой же недели за счет спринта делегирования. 2) "Дорого" -> Ответ: Одно неверное решение или найм не того топа стоит вам от 500k. Окупаемость менторства в среднем x4. 3) "А вдруг не сработает в моей нише?" -> Ответ: За 6 лет 140+ кейсов в 24 разных нишах (от ритейла до IT). Если за первые 14 дней вы не видите ценности — возврат 100%.',
          category: 'Отработка возражений'
        },
        {
          id: 'q5',
          question: 'Какие материалы, кейсы и кнопки целевого действия должен показывать SI-консультант?',
          answer: 'Материалы: PDF-гайд "5 скрытых утечек времени фаундера", ссылка на видео-интервью с резидентом с ростом выручки с 2M до 7M ₽. Кнопки: "Забронировать стратегический разбор", "Смотреть кейсы", "Связаться с Еленой в Telegram".',
          category: 'Материалы & Кнопки'
        }
      ]
    },

    // Custom quick buttons for the AI Seller
    customButtons: [
      { id: 'btn-audit', label: '📅 Записаться на диагностику', action: 'book_audit', primary: true },
      { id: 'btn-cases', label: '🏆 Кейсы и результаты', action: 'show_cases', primary: false },
      { id: 'btn-guide', label: '📥 Забрать гайд по делегированию', action: 'get_guide', primary: false },
      { id: 'btn-human', label: '👤 Написать человеку (Елене)', action: 'contact_human', primary: false }
    ],

    // 1. CHATS (All client dialogues)
    chats: [
      {
        id: 'chat-lead-1',
        leadName: 'Марк Левин',
        leadAvatar: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=120&q=80',
        leadUsername: '@mark_levin_it',
        status: 'hot',
        statusLabel: 'Горячий лид 🔥',
        lastMessageTime: '12 мин назад',
        unreadCount: 0,
        dealValue: '180,000 ₽',
        summary: 'Основатель IT-аутсорсинга, выручка 3.2M ₽. Главная боль — работает по 14 часов. Хочет созвон.',
        messages: [
          { sender: 'lead', text: 'Здравствуйте! Увидел ваш разбор про делегирование в канале. Хочу узнать подробнее.', time: '14:20' },
          { sender: 'ai', text: 'Приветствую, Марк! Рад познакомиться. Я SI-ассистент Елены Смирновой в SmartFlow. Направляю вам аудит «5 скрытых утечек времени фаундера». Скажите, какой у вас сейчас проект и сколько времени в неделю съедает операционка?', time: '14:21' },
          { 
            sender: 'lead', 
            isVoice: true, 
            duration: '0:18', 
            text: '«IT-разработка, 18 человек команда. Работаю без выходных, часов по 70 в неделю, сам закрываю продажи и контролирую разработку.»',
            whisperTranscribed: true,
            time: '14:24' 
          },
          { sender: 'ai', text: 'Понимаю вашу ситуацию, Марк. Типичная ловушка роста: бизнес растет за счет вашего здоровья. Елена как раз помогла Артему (CEO веб-студии) перестроить команду, сократив его личные часы с 65 до 25 в неделю при росте оборота на 40% за 2 месяца. Хотите посмотреть короткий разбор его внедрений?', time: '14:25' },
          { sender: 'lead', text: 'Да, интересно. А сколько стоит полноценная работа с Еленой?', time: '14:28' },
          { sender: 'ai', text: 'Индивидуальное сопровождение на 8 недель стоит 180,000 ₽ с гарантией результата (также доступна рассрочка от 15,000 ₽/мес). Первый шаг — стратегическая сессия за 25,000 ₽, где Елена лично разберет архитектуру вашего бизнеса. Если решите идти дальше — эти 25,000 ₽ полностью зачтутся в оплату программы. Хотите выбрать удобный слот на этой неделе?', time: '14:30' }
        ]
      },
      {
        id: 'chat-lead-2',
        leadName: 'Анна Бережная',
        leadAvatar: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&w=120&q=80',
        leadUsername: '@anna_bereg',
        status: 'objection',
        statusLabel: 'Возражение: "Дорого" ⚠️',
        lastMessageTime: '35 мин назад',
        unreadCount: 1,
        dealValue: '180,000 ₽',
        summary: 'Владелица сети шоурумов. Сомневается из-за цены, думает о рассрочке.',
        messages: [
          { sender: 'lead', text: 'Добрый день! Хочу на программу к Елене, но 180 тысяч сейчас для меня дороговато вытаскивать из оборота.', time: '13:45' },
          { sender: 'ai', text: 'Анна, прекрасно понимаю! Выдергивать крупную сумму из кассового оборота бизнеса сейчас нерационально. Именно поэтому у нас подключена банковская рассрочка на 12 месяцев без переплат — это всего 15,000 ₽ в месяц. Обычно эта сумма окупается уже за первые две недели после настройки регламентов в шоурумах. Показать расчет окупаемости?', time: '13:46' },
          { sender: 'lead', text: 'А точно ли не будет скрытых процентов в банке?', time: '13:51' }
        ]
      },
      {
        id: 'chat-lead-3',
        leadName: 'Владислав Романов',
        leadAvatar: 'https://images.unsplash.com/photo-1522075469751-3a6694fb2f61?auto=format&fit=crop&w=120&q=80',
        leadUsername: '@vlad_romanov_agency',
        status: 'closed',
        statusLabel: 'Оплачен созвон ✅',
        lastMessageTime: '2 часа назад',
        unreadCount: 0,
        dealValue: '25,000 ₽',
        summary: 'Оплатил стратегическую сессию на 2 октября 16:00. Встреча добавлена в календарь.',
        messages: [
          { sender: 'lead', text: 'Оплатил 25,000 ₽ по ссылке, чек пришел.', time: '12:10' },
          { sender: 'ai', text: 'Отлично, Владислав! Оплата успешно зафиксирована 🎉 Забронировал за вами слот: Четверг, 2 октября в 16:00 (МСК). Ссылка на Zoom и анкета подготовки отправлены вам сюда. Елена уже изучает ваш проект!', time: '12:11' }
        ]
      }
    ],

    // 2. ANALYTICS & CONVERSION
    analytics: {
      period: 'Последние 30 дней',
      trafficVisitors: 438,
      dialogsStarted: 392,
      qualifiedLeads: 246,
      reachedOffer: 154,
      callsBooked: 58,
      dealsClosed: 36,
      overallConversion: '14.6%',
      revenue: '4,280,000 ₽',
      avgCheck: '145,000 ₽',
      aiSellerSavedHours: 114,
      steps: [
        { title: 'Посетители воронки', count: 438, percent: '100%' },
        { title: 'Старт диалога с SI', count: 392, percent: '89.5%' },
        { title: 'Прошли квалификацию', count: 246, percent: '62.7%' },
        { title: 'Ознакомились с оффером', count: 154, percent: '39.2%' },
        { title: 'Запись на созвон / Оплата', count: 58, percent: '14.6%' }
      ]
    },

    // 3. AI-MARKETER RECOMMENDATIONS
    aiMarketerRecommendations: [
      {
        id: 'rec-exp-1',
        impact: '+35,000 ₽ к чеку',
        tag: 'Оффер & PMF',
        title: 'Увеличить стоимость стартового созвона с 25,000 ₽ до 35,000 ₽',
        reason: 'Ваш SI-консультант квалифицирует лидов с выручкой > 2.5 млн ₽. Для этой аудитории чек 25k кажется "подозрительно доступным". Тест на 20 лидах показал, что готовность платить 35k абсолютно такая же.',
        applied: false,
        actionType: 'update_price'
      },
      {
        id: 'rec-exp-2',
        impact: '+22% к конверсии',
        tag: 'Возражения',
        title: 'Внедрить авто-демонстрацию кейса в нише B2B IT',
        reason: 'За сентябрь 18 лидов из IT-сферы задали вопрос: "А есть ли примеры в заказной разработке?". Добавьте 2 слайда кейса Артема прямо в ответ SI-консультанта.',
        applied: true,
        actionType: 'add_case'
      },
      {
        id: 'rec-exp-3',
        impact: '+18% к доходимости',
        tag: 'Скорость ответа',
        title: 'Подключаться лично в раздел "Кто написал лично" быстрее 10 минут',
        reason: 'Когда вы отвечаете лично в течение 10 минут, конверсия в сделку составляет 68%. Если ответ задержан на 1+ час — падает до 19%.',
        applied: false,
        actionType: 'push_alerts'
      }
    ]
  },

  // Live Client Chat Session (End-user interacting with Elena's AI Seller)
  clientSession: {
    expertName: 'Елена Смирнова',
    expertAvatar: 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?auto=format&fit=crop&w=150&q=80',
    botName: 'SmartFlow SI-консультант',
    status: 'online',
    currentFunnelStep: 1,
    messages: [
      {
        id: 'cm-1',
        sender: 'ai',
        text: 'Приветствую! 👋 Я SI-консультант Елены Смирновой — Executive-коуча и ментора фаундеров.\n\nЗа 6 лет Елена помогла 140+ собственникам высвободить 15+ часов в неделю и вырасти в чистой прибыли x2-x5.\n\nЗафиксировал для вас **Гайд «5 скрытых утечек времени фаундера»** 📥\n\nМожете написать мне текстом или **отправить голосовое сообщение** 🎙️ — я отлично распознаю аудио! В какой нише ваш проект и какой сейчас оборот?',
        time: 'Только что',
        quickReplies: [
          'Услуги / IT (оборот 2-5M ₽)',
          'Торговля / E-commerce',
          'Производство / B2B',
          'Консалтинг & Услуги'
        ]
      }
    ],
    humanContactModalOpen: false
  }
};

class Store {
  constructor() {
    this.data = this.loadData();
    this.listeners = [];
  }

  loadData() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        // Sections added later get their defaults; every open starts on the Buddy screen.
        const data = { ...JSON.parse(JSON.stringify(defaultData)), ...JSON.parse(saved) };
        data.ui = JSON.parse(JSON.stringify(defaultData.ui));
        return data;
      }
    } catch (e) {
      console.warn('Failed to load from localStorage', e);
    }
    return JSON.parse(JSON.stringify(defaultData));
  }

  persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.data));
    } catch (e) {
      console.warn('Failed to save to localStorage', e);
    }
  }

  saveData() {
    this.persist();
    this.notify();
  }

  resetToDefault() {
    this.data = JSON.parse(JSON.stringify(defaultData));
    this.saveData();
  }

  subscribe(callback) {
    this.listeners.push(callback);
    return () => {
      this.listeners = this.listeners.filter(cb => cb !== callback);
    };
  }

  notify() {
    this.listeners.forEach(cb => {
      try {
        cb(this.data);
      } catch (err) {
        console.error('Store listener error:', err);
      }
    });
  }

  // Fields of auth/profile state that affect what is rendered (the token does not).
  visibleAuthSnapshot() {
    const auth = this.data.auth || {};
    const me = this.data.me || {};
    return JSON.stringify([auth.status, auth.internalUserId, auth.error, me.displayName, me.photoUrl, me.profile, this.data.office.consultants]);
  }

  setAuth(authData) {
    const before = this.visibleAuthSnapshot();
    if (!this.data.auth) this.data.auth = {};
    this.data.auth.status = 'authenticated';
    this.data.auth.internalUserId = authData.user?.id || authData.internalUserId;
    this.data.auth.telegramUser = authData.user || authData.telegramUser;
    this.data.auth.token = authData.token;
    this.data.auth.error = null;
    if (authData.user) this.applyServerUser(authData.user);
    if (authData.projects?.owned) this.setServerConsultants(authData.projects.owned);
    // Repeat opens: the screen was already rendered from the cached state. If the login
    // result changes nothing visible, persist the new token without a full re-render.
    if (this.visibleAuthSnapshot() === before) {
      this.persist();
    } else {
      this.saveData();
    }
  }

  setSessionExpired(err) {
    if (!this.data.auth) this.data.auth = {};
    this.data.auth.status = 'expired';
    this.data.auth.error = err?.message || 'Сессия Telegram Mini App истекла';
    this.saveData();
  }

  setAuthOffline(msg = 'Демо-режим') {
    if (!this.data.auth) this.data.auth = {};
    this.data.auth.status = 'offline_demo';
    this.data.auth.error = msg;
    this.saveData();
  }

  // ---------------------------------------------------------------
  // Navigation (not saved: every open starts on the Buddy screen)
  // ---------------------------------------------------------------
  currentRoute(tab = this.data.ui.tab) {
    const stack = this.data.ui.routes[tab] || [];
    return stack[stack.length - 1] || {};
  }

  setTab(tab) {
    if (this.data.ui.tab === tab) {
      // Tapping the open tab again returns to its first screen
      this.data.ui.routes[tab] = this.data.ui.routes[tab].slice(0, 1);
    }
    this.data.ui.tab = tab;
    this.notify();
  }

  pushRoute(route, tab = this.data.ui.tab) {
    this.data.ui.tab = tab;
    this.data.ui.routes[tab].push(route);
    this.notify();
  }

  // Replace the visible screen's parameters (e.g. the selected sub-tab)
  patchRoute(patch) {
    Object.assign(this.currentRoute(), patch);
    this.notify();
  }

  popRoute() {
    const stack = this.data.ui.routes[this.data.ui.tab];
    if (stack.length > 1) {
      stack.pop();
      this.notify();
      return true;
    }
    return false;
  }

  // ---------------------------------------------------------------
  // Me & profile
  // ---------------------------------------------------------------
  applyServerUser(user) {
    const me = this.data.me;
    me.displayName = user.displayName || me.displayName;
    me.username = user.username || null;
    me.photoUrl = user.photoUrl || null;
    me.hasUploadedPhoto = Boolean(user.hasUploadedPhoto);
    if (user.profile) me.profile = { ...me.profile, ...user.profile };
  }

  updateProfile(profile) {
    this.data.me.profile = { ...this.data.me.profile, ...profile };
    if (profile.displayName) this.data.me.displayName = profile.displayName;
    this.saveData();
  }

  setMyPhoto(photoUrl) {
    this.data.me.photoUrl = photoUrl;
    this.data.me.hasUploadedPhoto = true;
    this.saveData();
  }

  activateBusiness() {
    this.data.me.business = { active: true, agreedAt: new Date().toISOString() };
    this.saveData();
  }

  // ---------------------------------------------------------------
  // Office: my SI-consultants and SI-brain
  // ---------------------------------------------------------------
  // Real consultants (server projects) replace the demo list; demo methodology fills the gaps.
  setServerConsultants(projects) {
    if (!projects.length) return;
    const demo = defaultData.office.consultants[0];
    const existing = Object.fromEntries(this.data.office.consultants.map(c => [c.serverProjectId || c.id, c]));
    this.data.office.consultants = projects.map(p => {
      const local = existing[p.id] || {};
      const settings = p.custom_ai_settings || {};
      return {
        ...JSON.parse(JSON.stringify(demo)),
        ...local,
        id: p.id,
        serverProjectId: p.id,
        name: p.name,
        roleTitle: p.role_title || 'SI-консультант',
        photoUrl: p.photo_url || null,
        link: `https://t.me/smartflow_ai_support_bot/app?startapp=${p.slug}`,
        goal: settings.goal || local.goal || demo.goal,
        instructions: settings.instructions || local.instructions || demo.instructions,
        clientLimit: settings.clientLimit || local.clientLimit || demo.clientLimit,
        category: settings.category || local.category || demo.category
      };
    });
  }

  findOfficeConsultant(id) {
    return this.data.office.consultants.find(c => c.id === id);
  }

  addOfficeConsultant(consultant) {
    this.data.office.consultants.unshift(consultant);
    this.saveData();
    return consultant;
  }

  updateOfficeConsultant(id, patch) {
    const c = this.findOfficeConsultant(id);
    if (!c) return null;
    Object.assign(c, patch);
    this.saveData();
    return c;
  }

  toggleBrainAccess(consultantId, materialId) {
    const c = this.findOfficeConsultant(consultantId);
    if (!c) return;
    const set = new Set(c.brainAccess || []);
    if (set.has(materialId)) set.delete(materialId); else set.add(materialId);
    c.brainAccess = [...set];
    this.saveData();
  }

  // ---------------------------------------------------------------
  // Chats
  // ---------------------------------------------------------------
  findChat(chatId) {
    return this.data.chats.list.find(c => c.id === chatId);
  }

  // Chat with an SI-consultant from the Marketplace ("Спросить"); created on first use
  openConsultantChat(consultant) {
    if (consultant.chatId) return consultant.chatId;
    const chatId = `si-${consultant.id}`;
    if (!this.findChat(chatId)) {
      this.data.chats.list.unshift({
        id: chatId, kind: 'si', consultantId: consultant.id, title: consultant.name,
        roleTitle: consultant.roleTitle, photoUrl: consultant.photoUrl, unread: 0
      });
      this.data.chats.threads[chatId] = [{
        id: `t-${Date.now()}`, sender: 'ai', time: 'Сейчас',
        text: `Здравствуйте! Я ${consultant.roleTitle} · ${consultant.name}. ${consultant.offer}. Расскажите, что для вас сейчас важнее всего?`
      }];
      this.saveData();
    }
    return chatId;
  }

  addThreadMessage(chatId, sender, text) {
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (!this.data.chats.threads[chatId]) this.data.chats.threads[chatId] = [];
    const msg = { id: `t-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, sender, text, time };
    this.data.chats.threads[chatId].push(msg);
    this.saveData();
    return msg;
  }

  markChatRead(chatId) {
    const chat = this.findChat(chatId);
    if (chat && chat.unread) {
      chat.unread = 0;
      this.persist();
    }
  }

  // banner: { type: 'cta' | 'alternative', consultantId, reason } or null; hidden stays hidden
  setChatBanner(chatId, banner) {
    const current = this.data.chats.banner[chatId];
    if (current && current.hidden && banner && current.consultantId === banner.consultantId) return;
    this.data.chats.banner[chatId] = banner;
    this.saveData();
  }

  hideChatBanner(chatId) {
    const current = this.data.chats.banner[chatId];
    if (current) {
      current.hidden = true;
      this.saveData();
    }
  }

  // Handle direct inquiry when lead clicks "Связаться с человеком"
  registerDirectInquiry(leadData) {
    const newInquiry = {
      id: 'inq-' + Date.now(),
      leadName: leadData.leadName || 'Пользователь Telegram',
      leadAvatar: leadData.leadAvatar || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=120&q=80',
      leadUsername: leadData.leadUsername || '@telegram_user',
      timeAgo: 'Только что',
      urgency: 'Срочно 🔥',
      dealValue: '180,000 ₽',
      sourceStep: 'Чат SI-консультанта',
      summary: leadData.summary || 'Нажал кнопку «Связаться с человеком» в SmartFlow.',
      audioUrl: leadData.audioUrl || null,
      hasAudio: !!leadData.hasAudio,
      audioDuration: leadData.audioDuration || null,
      audioTranscription: leadData.audioTranscription || null,
      lastDirectMessage: leadData.lastDirectMessage || 'Клиент запросил связь с экспертом лично.',
      status: 'waiting'
    };

    this.data.expert.directHumanInquiries.unshift(newInquiry);
    this.saveData();
    return newInquiry;
  }

  resolveDirectInquiry(inquiryId, replyText) {
    const inq = this.data.expert.directHumanInquiries.find(i => i.id === inquiryId);
    if (inq) {
      inq.status = 'replied';
      inq.timeAgo = 'Отвечено';
      this.saveData();
    }
  }

  // Voice message simulation
  sendClientVoiceMessage(transcription, duration = '0:16') {
    const timeNow = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const userVoiceMsg = {
      id: 'cm-' + Date.now(),
      sender: 'user',
      isVoice: true,
      duration: duration,
      text: `«${transcription}»`,
      whisperTranscribed: true,
      time: timeNow
    };
    this.data.clientSession.messages.push(userVoiceMsg);
    this.saveData();
    return userVoiceMsg;
  }

  sendClientMessage(text) {
    const timeNow = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const userMsg = {
      id: 'cm-' + Date.now(),
      sender: 'user',
      text: text,
      time: timeNow
    };
    this.data.clientSession.messages.push(userMsg);
    this.saveData();
    return userMsg;
  }

  addAiSellerReply(text, quickReplies = []) {
    const timeNow = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const aiMsg = {
      id: 'cm-' + Date.now(),
      sender: 'ai',
      text: text,
      time: timeNow,
      quickReplies: quickReplies
    };
    this.data.clientSession.messages.push(aiMsg);
    this.saveData();
    return aiMsg;
  }

  sendExpertMessageToLead(chatId, text) {
    const chat = this.data.expert.chats.find(c => c.id === chatId);
    if (chat && text.trim()) {
      const timeNow = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      chat.messages.push({
        sender: 'expert_human',
        text: text.trim(),
        time: timeNow
      });
      chat.status = 'hot';
      chat.statusLabel = 'Эксперт на связи 👤';
      chat.lastMessageTime = 'Только что';
      this.saveData();
    }
  }

  applyExpertRecommendation(recId) {
    const rec = this.data.expert.aiMarketerRecommendations.find(r => r.id === recId);
    if (rec) {
      rec.applied = true;
      this.saveData();
    }
  }

  updatePmfAnswer(questionId, newAnswer) {
    const q = this.data.expert.pmfInterview.questionsAndAnswers.find(item => item.id === questionId);
    if (q) {
      q.answer = newAnswer;
      this.data.expert.pmfInterview.lastUpdated = 'Только что';
      this.saveData();
    }
  }

  toggleInquiryBotState(inquiryId) {
    const inq = this.data.expert.directHumanInquiries.find(i => i.id === inquiryId);
    if (inq) {
      inq.botState = inq.botState === 'paused' ? 'standby' : 'paused';
      this.saveData();
      return inq.botState;
    }
    return null;
  }

  addTagToInquiry(inquiryId, tag) {
    const inq = this.data.expert.directHumanInquiries.find(i => i.id === inquiryId);
    if (inq) {
      if (!inq.tags) inq.tags = [];
      const cleanTag = tag.startsWith('#') ? tag : '#' + tag;
      if (!inq.tags.includes(cleanTag)) {
        inq.tags.push(cleanTag);
        this.saveData();
      }
    }
  }

  removeTagFromInquiry(inquiryId, tag) {
    const inq = this.data.expert.directHumanInquiries.find(i => i.id === inquiryId);
    if (inq && inq.tags) {
      inq.tags = inq.tags.filter(t => t !== tag);
      this.saveData();
    }
  }

  generateAiBroadcast(promptText) {
    const p = promptText.toLowerCase();
    let targetTag = '#не_купил_миникурс';
    let count = 42;

    if (p.includes('b2b')) {
      targetTag = '#b2b_сегмент';
      count = 28;
    } else if (p.includes('горяч') || p.includes('созвон')) {
      targetTag = '#горячий_лид';
      count = 19;
    }

    this.data.expert.aiBroadcast.prompt = promptText;
    this.data.expert.aiBroadcast.targetTag = targetTag;
    this.data.expert.aiBroadcast.matchingLeadsCount = count;

    // Check if missing details (e.g. date or entry price)
    const hasDate = p.includes('суббот') || p.includes('воскрес') || p.includes('завтра') || p.includes('октябр') || p.includes('ноябр') || p.includes('числа');
    const hasPrice = p.includes('бесплатн') || p.includes('руб') || p.includes('депозит') || p.includes('стоимост') || p.includes('вход');

    if (!hasDate || !hasPrice) {
      this.data.expert.aiBroadcast.clarificationStep = true;
      this.data.expert.aiBroadcast.clarificationQuestion = `SI понял контекст! 🎯 Сегмент: ${count} лидов с тегом ${targetTag}. Место: кофейня «Раф», 16:00. Уточните: какая точная дата (в эту субботу?) и условия входа (бесплатно по брони или депозит)?`;
      this.data.expert.aiBroadcast.readyPost = null;
    } else {
      this.data.expert.aiBroadcast.clarificationStep = false;
      this.data.expert.aiBroadcast.readyPost = {
        title: 'Мастер-класс в кофейне «Раф»',
        text: `🔥 Привет! Заметила, что вы интересовались темой женского ресурса и практиками, но не успели зайти на мини-курс. В эту субботу в 16:00 я провожу камерный живой мастер-класс в кофейне «Раф» в центре. Разберем ключевые затыки за чашкой кофе. Участие бесплатное по брони, мест всего 12!`,
        buttonLabel: '🎟️ Забронировать место на мастер-класс',
        segment: targetTag,
        count: count
      };
    }
    this.saveData();
  }

  confirmBroadcastDetails(detailsText) {
    const count = this.data.expert.aiBroadcast.matchingLeadsCount || 42;
    const tag = this.data.expert.aiBroadcast.targetTag || '#не_купил_миникурс';

    this.data.expert.aiBroadcast.clarificationStep = false;
    this.data.expert.aiBroadcast.readyPost = {
      title: 'Мастер-класс в кофейне «Раф»',
      text: `🔥 Привет! Заметила, что вы интересовались темой практик и наполнения, но не успели зайти на мини-курс. В эту субботу в 16:00 я провожу камерный живой мастер-класс в уютной кофейне «Раф». Разберем практики за чашкой кофе. ${detailsText}. Мест всего 12!`,
      buttonLabel: '🎟️ Забронировать место на мастер-класс',
      segment: tag,
      count: count
    };
    this.saveData();
  }

  sendBroadcastNow() {
    if (this.data.expert.aiBroadcast.readyPost) {
      const camp = {
        id: 'bc-' + Date.now(),
        date: 'Только что',
        title: this.data.expert.aiBroadcast.readyPost.title,
        targetTag: this.data.expert.aiBroadcast.readyPost.segment,
        sentCount: this.data.expert.aiBroadcast.readyPost.count,
        openRate: '100%',
        replies: 0,
        status: 'Отправлено 🚀'
      };
      this.data.expert.aiBroadcast.history.unshift(camp);
      this.data.expert.aiBroadcast.readyPost = null;
      this.data.expert.aiBroadcast.prompt = '';

      // Activate all bots for these leads and put them on standby!
      this.data.expert.directHumanInquiries.forEach(inq => {
        inq.botState = 'standby';
      });
      this.saveData();
      return camp;
    }
    return null;
  }

  clearClientChat() {
    this.data.clientSession.messages = JSON.parse(JSON.stringify(defaultData.clientSession.messages));
    this.saveData();
  }
}

window.funnelStore = new Store();
