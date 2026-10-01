-- SmartFlow Migration 002: Seed Demo Blueprints & Separation of Demo Data
-- All demo records are marked with is_demo = 1

-- 1. Demo Marketer User
INSERT INTO users (id, display_name, username, avatar_url, roles, status, is_demo)
VALUES (
  'user_demo_marketer_gromov',
  'Александр Громов',
  'gromov_smartflow',
  'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=150&q=80',
  '["marketer"]',
  'active',
  1
) ON CONFLICT(id) DO NOTHING;

-- 2. Demo Expert User
INSERT INTO users (id, display_name, username, avatar_url, roles, status, is_demo)
VALUES (
  'user_demo_expert_elena',
  'Елена Воронова',
  'elena_coach',
  'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?auto=format&fit=crop&w=150&q=80',
  '["expert"]',
  'active',
  1
) ON CONFLICT(id) DO NOTHING;

-- 3. Demo Funnel Template by Marketer
INSERT INTO funnel_templates (
  id, creator_id, title, niche, tagline, description, monthly_price, currency, trial_days, badge, ai_clone_settings, steps, is_published, is_demo
) VALUES (
  'tmpl_high_ticket_v1',
  'user_demo_marketer_gromov',
  'High-Ticket: Воронка на высокий чек 100k-500k ₽',
  'Эксперты, премиум-коучи, менторы, консалтинг',
  'Автоквалификация платежеспособных клиентов и закрытие на стратегическую сессию',
  'Воронка построена по методологии кастдева и быстрой квалификации. Лид проходит через ценностный лид-магнит, фильтр по доходу/болям, получает разбор своего кейса и выходит на созвон уже прогретым.',
  9900,
  'RUB',
  14,
  'ТОП Выручка',
  '{"personality":"Уверенный, структурный стратег с акцентом на ROI и ценность времени","knowledgeBase":["Методология кастдев-квалификации B2B/B2C","Фреймворк закрытия возражений дорого, нет времени","Правило Не продавать созвон, а продавать решение проблемы"]}',
  '[{"id":"step-1","title":"1. Захват & PMF-Лидмагнит","type":"lead-magnet","goal":"Вызвать высокий интерес"},{"id":"step-2","title":"2. Кастдев-Квалификация","type":"qualification","goal":"Определить чек и готовность"},{"id":"step-3","title":"3. Разбор кейсов резидентов","type":"case-study","goal":"Снять скепсис"},{"id":"step-4","title":"4. Оффер & Фильтрация","type":"offer","goal":"Презентовать программу"},{"id":"step-5","title":"5. Закрытие на Стратсессию","type":"booking","goal":"Фиксация слота в Zoom"}]',
  1,
  1
) ON CONFLICT(id) DO NOTHING;

-- 4. Demo Expert Project Instance (Isolated clone for Elena Voronova)
INSERT INTO projects (
  id, owner_id, template_id, name, slug, status, niche, custom_ai_settings, pricing_options, stats, is_demo
) VALUES (
  'proj_demo_elena_high_ticket',
  'user_demo_expert_elena',
  'tmpl_high_ticket_v1',
  'AI-Продавец Елены Вороновой: Менторство по выходу из операционки',
  'elena-mentor',
  'active',
  'Наставничество для собственников B2B бизнеса',
  '{"systemRole":"AI-ассистент и бизнес-консультант Елены Вороновой","tone":"деловой, доброжелательный, аргументированный","objectionsHandling":{"дорого":"Инвестиция окупается в первый месяц за счет делегирования и роста чека","нет времени":"Именно поэтому программа длится 6 недель с фокусом на автоматизацию"}}',
  '[{"id":"p1","name":"Экспресс-разбор","price":45000},{"id":"p2","name":"Личное менторство 3 мес","price":350000}]',
  '{"traffic":1420,"leads":412,"qualified":248,"bookings":86,"cr":14.6,"revenueRub":4280000,"savedHours":114}',
  1
) ON CONFLICT(id) DO NOTHING;

-- 5. Marketer Funnel Subscription for Elena
INSERT INTO funnel_subscriptions (
  id, expert_user_id, marketer_user_id, funnel_template_id, status, price, currency, trial_ends_at, current_period_ends_at, auto_renew
) VALUES (
  'sub_demo_elena_gromov',
  'user_demo_expert_elena',
  'user_demo_marketer_gromov',
  'tmpl_high_ticket_v1',
  'active',
  9900,
  'RUB',
  '2026-11-01 00:00:00',
  '2026-11-15 00:00:00',
  1
) ON CONFLICT(id) DO NOTHING;

-- 6. Demo Clients for Elena's project
INSERT INTO clients (
  id, project_id, external_client_id, name, username, avatar_url, status, funnel_step, deal_value, tags, qualification_answers, last_message, is_demo
) VALUES (
  'cli_demo_dmitry',
  'proj_demo_elena_high_ticket',
  'tg_user_101',
  'Дмитрий Волков',
  'volkov_b2b',
  'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=100&q=80',
  'human_needed',
  'step-5',
  350000,
  '["B2B агентство", "Оборот 4M ₽", "Срочно"]',
  '{"revenue":"3-5 млн руб","niche":"IT и разработка","pain":"Застрял в операционке, работаю по 14 часов"}',
  'Хочу созвониться лично с Еленой перед оплатой менторства',
  1
),
(
  'cli_demo_artem',
  'proj_demo_elena_high_ticket',
  'tg_user_102',
  'Артём Смирнов',
  'artem_saas',
  'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=100&q=80',
  'diagnostic_booked',
  'step-5',
  150000,
  '["EdTech", "Готов стартовать"]',
  '{"revenue":"1-2 млн руб","pain":"Сложно масштабировать продажи"}',
  'Записался на Zoom в пятницу в 11:30',
  1
) ON CONFLICT(id) DO NOTHING;

-- 7. Demo Direct Inquiry for Elena
INSERT INTO direct_inquiries (
  id, project_id, client_id, lead_name, lead_username, lead_avatar, reason, urgency, status, is_demo
) VALUES (
  'inq_demo_dmitry',
  'proj_demo_elena_high_ticket',
  'cli_demo_dmitry',
  'Дмитрий Волков',
  '@volkov_b2b',
  'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=100&q=80',
  'Запрос на личный созвон с Еленой перед оплатой тарифа 350 000 ₽',
  'urgent',
  'waiting',
  1
) ON CONFLICT(id) DO NOTHING;
