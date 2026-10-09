// test/stage1.test.js - Comprehensive Automated Test Suite for Stage 1
// Runs completely on an isolated test database (Requirement 11)

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const assert = require('assert');

// Set environment for test mode with isolated test database
const TEST_DB_FILE = path.join(__dirname, '../data/test_stage1.db');
process.env.NODE_ENV = 'test';
process.env.DB_FILE = TEST_DB_FILE;
// Set TEST_DATABASE_URL (an empty PostgreSQL database) to run the suite on PostgreSQL instead.
const TEST_DRIVER = process.env.TEST_DATABASE_URL ? 'postgres' : 'sqlite';
process.env.DB_DRIVER = TEST_DRIVER;
if (TEST_DRIVER === 'postgres') process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
// Fake token: tests only need a value to sign initData with. Never put a real bot token here.
process.env.TELEGRAM_BOT_TOKEN = '1234567890:TEST_ONLY_fake_bot_token_not_real';
process.env.JWT_SECRET = 'sf_test_jwt_secret_key_stage1_testing_12345';

// Remove old test db if present
if (fs.existsSync(TEST_DB_FILE)) {
  fs.unlinkSync(TEST_DB_FILE);
}

const db = require('../server/db');
const migrator = require('../server/db/migrator');
const authService = require('../server/services/auth-service');
const projectService = require('../server/services/project-service');
const subscriptionService = require('../server/services/subscription-service');

/**
 * Helper to generate cryptographically authentic Telegram initData strings
 */
function createTelegramInitData(botToken, user, authDateOffsetSeconds = 0) {
  const authDate = Math.floor(Date.now() / 1000) + authDateOffsetSeconds;
  const params = {
    auth_date: String(authDate),
    query_id: 'AAHdF6IQAAAAAN0XohDhrOrc',
    user: JSON.stringify(user)
  };

  const dataCheckString = Object.keys(params)
    .sort()
    .map(key => `${key}=${params[key]}`)
    .join('\n');

  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const hash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  const searchParams = new URLSearchParams(params);
  searchParams.set('hash', hash);
  return searchParams.toString();
}

