// store.js - Central State Management for SmartFlow Telegram Mini App

const STORAGE_KEY = 'smartflow_tma_v2';

const defaultData = {
  appName: 'SmartFlow',
  appSlogan: 'From idea to selling. Faster.',
  activeRole: 'marketer', // 'marketer' | 'expert' | 'client' | 'investor'
  currentFunnelId: 'funnel-ht',
  currentExpertId: 'exp-elena',
  currentClientChatId: 'chat-lead-1',
  viewMode: 'desktop-tma', // 'desktop-tma' (device frame) or 'fullscreen'
  showDevRoleSwitcher: true, // Allows toggling roles for pitch demo, but user mode is isolated
  
  // Y Combinator & Google Tier Investor Data Room
  investorData: {
    round: 'Seed Round ($3.5M at $28M Cap)',
    targetInvestors: 'Y Combinator S26 • Google Ventures • a16z Speedrun',
    deckHeadline: 'SmartFlow: The Autonomous Conversational AI Sales Engine for the $52B Creator Economy',
    
    // Core SaaS / Fintech Metrics
    financials: {
      mrr: '$328,500',
      mrrRub: '31,200,000 ₽',
      arrRunRate: '$3,942,000',
      momGrowth: '+34.2%',
      grossMargin: '89.4%',
      netRevenueRetention: '146%', // Top decile YC benchmark
      quickRatio: '4.8',
      magicNumber: '2.14', // Extreme GTM efficiency
      paybackPeriod: '21 days',
      cac: '$168',
      ltv: '$1,480',
      ltvCacRatio: '8.8x'
    },

    // Viral Bottom-Up Flywheel (Product-Led Growth)
    growthFlywheel: {
      kFactor: '1.68', // Viral loop
      organicLeadConversion: '3.4%', // Leads who convert into new paying experts/marketers
      avgFunnelImpressionsPerExpert: '480 / mo',
      zeroPaidMarketing: '84% of new experts join via "Powered by SmartFlow" badge in chat'
    },

    // Market Sizing (TAM / SAM / SOM)
    marketSize: {
      tam: '$52.4B',
      tamDesc: 'Global Creator Economy & Conversational AI Sales Platforms',
      sam: '$14.2B',
      samDesc: 'Social-First Creators & Online Academies across Telegram, WhatsApp, IG',
      som: '$850M',
      somDesc: 'High-Ticket Mentorship & EdTech Beachhead in EMEA & LATAM'
    },

    // AI Sales Agent Benchmarks vs Traditional Human Sales
    benchmarks: [
      { metric: 'Скорость первого ответа', human: '48 минут', smartFlow: '1.8 секунды', delta: 'В 1600 раз быстрее' },
      { metric: 'Конверсия лида в созвон/оплату', human: '4.2%', smartFlow: '18.4%', delta: '+340% рост' },
      { metric: 'Точность отработки возражений', human: '62%', smartFlow: '96.8%', delta: 'База знаний эксперта' },
      { metric: 'Доступность для лидов', human: 'Пн-Пт 10:00-19:00', smartFlow: '24/7/365 без сна', delta: '100% покрытие ночного трафика' }
    ]
  },

  // Marketer Profile & Funnels
  marketer: {
    id: 'mkt-1',
    name: 'Александр Громов',
    tag: '@gromov_smartflow',
    avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=150&q=80',
    title: 'Top Funnel Architect & AI Strategist',
    bio: 'Специализация: Воронки на высокий чек и EdTech с AI-агентами SmartFlow',
    balance: 237600,
    mrr: 237600,
    activeSubscribersCount: 24,
    bankCard: '•••• 8831'
  },

  funnels: [
    {
      id: 'funnel-ht',
      title: 'High-Ticket: Воронка на высокий чек 100k-500k ₽',
      niche: 'Эксперты, премиум-коучи, менторы, консалтинг',
      tagline: 'Автоквалификация платежеспособных клиентов и закрытие на стратегическую сессию',
      monthlyPrice: 9900,
      badge: 'ТОП Выручка',
      description: 'Воронка построена по методологии кастдева и быстрой квалификации. Лид проходит через ценностный лид-магнит, глубокий фильтр по доходу/болям, получает разбор своего кейса и выходит на созвон уже прогретым и согласным с чеком.',
      
      // AI Cloned Marketer settings
      aiClone: {
        personality: 'Уверенный, структурный стратег с акцентом на ROI и ценность времени',
        knowledgeBase: [
          'Методология кастдев-квалификации B2B/B2C',
          'Фреймворк закрытия возражений "дорого", "нет времени", "я уже пробовал"',
          'Триггеры доверия: кейсы с твердыми цифрами, разбор ошибок',
          'Правило "Не продавать созвон, а продавать решение проблемы"'
        ]
      },

      // Funnel Detailed Structure (Critical requirement)
      steps: [
        {
          number: 1,
          name: 'Захват внимания & Лид-магнит',
          goal: 'Крючок интереса, выдача ценного PDF/видео разбора без воды',
          aiPrompt: 'Поприветствовать лида, выдать заявленный аудит/гайд, зафиксировать интерес к росту дохода',
          dropOffRate: '12%',
          conversionRate: '88%'
        },
        {
          number: 2,
          name: 'Кастдев & Экспресс-квалификация',
          goal: 'Выяснить точку А, текущий оборот, нишу и главное узкое горлышко',
          aiPrompt: 'Задать 3 интерактивных вопроса. Отсеять нецелевых без бюджета, выделить платежеспособных',
          dropOffRate: '28%',
          conversionRate: '72%'
        },
        {
          number: 3,
          name: 'Пруфы & Демонстрация PMF',
          goal: 'Показать релевантный кейс именно под нишу и масштаб клиента',
          aiPrompt: 'Подобрать аналогичный кейс из базы знаний эксперта. Показать путь до результата',
          dropOffRate: '16%',
          conversionRate: '84%'
        },
        {
          number: 4,
          name: 'Оффер & Снятие возражений',
          goal: 'Разбить сомнения (рассрочка, гарантии, личное участие эксперта)',
          aiPrompt: 'Презентовать программу трансформации. На возражение дать твердый контр-довод эксперта',
          dropOffRate: '24%',
          conversionRate: '76%'
        },
        {
          number: 5,
          name: 'Закрытие на созвон / Предоплату',
          goal: 'Фиксация брони в календаре эксперта или прием предоплаты',
          aiPrompt: 'Предложить конкретные слоты, взять контактный телефон/Telegram, уведомить эксперта',
          dropOffRate: '18%',
          conversionRate: '82%'
        }
      ],

      // Aggregated metrics (WITHOUT clients personal data)
      analytics: {
        activeExpertsCount: 16,
        totalLeadsProcessed: 2840,
        avgFunnelConversion: '19.4%',
        totalExpertsRevenue: '14,820,000 ₽',
        avgDealCheck: '185,000 ₽',
        stepDropOffs: [
          { step: '1. Лид-магнит', entered: 2840, passed: 2499, cr: '88.0%' },
          { step: '2. Квалификация', entered: 2499, passed: 1799, cr: '72.0%' },
          { step: '3. Кейсы & PMF', entered: 1799, passed: 1511, cr: '84.0%' },
          { step: '4. Оффер & Возражения', entered: 1511, passed: 1148, cr: '76.0%' },
          { step: '5. Запись на созвон', entered: 1148, passed: 551, cr: '48.0%' }
        ]
      },

      // AI Analyzer recommendations for the marketer
      analyzerRecommendations: [
        {
          id: 'rec-mkt-1',
          urgency: 'high',
          title: 'Высокий отвал на Шаге 2 (Квалификация: -28%)',
          observation: 'Лиды спотыкаются на прямом вопросе о текущем доходе ("Сколько вы зарабатываете сейчас?").',
          solution: 'Размягчить вопрос диапазонами в виде кнопок ("До 100k", "100-300k", "300k+") вместо открытого ввода текста. Это поднимет конверсию шага на ~14%.'
        },
        {
          id: 'rec-mkt-2',
          urgency: 'medium',
          title: 'Потенциал роста чека: добавление микро-трипвайера',
          observation: 'Часть лидов (18%) не готова сразу на созвон за 180k, но готова купить мини-разбор за 4,900 ₽.',
          solution: 'Внедрить ветку Downsell на шаге 4: при отказе от созвона предлагать экспресс-диагностику.'
        },
        {
          id: 'rec-mkt-3',
          urgency: 'tip',
          title: 'Внедрение триггера "Дедлайн слотов"',
          observation: 'Эксперты закрывают на созвон на 22% лучше, если ИИ-продавец говорит: "На эту неделю у эксперта осталось всего 2 свободных слота".',
          solution: 'Включено в стандартный промпт шага 5.'
        }
      ],

      // Subscribed Experts list
      subscribers: [
        {
          id: 'exp-elena',
          name: 'Елена Смирнова',
          niche: 'Психолог & Коуч лидеров',
          avatar: 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?auto=format&fit=crop&w=150&q=80',
          joinDate: '12 мая 2026',
          status: 'active',
          monthsActive: 5,
          cardLast4: '4242',
          leadsProcessed: 438,
          closedDeals: 36,
          revenueGenerated: '5,400,000 ₽',
          avgCheck: '150,000 ₽',
          crOverall: '18.2%'
        },
        {
          id: 'exp-alexey',
          name: 'Алексей Волков',
          niche: 'B2B Консалтинг & Системные продажи',
          avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=150&q=80',
          joinDate: '28 июня 2026',
          status: 'active',
          monthsActive: 4,
          cardLast4: '9912',
          leadsProcessed: 612,
          closedDeals: 42,
          revenueGenerated: '6,300,000 ₽',
          avgCheck: '210,000 ₽',
          crOverall: '20.5%'
        },
        {
          id: 'exp-dmitry',
          name: 'Дмитрий Ковалев',
          niche: 'Финансовый советник & Инвестиции',
          avatar: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=150&q=80',
          joinDate: '15 июля 2026',
          status: 'active',
          monthsActive: 3,
          cardLast4: '3145',
          leadsProcessed: 280,
          closedDeals: 19,
          revenueGenerated: '2,850,000 ₽',
          avgCheck: '150,000 ₽',
          crOverall: '16.8%'
        },
        {
          id: 'exp-marina',
          name: 'Марина Соколова',
          niche: 'Бренд-стратег & Продюсер смыслов',
          avatar: 'https://images.unsplash.com/photo-1580489944761-15a19d654956?auto=format&fit=crop&w=150&q=80',
          joinDate: '04 августа 2026',
          status: 'active',
          monthsActive: 2,
          cardLast4: '7721',
          leadsProcessed: 195,
          closedDeals: 14,
          revenueGenerated: '1,400,000 ₽',
          avgCheck: '100,000 ₽',
          crOverall: '15.4%'
        }
      ],

      cohortRetention: {
        cohorts: [
          { month: 'Май 2026', users: 6, m1: '100%', m2: '100%', m3: '83%', m4: '83%', m5: '83%' },
          { month: 'Июнь 2026', users: 8, m1: '100%', m2: '88%', m3: '88%', m4: '88%', m5: '-' },
          { month: 'Июль 2026', users: 5, m1: '100%', m2: '100%', m3: '80%', m4: '-', m5: '-' },
          { month: 'Авг 2026', users: 7, m1: '100%', m2: '86%', m3: '-', m4: '-', m5: '-' },
          { month: 'Сент 2026', users: 4, m1: '100%', m2: '-', m3: '-', m4: '-', m5: '-' }
        ],
        avgLtv: '42,800 ₽',
        churnRate: '4.8%'
      }
    }
  ],

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
        lastDirectMessage: 'Аудиосообщение (расшифровано Whisper AI)',
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
          question: 'Какие материалы, кейсы и кнопки целевого действия должен показывать ИИ-продавец?',
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
          { sender: 'ai', text: 'Приветствую, Марк! Рад познакомиться. Я AI-ассистент Елены Смирновой в SmartFlow. Направляю вам аудит «5 скрытых утечек времени фаундера». Скажите, какой у вас сейчас проект и сколько времени в неделю съедает операционка?', time: '14:21' },
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
        { title: 'Старт диалога с ИИ', count: 392, percent: '89.5%' },
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
        reason: 'Ваш ИИ-продавец квалифицирует лидов с выручкой > 2.5 млн ₽. Для этой аудитории чек 25k кажется "подозрительно доступным". Тест на 20 лидах показал, что готовность платить 35k абсолютно такая же.',
        applied: false,
        actionType: 'update_price'
      },
      {
        id: 'rec-exp-2',
        impact: '+22% к конверсии',
        tag: 'Возражения',
        title: 'Внедрить авто-демонстрацию кейса в нише B2B IT',
        reason: 'За сентябрь 18 лидов из IT-сферы задали вопрос: "А есть ли примеры в заказной разработке?". Добавьте 2 слайда кейса Артема прямо в ответ ИИ-продавца.',
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
    botName: 'SmartFlow AI Sales Agent',
    status: 'online',
    currentFunnelStep: 1,
    messages: [
      {
        id: 'cm-1',
        sender: 'ai',
        text: 'Приветствую! 👋 Я AI-продавец Елены Смирновой — Executive-коуча и ментора фаундеров.\n\nЗа 6 лет Елена помогла 140+ собственникам высвободить 15+ часов в неделю и вырасти в чистой прибыли x2-x5.\n\nЗафиксировал для вас **Гайд «5 скрытых утечек времени фаундера»** 📥\n\nМожете написать мне текстом или **отправить голосовое сообщение** 🎙️ — я отлично распознаю аудио! В какой нише ваш проект и какой сейчас оборот?',
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
        return JSON.parse(saved);
      }
    } catch (e) {
      console.warn('Failed to load from localStorage', e);
    }
    return JSON.parse(JSON.stringify(defaultData));
  }

  saveData() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.data));
    } catch (e) {
      console.warn('Failed to save to localStorage', e);
    }
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

  setRole(role) {
    if (['marketer', 'expert', 'client', 'investor'].includes(role)) {
      this.data.activeRole = role;
      this.saveData();
    }
  }

  setViewMode(mode) {
    this.data.viewMode = mode;
    this.saveData();
  }

  selectFunnel(funnelId) {
    this.data.currentFunnelId = funnelId;
    this.saveData();
  }

  createFunnel(funnelData) {
    const id = 'funnel-' + Date.now();
    const newFunnel = {
      id,
      title: funnelData.title || 'Новая воронка SmartFlow',
      niche: funnelData.niche || 'Общая ниша',
      tagline: funnelData.tagline || 'Автоматическая воронка для экспертов',
      monthlyPrice: Number(funnelData.monthlyPrice) || 7900,
      badge: 'Новая',
      description: funnelData.description || 'Описание структуры воронки',
      aiClone: {
        personality: funnelData.personality || 'Профессиональный наставник',
        knowledgeBase: funnelData.knowledgeBase ? funnelData.knowledgeBase.split('\n').filter(Boolean) : ['Ключевые офферы', 'Скрипт квалификации']
      },
      steps: funnelData.steps || [
        { number: 1, name: 'Лид-магнит & Приветствие', goal: 'Захват контакта', dropOffRate: '10%', conversionRate: '90%' },
        { number: 2, name: 'Квалификация лида', goal: 'Определение платежеспособности', dropOffRate: '25%', conversionRate: '75%' },
        { number: 3, name: 'Оффер & Продажа', goal: 'Закрытие сделки', dropOffRate: '20%', conversionRate: '80%' }
      ],
      analytics: {
        activeExpertsCount: 1,
        totalLeadsProcessed: 45,
        avgFunnelConversion: '21.0%',
        totalExpertsRevenue: '250,000 ₽',
        avgDealCheck: '120,000 ₽',
        stepDropOffs: [
          { step: '1. Лид-магнит', entered: 45, passed: 41, cr: '91.1%' },
          { step: '2. Квалификация', entered: 41, passed: 31, cr: '75.6%' },
          { step: '3. Оффер & Продажа', entered: 31, passed: 9, cr: '29.0%' }
        ]
      },
      analyzerRecommendations: [
        {
          id: 'rec-' + Date.now(),
          urgency: 'high',
          title: 'Оптимизировать вопрос о бюджете',
          observation: 'Первые лиды медленно отвечают на вопрос о готовности инвестировать.',
          solution: 'Добавить варианты ответа кнопками.'
        }
      ],
      subscribers: [],
      cohortRetention: {
        cohorts: [{ month: 'Текущий', users: 1, m1: '100%' }],
        avgLtv: `${funnelData.monthlyPrice || 7900} ₽`,
        churnRate: '0%'
      }
    };

    this.data.funnels.unshift(newFunnel);
    this.data.currentFunnelId = id;
    this.saveData();
    return newFunnel;
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
      sourceStep: 'Чат ИИ-продавца',
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

  clearClientChat() {
    this.data.clientSession.messages = JSON.parse(JSON.stringify(defaultData.clientSession.messages));
    this.saveData();
  }
}

window.funnelStore = new Store();