async function runAllTests() {
  console.log('\n======================================================');
  console.log('  SMARTFLOW STAGE 1 VERIFICATION & SECURITY TEST SUITE');
  console.log('======================================================\n');

  let passed = 0;
  let failed = 0;

  async function test(name, fn) {
    try {
      await fn();
      console.log(`  ✅ [PASS] ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ❌ [FAIL] ${name}`);
      console.error(`     Error: ${err.message}`);
      failed++;
    }
  }

  // 1. Database Migrations on Isolated DB
  await test('01. Isolated Database Initialization & Versioned Migrations', async () => {
    db.initDatabase({ dbFile: TEST_DB_FILE, driver: TEST_DRIVER });
    const applied = await migrator.runMigrations({ silent: true });
    assert(applied.length >= 2, 'Should apply at least 2 migrations');

    const versions = await migrator.getAppliedMigrations();
    const expected = require('fs').readdirSync(require('path').join(__dirname, '../server/db/migrations'))
      .filter(f => /^\d+_.+\.sql$/.test(f)).map(f => parseInt(f, 10)).sort((a, b) => a - b);
    assert.deepStrictEqual(versions, expected, 'Every migration file must be recorded in order');
  });

  // 2. Telegram Auth HMAC Validation
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const expertA_Tg = { id: 100001, first_name: 'Эксперт', last_name: 'Алексей', username: 'expert_alexey' };
  const expertB_Tg = { id: 200002, first_name: 'Эксперт', last_name: 'Борис', username: 'expert_boris' };

  await test('02. Настоящий вход через Telegram (Authentic HMAC Verification)', async () => {
    const validInitData = createTelegramInitData(botToken, expertA_Tg);
    const verification = authService.verifyTelegramInitData(validInitData);
    assert.strictEqual(verification.valid, true, 'Valid initData must pass HMAC verification');
    assert.strictEqual(verification.user.id, expertA_Tg.id);
    assert.strictEqual(verification.user.username, expertA_Tg.username);

    // Register through auth service
    const userA = await authService.findOrCreateTelegramUser(verification.user, 'expert');
    assert(userA.id.startsWith('usr_'), 'User must have a persistent internal SmartFlow ID');
    assert.strictEqual(userA.display_name, 'Эксперт Алексей');

    const tokenA = authService.generateSessionToken(userA);
    const decodedA = authService.verifySessionToken(tokenA);
    assert.strictEqual(decodedA.userId, userA.id);
  });

  await test('03. Поддельная авторизация отклоняется (Tampered HMAC rejected)', async () => {
    const validInitData = createTelegramInitData(botToken, expertA_Tg);
    // Tamper with username in query string without updating hash
    const tamperedInitData = validInitData.replace('expert_alexey', 'hacker_attacker');
    const verification = authService.verifyTelegramInitData(tamperedInitData);
    assert.strictEqual(verification.valid, false, 'Tampered initData must be rejected');
    assert.strictEqual(verification.error, 'invalid_signature');
  });

  await test('04. Просроченная авторизация отклоняется (Expired initData rejected)', async () => {
    // Generate initData from 48 hours ago
    const expiredInitData = createTelegramInitData(botToken, expertA_Tg, - (48 * 3600));
    const verification = authService.verifyTelegramInitData(expiredInitData);
    assert.strictEqual(verification.valid, false, 'Expired initData must be rejected');
    assert.strictEqual(verification.error, 'expired_auth_data');
  });

  // 3. User Identity & Re-login Consistency
  let expertA_InternalId = null;
  let expertB_InternalId = null;

  await test('05. Повторный вход сохраняет тот же SmartFlow user_id (Single Source of Truth)', async () => {
    const initData1 = createTelegramInitData(botToken, expertA_Tg);
    const userA1 = await authService.findOrCreateTelegramUser(expertA_Tg, 'expert');
    expertA_InternalId = userA1.id;

    // Simulate re-login
    const initData2 = createTelegramInitData(botToken, expertA_Tg);
    const userA2 = await authService.findOrCreateTelegramUser(expertA_Tg, 'expert');

    assert.strictEqual(userA1.id, userA2.id, 'Internal SmartFlow user_id MUST remain identical on re-login');
  });

  await test('06. Сохранение данных после повторного входа', async () => {
    // Retrieve project created for Expert A
    const projectsBefore = await projectService.getUserProjects(expertA_InternalId);
    assert(projectsBefore.owned.length > 0, 'Expert A should have an automatically provisioned project');
    const projectA = projectsBefore.owned[0];

    // Expert A customizes project
    await projectService.updateProject(projectA.id, {
      name: 'Бизнес-Воронка Алексея 2.0 (Обновлено)',
      niche: 'B2B Консалтинг'
    });

    // Re-authenticate and verify updated data is retained
    const userAfter = await authService.findOrCreateTelegramUser(expertA_Tg, 'expert');
    const projectsAfter = await projectService.getUserProjects(userAfter.id);
    const updatedProj = projectsAfter.owned.find(p => p.id === projectA.id);

    assert.strictEqual(updatedProj.name, 'Бизнес-Воронка Алексея 2.0 (Обновлено)');
    assert.strictEqual(updatedProj.niche, 'B2B Консалтинг');
  });

  // 4. Data Isolation: Expert A vs Expert B
  await test('07. Эксперт А не может получить доступ к данным Эксперта Б (Strict Isolation)', async () => {
    // Create Expert B
    const userB = await authService.findOrCreateTelegramUser(expertB_Tg, 'expert');
    expertB_InternalId = userB.id;
    assert.notStrictEqual(expertA_InternalId, expertB_InternalId, 'Expert A and B must have different internal IDs');

    const projectsB = await projectService.getUserProjects(expertB_InternalId);
    const projectB = projectsB.owned[0];

    // Expert A tries to access Expert B's project settings
    const checkRead = await projectService.checkProjectAccess(expertA_InternalId, projectB.id, 'funnel:read');
    assert.strictEqual(checkRead.allowed, false, 'Expert A must NOT have funnel:read on Expert B project');
    assert.strictEqual(checkRead.reason, 'access_denied_not_a_member');

    // Expert A tries to edit Expert B's project
    const checkWrite = await projectService.checkProjectAccess(expertA_InternalId, projectB.id, 'funnel:write');
    assert.strictEqual(checkWrite.allowed, false, 'Expert A must NOT have funnel:write on Expert B project');

    // Expert A tries to view Expert B's analytics
    const checkAnalytics = await projectService.checkProjectAccess(expertA_InternalId, projectB.id, 'analytics:read');
    assert.strictEqual(checkAnalytics.allowed, false, 'Expert A must NOT have analytics:read on Expert B project');

    // Expert A tries to read Expert B's CRM conversations
    const checkConvs = await projectService.checkProjectAccess(expertA_InternalId, projectB.id, 'conversations:read');
    assert.strictEqual(checkConvs.allowed, false, 'Expert A must NOT have conversations:read on Expert B project');
  });

  await test('08. Изменение роли или owner_id в запросе не дает чужой доступ', async () => {
    // Expert A creates a project trying to spoof owner_id = Expert B
    // Server ignores requested owner_id and forces user_id from token
    const newProj = await projectService.createProject(expertA_InternalId, {
      name: 'Скрытый проект',
      owner_id: expertB_InternalId // Spoof attempt
    });

    assert.strictEqual(newProj.owner_id, expertA_InternalId, 'Server must enforce owner_id = authenticated user ID');
  });

  // 5. Future Collaborator / Marketer Invitation Architecture
  await test('09. Архитектура приглашения маркетолога с гранулярными правами (Granular Member Permissions)', async () => {
    const projectsA = await projectService.getUserProjects(expertA_InternalId);
    const projectA = projectsA.owned[0];

    // By default, Marketer has NO access to Expert A's project
    const marketerUser = await db.get('SELECT * FROM users WHERE id = ?', ['user_demo_marketer_gromov']);
    const checkBeforeInvite = await projectService.checkProjectAccess(marketerUser.id, projectA.id, 'analytics:read');
    assert.strictEqual(checkBeforeInvite.allowed, false, 'Marketer has no access before explicit invitation');

    // Simulate expert inviting marketer with ONLY analytics:read permission (read-only analyst)
    const memberId = `pm_${Date.now()}`;
    await db.run(
      `INSERT INTO project_members (id, project_id, user_id, role, permissions, invited_by, status)
       VALUES (?, ?, ?, 'collaborator', ?, ?, 'active')`,
      [memberId, projectA.id, marketerUser.id, JSON.stringify(['analytics:read']), expertA_InternalId]
    );

    // Now marketer CAN read analytics
    const checkAnalytics = await projectService.checkProjectAccess(marketerUser.id, projectA.id, 'analytics:read');
    assert.strictEqual(checkAnalytics.allowed, true, 'Marketer can read analytics with permission');

    // But marketer CANNOT edit funnel or read private conversations
    const checkEdit = await projectService.checkProjectAccess(marketerUser.id, projectA.id, 'funnel:write');
    assert.strictEqual(checkEdit.allowed, false, 'Marketer CANNOT edit funnel without funnel:write');

    const checkChat = await projectService.checkProjectAccess(marketerUser.id, projectA.id, 'conversations:read');
    assert.strictEqual(checkChat.allowed, false, 'Marketer CANNOT view private conversations without permission');

    // Expert revokes access
    await db.run('UPDATE project_members SET status = ? WHERE id = ?', ['revoked', memberId]);
    const checkRevoked = await projectService.checkProjectAccess(marketerUser.id, projectA.id, 'analytics:read');
    assert.strictEqual(checkRevoked.allowed, false, 'Revoked member loses all access immediately');
  });

  // 6. Subscriptions: SmartFlow Platform vs Marketer Funnel Template
  await test('10. Разделение подписки SmartFlow и подписки на шаблон маркетолога', async () => {
    // 1. Platform subscription
    const platSub = await subscriptionService.getPlatformSubscription(expertA_InternalId);
    assert.strictEqual(platSub.plan_code, 'founder_free_100');
    assert.strictEqual(platSub.hasActiveAccess, true);

    // 2. Subscribe Expert A to Marketer's template
    const template = await db.get('SELECT * FROM funnel_templates WHERE is_demo = 1 LIMIT 1');
    const subResult = await subscriptionService.subscribeToTemplate(expertA_InternalId, template.id);

    assert(subResult.subscriptionId.startsWith('sub_fnl_'));
    assert(subResult.project, 'Subscribing to template must create an isolated expert project instance');
    assert.strictEqual(subResult.project.owner_id, expertA_InternalId);

    // Verify template creator still does NOT own or have access to expert's new instance
    const checkCreatorAccess = await projectService.checkProjectAccess(template.creator_id, subResult.project.id, 'conversations:read');
    assert.strictEqual(checkCreatorAccess.allowed, false, 'Template creator does NOT get access to expert instance');
  });

  await test('11. Отмена подписки НЕ удаляет данные эксперта (Data Retention Rule)', async () => {
    const template = await db.get('SELECT * FROM funnel_templates WHERE is_demo = 1 LIMIT 1');
    const subs = await subscriptionService.getExpertFunnelSubscriptions(expertA_InternalId);
    assert(subs.length > 0);

    const subToCancel = subs[0];
    const cancelRes = await subscriptionService.cancelFunnelSubscription(subToCancel.id, expertA_InternalId, 'Тест отмены');
    assert.strictEqual(cancelRes.success, true);

    // Verify records and instance in projects table are completely preserved
    const projectsStillHere = await projectService.getUserProjects(expertA_InternalId);
    assert(projectsStillHere.owned.length > 0, 'Projects must NOT be deleted upon subscription cancellation');

    const subInDb = await db.get('SELECT * FROM funnel_subscriptions WHERE id = ?', [subToCancel.id]);
    assert.strictEqual(subInDb.status, 'cancelled');
    assert.strictEqual(subInDb.auto_renew, 0);
  });

  // 7. Public Client Endpoint & Protection of Private Data
  await test('12. Клиентская ссылка на опубликованного AI-продавца и изоляция настроек', async () => {
    const projectsA = await projectService.getUserProjects(expertA_InternalId);
    const projectA = projectsA.owned[0];

    const publicView = await projectService.getPublicProjectBySlug(projectA.slug);
    assert(publicView, 'Public view must be accessible by slug');
    assert.strictEqual(publicView.name, projectA.name);
    assert(publicView.expert.name, 'Expert name is public');

    // Strict security check: Private prompts, CRM data, and owner_id are omitted!
    assert.strictEqual(publicView.owner_id, undefined, 'owner_id must NOT be exposed to clients');
    assert.strictEqual(publicView.stats, undefined, 'Internal financial stats must NOT be exposed to clients');
    assert.strictEqual(publicView.crm, undefined, 'CRM records must NOT be exposed to clients');
  });

  // 8. Server Restart Simulation & Data Durability
  await test('13. Перезапуск сервера не приводит к потере данных (Database Persistence)', async () => {
    // Close database connection
    db.closeDatabase();

    // Re-initialize from the same disk file
    db.initDatabase({ dbFile: TEST_DB_FILE, driver: TEST_DRIVER });

    // Verify Expert A and all data exist intact
    const restoredUser = await db.get('SELECT * FROM users WHERE id = ?', [expertA_InternalId]);
    assert(restoredUser, 'User must exist after restart');
    assert.strictEqual(restoredUser.display_name, 'Эксперт Алексей');

    const restoredProjects = await projectService.getUserProjects(expertA_InternalId);
    assert(restoredProjects.owned.length >= 2, 'Projects must exist intact after restart');
  });

  // 9. Production Security Verification
  await test('14. Production строго не допускает тестовый обход авторизации (Dev-login blocked in prod)', async () => {
    const express = require('express');
    const authRoutes = require('../server/routes/auth');
    const app = express();
    app.use(express.json());
    app.use('/api/auth', authRoutes);

    // Temporarily simulate production
    const config = require('../server/config');
    const originalProd = config.isProd;
    config.isProd = true;

    // Simulate request to /api/auth/dev-login
    const req = { body: { role: 'expert' } };
    let responseStatus = null;
    let responseBody = null;
    const res = {
      status(s) { responseStatus = s; return this; },
      json(b) { responseBody = b; return this; }
    };

    // Find the dev-login handler
    const devLoginRoute = authRoutes.stack.find(layer => layer.route && layer.route.path === '/dev-login');
    assert(devLoginRoute, 'dev-login route exists in auth router');
    await devLoginRoute.route.stack[0].handle(req, res, () => {});

    // Restore original isProd
    config.isProd = originalProd;

    assert.strictEqual(responseStatus, 403, 'dev-login must return 403 Forbidden in production');
    assert.strictEqual(responseBody.error, 'forbidden');
  });

  // 11. Photos and profile over real HTTP (the same Express app the server runs)
  const { app } = require('../server/index');
  const httpServer = await new Promise(resolve => {
    const srv = app.listen(0, () => resolve(srv));
  });
  const baseUrl = `http://127.0.0.1:${httpServer.address().port}`;
  const tokenFor = async (tgUser) => authService.generateSessionToken(await authService.findOrCreateTelegramUser(tgUser, 'expert'));
  const tokenA = await tokenFor(expertA_Tg);
  const tokenB = await tokenFor(expertB_Tg);
  // Smallest valid JPEG header + filler: enough for the server's file-type check
  const fakeJpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 7)]);
  const upload = (url, token, body, type = 'image/jpeg') => fetch(baseUrl + url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': type },
    body
  });

  await test('16. Загрузка своего фото: сохраняется и отдаётся по ссылке', async () => {
    const res = await upload('/api/me/photo', tokenA, fakeJpeg);
    assert.strictEqual(res.status, 201);
    const { photoUrl } = await res.json();
    assert(/^\/api\/media\/med_[a-f0-9]{32}$/.test(photoUrl), 'photo URL points to /api/media');

    const img = await fetch(baseUrl + photoUrl);
    assert.strictEqual(img.status, 200);
    assert.strictEqual(img.headers.get('content-type'), 'image/jpeg');
    assert.strictEqual(img.headers.get('x-content-type-options'), 'nosniff');
    assert(Buffer.from(await img.arrayBuffer()).equals(fakeJpeg), 'Served bytes equal uploaded bytes');

    // A new Telegram login (with a Telegram photo) must not replace the uploaded photo
    await authService.findOrCreateTelegramUser({ ...expertA_Tg, photo_url: 'https://t.me/i/userpic/320/a.jpg' }, 'expert');
    const me = await fetch(baseUrl + '/api/me/profile', { headers: { Authorization: `Bearer ${tokenA}` } }).then(r => r.json());
    assert.strictEqual(me.user.photoUrl, photoUrl, 'Uploaded photo wins over the Telegram photo');

    // Replacing the photo removes the old file
    const second = await upload('/api/me/photo', tokenA, fakeJpeg).then(r => r.json());
    assert.notStrictEqual(second.photoUrl, photoUrl);
    assert.strictEqual((await fetch(baseUrl + photoUrl)).status, 404, 'Old photo is deleted');
  });

  await test('17. Не-картинки и чужие консультанты отклоняются', async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    assert.strictEqual((await upload('/api/me/photo', tokenA, svg, 'image/svg+xml')).status, 400, 'SVG is rejected');
    assert.strictEqual((await upload('/api/me/photo', tokenA, Buffer.from('hello world, not an image'))).status, 400);
    assert.strictEqual((await upload('/api/me/photo', 'bad-token', fakeJpeg)).status, 401, 'Login required');
    const big = Buffer.concat([fakeJpeg, Buffer.alloc(2 * 1024 * 1024)]);
    assert.strictEqual((await upload('/api/me/photo', tokenA, big)).status, 413, 'More than 2 MB is rejected');

    const projectB = (await projectService.getUserProjects(expertB_InternalId)).owned[0];
    const foreign = await upload(`/api/projects/${projectB.id}/photo`, tokenA, fakeJpeg);
    assert.strictEqual(foreign.status, 403, 'Expert A cannot change the photo of Expert B consultant');

    const own = await upload(`/api/projects/${projectB.id}/photo`, tokenB, fakeJpeg);
    assert.strictEqual(own.status, 201);
    const { photoUrl } = await own.json();
    const after = (await projectService.getUserProjects(expertB_InternalId)).owned.find(p => p.id === projectB.id);
    assert.strictEqual(after.photo_url, photoUrl, 'Consultant photo is returned with the project');
    const publicView = await projectService.getPublicProjectBySlug(after.slug);
    assert.strictEqual(publicView.aiSeller.photoUrl, photoUrl, 'Clients see the consultant photo');
  });

  await test('18. Профиль: сохраняется, опасные ссылки отбрасываются, роль начинается с SI', async () => {
    const res = await fetch(baseUrl + '/api/me/profile', {
      method: 'PUT',
      headers: { Authorization: `Bearer ${tokenA}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        displayName: 'Алексей Эксперт',
        bio: 'Помогаю экспертам продавать',
        links: [
          { label: 'Instagram', url: 'https://instagram.com/alexey' },
          { label: 'Плохая', url: 'javascript:alert(1)' }
        ],
        isAdmin: true
      })
    });
    assert.strictEqual(res.status, 200);
    const { user } = await res.json();
    assert.strictEqual(user.displayName, 'Алексей Эксперт');
    assert.strictEqual(user.profile.bio, 'Помогаю экспертам продавать');
    assert.deepStrictEqual(user.profile.links, [{ label: 'Instagram', url: 'https://instagram.com/alexey' }]);
    assert.strictEqual(user.profile.isAdmin, undefined, 'Unknown fields are dropped');

    // A Telegram re-login keeps the name chosen in the app
    await authService.findOrCreateTelegramUser(expertA_Tg, 'expert');
    const me = await fetch(baseUrl + '/api/me/profile', { headers: { Authorization: `Bearer ${tokenA}` } }).then(r => r.json());
    assert.strictEqual(me.user.displayName, 'Алексей Эксперт');

    assert.strictEqual(projectService.normalizeRoleTitle('помощник'), 'SI-помощник');
    assert.strictEqual(projectService.normalizeRoleTitle('si-менеджер'), 'SI-менеджер');
    assert.strictEqual(projectService.normalizeRoleTitle('SI-консультант'), 'SI-консультант');
  });

  await test('19. Миграции: блоки только для PostgreSQL (RLS) не выполняются в SQLite', async () => {
    const sql = 'CREATE TABLE a (id TEXT);\n-- postgres-only:begin\nALTER TABLE a ENABLE ROW LEVEL SECURITY;\n-- postgres-only:end\n';
    assert(!migrator.sqlForDriver(sql, 'sqlite').includes('ROW LEVEL SECURITY'));
    assert(migrator.sqlForDriver(sql, 'postgres').includes('ROW LEVEL SECURITY'));
  });

  // 12. Chats with SI-consultants, "Связаться с человеком", bot notifications, Marketplace
  const config = require('../server/config');
  const telegramBot = require('../server/services/telegram-bot');
  const chatService = require('../server/services/chat-service');
  const clientTg = { id: 300003, first_name: 'Клиент', last_name: 'Сергей', username: 'client_sergey' };
  const tokenClient = await tokenFor(clientTg);
  const clientUser = await authService.findOrCreateTelegramUser(clientTg, 'expert');
  const api = (method, url, token, body) => fetch(baseUrl + url, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  }).then(async r => ({ status: r.status, body: await r.json().catch(() => null) }));
  const projectA = (await projectService.getUserProjects(expertA_InternalId)).owned[0];

  await test('15. Чат с SI-консультантом: только после входа, каждый видит только свою переписку', async () => {
    assert.strictEqual((await api('POST', `/api/chat/${projectA.slug}/messages`, null, { text: 'Привет' })).status, 401);

    const sent = await api('POST', `/api/chat/${projectA.slug}/messages`, tokenClient, { text: 'Сколько стоит?' });
    assert.strictEqual(sent.status, 201);
    assert.strictEqual(sent.body.message.sender, 'client');
    assert.strictEqual(sent.body.reply.sender, 'ai', 'SI answers');
    assert.strictEqual(sent.body.source, 'fallback', 'Without an OpenAI key the reply is the honest fallback');

    const mine = await api('GET', `/api/chat/${projectA.slug}/messages`, tokenClient);
    assert.deepStrictEqual(mine.body.messages.map(m => m.sender), ['client', 'ai'], 'Messages in the right order');
    const other = await api('GET', `/api/chat/${projectA.slug}/messages`, tokenB);
    assert.strictEqual(other.body.messages.length, 0, 'Another person sees none of my messages');

    const list = await api('GET', '/api/chat', tokenClient);
    assert(list.body.chats.some(c => c.slug === projectA.slug), 'The chat appears in my chat list');
  });

  await test('20. OpenAI: SI получает оффер, правила и историю переписки', async () => {
    await projectService.updateProject(projectA.id, {
      offer: 'Разбор бизнеса за 60 минут',
      // Old auto-filled tariffs (never typed by the expert) must not reach the SI
      pricing_options: [{ id: 'p1', name: 'VIP Менторство', price: 200000 }]
    });
    const realFetch = global.fetch;
    const originalKey = config.openaiApiKey;
    let sentToOpenAI = null;
    config.openaiApiKey = 'sk-test-not-real';
    global.fetch = async (url, options) => {
      if (String(url).startsWith('https://api.openai.com/')) {
        sentToOpenAI = { url, headers: options.headers, body: JSON.parse(options.body) };
        return new Response(JSON.stringify({ choices: [{ message: { content: 'Разбор стоит 15 000 ₽.' } }] }), { status: 200 });
      }
      return realFetch(url, options);
    };
    try {
      const sent = await api('POST', `/api/chat/${projectA.slug}/messages`, tokenClient, { text: 'Что вы предлагаете?' });
      assert.strictEqual(sent.body.source, 'openai');
      assert.strictEqual(sent.body.reply.text, 'Разбор стоит 15 000 ₽.');
      const system = sentToOpenAI.body.messages[0].content;
      assert(system.includes('Разбор бизнеса за 60 минут'), 'The offer is given to the SI');
      assert(system.includes('Не выдумывай'), 'The SI is told not to invent facts');
      assert(!system.includes('VIP Менторство'), 'Auto-filled tariffs are not used');
      assert.strictEqual(sentToOpenAI.body.messages.at(-1).content, 'Что вы предлагаете?');
      assert(sentToOpenAI.body.messages.some(m => m.role === 'assistant'), 'Earlier replies are sent as context');
    } finally {
      global.fetch = realFetch;
      config.openaiApiKey = originalKey;
    }
  });

  await test('21. «Связаться с человеком»: эксперту пишет бот, SI молчит, ответ эксперта приходит клиенту', async () => {
    telegramBot.testOutbox.length = 0;
    const req = await api('POST', `/api/chat/${projectA.slug}/human`, tokenClient, { reason: 'Хочу обсудить договор' });
    assert.strictEqual(req.status, 201);
    assert.strictEqual(req.body.notified, true);
    const toExpert = telegramBot.testOutbox.find(m => m.userId === expertA_InternalId);
    assert(toExpert && toExpert.text.includes('Хочу обсудить договор'), 'The expert gets a Telegram message');
    assert.strictEqual(toExpert.chat_id, String(expertA_Tg.id));
    assert.strictEqual(toExpert.reply_markup.inline_keyboard[0][0].url, `https://t.me/smartflow_ai_support_bot/app?startapp=I_${projectA.id}`);

    const paused = await api('POST', `/api/chat/${projectA.slug}/messages`, tokenClient, { text: 'Вы тут?' });
    assert.strictEqual(paused.body.reply, null, 'SI is paused while the expert answers');

    const inquiries = await api('GET', `/api/projects/${projectA.id}/clients/inquiries/list`, tokenA);
    const inquiry = inquiries.body.find(i => i.id === req.body.inquiryId);
    assert.strictEqual(inquiry.status, 'waiting');
    const foreign = await api('GET', `/api/projects/${projectA.id}/clients/inquiries/list`, tokenB);
    assert.strictEqual(foreign.status, 403, 'Another expert cannot see these requests');

    const reply = await api('POST', `/api/projects/${projectA.id}/conversations/${inquiry.client_id}/messages`, tokenA, { text: 'Здравствуйте! Давайте созвонимся.' });
    assert.strictEqual(reply.status, 201);
    const toClient = telegramBot.testOutbox.find(m => m.userId === clientUser.id);
    assert(toClient, 'The client gets a Telegram message about the reply');
    assert.strictEqual(toClient.reply_markup.inline_keyboard[0][0].url, `https://t.me/smartflow_ai_support_bot/app?startapp=${projectA.slug}`);
    const after = await api('GET', `/api/projects/${projectA.id}/clients/inquiries/list`, tokenA);
    assert.strictEqual(after.body.find(i => i.id === inquiry.id).status, 'answered');
    const history = await api('GET', `/api/chat/${projectA.slug}/messages`, tokenClient);
    assert.strictEqual(history.body.messages.at(-1).sender, 'expert_human', 'The client sees the expert reply');

    await api('POST', `/api/projects/${projectA.id}/clients/${inquiry.client_id}/si`, tokenA, { enabled: true });
    const resumed = await api('POST', `/api/chat/${projectA.slug}/messages`, tokenClient, { text: 'Спасибо!' });
    assert(resumed.body.reply, 'SI answers again after the expert turns it on');
  });

  await test('22. Лимит сообщений SI на клиента', async () => {
    const settings = projectService.safeJsonParse((await db.get('SELECT custom_ai_settings FROM projects WHERE id = ?', [projectA.id])).custom_ai_settings);
    await projectService.updateProject(projectA.id, { custom_ai_settings: { ...settings, clientLimit: 1 } });
    const first = await api('POST', `/api/chat/${projectA.slug}/messages`, tokenB, { text: 'Вопрос 1' });
    assert(first.body.reply && first.body.reply.text !== chatService.LIMIT_TEXT);
    const second = await api('POST', `/api/chat/${projectA.slug}/messages`, tokenB, { text: 'Вопрос 2' });
    assert.strictEqual(second.body.reply.text, chatService.LIMIT_TEXT, 'Limit message once');
    const third = await api('POST', `/api/chat/${projectA.slug}/messages`, tokenB, { text: 'Вопрос 3' });
    assert.strictEqual(third.body.reply, null, 'Then the SI stays silent');
    await projectService.updateProject(projectA.id, { custom_ai_settings: settings });
  });

  await test('23. Маркетплейс: только включённые владельцем, у каждого своя ссылка на оплату', async () => {
    const before = await api('GET', '/api/marketplace');
    assert(!before.body.consultants.some(c => c.id === projectA.id), 'Not listed until the owner turns it on');
    assert(!before.body.consultants.some(c => c.slug === 'elena-mentor'), 'Demo rows never appear');

    const badLink = await api('PUT', `/api/projects/${projectA.id}`, tokenA, { payment_url: 'javascript:alert(1)' });
    assert.strictEqual(badLink.status, 400);
    const noOffer = await api('PUT', `/api/projects/${projectA.id}`, tokenA, { offer: '', is_listed: true });
    assert.strictEqual(noOffer.status, 400, 'An offer is required to be listed');
    const foreign = await api('PUT', `/api/projects/${projectA.id}`, tokenB, { is_listed: false });
    assert.strictEqual(foreign.status, 403);

    const ok = await api('PUT', `/api/projects/${projectA.id}`, tokenA, {
      offer: 'Разбор бизнеса за 60 минут', price_label: '15 000 ₽', payment_url: 'https://pay.example.com/alexey', is_listed: true
    });
    assert.strictEqual(ok.status, 200);
    const projectB = (await projectService.getUserProjects(expertB_InternalId)).owned[0];
    await api('PUT', `/api/projects/${projectB.id}`, tokenB, { offer: 'Другой оффер', payment_url: 'https://pay.example.com/boris', is_listed: true });

    const list = await api('GET', '/api/marketplace');
    const cardA = list.body.consultants.find(c => c.id === projectA.id);
    const cardB = list.body.consultants.find(c => c.id === projectB.id);
    assert.strictEqual(cardA.paymentUrl, 'https://pay.example.com/alexey');
    assert.strictEqual(cardB.paymentUrl, 'https://pay.example.com/boris', 'Each consultant has its own payment link');
    assert(cardA.stats.dialogs >= 2, 'Real number of dialogs');
    assert.strictEqual(cardA.custom_ai_settings, undefined, 'Instructions never leave the server');

    const profile = await api('GET', `/api/marketplace/profiles/${expertA_InternalId}`);
    assert.strictEqual(profile.status, 200);
    assert(profile.body.profile.consultants.some(c => c.id === projectA.id));
    assert(typeof profile.body.profile.trust === 'number');
  });

  await test('24. Жалобы и предложения SI-ассистенту сохраняются', async () => {
    const res = await api('POST', '/api/feedback', tokenClient, { text: 'Добавьте казахский язык' });
    assert.strictEqual(res.status, 201);
    const row = await db.get('SELECT * FROM feedback WHERE id = ?', [res.body.id]);
    assert.strictEqual(row.user_id, clientUser.id);
  });

  await new Promise(resolve => httpServer.close(resolve));

  console.log('\n------------------------------------------------------');
  console.log(`  TEST RESULTS: ${passed} PASSED, ${failed} FAILED (TOTAL: ${passed + failed})`);
  console.log('------------------------------------------------------\n');

  db.closeDatabase();
  // Cleanup test database
  if (fs.existsSync(TEST_DB_FILE)) {
    fs.unlinkSync(TEST_DB_FILE);
  }

  if (failed > 0) {
    process.exit(1);
  }
}

if (require.main === module) {
  runAllTests().catch(err => {
    console.error('Fatal test error:', err);
    process.exit(1);
  });
}

module.exports = { runAllTests };
