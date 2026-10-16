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
// Messages to clients go only 9:00–21:00 by their time: for clients without a time zone the tests
// pick one where it is midday now, so the suite does not depend on the hour it runs
process.env.DEFAULT_TZ_OFFSET_MINUTES = String(((12 - new Date().getUTCHours() + 36) % 24 - 12) * 60);

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
function createTelegramInitData(botToken, user, authDateOffsetSeconds = 0, startParam = null) {
  const authDate = Math.floor(Date.now() / 1000) + authDateOffsetSeconds;
  const params = {
    auth_date: String(authDate),
    query_id: 'AAHdF6IQAAAAAN0XohDhrOrc',
    user: JSON.stringify(user)
  };
  if (startParam) params.start_param = startParam;

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

    // Opening the consultant's link: the SI writes first, only once
    const start = await api('POST', `/api/chat/${projectA.slug}/start`, tokenClient);
    assert.strictEqual(start.status, 201);
    assert.strictEqual(start.body.opener.sender, 'ai', 'The SI starts the conversation');
    const again = await api('POST', `/api/chat/${projectA.slug}/start`, tokenClient);
    assert.strictEqual(again.body.opener, null, 'No second greeting');

    const sent = await api('POST', `/api/chat/${projectA.slug}/messages`, tokenClient, { text: 'Сколько стоит?' });
    assert.strictEqual(sent.status, 201);
    assert.strictEqual(sent.body.message.sender, 'client');
    assert.strictEqual(sent.body.reply.sender, 'ai', 'SI answers');
    assert.strictEqual(sent.body.source, 'fallback', 'Without an OpenAI key the reply is the honest fallback');

    const mine = await api('GET', `/api/chat/${projectA.slug}/messages`, tokenClient);
    assert.deepStrictEqual(mine.body.messages.map(m => m.sender), ['ai', 'client', 'ai'], 'Messages in the right order');
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
        const body = JSON.parse(options.body);
        // The funnel analysis of the same turn goes in a separate request (JSON answer)
        if (!body.response_format) sentToOpenAI = { url, headers: options.headers, body };
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

  // 13. SI-brain: materials (text only), access per consultant, search for the SI
  const brainService = require('../server/services/brain-service');
  const uploadMaterial = (token, body, query) => fetch(`${baseUrl}/api/brain/materials?${new URLSearchParams(query)}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/octet-stream' },
    body
  }).then(async r => ({ status: r.status, body: await r.json().catch(() => null) }));
  const priceText = 'Программа курса «Выход из операционки». Длительность — 8 недель, созвоны с куратором раз в неделю. ' +
    'Возврат денег возможен в течение 14 дней после старта.';
  let materialA = null;

  await test('25. SI-мозг: текст сохраняется, файл — нет; чужие консультанты и материалы недоступны', async () => {
    const projectB = (await projectService.getUserProjects(expertB_InternalId)).owned[0];
    const foreign = await uploadMaterial(tokenA, priceText, { name: 'курс.txt', consultants: projectB.id });
    assert.strictEqual(foreign.status, 403, 'Cannot give a material to another expert\'s consultant');

    const res = await uploadMaterial(tokenA, priceText, { name: 'курс.txt', consultants: projectA.id });
    assert.strictEqual(res.status, 201);
    materialA = res.body.material;
    assert.strictEqual(materialA.title, 'курс');
    assert.strictEqual(materialA.sourceType, 'txt');
    assert.deepStrictEqual(materialA.consultantIds, [projectA.id]);
    const columns = Object.keys(await db.get('SELECT * FROM brain_materials WHERE id = ?', [materialA.id]));
    assert(!columns.some(c => /data|file|blob/.test(c)), 'The file itself is not stored');

    assert.strictEqual((await uploadMaterial(tokenA, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 1, 2, 3]), { name: 'x.png' })).status, 400, 'Images are rejected');
    assert.strictEqual((await uploadMaterial(tokenA, '%PDF-1.4 broken', { name: 'x.pdf' })).status, 400, 'A broken PDF gets a clear error');
    assert.strictEqual((await uploadMaterial('bad-token', priceText, { name: 'a.txt' })).status, 401);

    const listB = await api('GET', '/api/brain/materials', tokenB);
    assert.strictEqual(listB.body.materials.length, 0, 'Expert B does not see Expert A materials');
    assert.strictEqual((await api('DELETE', `/api/brain/materials/${materialA.id}`, tokenB)).status, 404);
    assert.strictEqual((await api('PUT', `/api/brain/materials/${materialA.id}/consultants`, tokenB, { consultantIds: [] })).status, 404);
    const listA = await api('GET', '/api/brain/materials', tokenA);
    assert.strictEqual(listA.body.materials[0].id, materialA.id);
    assert(listA.body.materials[0].preview.startsWith('Программа курса'), 'A preview of the text is shown');
  });

  await test('26. SI-мозг: чтение PDF и Word, разбивка на части', async () => {
    const pdf = Buffer.from(
      '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
      '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 100]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\n' +
      '4 0 obj<</Length 60>>stream\nBT /F1 12 Tf 10 50 Td (Course lasts eight weeks, refund in 14 days) Tj ET\nendstream endobj\n' +
      '5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF');
    const fromPdf = await brainService.extractText(pdf, 'course.pdf');
    assert.strictEqual(fromPdf.sourceType, 'pdf');
    assert(fromPdf.text.includes('Course lasts eight weeks'), 'PDF text is read');

    const JSZip = require('jszip');
    const zip = new JSZip();
    zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
    zip.file('_rels/.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
    zip.file('word/document.xml', '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
      '<w:body><w:p><w:r><w:t>Стоимость курса — 25 000 рублей, оплата частями.</w:t></w:r></w:p></w:body></w:document>');
    const fromWord = await brainService.extractText(await zip.generateAsync({ type: 'nodebuffer' }), 'прайс.docx');
    assert.strictEqual(fromWord.sourceType, 'docx');
    assert(fromWord.text.includes('25 000 рублей'), 'Word text is read');

    await assert.rejects(brainService.extractText(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 1, 2, 3, 4]), 'old.doc'), /\.docx/);
    const pieces = brainService.chunkText('Предложение номер один. '.repeat(200));
    assert(pieces.length > 3 && pieces.every(p => p.length <= 1200), 'Long text is cut into pieces');
  });

  await test('27. SI-мозг: SI получает подходящие отрывки только своих материалов', async () => {
    // A big material so search (not "everything") is used; one piece mentions the refund
    const filler = Array.from({ length: 12 }, (_, i) => `Раздел ${i + 1}. Упражнения для команды и делегирование задач, планёрки и отчёты. `.repeat(8)).join('\n\n');
    const big = await uploadMaterial(tokenA, `${filler}\n\nВозврат: деньги вернём полностью в течение 14 дней, если курс не подошёл.`, { name: 'книга.txt', consultants: projectA.id });
    assert.strictEqual(big.status, 201);

    const realFetch = global.fetch;
    const originalKey = config.openaiApiKey;
    let systemPrompt = null;
    config.openaiApiKey = 'sk-test-not-real';
    global.fetch = async (url, options) => {
      if (String(url) === 'https://api.openai.com/v1/embeddings') return new Response('{"error":{"message":"no balance"}}', { status: 429 });
      if (String(url).startsWith('https://api.openai.com/')) {
        const body = JSON.parse(options.body);
        if (!body.response_format) systemPrompt = body.messages[0].content; // not the funnel analysis
        return new Response(JSON.stringify({ choices: [{ message: { content: 'Да, вернём в течение 14 дней.' } }] }), { status: 200 });
      }
      return realFetch(url, options);
    };
    try {
      const sent = await api('POST', `/api/chat/${projectA.slug}/messages`, tokenClient, { text: 'А если не подойдёт, вернёте деньги?' });
      assert.strictEqual(sent.body.source, 'openai');
      assert(systemPrompt.includes('деньги вернём полностью'), 'The matching piece reaches the SI (word search without OpenAI embeddings)');
      assert(systemPrompt.includes('не выдавай материалы целиком'), 'The SI is told not to give away the materials');

      // Taken away from this consultant → the SI no longer gets it
      await api('PUT', `/api/brain/materials/${big.body.material.id}/consultants`, tokenA, { consultantIds: [] });
      await api('PUT', `/api/brain/materials/${materialA.id}/consultants`, tokenA, { consultantIds: [] });
      await api('POST', `/api/chat/${projectA.slug}/messages`, tokenClient, { text: 'Так вернёте деньги?' });
      assert(!systemPrompt.includes('деньги вернём полностью') && !systemPrompt.includes('Материалы эксперта'), 'Materials not given to this SI are not used');
    } finally {
      global.fetch = realFetch;
      config.openaiApiKey = originalKey;
    }

    // Deleting removes the text completely
    assert.strictEqual((await api('DELETE', `/api/brain/materials/${big.body.material.id}`, tokenA)).status, 200);
    const left = await db.get('SELECT COUNT(*) AS count FROM brain_chunks WHERE material_id = ?', [big.body.material.id]);
    assert.strictEqual(left.count, 0, 'The pieces of a deleted material are gone');
  });

  // 14. Support: user numbers, error codes, complaints with details, the support panel and fixes
  const supportService = require('../server/services/support-service');
  const errorHandler = require('../server/middleware/error-handler');
  const ownerTg = { id: 400004, first_name: 'Владелица', username: 'owner_sf' };
  const studentTg = { id: 500005, first_name: 'Студент', username: 'student_sf' };
  const tokenOwner = await tokenFor(ownerTg);
  const tokenStudent = await tokenFor(studentTg);
  const ownerUser = await authService.findOrCreateTelegramUser(ownerTg, 'expert');
  const studentUser = await authService.findOrCreateTelegramUser(studentTg, 'expert');

  await test('28. Короткий номер пользователя: выдаётся при входе, у всех разный, ищется однозначно', async () => {
    const me = await api('GET', '/api/auth/me', tokenClient);
    assert.match(me.body.user.supportCode, /^SF-\d{5}$/);
    const again = await api('GET', '/api/auth/me', tokenClient);
    assert.strictEqual(again.body.user.supportCode, me.body.user.supportCode, 'The number does not change');
    await db.run('UPDATE users SET support_code = NULL WHERE id = ?', [expertB_InternalId]);
    assert(await supportService.backfillSupportCodes() >= 1, 'People without a number get one');
    const codes = (await db.all('SELECT support_code FROM users WHERE support_code IS NOT NULL')).map(r => r.support_code);
    assert.strictEqual(new Set(codes).size, codes.length, 'Numbers are unique');
    assert.strictEqual(supportService.normalizeSupportCode('sf 48213'), 'SF-48213');
    const pub = await api('GET', `/api/marketplace/profiles/${clientUser.id}`);
    assert(!JSON.stringify(pub.body || {}).includes('SF-'), 'The number is not shown in public profiles');
  });

  await test('29. Код ошибки: на экране, в логе и в базе с номером человека, без личных данных', async () => {
    let body = null;
    let status = null;
    const res = { headersSent: false, status(s) { status = s; return this; }, json(b) { body = b; return this; } };
    await errorHandler(new Error('db is down'), { method: 'POST', originalUrl: '/api/chat/x/messages?secret=1', user: { userId: clientUser.id } }, res, () => {});
    assert.strictEqual(status, 500);
    assert.match(body.errorCode, /^[A-Z2-9]{4}$/);
    const row = await db.get('SELECT * FROM error_log WHERE code = ?', [body.errorCode]);
    assert.strictEqual(row.user_id, clientUser.id);
    assert.strictEqual(row.path, '/api/chat/x/messages', 'Query string (may hold secrets) is not logged');

    const client = await api('POST', '/api/support/errors', tokenClient, { code: 'k7p2', message: 'render chats/list: TypeError', route: 'chats / list' });
    assert.strictEqual(client.status, 201);
    assert.strictEqual(client.body.code, 'K7P2');
    const saved = await db.get(`SELECT * FROM error_log WHERE code = 'K7P2' AND source = 'client'`);
    assert.strictEqual(saved.user_id, clientUser.id);
  });

  let feedbackId = null;
  await test('30. Жалоба: прикладываются телефон, экран и коды ошибок; команде пишет бот с кнопкой «Открыть»', async () => {
    const before = telegramBot.testOutbox.length;
    config.adminUsers = [ownerTg.id.toString()];
    const res = await api('POST', '/api/feedback', tokenClient, {
      text: 'SI не отвечает',
      context: { platform: 'ios', tgVersion: '8.0', route: 'chats / chat / x', botCanWrite: true, secretField: 'dropped',
        recentErrors: [{ code: 'K7P2', status: 500, path: '/api/chat/x/messages', message: 'Ошибка' }] }
    });
    assert.strictEqual(res.status, 201);
    feedbackId = res.body.id;
    const row = await db.get('SELECT * FROM feedback WHERE id = ?', [feedbackId]);
    const ctx = JSON.parse(row.context);
    assert.strictEqual(ctx.platform, 'ios');
    assert.strictEqual(ctx.recentErrors[0].code, 'K7P2');
    assert.strictEqual(ctx.secretField, undefined, 'Unknown fields are dropped');
    const toOwner = telegramBot.testOutbox.slice(before).find(m => m.userId === ownerUser.id);
    assert(toOwner, 'The owner gets a bot message about the complaint');
    assert(toOwner.text.includes('SI не отвечает') && toOwner.text.includes('K7P2'));
    assert(toOwner.reply_markup.inline_keyboard[0][0].url.endsWith(`startapp=A_${feedbackId}`), 'Button opens the complaint');
  });

  await test('31. Панель поддержки: только команда; владелица добавляет студента по номеру', async () => {
    assert.strictEqual((await api('GET', '/api/admin/overview', tokenClient)).status, 403, 'Clients have no access');
    assert.strictEqual((await api('GET', '/api/admin/overview', tokenStudent)).status, 403, 'Not in the team yet');
    const overview = await api('GET', '/api/admin/overview', tokenOwner);
    assert.strictEqual(overview.status, 200);
    assert.strictEqual(overview.body.me.role, 'owner');
    assert(overview.body.feedback.new >= 1);
    assert.strictEqual((await api('GET', '/api/auth/me', tokenOwner)).body.user.staffRole, 'owner');

    const studentCode = (await api('GET', '/api/auth/me', tokenStudent)).body.user.supportCode;
    assert.strictEqual((await api('POST', '/api/admin/staff', tokenOwner, { supportCode: 'SF-00000' })).status, 404);
    assert.strictEqual((await api('POST', '/api/admin/staff', tokenOwner, { supportCode: studentCode.toLowerCase() })).status, 201);
    assert.strictEqual((await api('GET', '/api/admin/overview', tokenStudent)).body.me.role, 'support');
    assert.strictEqual((await api('GET', '/api/admin/staff', tokenStudent)).status, 403, 'Only the owner manages the team');

    const clientCode = (await api('GET', '/api/auth/me', tokenClient)).body.user.supportCode;
    const found = await api('GET', `/api/admin/users?q=${encodeURIComponent(clientCode)}`, tokenStudent);
    assert.strictEqual(found.body.users.length, 1);
    assert.strictEqual(found.body.users[0].id, clientUser.id);
    assert.strictEqual((await api('GET', '/api/admin/users?q=%40client_serg', tokenStudent)).body.users[0].id, clientUser.id, 'Search by @username');

    const card = await api('GET', `/api/admin/users/${clientUser.id}`, tokenStudent);
    assert.strictEqual(card.status, 200);
    assert(card.body.feedback.some(f => f.id === feedbackId));
    assert(card.body.errors.some(e => e.code === 'K7P2'));
    assert(card.body.chatsAsClient.length >= 1, 'The person\'s chats are listed');

    const byCode = await api('GET', '/api/admin/errors?code=k7p2', tokenStudent);
    assert(byCode.body.errors.length >= 1 && byCode.body.errors[0].user.id === clientUser.id, 'An error code leads to the person');

    const reply = await api('POST', `/api/admin/feedback/${feedbackId}/reply`, tokenStudent, { text: 'Починили, откройте чат заново', close: true });
    assert.strictEqual(reply.body.feedback.status, 'done');
    const mine = await api('GET', '/api/feedback/mine', tokenClient);
    assert.strictEqual(mine.body.feedback.find(f => f.id === feedbackId).reply, 'Починили, откройте чат заново', 'The answer is in the person\'s support chat');
    assert(telegramBot.testOutbox.some(m => m.userId === clientUser.id && m.text.includes('Починили')), 'The bot sends the answer');
  });

  await test('32. Исправления: «было → станет», только у этого человека, стоп при другом числе записей', async () => {
    await api('POST', `/api/chat/${projectA.slug}/human`, tokenClient, { reason: 'Позовите человека' });
    const chat = (await api('GET', `/api/admin/users/${clientUser.id}`, tokenStudent)).body.chatsAsClient.find(c => c.slug === projectA.slug);
    assert.strictEqual(chat.siPaused, true);

    // Another person's chat cannot be changed from this person's card
    const foreign = await api('POST', `/api/admin/users/${expertB_InternalId}/fixes/resume_si/preview`, tokenStudent, { params: { clientId: chat.clientId } });
    assert.strictEqual(foreign.status, 404);

    const url = `/api/admin/users/${clientUser.id}/fixes/resume_si`;
    const preview = await api('POST', `${url}/preview`, tokenStudent, { params: { clientId: chat.clientId } });
    assert.strictEqual(preview.body.preview.count, 1);
    assert.strictEqual(preview.body.preview.changes[0].after, 'отвечает');
    const wrong = await api('POST', `${url}/apply`, tokenStudent, { params: { clientId: chat.clientId }, expectedCount: 300 });
    assert.strictEqual(wrong.status, 409, 'Different number of records → stop');
    assert.strictEqual((await db.get('SELECT responsible_type FROM clients WHERE id = ?', [chat.clientId])).responsible_type, 'human', 'Nothing changed');
    const applied = await api('POST', `${url}/apply`, tokenStudent, { params: { clientId: chat.clientId }, expectedCount: 1 });
    assert.strictEqual(applied.status, 200);
    assert.strictEqual((await db.get('SELECT responsible_type FROM clients WHERE id = ?', [chat.clientId])).responsible_type, 'si');
    assert.strictEqual((await api('POST', `${url}/apply`, tokenStudent, { params: { clientId: chat.clientId }, expectedCount: 1 })).status, 409, 'Nothing to change twice');

    const reset = await api('POST', `/api/admin/users/${clientUser.id}/fixes/reset_device/apply`, tokenStudent, { expectedCount: 1 });
    assert.strictEqual(reset.status, 200);
    assert((await api('GET', '/api/auth/me', tokenClient)).body.user.clientResetAt, 'The app learns it must clear its cache');

    const log = await api('GET', '/api/admin/actions', tokenOwner);
    const entry = log.body.actions.find(a => a.action === 'fix:resume_si');
    assert(entry && entry.targetUserId === clientUser.id && entry.details.changes[0].before.includes('молчит'), 'Every fix is in the team log');

    const viewed = await api('GET', `/api/admin/users/${clientUser.id}/chats/${chat.clientId}`, tokenStudent);
    assert(viewed.body.messages.length > 0);
    assert((await db.get(`SELECT COUNT(*) AS count FROM admin_actions WHERE action = 'view_chat'`)).count >= 1, 'Reading a chat is logged');
  });

  await test('33. Блокировка: только владелица; заблокированный не может пользоваться приложением', async () => {
    const url = `/api/admin/users/${clientUser.id}/fixes/block_user`;
    assert.strictEqual((await api('POST', `${url}/preview`, tokenStudent, { params: { blocked: true } })).status, 403, 'Support cannot block');
    assert.strictEqual((await api('POST', `/api/admin/users/${studentUser.id}/fixes/block_user/apply`, tokenOwner, { params: { blocked: true }, expectedCount: 1 })).status, 409, 'A team member cannot be blocked');
    assert.strictEqual((await api('POST', `${url}/apply`, tokenOwner, { params: { blocked: true }, expectedCount: 1 })).status, 200);
    const blocked = await api('GET', '/api/chat', tokenClient);
    assert.strictEqual(blocked.status, 403);
    assert.strictEqual(blocked.body.code, 'USER_BLOCKED');
    const login = await fetch(`${baseUrl}/api/auth/telegram`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ initData: createTelegramInitData(process.env.TELEGRAM_BOT_TOKEN, clientTg) })
    });
    assert.strictEqual(login.status, 403, 'A blocked person cannot sign in');
    assert.strictEqual((await api('POST', `${url}/apply`, tokenOwner, { params: { blocked: false }, expectedCount: 1 })).status, 200);
    assert.strictEqual((await api('GET', '/api/chat', tokenClient)).status, 200, 'Unblocked again');
    config.adminUsers = [];
  });

  // 13. Business and one assistant
  const businessService = require('../server/services/business-service');
  const funnelService = require('../server/services/funnel-service');
  const assistantTg = { id: 400004, first_name: 'Анна', last_name: 'Помощник', username: 'anna_helper' };
  const tokenAssistant = await tokenFor(assistantTg);
  const assistantUser = await authService.findOrCreateTelegramUser(assistantTg, 'expert');
  const otherTg = { id: 500005, first_name: 'Олег', last_name: 'Второй', username: 'oleg_second' };
  const tokenOther = await tokenFor(otherTg);

  await test('35. Бизнес: появляется с включённым SI-продавцом, туда переносятся SI-продавцы, клиенты и переписки', async () => {
    const business = await db.get('SELECT * FROM businesses WHERE owner_id = ?', [expertA_InternalId]);
    assert(business, 'Expert A has a business: their SI-seller talks to clients');
    assert.strictEqual((await db.get('SELECT business_id FROM projects WHERE id = ?', [projectA.id])).business_id, business.id);
    const orphans = await db.get(
      `SELECT (SELECT COUNT(*) FROM clients WHERE project_id = ? AND (business_id IS NULL OR business_id <> ?)) +
              (SELECT COUNT(*) FROM conversations WHERE project_id = ? AND (business_id IS NULL OR business_id <> ?)) AS count`,
      [projectA.id, business.id, projectA.id, business.id]
    );
    assert.strictEqual(orphans.count, 0, 'All clients and messages of the SI-seller are in the business');
    const owner = await db.get('SELECT role FROM business_members WHERE business_id = ? AND user_id = ?', [business.id, expertA_InternalId]);
    assert.strictEqual(owner.role, 'owner');

    // Signing in does not create a business; creating an SI-seller in the Office does
    assert.strictEqual(await db.get('SELECT id FROM businesses WHERE owner_id = ?', [assistantUser.id]), null);
    const ownView = await api('GET', '/api/business', tokenAssistant);
    assert.strictEqual(ownView.body.business, null);
    const created = await api('POST', '/api/projects', tokenOther, { name: 'Oleg SI' });
    assert.strictEqual(created.status, 201);
    assert(created.body.business_id, 'The new SI-seller belongs to its owner\'s business');
    assert.strictEqual(Number((await db.get('SELECT COUNT(*) AS count FROM businesses WHERE owner_id = ?', [created.body.owner_id])).count), 1);
    await api('POST', '/api/projects', tokenOther, { name: 'Oleg SI 2' });
    assert.strictEqual(Number((await db.get('SELECT COUNT(*) AS count FROM businesses WHERE owner_id = ?', [created.body.owner_id])).count), 1, 'One business per expert');
  });

  await test('36. Помощник: владелец приглашает по номеру SF-…, не больше одного', async () => {
    const assistantCode = (await api('GET', '/api/auth/me', tokenAssistant)).body.user.supportCode;
    const otherCode = (await api('GET', '/api/auth/me', tokenOther)).body.user.supportCode;
    assert.strictEqual((await api('POST', '/api/business/assistants', tokenAssistant, { supportCode: otherCode })).status, 400, 'No business — nobody to invite into');
    assert.strictEqual((await api('POST', '/api/business/assistants', tokenA, { supportCode: 'SF-00000' })).status, 404);
    const ownCode = (await api('GET', '/api/auth/me', tokenA)).body.user.supportCode;
    assert.strictEqual((await api('POST', '/api/business/assistants', tokenA, { supportCode: ownCode })).status, 400, 'Not yourself');

    telegramBot.testOutbox.length = 0;
    const added = await api('POST', '/api/business/assistants', tokenA, { supportCode: assistantCode.toLowerCase() });
    assert.strictEqual(added.status, 201);
    assert(added.body.members.some(m => m.userId === assistantUser.id && m.role === 'assistant'));
    assert(telegramBot.testOutbox.some(m => m.userId === assistantUser.id), 'The assistant gets a bot message');

    const second = await api('POST', '/api/business/assistants', tokenA, { supportCode: otherCode });
    assert.strictEqual(second.status, 409);
    assert.strictEqual(second.body.code, 'ASSISTANT_LIMIT', 'Only one assistant');
    assert.strictEqual(businessService.MAX_ASSISTANTS, 1);
    assert.strictEqual((await api('POST', '/api/business/assistants', tokenA, { supportCode: assistantCode })).status, 409, 'Already the assistant');

    const view = await api('GET', '/api/business', tokenAssistant);
    assert.strictEqual(view.body.assisting.length, 1);
    assert.strictEqual(view.body.assisting[0].ownerName, (await api('GET', '/api/auth/me', tokenA)).body.user.displayName);
  });

  await test('37. Права помощника проверяет сервер: клиенты и пауза SI — да, деньги, SI-мозг и настройки — нет', async () => {
    const list = await api('GET', '/api/projects', tokenAssistant);
    const assisted = list.body.assisting.find(p => p.id === projectA.id);
    assert(assisted, 'The assistant sees the business\'s SI-sellers');
    for (const hidden of ['payment_url', 'price_label', 'offer', 'custom_ai_settings', 'pricing_options', 'stats']) {
      assert(!(hidden in assisted), `No ${hidden} for the assistant`);
    }
    assert(!list.body.owned.some(p => p.id === projectA.id));

    const clients = await api('GET', `/api/projects/${projectA.id}/clients`, tokenAssistant);
    assert.strictEqual(clients.status, 200, 'Client cards are visible');
    assert(clients.body.length > 0 && clients.body.every(c => !('deal_value' in c)), 'No money in client cards');
    const card = await api('GET', `/api/projects/${projectA.id}/clients/${clients.body[0].id}`, tokenAssistant);
    assert.strictEqual(card.status, 200);
    assert(Array.isArray(card.body.events), 'The card shows the event journal');
    assert.strictEqual((await api('GET', `/api/projects/${projectA.id}/clients/inquiries/list`, tokenAssistant)).status, 200, '"Мне написали" is open');

    assert.strictEqual((await api('GET', `/api/projects/${projectA.id}`, tokenAssistant)).status, 403, 'No SI-seller settings and payment link');
    assert.strictEqual((await api('PUT', `/api/projects/${projectA.id}`, tokenAssistant, { payment_url: 'https://evil.example' })).status, 403, 'Cannot edit the SI-seller');
    assert.strictEqual((await api('GET', `/api/projects/${projectA.id}/analytics`, tokenAssistant)).status, 403);
    assert.strictEqual((await upload(`/api/projects/${projectA.id}/photo`, tokenAssistant, fakeJpeg)).status, 403);
    assert.strictEqual((await api('POST', '/api/business/assistants', tokenAssistant, { supportCode: 'SF-12345' })).status, 400, 'Cannot invite into someone else\'s business');
    const materialsA = (await api('GET', '/api/brain/materials', tokenA)).body.materials;
    const materialsAssistant = (await api('GET', '/api/brain/materials', tokenAssistant)).body.materials;
    assert(materialsA.length > 0 && materialsAssistant.length === 0, 'The owner\'s SI-brain is not visible');
    if (materialsA.length) {
      const del = await api('DELETE', `/api/brain/materials/${materialsA[0].id}`, tokenAssistant);
      assert.strictEqual(del.status, 404, 'Cannot change the owner\'s SI-brain');
    }
    assert.strictEqual((await api('GET', `/api/projects/${projectA.id}/clients`, tokenOther)).status, 403, 'Strangers still have no access');
  });

  await test('38. Автор сообщения, ответственный за диалог, пауза SI и журнал событий', async () => {
    telegramBot.testOutbox.length = 0;
    const human = await api('POST', `/api/chat/${projectA.slug}/human`, tokenClient, { reason: 'Нужен человек' });
    assert.strictEqual(human.status, 201);
    assert(telegramBot.testOutbox.some(m => m.userId === assistantUser.id && m.text.includes('Нужен человек')), 'The assistant is notified too');
    const lead = await db.get('SELECT * FROM clients WHERE project_id = ? AND external_client_id = ?', [projectA.id, clientUser.id]);
    assert.strictEqual(lead.responsible_type, 'human');
    assert.strictEqual(lead.responsible_user_id, expertA_InternalId, 'The owner is responsible by default');
    assert.strictEqual(lead.funnel_status, 'waiting_human');

    const reply = await api('POST', `/api/projects/${projectA.id}/conversations/${lead.id}/messages`, tokenAssistant, { text: 'Здравствуйте, я помощник.' });
    assert.strictEqual(reply.status, 201);
    assert.strictEqual(reply.body.authorType, 'assistant');
    assert.strictEqual(reply.body.authorUserId, assistantUser.id);
    const after = await db.get('SELECT * FROM clients WHERE id = ?', [lead.id]);
    assert.strictEqual(after.responsible_user_id, assistantUser.id, 'The assistant who answered is responsible now');
    assert.notStrictEqual(after.funnel_status, 'waiting_human');
    assert(telegramBot.testOutbox.some(m => m.userId === clientUser.id && m.text.includes('Помощник')), 'The client learns it was the assistant');

    const silent = await api('POST', `/api/chat/${projectA.slug}/messages`, tokenClient, { text: 'А когда созвон?' });
    assert.strictEqual(silent.body.reply, null, 'SI is quiet while a person is responsible');
    assert.strictEqual((await api('GET', `/api/chat/${projectA.slug}/messages`, tokenClient)).body.siPaused, true);

    const resumed = await api('POST', `/api/projects/${projectA.id}/clients/${lead.id}/si`, tokenAssistant, { enabled: true });
    assert.strictEqual(resumed.status, 200, 'The assistant can resume the SI');
    assert.strictEqual((await db.get('SELECT responsible_type FROM clients WHERE id = ?', [lead.id])).responsible_type, 'si');
    const answered = await api('POST', `/api/chat/${projectA.slug}/messages`, tokenClient, { text: 'Хорошо' });
    assert(answered.body.reply && answered.body.reply.authorType === 'si', 'SI answers again');
    assert.strictEqual((await api('POST', `/api/projects/${projectA.id}/clients/${lead.id}/si`, tokenAssistant, { enabled: false })).status, 200, 'And pause it');
    assert.strictEqual((await db.get('SELECT responsible_user_id FROM clients WHERE id = ?', [lead.id])).responsible_user_id, assistantUser.id);

    const authors = await db.all('SELECT DISTINCT author_type FROM conversations WHERE client_id = ?', [lead.id]);
    assert.deepStrictEqual(authors.map(a => a.author_type).sort(), ['assistant', 'client', 'owner', 'si'], 'Every message has its author type');
    assert.strictEqual(Number((await db.get('SELECT COUNT(*) AS count FROM conversations WHERE author_type IS NULL')).count), 0);

    const events = (await db.all('SELECT type FROM client_events WHERE client_id = ?', [lead.id])).map(e => e.type);
    for (const type of ['client_message', 'handed_to_human', 'human_replied', 'si_resumed', 'si_paused']) {
      assert(events.includes(type), `Journal has ${type}`);
    }
    const funnel = await api('GET', `/api/business/funnel?businessId=${lead.business_id}`, tokenAssistant);
    assert.strictEqual(funnel.status, 200);
    assert.deepStrictEqual(Object.keys(funnel.body.counts), ['not_finished', 'objections', 'waiting_human', 'bought', 'refused']);
    assert.strictEqual((await api('GET', `/api/business/funnel?businessId=${lead.business_id}`, tokenOther)).status, 404, 'Strangers see no funnel');
    const page = await api('GET', '/api/business/funnel?status=not_finished', tokenA);
    assert(page.body.clients.length <= funnelService.PAGE_SIZE);
  });

  await test('39. Воронка: цель-оффер — не дошли до конца / есть возражения, исходы купили и отказ', async () => {
    const next = funnelService.nextStatus;
    assert.strictEqual(next({ funnel_status: 'not_finished' }, 'client_message'), 'not_finished', 'No answer to the offer — the path goes on');
    assert.strictEqual(next({ funnel_status: 'not_finished' }, 'offer_answered'), 'objections', 'Answered the offer but has not bought');
    assert.strictEqual(next({ funnel_status: 'not_finished' }, 'objection'), 'objections', 'An objection');
    assert.strictEqual(next({ funnel_status: 'objections', offer_answered_at: 'x' }, 'client_message'), 'objections');
    assert.strictEqual(next({ funnel_status: 'objections', offer_answered_at: 'x' }, 'paid'), 'bought');
    assert.strictEqual(next({ funnel_status: 'objections', offer_answered_at: 'x' }, 'refused'), 'refused');
    assert.strictEqual(next({ funnel_status: 'bought' }, 'client_message'), 'bought', 'Outcome stays');
    assert.strictEqual(next({ funnel_status: 'refused', objection_at: 'x' }, 'reopened'), 'objections', 'Back into the funnel');
    assert.strictEqual(next({ funnel_status: 'bought' }, 'reopened'), 'not_finished');
    assert.strictEqual(next({ funnel_status: 'not_finished' }, 'handed_to_human'), 'waiting_human');
    assert.strictEqual(next({ funnel_status: 'waiting_human' }, 'client_message'), 'waiting_human');
    assert.strictEqual(next({ funnel_status: 'waiting_human', offer_answered_at: 'x' }, 'human_replied'), 'objections');
    assert.strictEqual(funnelService.STATUSES.not_finished, 'Не дошли до конца воронки');
    assert.strictEqual(funnelService.STATUSES.objections, 'Есть возражения');

    const lead = await db.get('SELECT * FROM clients WHERE project_id = ? AND external_client_id = ?', [projectA.id, clientUser.id]);
    await db.run(`UPDATE clients SET funnel_status = 'not_finished', offer_answered_at = NULL WHERE id = ?`, [lead.id]);
    const fresh = await db.get('SELECT * FROM clients WHERE id = ?', [lead.id]);
    assert.strictEqual(await funnelService.recordEvent(fresh, 'offer_answered', { type: 'client' }), 'objections');
    const saved = await db.get('SELECT funnel_status, offer_answered_at FROM clients WHERE id = ?', [lead.id]);
    assert.strictEqual(saved.funnel_status, 'objections');
    assert(saved.offer_answered_at, 'The moment of the answer is kept');
  });

  await test('42. Сценарии «если…, то…» в методологии; SI отмечает оффер, возражения и отказ; итог отмечают люди', async () => {
    // Scenarios are saved inside the methodology; unknown conditions and actions are dropped
    const put = await api('PUT', `/api/projects/${projectA.id}`, tokenA, {
      custom_ai_settings: {
        ...projectService.safeJsonParse((await db.get('SELECT custom_ai_settings FROM projects WHERE id = ?', [projectA.id])).custom_ai_settings),
        scenarios: [
          { when: 'objection', words: 'дорого, нет денег', then: 'si_says', text: 'Мягко расскажи про рассрочку на 3 месяца' },
          { when: 'objection', words: 'дорого', then: 'notify', text: 'Можно дать скидку' },
          { when: 'refused', then: 'handover', text: '' },
          { when: 'hack', then: 'delete_everything' },
          { when: 'objection', then: 'si_says', text: '' }
        ],
        methodology: 'Сначала узнай цель клиента, потом расскажи про разбор. ' + 'x'.repeat(4000)
      }
    });
    assert.strictEqual(put.status, 200);
    const scenarios = put.body.custom_ai_settings.scenarios;
    assert.strictEqual(scenarios.length, 3, 'Only valid scenarios are kept');
    assert(scenarios.every(sc => /^scn_/.test(sc.id)));
    assert.strictEqual((await api('PUT', `/api/projects/${projectA.id}`, tokenAssistant, { custom_ai_settings: { scenarios: [] } })).status, 403, 'The assistant cannot change the methodology');

    const lead = await db.get('SELECT * FROM clients WHERE project_id = ? AND external_client_id = ?', [projectA.id, clientUser.id]);
    await api('POST', `/api/projects/${projectA.id}/clients/${lead.id}/si`, tokenA, { enabled: true });
    await db.run(`UPDATE clients SET funnel_status = 'not_finished', offer_answered_at = NULL, objection_at = NULL, last_objection = NULL WHERE id = ?`, [lead.id]);
    await db.run(`DELETE FROM client_events WHERE client_id = ? AND type IN ('offer_sent', 'objection', 'scenario')`, [lead.id]);

    const realFetch = global.fetch;
    const originalKey = config.openaiApiKey;
    config.openaiApiKey = 'sk-test-not-real';
    let analysis = { offer_made: true, offer_answered: true, objection: 'дорого', refused: false };
    let system = '';
    global.fetch = async (url, options) => {
      if (String(url).startsWith('https://api.openai.com/')) {
        const body = JSON.parse(options.body);
        if (body.response_format) {
          return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(analysis) } }] }), { status: 200 });
        }
        system = body.messages[0].content;
        return new Response(JSON.stringify({ choices: [{ message: { content: 'Понимаю вас. Есть рассрочка.' } }] }), { status: 200 });
      }
      return realFetch(url, options);
    };
    try {
      telegramBot.testOutbox.length = 0;
      const sent = await api('POST', `/api/chat/${projectA.slug}/messages`, tokenClient, { text: 'Звучит интересно, но для меня это дорого' });
      assert.strictEqual(sent.status, 201);
      assert(system.includes('Мягко расскажи про рассрочку на 3 месяца'), 'The SI follows the "SI отвечает так" scenario');
      assert(system.includes('Методология эксперта') && system.includes('Сначала узнай цель клиента'), 'The general description goes to the SI');
      assert.strictEqual(put.body.custom_ai_settings.methodology.length, 3000, 'The description is limited to 3000 characters');
      assert(system.includes('«дорого»'), 'With the objection words');
      let row = await db.get('SELECT * FROM clients WHERE id = ?', [lead.id]);
      assert.strictEqual(row.funnel_status, 'objections');
      assert.strictEqual(row.last_objection, 'дорого');
      let types = (await db.all('SELECT type FROM client_events WHERE client_id = ?', [lead.id])).map(e => e.type);
      for (const type of ['offer_sent', 'offer_answered', 'objection', 'scenario']) assert(types.includes(type), `Journal has ${type}`);
      assert(telegramBot.testOutbox.some(m => m.userId === expertA_InternalId && m.text.includes('Клиент возразил') && m.text.includes('Можно дать скидку')), 'The owner is told by the bot');

      telegramBot.testOutbox.length = 0;
      await api('POST', `/api/chat/${projectA.slug}/messages`, tokenClient, { text: 'Всё же дорого' });
      assert(!telegramBot.testOutbox.some(m => m.text.includes('Клиент возразил')), 'A scenario fires once per client');
      assert.strictEqual(Number((await db.get(`SELECT COUNT(*) AS count FROM client_events WHERE client_id = ? AND type = 'offer_sent'`, [lead.id])).count), 1, 'The offer is noted once');

      analysis = { offer_made: false, offer_answered: false, objection: '', refused: true };
      await api('POST', `/api/chat/${projectA.slug}/messages`, tokenClient, { text: 'Нет, спасибо, не буду' });
      row = await db.get('SELECT * FROM clients WHERE id = ?', [lead.id]);
      assert.strictEqual(row.funnel_status, 'refused');
      assert.strictEqual(row.responsible_type, 'human', '"Передать человеку" pauses the SI');
      assert(await db.get(`SELECT id FROM direct_inquiries WHERE client_id = ? AND status = 'waiting' AND reason LIKE 'Сценарий:%'`, [lead.id]), 'A request appears in "Мне написали"');

      // A broken analysis answer never breaks the chat
      analysis = 'not json';
      await api('POST', `/api/projects/${projectA.id}/clients/${lead.id}/si`, tokenA, { enabled: true });
      const ok = await api('POST', `/api/chat/${projectA.slug}/messages`, tokenClient, { text: 'Ещё вопрос' });
      assert.strictEqual(ok.status, 201);
      assert(ok.body.reply);
    } finally {
      global.fetch = realFetch;
      config.openaiApiKey = originalKey;
    }

    // "Купить" in the chat goes to the journal
    assert.strictEqual((await api('POST', `/api/chat/${projectA.slug}/events`, tokenClient, { type: 'buy_clicked' })).body.recorded, true);
    assert.strictEqual((await api('POST', `/api/chat/${projectA.slug}/events`, tokenClient, { type: 'paid' })).status, 400, 'The client cannot mark a payment');

    // People of the business mark the outcome
    const back = await api('POST', `/api/projects/${projectA.id}/clients/${lead.id}/funnel`, tokenAssistant, { outcome: 'reopened' });
    assert.strictEqual(back.status, 200);
    assert.strictEqual(back.body.funnelStatus, 'objections');
    const paid = await api('POST', `/api/projects/${projectA.id}/clients/${lead.id}/funnel`, tokenA, { outcome: 'paid' });
    assert.strictEqual(paid.body.funnelStatus, 'bought');
    assert.strictEqual(paid.body.funnelLabel, 'Купили');
    assert.strictEqual((await api('POST', `/api/projects/${projectA.id}/clients/${lead.id}/funnel`, tokenA, { outcome: 'magic' })).status, 400);
    assert.strictEqual((await api('POST', `/api/projects/${projectA.id}/clients/${lead.id}/funnel`, tokenOther, { outcome: 'refused' })).status, 403);

    const card = await api('GET', `/api/projects/${projectA.id}/clients/${lead.id}`, tokenA);
    const objection = card.body.events.find(e => e.type === 'objection');
    assert(objection && objection.detail === 'дорого', 'The journal shows the objection');
    assert(card.body.events.some(e => e.type === 'buy_clicked'));

    // Funnel screen: counts for 7 / 30 days and the list of one status with the SI-seller name
    const week = await api('GET', `/api/business/funnel?businessId=${lead.business_id}&days=7`, tokenAssistant);
    assert(week.body.counts.bought >= 1);
    const list = await api('GET', `/api/business/funnel?businessId=${lead.business_id}&days=30&status=bought`, tokenA);
    const item = list.body.clients.find(c => c.id === lead.id);
    assert(item && item.project_name === projectA.name);
    await db.run(`UPDATE clients SET last_activity = '2020-01-01 00:00:00' WHERE id = ?`, [lead.id]);
    const old = await api('GET', `/api/business/funnel?businessId=${lead.business_id}&days=7&status=bought`, tokenA);
    assert(!old.body.clients.some(c => c.id === lead.id), 'Old clients are outside the 7-day filter');
    await db.run(`UPDATE clients SET last_activity = CURRENT_TIMESTAMP WHERE id = ?`, [lead.id]);
  });

  await test('43. Чек об оплате: видят только люди бизнеса; подтверждение → «Купили» и ссылка на доступ; контакт из Telegram', async () => {
    await projectService.updateProject(projectA.id, { payment_url: 'https://pay.example.com/a', access_url: 'https://course.example.com/secret' });
    const lead = await db.get('SELECT * FROM clients WHERE project_id = ? AND external_client_id = ?', [projectA.id, clientUser.id]);
    await api('POST', `/api/projects/${projectA.id}/clients/${lead.id}/funnel`, tokenA, { outcome: 'reopened' });

    // The access link is never shown publicly, to the assistant or to the SI
    const card = await api('GET', `/api/chat/${projectA.slug}`, tokenClient);
    assert(!JSON.stringify(card.body).includes('course.example.com'), 'The public card has no access link');
    const assisted = await projectService.getUserProjects(assistantUser.id);
    assert(!JSON.stringify(assisted).includes('course.example.com'), 'The assistant does not see the access link');
    const prompt = chatService && require('../server/services/si-engine').buildSystemPrompt(await db.get('SELECT * FROM projects WHERE id = ?', [projectA.id]), 'Эксперт');
    assert(!prompt.includes('course.example.com'), 'The SI does not know the access link');
    assert(prompt.includes('Отправить чек'), 'The SI asks for a receipt instead of confirming payments itself');

    const upload = (token, buf, type) => fetch(`${baseUrl}/api/chat/${projectA.slug}/receipts`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': type },
      body: buf
    }).then(async r => ({ status: r.status, body: await r.json() }));
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);
    const pdf = Buffer.from('%PDF-1.4\n% receipt test file\n%%EOF\n');
    assert.strictEqual((await upload(tokenClient, Buffer.from('<svg onload=alert(1)></svg>  '), 'image/svg+xml')).status, 400, 'Only photos and PDF');

    telegramBot.testOutbox.length = 0;
    const sent = await upload(tokenClient, png, 'image/png');
    assert.strictEqual(sent.status, 201);
    const receiptId = sent.body.receipt.id;
    let row = await db.get('SELECT * FROM clients WHERE id = ?', [lead.id]);
    assert.strictEqual(row.funnel_status, 'waiting_human', 'A receipt waits for a person');
    assert(telegramBot.testOutbox.some(m => m.userId === expertA_InternalId && m.text.includes('чек')), 'The owner is told');
    assert(telegramBot.testOutbox.some(m => m.userId === assistantUser.id && m.text.includes('чек')), 'The assistant is told');
    assert(await db.get(`SELECT id FROM direct_inquiries WHERE client_id = ? AND status = 'waiting' AND reason LIKE 'Прислал(а) чек%'`, [lead.id]), 'It is in "Мне написали"');

    const fileUrl = `${baseUrl}/api/projects/${projectA.id}/clients/${lead.id}/receipts/${receiptId}/file`;
    const asAssistant = await fetch(fileUrl, { headers: { Authorization: `Bearer ${tokenAssistant}` } });
    assert.strictEqual(asAssistant.status, 200);
    assert.strictEqual(asAssistant.headers.get('content-type'), 'image/png');
    assert(Buffer.from(await asAssistant.arrayBuffer()).equals(png), 'The same file comes back');
    assert.strictEqual((await fetch(fileUrl, { headers: { Authorization: `Bearer ${tokenOther}` } })).status, 403, 'Strangers cannot see receipts');
    assert.strictEqual((await fetch(fileUrl)).status, 401);
    assert.strictEqual((await api('GET', `/api/media/${receiptId}`)).status, 404, 'Never through the public photos');
    const client = await api('GET', `/api/projects/${projectA.id}/clients/${lead.id}`, tokenA);
    assert.strictEqual(client.body.receipts[0].status, 'new');
    assert(!JSON.stringify(client.body.receipts).includes('data_base64'));

    // The assistant confirms: "Купили", the client gets the access link in the chat and a bot message
    telegramBot.testOutbox.length = 0;
    const ok = await api('POST', `/api/projects/${projectA.id}/clients/${lead.id}/receipts/${receiptId}`, tokenAssistant, { action: 'confirm' });
    assert.strictEqual(ok.status, 200);
    assert.strictEqual(ok.body.funnelStatus, 'bought');
    assert(ok.body.message.text.includes('https://course.example.com/secret'));
    assert.strictEqual(ok.body.message.authorType, 'assistant');
    assert(telegramBot.testOutbox.some(m => m.userId === clientUser.id && m.text.includes('Оплата подтверждена')));
    assert.strictEqual((await api('POST', `/api/projects/${projectA.id}/clients/${lead.id}/receipts/${receiptId}`, tokenA, { action: 'confirm' })).status, 409, 'Checked once');
    assert.strictEqual(Number((await db.get(`SELECT COUNT(*) AS count FROM direct_inquiries WHERE client_id = ? AND status = 'waiting' AND reason LIKE 'Прислал(а) чек%'`, [lead.id])).count), 0);

    // A second receipt (PDF) is not confirmed: the client is told kindly, the status leaves "waiting"
    await api('POST', `/api/projects/${projectA.id}/clients/${lead.id}/funnel`, tokenA, { outcome: 'reopened' });
    const second = await upload(tokenClient, pdf, 'application/pdf');
    assert.strictEqual(second.status, 201);
    assert.strictEqual(second.body.receipt.mimeType, 'application/pdf');
    const no = await api('POST', `/api/projects/${projectA.id}/clients/${lead.id}/receipts/${second.body.receipt.id}`, tokenA, { action: 'reject' });
    assert.strictEqual(no.status, 200);
    assert.notStrictEqual(no.body.funnelStatus, 'waiting_human');
    assert(!no.body.message.text.includes('course.example.com'), 'No access link without a confirmed payment');
    const mine = await api('GET', `/api/chat/${projectA.slug}/receipts`, tokenClient);
    assert.deepStrictEqual(mine.body.receipts.map(r => r.status).sort(), ['confirmed', 'rejected']);

    // Contact: only Telegram's signed answer with the person's own contact
    const sign = (params) => {
      const check = Object.keys(params).sort().map(k => `${k}=${params[k]}`).join('\n');
      const secret = crypto.createHmac('sha256', 'WebAppData').update(process.env.TELEGRAM_BOT_TOKEN).digest();
      const q = new URLSearchParams(params);
      q.set('hash', crypto.createHmac('sha256', secret).update(check).digest('hex'));
      return q.toString();
    };
    const now = String(Math.floor(Date.now() / 1000));
    const own = sign({ contact: JSON.stringify({ user_id: clientTg.id, phone_number: '77011234567', first_name: 'Клиент' }), auth_date: now });
    const foreign = sign({ contact: JSON.stringify({ user_id: 999999, phone_number: '77000000000' }), auth_date: now });
    const forged = own.replace('77011234567', '77019999999');
    assert.strictEqual((await api('POST', `/api/chat/${projectA.slug}/contact`, tokenClient, { response: forged })).status, 400, 'Changed data is rejected');
    assert.strictEqual((await api('POST', `/api/chat/${projectA.slug}/contact`, tokenClient, { response: foreign })).status, 400, 'Someone else\'s contact is rejected');
    const shared = await api('POST', `/api/chat/${projectA.slug}/contact`, tokenClient, { response: own });
    assert.strictEqual(shared.status, 200);
    assert.strictEqual(shared.body.phone, '+77011234567');
    assert.strictEqual((await api('GET', `/api/chat/${projectA.slug}/messages`, tokenClient)).body.contactShared, true);
    const withPhone = await api('GET', `/api/projects/${projectA.id}/clients/${lead.id}`, tokenAssistant);
    assert.strictEqual(withPhone.body.contact_phone, '+77011234567');
    assert(withPhone.body.contact_consent_at, 'The moment of consent is kept');
    assert(withPhone.body.events.some(e => e.type === 'contact_shared'));
  });

  await test('44. Своё условие в сценарии: SI замечает его в переписке и выполняет действие', async () => {
    const put = await api('PUT', `/api/projects/${projectA.id}`, tokenA, {
      custom_ai_settings: {
        ...projectService.safeJsonParse((await db.get('SELECT custom_ai_settings FROM projects WHERE id = ?', [projectA.id])).custom_ai_settings),
        scenarios: [
          { when: 'custom', condition: 'клиент спрашивает про рассрочку', then: 'notify', text: 'Предложить рассрочку' },
          { when: 'custom', condition: 'клиент из другой страны', then: 'si_says', text: 'Уточнить часовой пояс' },
          { when: 'custom', condition: '', then: 'notify' }
        ]
      }
    });
    assert.strictEqual(put.body.custom_ai_settings.scenarios.length, 2, 'An empty condition is dropped');
    assert.strictEqual(funnelService.normalizeScenarios(Array.from({ length: 30 }, () => ({ when: 'refused', then: 'notify' }))).length, 20, 'Up to 20 scenarios');
    const lead = await db.get('SELECT * FROM clients WHERE project_id = ? AND external_client_id = ?', [projectA.id, clientUser.id]);
    await api('POST', `/api/projects/${projectA.id}/clients/${lead.id}/si`, tokenA, { enabled: true });

    const realFetch = global.fetch;
    const originalKey = config.openaiApiKey;
    config.openaiApiKey = 'sk-test-not-real';
    let analysisPrompt = '';
    let system = '';
    global.fetch = async (url, options) => {
      if (String(url).startsWith('https://api.openai.com/')) {
        const body = JSON.parse(options.body);
        if (body.response_format) {
          analysisPrompt = body.messages[0].content;
          return new Response(JSON.stringify({ choices: [{ message: { content: '{"offer_made":false,"offer_answered":false,"objection":"","refused":false,"conditions":[1, 7]}' } }] }), { status: 200 });
        }
        system = body.messages[0].content;
        return new Response(JSON.stringify({ choices: [{ message: { content: 'Да, можно частями.' } }] }), { status: 200 });
      }
      return realFetch(url, options);
    };
    try {
      telegramBot.testOutbox.length = 0;
      await api('POST', `/api/chat/${projectA.slug}/messages`, tokenClient, { text: 'А можно платить частями?' });
      assert(analysisPrompt.includes('1. клиент спрашивает про рассрочку'), 'The SI looks for the expert\'s conditions');
      assert(system.includes('Если клиент из другой страны: Уточнить часовой пояс'), 'Custom "SI отвечает так" goes to the SI');
      assert(telegramBot.testOutbox.some(m => m.userId === expertA_InternalId && m.text.includes('клиент спрашивает про рассрочку') && m.text.includes('Предложить рассрочку')));
      const condition = await db.get(`SELECT data FROM client_events WHERE client_id = ? AND type = 'condition' ORDER BY created_at DESC LIMIT 1`, [lead.id]);
      assert(condition && condition.data.includes('рассрочку'), 'A number that is not in the list is ignored');
    } finally {
      global.fetch = realFetch;
      config.openaiApiKey = originalKey;
    }
  });

  await test('45. Кнопки «Отправить чек» и «Поделиться контактом» — только когда разговор к этому подошёл', async () => {
    await projectService.updateProject(projectA.id, { payment_url: 'https://pay.example.com/a' });
    const fresh = { id: 600006, first_name: 'Новый', username: 'new_client' };
    const token = await tokenFor(fresh);
    await api('POST', `/api/chat/${projectA.slug}/start`, token);
    let thread = await api('GET', `/api/chat/${projectA.slug}/messages`, token);
    assert.deepStrictEqual(thread.body.tools, { contact: false, receipt: false, booking: false }, 'No buttons by default');

    // «Купить» pressed → "Отправить чек" appears
    await api('POST', `/api/chat/${projectA.slug}/events`, token, { type: 'buy_clicked' });
    thread = await api('GET', `/api/chat/${projectA.slug}/messages`, token);
    assert.strictEqual(thread.body.tools.receipt, true);
    assert.strictEqual(thread.body.tools.contact, false);

    // A person asks for the phone → "Поделиться контактом" appears
    const lead = await db.get('SELECT * FROM clients WHERE project_id = ? AND external_client_id = ?', [projectA.id, (await authService.findOrCreateTelegramUser(fresh, 'expert')).id]);
    await api('POST', `/api/projects/${projectA.id}/conversations/${lead.id}/messages`, tokenA, { text: 'Оставьте, пожалуйста, ваш номер — я перезвоню.' });
    thread = await api('GET', `/api/chat/${projectA.slug}/messages`, token);
    assert.strictEqual(thread.body.tools.contact, true);

    // Bought → no receipt button; contact shared → no contact button
    await api('POST', `/api/projects/${projectA.id}/clients/${lead.id}/funnel`, tokenA, { outcome: 'paid' });
    await db.run('UPDATE clients SET contact_consent_at = CURRENT_TIMESTAMP WHERE id = ?', [lead.id]);
    thread = await api('GET', `/api/chat/${projectA.slug}/messages`, token);
    assert.deepStrictEqual(thread.body.tools, { contact: false, receipt: false, booking: false });

    // Without a payment link there is never a receipt button
    const t = await chatService.chatTools({ payment_url: null }, { id: lead.id, funnel_status: 'not_finished' }, [{ sender: 'ai', text: 'Пришлите чек' }]);
    assert.strictEqual(t.receipt, false);
    const si = await chatService.chatTools({ payment_url: 'https://x' }, { id: 'cli_none', funnel_status: 'not_finished' }, [{ sender: 'ai', text: 'Спасибо! Отправьте, пожалуйста, чек кнопкой «Отправить чек»' }]);
    assert.strictEqual(si.receipt, true, 'The SI asked for a receipt');
  });

  await test('46. «Будильник» и сценарий «Клиент замолчал»: ветка воронки, минуты, один раз за молчание', async () => {
    const scheduler = require('../server/services/scheduler-service');
    const followup = require('../server/services/followup-service');
    scheduler.register('silent-clients', followup.runSilentScenarios);
    const settings = projectService.safeJsonParse((await db.get('SELECT custom_ai_settings FROM projects WHERE id = ?', [projectA.id])).custom_ai_settings);
    const ago = (m) => new Date(Date.now() - m * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ');
    const save = (scenarios) => api('PUT', `/api/projects/${projectA.id}`, tokenA, { custom_ai_settings: { ...settings, scenarios } });

    const put = await save([
      { when: 'silent', minutes: 60, after: 'any', then: 'si_says', text: '' },
      { when: 'silent', minutes: 1440, after: 'objection', then: 'notify', text: 'Позвонить' },
      { when: 'silent', minutes: 1, after: 'nowhere', then: 'notify' }
    ]);
    const saved = put.body.custom_ai_settings.scenarios;
    assert.deepStrictEqual(saved.map(x => [x.minutes, x.after]), [[60, 'any'], [1440, 'objection'], [5, 'any']], 'Minutes 5..43200, unknown branch → any');
    assert(!require('../server/services/si-engine').buildSystemPrompt({ ...(await db.get('SELECT * FROM projects WHERE id = ?', [projectA.id])) }, 'Э').includes('Если клиент замолчал'), 'Silence is not a rule for the conversation');

    // A client who wrote, got an SI answer and has been silent for 90 minutes
    const silentTg = { id: 700007, first_name: 'Молчун' };
    const token = await tokenFor(silentTg);
    await api('POST', `/api/chat/${projectA.slug}/messages`, token, { text: 'Сколько стоит?' });
    const lead = await db.get('SELECT * FROM clients WHERE project_id = ? AND external_client_id = ?', [projectA.id, (await authService.findOrCreateTelegramUser(silentTg, 'expert')).id]);
    const silence = async (minutes) => {
      await db.run('UPDATE clients SET last_activity = ? WHERE id = ?', [ago(minutes), lead.id]);
      await db.run('UPDATE conversations SET created_at = ? WHERE client_id = ?', [ago(minutes), lead.id]);
      await db.run(`UPDATE client_events SET created_at = ? WHERE client_id = ?`, [ago(minutes), lead.id]);
    };
    await silence(90);
    // Someone who only opened the chat and never wrote is left alone
    const quietTg = { id: 700008, first_name: 'Просто открыл' };
    await api('POST', `/api/chat/${projectA.slug}/start`, await tokenFor(quietTg));
    const quiet = await db.get('SELECT * FROM clients WHERE project_id = ? AND external_client_id = ?', [projectA.id, (await authService.findOrCreateTelegramUser(quietTg, 'expert')).id]);
    await db.run('UPDATE clients SET last_activity = ? WHERE id = ?', [ago(90), quiet.id]);
    await db.run('UPDATE conversations SET created_at = ? WHERE client_id = ?', [ago(90), quiet.id]);
    const count = async (id) => (await chatService.history(projectA.id, id)).length;
    const before = await count(lead.id);

    telegramBot.testOutbox.length = 0;
    const run = (await scheduler.tick()).find(r => r.name === 'silent-clients');
    assert(!run.error, run.error);
    assert(telegramBot.testOutbox.some(m => m.userId === expertA_InternalId && m.text.includes('молчит 5 мин')), 'First the 5-minute scenario tells the owner (one action per minute)');
    assert.strictEqual(await count(lead.id), before, 'The owner was told, the client got nothing yet');
    telegramBot.testOutbox.length = 0;
    await scheduler.tick();
    const after = await chatService.history(projectA.id, lead.id);
    assert.strictEqual(after.length, before + 1, 'The SI wrote one follow-up after 60 minutes');
    assert.strictEqual(after.at(-1).authorType, 'si');
    assert(telegramBot.testOutbox.some(m => m.userId === lead.external_client_id && m.text.includes('написал')), 'The client gets a bot message');
    assert.strictEqual((await chatService.history(projectA.id, quiet.id)).filter(m => m.authorType === 'si').length, 1, 'Only the opener for someone who never wrote');
    telegramBot.testOutbox.length = 0;
    await scheduler.tick();
    assert.strictEqual(await count(lead.id), before + 1, 'Once per silence');
    assert.strictEqual(telegramBot.testOutbox.length, 0, 'Each scenario once per silence');

    // Branch "после возражения": fires only when the client went silent after an objection
    await db.run(`UPDATE client_events SET created_at = ? WHERE client_id = ?`, [ago(1500), lead.id]);
    await db.run('UPDATE clients SET last_activity = ? WHERE id = ?', [ago(1500), lead.id]);
    telegramBot.testOutbox.length = 0;
    await scheduler.tick();
    assert(!telegramBot.testOutbox.some(m => m.text.includes('Позвонить')), 'No objection — not this branch');
    const fresh = await db.get('SELECT * FROM clients WHERE id = ?', [lead.id]);
    await funnelService.recordEvent(fresh, 'objection', { type: 'client' }, { objection: 'дорого' });
    await db.run(`UPDATE client_events SET created_at = ? WHERE client_id = ? AND type = 'objection'`, [ago(1490), lead.id]);
    await db.run('UPDATE clients SET last_activity = ? WHERE id = ?', [ago(1500), lead.id]);
    await scheduler.tick();
    assert(telegramBot.testOutbox.some(m => m.userId === expertA_InternalId && m.text.includes('после возражения') && m.text.includes('Позвонить')), 'The objection branch tells the owner');

    // Branch "после оффера": the SI's last message is checked once (without OpenAI — by words)
    await save([{ when: 'silent', minutes: 60, after: 'offer', then: 'notify', text: 'Оффер без ответа' }]);
    await api('POST', `/api/chat/${projectA.slug}/messages`, token, { text: 'А что дальше?' });
    await db.run('UPDATE projects SET price_label = ? WHERE id = ?', ['25 000 ₽', projectA.id]);
    await chatService.saveMessage(await db.get('SELECT * FROM clients WHERE id = ?', [lead.id]), { type: 'si' }, 'Участие стоит 25 000 ₽, можно нажать «Купить».');
    await silence(90);
    telegramBot.testOutbox.length = 0;
    await scheduler.tick();
    assert(telegramBot.testOutbox.some(m => m.text.includes('после оффера') && m.text.includes('Оффер без ответа')), 'The offer branch fires');
    assert((await db.all(`SELECT data FROM client_events WHERE client_id = ? AND type = 'offer_sent'`, [lead.id])).length >= 1, 'The offer goes to the journal');

    // Bought clients are left alone
    await save([{ when: 'silent', minutes: 60, after: 'any', then: 'si_says' }]);
    await api('POST', `/api/chat/${projectA.slug}/messages`, token, { text: 'Я подумаю' });
    await api('POST', `/api/projects/${projectA.id}/clients/${lead.id}/funnel`, tokenA, { outcome: 'paid' });
    await silence(90);
    const k = await count(lead.id);
    await scheduler.tick();
    assert.strictEqual(await count(lead.id), k, 'No follow-ups after buying');

    // Lease: a second copy of the server does not run the job at the same time
    await db.run(`UPDATE scheduler_jobs SET locked_until = ?, locked_by = 'srv_other' WHERE name = 'silent-clients'`, [new Date(Date.now() + 60000).toISOString().slice(0, 19).replace('T', ' ')]);
    assert.strictEqual((await scheduler.tick()).find(r => r.name === 'silent-clients').skipped, true);
    await db.run(`UPDATE scheduler_jobs SET locked_until = NULL WHERE name = 'silent-clients'`);
    assert((await scheduler.status()).jobs.find(j => j.name === 'silent-clients').runs >= 5);

    await projectService.updateProject(projectA.id, { custom_ai_settings: settings });
  });

  await test('47. Ветки воронки: «ответил так — отправь материал A, ответил вот так — B», ветка после ветки', async () => {
    const scheduler = require('../server/services/scheduler-service');
    const followup = require('../server/services/followup-service');
    scheduler.register('silent-clients', followup.runSilentScenarios);
    const settings = projectService.safeJsonParse((await db.get('SELECT custom_ai_settings FROM projects WHERE id = ?', [projectA.id])).custom_ai_settings);
    const put = await api('PUT', `/api/projects/${projectA.id}`, tokenA, {
      custom_ai_settings: { ...settings, scenarios: [
        { id: 'scn_newbiz', title: 'Новичок', when: 'custom', condition: 'клиент только начинает бизнес', then: 'send_text', text: 'Материал A: https://example.com/start' },
        { id: 'scn_pro', title: 'Опытный', when: 'custom', condition: 'у клиента уже есть бизнес', then: 'send_text', text: 'Материал B: https://example.com/pro' },
        { id: 'scn_after', title: 'Посмотрел?', when: 'silent', minutes: 30, after: 'scn_newbiz', then: 'send_text', text: 'Удалось посмотреть материал?' },
        { when: 'silent', minutes: 30, after: 'scn_missing', then: 'notify' },
        { when: 'custom', condition: 'что-то', then: 'send_text', text: '' }
      ] }
    });
    const saved = put.body.custom_ai_settings.scenarios;
    assert.deepStrictEqual(saved.map(x => x.title), ['Новичок', 'Опытный', 'Посмотрел?'], 'A branch after a missing branch and an empty material are dropped');

    const tg = { id: 700009, first_name: 'Ветка' };
    const token = await tokenFor(tg);
    const realFetch = global.fetch;
    const originalKey = config.openaiApiKey;
    config.openaiApiKey = 'sk-test-not-real';
    let matched = [1];
    global.fetch = async (url, options) => {
      if (String(url).startsWith('https://api.openai.com/')) {
        const body = JSON.parse(options.body);
        const content = body.response_format
          ? JSON.stringify({ offer_made: false, offer_answered: false, objection: '', refused: false, conditions: matched })
          : 'Понимаю вас!';
        return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
      }
      return realFetch(url, options);
    };
    try {
      const sent = await api('POST', `/api/chat/${projectA.slug}/messages`, token, { text: 'Я только думаю открыть своё дело' });
      assert.strictEqual(sent.status, 201);
      let history = (await api('GET', `/api/chat/${projectA.slug}/messages`, token)).body.messages;
      assert.strictEqual(history.at(-1).text, 'Материал A: https://example.com/start', 'Branch A sends material A after the SI reply');
      assert(!history.some(m => m.text.includes('Материал B')));

      matched = [2];
      await api('POST', `/api/chat/${projectA.slug}/messages`, token, { text: 'Хотя у меня уже есть салон' });
      history = (await api('GET', `/api/chat/${projectA.slug}/messages`, token)).body.messages;
      assert.strictEqual(history.at(-1).text, 'Материал B: https://example.com/pro', 'Branch B sends material B');

      matched = [1];
      await api('POST', `/api/chat/${projectA.slug}/messages`, token, { text: 'Я новичок' });
      history = (await api('GET', `/api/chat/${projectA.slug}/messages`, token)).body.messages;
      assert.strictEqual(history.filter(m => m.text.includes('Материал A')).length, 1, 'A material is sent once per client');
    } finally {
      global.fetch = realFetch;
      config.openaiApiKey = originalKey;
    }

    // "Посмотрел?" goes after branch A — only for a silence that started after branch A fired
    const lead = await db.get('SELECT * FROM clients WHERE project_id = ? AND external_client_id = ?', [projectA.id, (await authService.findOrCreateTelegramUser(tg, 'expert')).id]);
    const ago = (m) => new Date(Date.now() - m * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ');
    await db.run('UPDATE clients SET last_activity = ? WHERE id = ?', [ago(40), lead.id]);
    await db.run('UPDATE conversations SET created_at = ? WHERE client_id = ?', [ago(40), lead.id]);
    await db.run('UPDATE client_events SET created_at = ? WHERE client_id = ?', [ago(40), lead.id]);
    await db.run(`UPDATE client_events SET created_at = ? WHERE client_id = ? AND type = 'scenario'`, [ago(60), lead.id]);
    // Branch A fired before the client's last message ("Я новичок" did not fire it again): not after branch A
    await scheduler.tick();
    let history = await chatService.history(projectA.id, lead.id);
    assert(!history.some(m => m.text === 'Удалось посмотреть материал?'), 'Not after branch A this time');
    // Branch A fired after the client's last message → the follow-up branch fires
    await db.run(`UPDATE client_events SET created_at = ? WHERE client_id = ? AND type = 'scenario'`, [ago(35), lead.id]);
    await scheduler.tick();
    history = await chatService.history(projectA.id, lead.id);
    assert.strictEqual(history.at(-1).text, 'Удалось посмотреть материал?', 'The branch after branch A sends its text');

    await projectService.updateProject(projectA.id, { custom_ai_settings: settings });
  });

  await test('48. Условия только словами: кнопки («нажал «Купить»»), «после того, как…», слова в кавычках без OpenAI', async () => {
    const scheduler = require('../server/services/scheduler-service');
    const followup = require('../server/services/followup-service');
    scheduler.register('silent-clients', followup.runSilentScenarios);
    const settings = projectService.safeJsonParse((await db.get('SELECT custom_ai_settings FROM projects WHERE id = ?', [projectA.id])).custom_ai_settings);
    await projectService.updateProject(projectA.id, { payment_url: 'https://pay.example.com/a' });
    const put = await api('PUT', `/api/projects/${projectA.id}`, tokenA, {
      custom_ai_settings: { ...settings, scenarios: [
        { title: 'Рассрочка', when: 'custom', condition: 'клиент спросил про «рассрочку»', then: 'send_text', text: 'Рассрочка: https://example.com/split' },
        { title: 'Нажал купить', when: 'custom', condition: 'клиент нажал «Купить»', then: 'notify', text: 'Проверить оплату' },
        { title: 'После цены', when: 'silent', minutes: 30, after: 'text', afterText: 'SI назвал «цену»', then: 'send_text', text: 'Остались вопросы по цене?' },
        { when: 'silent', minutes: 30, after: 'text', afterText: '', then: 'notify' }
      ] }
    });
    const saved = put.body.custom_ai_settings.scenarios;
    assert.strictEqual(saved[2].afterText, 'SI назвал «цену»');
    assert.strictEqual(saved[3].after, 'any', 'Empty "после того, как" → any moment');

    // Without OpenAI: words in quotes match the client's message
    const tg = { id: 700010, first_name: 'Слова' };
    const token = await tokenFor(tg);
    await api('POST', `/api/chat/${projectA.slug}/messages`, token, { text: 'А есть рассрочку на 3 месяца?' });
    let history = (await api('GET', `/api/chat/${projectA.slug}/messages`, token)).body.messages;
    assert.strictEqual(history.at(-1).text, 'Рассрочка: https://example.com/split', 'The quoted word works without OpenAI');

    // A button press is checked like a message
    telegramBot.testOutbox.length = 0;
    await api('POST', `/api/chat/${projectA.slug}/events`, token, { type: 'buy_clicked' });
    assert(telegramBot.testOutbox.some(m => m.userId === expertA_InternalId && m.text.includes('Нажал купить') && m.text.includes('Проверить оплату')), '"Клиент нажал «Купить»" written in words fires on the button');

    // "Молчит после того, как SI назвал «цену»": checked on the last messages
    const lead = await db.get('SELECT * FROM clients WHERE project_id = ? AND external_client_id = ?', [projectA.id, (await authService.findOrCreateTelegramUser(tg, 'expert')).id]);
    await chatService.saveMessage(lead, { type: 'si' }, 'Хорошо! А по стоимости: цену эксперт назовёт на созвоне.');
    const ago = (m) => new Date(Date.now() - m * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ');
    await db.run('UPDATE clients SET last_activity = ? WHERE id = ?', [ago(40), lead.id]);
    await db.run('UPDATE conversations SET created_at = ? WHERE client_id = ?', [ago(40), lead.id]);
    await db.run('UPDATE client_events SET created_at = ? WHERE client_id = ?', [ago(40), lead.id]);
    await scheduler.tick();
    await scheduler.tick();
    history = await chatService.history(projectA.id, lead.id);
    assert(history.some(m => m.text === 'Остались вопросы по цене?'), 'The silence after the described moment fires');

    await projectService.updateProject(projectA.id, { custom_ai_settings: settings });
  });

  await test('49. Уведомления сначала у Бадди в приложении, потом в Telegram; каждый видит только свои', async () => {
    telegramBot.testOutbox.length = 0;
    const sent = await telegramBot.notifyUser(expertA_InternalId, '⏰ Тест: клиент молчит 1 ч', { buttonText: 'Открыть', startParam: `I_${projectA.id}` });
    assert.strictEqual(sent, true, 'Telegram too');
    const mine = await api('GET', '/api/me/notifications', tokenA);
    assert.strictEqual(mine.status, 200);
    const note = mine.body.notifications.find(n => n.text === '⏰ Тест: клиент молчит 1 ч');
    assert(note, 'The notification is in Buddy');
    assert.strictEqual(note.startParam, `I_${projectA.id}`, 'It leads to the same place as the bot button');
    assert.strictEqual(note.read, false);
    assert(mine.body.unread >= 1);
    const other = await api('GET', '/api/me/notifications', tokenB);
    assert(!other.body.notifications.some(n => n.id === note.id), 'Nobody else sees it');
    assert.strictEqual((await api('POST', '/api/me/notifications/read', tokenB, { id: note.id })).status, 200);
    assert.strictEqual((await api('GET', '/api/me/notifications', tokenA)).body.notifications.find(n => n.id === note.id).read, false, 'Another person cannot mark it read');
    await api('POST', '/api/me/notifications/read', tokenA, { id: note.id });
    assert.strictEqual((await api('GET', '/api/me/notifications', tokenA)).body.notifications.find(n => n.id === note.id).read, true);
    await api('POST', '/api/me/notifications/read', tokenA, {});
    assert.strictEqual((await api('GET', '/api/me/notifications', tokenA)).body.unread, 0, '"Прочитать все"');
    // An unknown person: nothing breaks
    assert.strictEqual(await telegramBot.notifyUser('usr_does_not_exist', 'x'), false);
  });

  await test('50. Бадди — переписка: личный помощник, напоминания по часовому поясу, лимит 30 в день', async () => {
    const buddyService = require('../server/services/buddy-service');
    const scheduler = require('../server/services/scheduler-service');
    scheduler.register('buddy-reminders', buddyService.runReminders);
    const tg = { id: 700020, first_name: 'Айгерим' };
    const token = await tokenFor(tg);
    const user = await authService.findOrCreateTelegramUser(tg, 'expert');

    // Without OpenAI: an honest answer, the message is kept
    let res = await api('POST', '/api/buddy/messages', token, { text: 'Привет!', tzOffset: 300 });
    assert.strictEqual(res.status, 201);
    assert.strictEqual(res.body.messages[0].sender, 'user');
    assert(res.body.messages[1].text.includes('пока не могу отвечать'));
    assert.strictEqual((await db.get('SELECT tz_offset_minutes FROM users WHERE id = ?', [user.id])).tz_offset_minutes, 300, 'The time zone of the phone is kept');

    const realFetch = global.fetch;
    const originalKey = config.openaiApiKey;
    config.openaiApiKey = 'sk-test-not-real';
    let answer = {};
    let prompt = '';
    let model = '';
    global.fetch = async (url, options) => {
      if (String(url).startsWith('https://api.openai.com/')) {
        const body = JSON.parse(options.body);
        prompt = body.messages[0].content;
        model = body.model;
        return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(answer) } }] }), { status: 200 });
      }
      return realFetch(url, options);
    };
    try {
      // "Напомни завтра в 9:00" in Almaty time (UTC+5) → 04:00 UTC
      const local = new Date(Date.now() + 300 * 60000);
      local.setUTCDate(local.getUTCDate() + 1);
      const day = local.toISOString().slice(0, 10);
      answer = { reply: `Запомнил: завтра в 9:00 — позвонить маме.`, reminders: [{ text: 'позвонить маме', at: `${day} 09:00` }, { text: 'в прошлом', at: '2020-01-01 09:00' }], cancel: [], open: 'none' };
      res = await api('POST', '/api/buddy/messages', token, { text: 'Напомни завтра в 9 позвонить маме', tzOffset: 300 });
      assert.strictEqual(res.body.messages[1].text, 'Запомнил: завтра в 9:00 — позвонить маме.');
      assert(prompt.includes('Бадди') && prompt.includes('Айгерим'), 'Buddy knows who it talks to');
      assert.strictEqual(model, config.buddyModel, 'Buddy uses its own model setting');
      const reminders = await buddyService.activeReminders(user.id);
      assert.strictEqual(reminders.length, 1, 'Only a future reminder is kept');
      assert.strictEqual(String(reminders[0].remind_at instanceof Date ? reminders[0].remind_at.toISOString().slice(0, 19).replace('T', ' ') : reminders[0].remind_at), `${day} 04:00:00`, '09:00 in UTC+5 is 04:00 UTC');

      // A button to a section of the app
      answer = { reply: 'Экспертов можно найти в Маркетплейсе.', reminders: [], cancel: [], open: 'marketplace' };
      res = await api('POST', '/api/buddy/messages', token, { text: 'Где найти эксперта?', tzOffset: 300 });
      assert.strictEqual(res.body.messages[1].startParam, 'GO_marketplace');

      // "Что у меня запланировано?" — Buddy sees the list; cancel by number
      answer = { reply: 'Отменил.', reminders: [], cancel: [1], open: 'none' };
      await api('POST', '/api/buddy/messages', token, { text: 'Отмени напоминание про маму', tzOffset: 300 });
      assert(prompt.includes('позвонить маме'), 'Buddy is told the reminders');
      assert.strictEqual((await buddyService.activeReminders(user.id)).length, 0, 'Cancelled');

      // A reminder whose time has come: Buddy's message (+ Telegram), once
      await db.run('INSERT INTO buddy_reminders (id, user_id, text, remind_at) VALUES (?, ?, ?, ?)', ['rem_test1', user.id, 'выпить воды', '2020-01-01 00:00:00']);
      telegramBot.testOutbox.length = 0;
      await scheduler.tick();
      await scheduler.tick();
      const list = (await api('GET', '/api/buddy/messages', token)).body;
      assert.strictEqual(list.messages.filter(m => m.text === '⏰ Напоминаю: выпить воды').length, 1, 'The reminder came once');
      assert(list.unread >= 1, 'It is unread (red dot)');
      assert.strictEqual(telegramBot.testOutbox.filter(m => m.text.includes('выпить воды')).length, 1, 'And to Telegram');
      await api('POST', '/api/buddy/read', token);
      assert.strictEqual((await api('GET', '/api/buddy/messages', token)).body.unread, 0);

      // Nobody else sees this conversation
      assert(!(await api('GET', '/api/buddy/messages', tokenB)).body.messages.some(m => m.text.includes('маме')));

      // The daily limit: 30 messages; then one gentle message and no OpenAI calls
      for (let i = 0; i < 30; i++) {
        await db.run(`INSERT INTO notifications (id, user_id, text, sender, kind) VALUES (?, ?, 'x', 'user', 'chat')`, [`ntf_lim${i}`, user.id]);
      }
      prompt = '';
      res = await api('POST', '/api/buddy/messages', token, { text: 'Ещё вопрос', tzOffset: 300 });
      assert.strictEqual(res.body.limitReached, true);
      assert.strictEqual(res.body.messages[1].text, buddyService.LIMIT_TEXT);
      assert.strictEqual(prompt, '', 'No OpenAI after the limit');
      res = await api('POST', '/api/buddy/messages', token, { text: 'И ещё', tzOffset: 300 });
      assert.strictEqual(res.body.messages.length, 1, 'The limit message is said once a day');
    } finally {
      global.fetch = realFetch;
      config.openaiApiKey = originalKey;
    }
  });

  await test('51. Голосовые: до 1,5 минуты, расшифровка OpenAI, SI отвечает на текст, слушать могут только свои', async () => {
    const tg = { id: 700030, first_name: 'Голос' };
    const token = await tokenFor(tg);
    const webm = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(2000, 7)]);
    const upload = (body, seconds = 18, t = token) => fetch(`${baseUrl}/api/chat/${projectA.slug}/voice?seconds=${seconds}`, {
      method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'audio/webm' }, body
    }).then(async r => ({ status: r.status, body: await r.json() }));

    assert.strictEqual((await upload(Buffer.from('not audio at all, really'))).status, 400, 'Only real audio');

    // Without OpenAI: the voice is kept, the SI honestly asks to write instead
    let res = await upload(webm);
    assert.strictEqual(res.status, 201);
    assert.strictEqual(res.body.message.isVoice, true);
    assert.strictEqual(res.body.message.voiceSeconds, 18);
    assert(res.body.reply.text.includes('расслышать'));

    // With OpenAI: the transcript is the message, the SI answers it
    const realFetch = global.fetch;
    const originalKey = config.openaiApiKey;
    config.openaiApiKey = 'sk-test-not-real';
    let transcribeModel = '';
    global.fetch = async (url, options) => {
      if (String(url) === 'https://api.openai.com/v1/audio/transcriptions') {
        transcribeModel = options.body.get('model');
        return new Response(JSON.stringify({ text: 'Сколько стоит ваш курс и есть ли рассрочка?' }), { status: 200 });
      }
      if (String(url).startsWith('https://api.openai.com/')) {
        const body = JSON.parse(options.body);
        const content = body.response_format ? '{"offer_made":false,"offer_answered":false,"objection":"","refused":false,"conditions":[]}' : 'Курс стоит 25 000 ₽, рассрочка есть.';
        return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
      }
      return realFetch(url, options);
    };
    try {
      res = await upload(webm, 500);
      assert.strictEqual(res.status, 201);
      assert.strictEqual(transcribeModel, config.transcribeModel);
      assert.strictEqual(res.body.message.text, 'Сколько стоит ваш курс и есть ли рассрочка?', 'The transcript is the message');
      assert.strictEqual(res.body.message.voiceSeconds, 90, 'Up to 1.5 minutes');
      assert.strictEqual(res.body.reply.text, 'Курс стоит 25 000 ₽, рассрочка есть.', 'The SI answers the transcript');
    } finally {
      global.fetch = realFetch;
      config.openaiApiKey = originalKey;
    }

    // Playing: the client, the owner and the assistant — yes; others — no
    const voiceId = res.body.message.voiceId;
    const mine = await fetch(`${baseUrl}/api/chat/${projectA.slug}/voice/${voiceId}`, { headers: { Authorization: `Bearer ${token}` } });
    assert.strictEqual(mine.status, 200);
    assert.strictEqual(mine.headers.get('content-type'), 'audio/webm');
    assert.strictEqual((await fetch(`${baseUrl}/api/chat/${projectA.slug}/voice/${voiceId}`, { headers: { Authorization: `Bearer ${tokenB}` } })).status, 404, 'Another client cannot');
    const lead = await db.get('SELECT * FROM clients WHERE project_id = ? AND external_client_id = ?', [projectA.id, (await authService.findOrCreateTelegramUser(tg, 'expert')).id]);
    const ownerUrl = `${baseUrl}/api/projects/${projectA.id}/conversations/${lead.id}/voice/${voiceId}`;
    assert.strictEqual((await fetch(ownerUrl, { headers: { Authorization: `Bearer ${tokenA}` } })).status, 200, 'The owner can');
    assert.strictEqual((await fetch(ownerUrl, { headers: { Authorization: `Bearer ${tokenOther}` } })).status, 403, 'A stranger cannot');
    const history = (await api('GET', `/api/projects/${projectA.id}/conversations/${lead.id}/messages`, tokenA)).body;
    assert(history.some(m => m.voiceId === voiceId && m.isVoice), 'The expert sees the voice message with its transcript');

    // At most 20 voice messages a day per client
    for (let i = 0; i < 18; i++) {
      await db.run(`INSERT INTO voice_messages (id, project_id, client_id, mime_type, size_bytes, data_base64) VALUES (?, ?, ?, 'audio/webm', 1, 'AA==')`, [`voi_lim${i}`, projectA.id, lead.id]);
    }
    assert.strictEqual((await upload(webm)).status, 429);
  });

  await test('52. Календарь: окна владельца и помощника, запись в чате, без двойной брони, правила эксперта, напоминание', async () => {
    const calendarService = require('../server/services/calendar-service');
    const business = await db.get('SELECT id FROM businesses WHERE owner_id = ?', [expertA_InternalId]);
    let cal = await api('GET', '/api/business/calendar', tokenA);
    assert.strictEqual(cal.status, 200);
    assert.strictEqual(cal.body.role, 'owner');
    assert.strictEqual(cal.body.enabled, false, 'Closed until somebody has windows');
    assert.strictEqual((await api('GET', `/api/chat/${projectA.slug}/calendar`, tokenClient)).status, 404, 'No windows — no booking');

    // Only the owner sets rules and windows; the assistant sees the calendar
    const asAssistant = await api('GET', `/api/business/calendar?businessId=${business.id}`, tokenAssistant);
    assert.strictEqual(asAssistant.status, 200);
    assert.strictEqual(asAssistant.body.role, 'assistant');
    assert.strictEqual((await api('PUT', '/api/business/calendar/settings', tokenAssistant, { businessId: business.id, durationMinutes: 60 })).status, 403);
    assert.strictEqual((await api('GET', `/api/business/calendar?businessId=${business.id}`, tokenOther)).status, 404, 'A stranger does not see it');
    assert.deepStrictEqual((await api('GET', '/api/business/calendar', tokenClient)).body, { businessId: null }, 'No business — nothing is created');

    await api('PUT', '/api/business/calendar/settings', tokenA, { tzOffset: 300, durationMinutes: 60, clientCanCancel: true, clientCanReschedule: false, hoursBefore: 3 });
    const everyDay = (from, to) => [0, 1, 2, 3, 4, 5, 6].map(day => ({ day, from, to }));
    assert.strictEqual((await api('PUT', `/api/business/calendar/hosts/${expertA_InternalId}`, tokenA, { zoomUrl: 'http://zoom.us/j/1', windows: everyDay('10:00', '12:00') })).status, 400, 'Only https links');
    assert.strictEqual((await api('PUT', `/api/business/calendar/hosts/${clientUser.id}`, tokenA, { windows: everyDay('10:00', '12:00') })).status, 404, 'Only people of the business');
    assert.strictEqual((await api('PUT', `/api/business/calendar/hosts/${assistantUser.id}`, tokenAssistant, { businessId: business.id, windows: everyDay('10:00', '12:00') })).status, 403);
    await api('PUT', `/api/business/calendar/hosts/${expertA_InternalId}`, tokenA, { zoomUrl: 'https://zoom.us/j/111', windows: everyDay('10:00', '12:00') });
    cal = await api('PUT', `/api/business/calendar/hosts/${assistantUser.id}`, tokenA, { zoomUrl: 'https://zoom.us/j/222', windows: everyDay('10:00', '11:00') });
    assert.strictEqual(cal.status, 200);
    assert.strictEqual(cal.body.enabled, true);
    assert.deepStrictEqual(cal.body.hosts.find(h => h.userId === assistantUser.id).windows[0], { day: 0, from: '10:00', to: '11:00' });

    // Windows are in the business time (UTC+5): 10:00 there = 05:00 UTC; both people free at 10:00, only the owner at 11:00
    const slots = await calendarService.freeSlots(business.id, new Date('2026-10-13T00:00:00Z'));
    assert.strictEqual(slots.length, 28, '14 days × 2 hours');
    assert.strictEqual(slots[0].at, '2026-10-13T05:00:00.000Z');
    assert.deepStrictEqual(slots[0].hosts.sort(), [expertA_InternalId, assistantUser.id].sort());
    assert.deepStrictEqual(slots[1].hosts, [expertA_InternalId]);
    assert.strictEqual((await calendarService.freeSlots(business.id, new Date('2026-10-13T04:30:00Z')))[0].at, '2026-10-13T06:00:00.000Z', 'Not sooner than an hour from now');

    // The client books in the chat; the button appears when the conversation is about a meeting
    const view = await api('GET', `/api/chat/${projectA.slug}/calendar`, tokenClient);
    assert.strictEqual(view.status, 200);
    assert.strictEqual(view.body.meeting, null);
    const now = Date.now();
    const both = (await calendarService.freeSlots(business.id)).find(s => s.hosts.length === 2 && new Date(s.at) - now > 5 * 3600000);
    telegramBot.testOutbox.length = 0;
    const booked = await api('POST', `/api/chat/${projectA.slug}/calendar/book`, tokenClient, { at: both.at, tzOffset: 180 });
    assert.strictEqual(booked.status, 201);
    assert(['https://zoom.us/j/111', 'https://zoom.us/j/222'].includes(booked.body.meeting.zoomUrl), 'The Zoom link of the person who takes it');
    assert.strictEqual(booked.body.calendar.meeting.canCancel, true);
    assert.strictEqual(booked.body.calendar.meeting.canReschedule, false, 'The expert did not allow moving');
    const thread = await api('GET', `/api/chat/${projectA.slug}/messages`, tokenClient);
    assert(thread.body.messages.some(m => m.sender === 'ai' && m.text.includes('Вы записаны') && m.text.includes('zoom.us')));
    assert.strictEqual(thread.body.tools.booking, 'meeting');
    const lead = await db.get('SELECT * FROM clients WHERE project_id = ? AND external_client_id = ?', [projectA.id, clientUser.id]);
    assert(await funnelService.hasEvent(lead.id, 'booked'), '«Записался» in the journal');
    assert(telegramBot.testOutbox.some(m => m.userId === expertA_InternalId && m.text.includes('Новая запись') && m.reply_markup.inline_keyboard[0][0].url.includes('CAL')));
    assert.strictEqual((await api('POST', `/api/chat/${projectA.slug}/calendar/book`, tokenClient, { at: both.at })).status, 409, 'One upcoming meeting per client');

    // No double booking: the second person takes the other host, the third gets "занято"
    const second = await api('POST', `/api/chat/${projectA.slug}/calendar/book`, tokenB, { at: both.at });
    assert.strictEqual(second.status, 201);
    assert.notStrictEqual(second.body.meeting.zoomUrl, booked.body.meeting.zoomUrl);
    const third = await api('POST', `/api/chat/${projectA.slug}/calendar/book`, tokenOther, { at: both.at });
    assert.strictEqual(third.status, 409);
    assert.strictEqual(third.body.code, 'TAKEN');
    await assert.rejects(db.run(
      `INSERT INTO meetings (id, business_id, client_id, host_user_id, starts_at, ends_at, status) VALUES ('mtg_dup', ?, ?, ?, ?, ?, 'booked')`,
      [business.id, lead.id, expertA_InternalId, (await db.get('SELECT starts_at FROM meetings WHERE id = ?', [booked.body.meeting.id])).starts_at, '2030-01-01 00:00:00']
    ), 'The database itself refuses a second booked meeting at the same time');

    // The expert's rules: moving is off; cancelling is on (more than 3 hours before)
    const meetingId = booked.body.meeting.id;
    const later = (await calendarService.freeSlots(business.id)).find(s => new Date(s.at) - now > 5 * 3600000);
    assert.strictEqual((await api('POST', `/api/chat/${projectA.slug}/calendar/${meetingId}/reschedule`, tokenClient, { at: later.at })).status, 403);
    await api('PUT', '/api/business/calendar/settings', tokenA, { clientCanReschedule: true });
    const moved = await api('POST', `/api/chat/${projectA.slug}/calendar/${meetingId}/reschedule`, tokenClient, { at: later.at });
    assert.strictEqual(moved.status, 200);
    assert.strictEqual((await db.get('SELECT status FROM meetings WHERE id = ?', [meetingId])).status, 'rescheduled');
    assert(await funnelService.hasEvent(lead.id, 'meeting_moved'));
    assert.strictEqual(calendarService.clientMay('cancel', { startsAt: new Date(now + 2 * 3600000).toISOString() }, { clientCanCancel: true, hoursBefore: 3 }), false, 'Too late to cancel by the rules');
    const cancelled = await api('POST', `/api/chat/${projectA.slug}/calendar/${moved.body.meeting.id}/cancel`, tokenClient);
    assert.strictEqual(cancelled.status, 200);
    assert.strictEqual(cancelled.body.calendar.meeting, null);
    assert(await funnelService.hasEvent(lead.id, 'meeting_cancelled'));

    // The assistant sees the meetings and may cancel; the outcome only after the start
    const bMeeting = second.body.meeting.id;
    assert.strictEqual((await api('POST', `/api/business/calendar/meetings/${bMeeting}`, tokenAssistant, { businessId: business.id, action: 'done' })).status, 400);
    const reminders = await calendarService.runMeetingReminders(new Date(new Date(second.body.meeting.startsAt).getTime() - 30 * 60000));
    assert.strictEqual(reminders.sent, 1, 'A reminder an hour before');
    assert(telegramBot.testOutbox.some(m => m.userId === expertB_InternalId && m.text.includes('Через час')), 'The client gets it');
    assert.strictEqual((await calendarService.runMeetingReminders(new Date(new Date(second.body.meeting.startsAt).getTime() - 20 * 60000))).sent, 0, 'Only once');
    const byAssistant = await api('POST', `/api/business/calendar/meetings/${bMeeting}`, tokenAssistant, { businessId: business.id, action: 'cancel' });
    assert.strictEqual(byAssistant.status, 200);
    assert.strictEqual(byAssistant.body.meetings.find(m => m.id === bMeeting).status, 'cancelled');
    assert.strictEqual((await api('POST', `/api/business/calendar/meetings/${bMeeting}`, tokenOther, { businessId: business.id, action: 'cancel' })).status, 404);

    // Close the calendar again for the next tests
    await db.run('DELETE FROM calendar_hosts WHERE business_id = ?', [business.id]);
  });

  const profileService = require('../server/services/profile-service');
  await test('53. Люди: поиск, переписка «Принять / Заблокировать», лимиты от спама, жалоба команде', async () => {
    const otherUserId = () => otherIdForSpam;
    const otherIdForSpam = (await authService.findOrCreateTelegramUser(otherTg, 'expert')).id;
    const meA = await db.get('SELECT * FROM users WHERE id = ?', [expertA_InternalId]);
    const nameA = profileService.toPublicUser(meA).displayName;
    // Search by name (any case), @username; not myself; hidden people are not found
    const q = nameA.slice(0, 4).toLowerCase();
    let found = await api('GET', `/api/people/search?q=${encodeURIComponent(q)}`, tokenClient);
    assert.strictEqual(found.status, 200);
    assert(found.body.people.some(p => p.id === expertA_InternalId), 'Found by the start of the name, lower case');
    assert(!JSON.stringify(found.body).includes('SF-'), 'No support numbers in search');
    assert.strictEqual((await api('GET', `/api/people/search?q=${encodeURIComponent(q)}`, tokenA)).body.people.some(p => p.id === expertA_InternalId), false, 'Not myself');
    assert((await api('GET', '/api/people/search?q=@client_ser', tokenA)).body.people.some(p => p.id === clientUser.id), 'Found by @username');
    assert.strictEqual((await api('GET', '/api/people/search?q=a', tokenA)).body.people.length, 0, 'At least 2 letters');
    assert.strictEqual((await api('GET', '/api/people/search?q=client', null)).status, 401, 'Only after signing in');
    // Keywords from the line under the name and «О себе», several words at once
    await profileService.updateProfile(clientUser.id, { headline: 'Коуч по продажам', bio: 'Помогаю экспертам запускать марафоны' });
    assert((await api('GET', '/api/people/search?q=' + encodeURIComponent('марафон коуч'), tokenA)).body.people.some(p => p.id === clientUser.id), 'Found by keywords');
    assert.strictEqual((await api('GET', '/api/people/search?q=' + encodeURIComponent('марафон дизайн'), tokenA)).body.people.some(p => p.id === clientUser.id), false, 'Every word must match');
    await api('PUT', '/api/people/visibility', tokenClient, { hidden: true });
    assert.strictEqual((await api('GET', '/api/people/search?q=@client_ser', tokenA)).body.people.length, 0, 'Hidden from search');
    assert.strictEqual((await api('GET', '/api/auth/me', tokenClient)).body.user.hiddenFromSearch, true);
    await api('PUT', '/api/people/visibility', tokenClient, { hidden: false });

    // The first message arrives with «Принять / Заблокировать»; Buddy + Telegram once per unread run
    telegramBot.testOutbox.length = 0;
    const url = `/api/people/${expertA_InternalId}`;
    assert.strictEqual((await api('POST', `/api/people/${clientUser.id}/messages`, tokenClient, { text: 'себе' })).status, 400, 'Not to myself');
    assert.strictEqual((await api('POST', `${url}/messages`, tokenClient, { text: 'Здравствуйте! Хочу познакомиться' })).status, 201);
    await api('POST', `${url}/messages`, tokenClient, { text: 'Я тоже из продаж' });
    assert.strictEqual(telegramBot.testOutbox.filter(m => m.userId === expertA_InternalId).length, 1, 'One notification while unread');
    assert(telegramBot.testOutbox[0].text.includes('хочет с вами пообщаться'));
    assert(telegramBot.testOutbox[0].reply_markup.inline_keyboard[0][0].url.includes(`U_${clientUser.id}`));
    await api('POST', `${url}/messages`, tokenClient, { text: 'Третье' });
    const fourth = await api('POST', `${url}/messages`, tokenClient, { text: 'Четвёртое' });
    assert.strictEqual(fourth.status, 429, 'Until accepted — at most 3 messages');

    let chatsA = (await api('GET', '/api/people/chats', tokenA)).body.chats;
    const forA = chatsA.find(c => c.person.id === clientUser.id);
    assert.strictEqual(forA.needsMyAnswer, true);
    assert.strictEqual(forA.unread, true);
    const convA = await api('GET', `/api/people/${clientUser.id}/messages`, tokenA);
    assert.deepStrictEqual(convA.body.messages.map(m => m.text), ['Здравствуйте! Хочу познакомиться', 'Я тоже из продаж', 'Третье'], 'In order');
    assert.strictEqual((await api('GET', '/api/people/chats', tokenA)).body.chats.find(c => c.person.id === clientUser.id).unread, false, 'Opened = read');
    assert.strictEqual((await api('GET', `/api/people/${clientUser.id}/messages`, tokenOther)).body.messages.length, 0, 'Others do not see it');

    // Answering accepts; then both write freely
    assert.strictEqual((await api('POST', `/api/people/${clientUser.id}/messages`, tokenA, { text: 'Привет! Рада знакомству' })).status, 201);
    assert.strictEqual((await api('GET', `${url}/messages`, tokenClient)).body.thread.status, 'accepted');
    assert.strictEqual((await api('POST', `${url}/messages`, tokenClient, { text: 'Отлично!' })).status, 201);

    // Voice (1.5 min), photo and a round video (30 s); files go only to the two people
    const sendFile = (kind, body, seconds = '') => fetch(`${baseUrl}${url}/files?kind=${kind}&seconds=${seconds}`, {
      method: 'POST', headers: { Authorization: `Bearer ${tokenClient}`, 'Content-Type': 'application/octet-stream' }, body
    }).then(async r => ({ status: r.status, body: await r.json() }));
    const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(500, 1)]);
    const webm = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(800, 2)]);
    const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypmp42'), Buffer.alloc(800, 3)]);
    assert.strictEqual((await sendFile('photo', Buffer.from('<svg onload=alert(1)>  not a photo'))).status, 400, 'Only real photos');
    assert.strictEqual((await sendFile('gif', jpeg)).status, 400);
    const photo = await sendFile('photo', jpeg);
    assert.strictEqual(photo.status, 201);
    assert.strictEqual(photo.body.message.kind, 'photo');
    const voice = await sendFile('voice', webm, 500);
    assert.strictEqual(voice.body.message.seconds, 90, 'Voice up to 1.5 minutes');
    const circle = await sendFile('video', mp4, 45);
    assert.strictEqual(circle.body.message.kind, 'video');
    assert.strictEqual(circle.body.message.seconds, 30, 'A round video up to 30 seconds');
    const fileUrl = `/api/people/${clientUser.id}/files/${circle.body.message.fileId}`;
    const got = await fetch(baseUrl + fileUrl, { headers: { Authorization: `Bearer ${tokenA}` } });
    assert.strictEqual(got.status, 200, 'The other person gets the file');
    assert.strictEqual(got.headers.get('content-type'), 'video/mp4');
    assert.strictEqual((await fetch(`${baseUrl}/api/people/${clientUser.id}/files/${circle.body.message.fileId}`, { headers: { Authorization: `Bearer ${tokenOther}` } })).status, 404, 'Others do not');
    const listA = (await api('GET', '/api/people/chats', tokenA)).body.chats.find(c => c.person.id === clientUser.id);
    assert.strictEqual(listA.lastMessage, '🎥 Видео');

    // Block: the other side cannot write and does not find the blocker; unblock works
    const blocked = await api('POST', `/api/people/${clientUser.id}/answer`, tokenA, { action: 'block' });
    assert.strictEqual(blocked.body.thread.blockedByMe, true);
    const refused = await api('POST', `${url}/messages`, tokenClient, { text: 'Ещё' });
    assert.strictEqual(refused.status, 403);
    assert(!refused.body.message.includes('заблок'), 'The blocked person is not told about the block');
    assert.strictEqual((await api('GET', `/api/people/search?q=${encodeURIComponent(q)}`, tokenClient)).body.people.some(p => p.id === expertA_InternalId), false);
    await api('POST', `/api/people/${clientUser.id}/answer`, tokenA, { action: 'unblock' });
    assert.strictEqual((await api('POST', `${url}/messages`, tokenClient, { text: 'Снова на связи' })).status, 201);

    // The complaint goes to the team with the last messages; the person is blocked
    telegramBot.testOutbox.length = 0;
    const report = await api('POST', `/api/people/${expertA_InternalId}/report`, tokenOther, { reason: 'спам' });
    assert.strictEqual(report.status, 404, 'Only about a real conversation');
    assert.strictEqual((await api('POST', `${url}/report`, tokenClient, { reason: 'грубит' })).status, 200);
    // By its text: two complaints within one second have no fixed order
    const fb = await db.get(`SELECT * FROM feedback WHERE user_id = ? AND text LIKE ? ORDER BY created_at DESC LIMIT 1`, [clientUser.id, '%грубит%']);
    assert(fb && fb.text.includes('грубит') && fb.text.includes('Снова на связи'), 'The team sees the reason and the last messages');
    assert.strictEqual((await api('POST', `/api/people/${clientUser.id}/messages`, tokenA, { text: 'Почему?' })).status, 403, 'After a complaint the person is blocked');

    // At most 20 new conversations a day
    const peopleService = require('../server/services/people-service');
    for (let i = 0; i < peopleService.NEW_PER_DAY; i++) {
      await db.run(`INSERT INTO users (id, display_name) VALUES (?, ?)`, [`usr_spam_${i}`, `Цель ${i}`]);
      if (i < peopleService.NEW_PER_DAY - 1) await peopleService.send(otherUserId(), `usr_spam_${i}`, 'Реклама');
    }
    assert.strictEqual((await api('POST', `/api/people/usr_spam_${peopleService.NEW_PER_DAY - 1}/messages`, tokenOther, { text: 'Реклама' })).status, 201);
    await db.run(`INSERT INTO users (id, display_name) VALUES ('usr_spam_x', 'Ещё')`);
    assert.strictEqual((await api('POST', '/api/people/usr_spam_x/messages', tokenOther, { text: 'Реклама' })).status, 429);
  });

  await test('54. Шаги воронки: SI видит шаг клиента и ведёт дальше, материал шага, сценарии шага, «По шагам»', async () => {
    const settings = projectService.safeJsonParse((await db.get('SELECT custom_ai_settings FROM projects WHERE id = ?', [projectA.id])).custom_ai_settings);
    const put = await api('PUT', `/api/projects/${projectA.id}`, tokenA, {
      custom_ai_settings: {
        ...settings,
        steps: [
          { id: 'stp_hello', title: 'Знакомство', goal: 'узнать ситуацию клиента', doneWhen: 'клиент рассказал о себе или написал «готов»' },
          { id: 'stp_lesson', title: 'Материал', goal: 'дать бесплатный урок', doneWhen: 'клиент посмотрел урок', material: 'Вот бесплатный урок: https://example.com/lesson' },
          { title: '' },
          { id: 'stp_offer', title: 'Оффер', goal: 'предложить разбор' },
          ...Array.from({ length: 10 }, (_, i) => ({ title: `Лишний ${i}` }))
        ],
        scenarios: [
          { id: 'scn_onlesson', when: 'step_reached', step: 'stp_lesson', then: 'notify', text: 'Клиент получил урок' },
          { id: 'scn_lessonq', when: 'custom', step: 'stp_lesson', condition: 'клиент спрашивает про сертификат', then: 'notify' },
          { when: 'step_reached', step: 'stp_missing', then: 'notify' },
          { when: 'step_reached', then: 'notify' }
        ]
      }
    });
    assert.strictEqual(put.status, 200);
    const saved = put.body.custom_ai_settings;
    assert.strictEqual(saved.steps.length, 8, 'Up to 8 steps, a step without a title is dropped');
    assert.deepStrictEqual(saved.steps.slice(0, 3).map(s => s.id), ['stp_hello', 'stp_lesson', 'stp_offer']);
    assert.deepStrictEqual(saved.scenarios.map(s => s.id), ['scn_onlesson', 'scn_lessonq'], 'Scenarios of a missing step are dropped');
    await api('PUT', `/api/projects/${projectA.id}`, tokenA, { custom_ai_settings: { ...saved, steps: saved.steps.slice(0, 3) } });

    const tg = { id: 700054, first_name: 'Шаги' };
    const token = await tokenFor(tg);
    const realFetch = global.fetch;
    const originalKey = config.openaiApiKey;
    config.openaiApiKey = 'sk-test-not-real';
    let stepsDone = 1;
    let conditions = [];
    let system = '';
    let analysisPrompt = '';
    global.fetch = async (url, options) => {
      if (String(url).startsWith('https://api.openai.com/')) {
        const body = JSON.parse(options.body);
        if (body.response_format) {
          analysisPrompt = body.messages[0].content;
          return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ offer_made: false, offer_answered: false, objection: '', refused: false, conditions, steps_done: stepsDone }) } }] }), { status: 200 });
        }
        system = body.messages[0].content;
        return new Response(JSON.stringify({ choices: [{ message: { content: 'Понимаю!' } }] }), { status: 200 });
      }
      return realFetch(url, options);
    };
    let lead;
    try {
      telegramBot.testOutbox.length = 0;
      await api('POST', `/api/chat/${projectA.slug}/messages`, token, { text: 'Я веду блог, хочу продавать' });
      assert(system.includes('Сейчас клиент на шаге 1 «Знакомство»'), 'The SI sees the client\'s step');
      assert(system.includes('мягко переходи к шагу 2 «Материал»'));
      assert(!system.includes('https://example.com/lesson'), 'The material of a later step is not in the prompt');
      assert(analysisPrompt.includes('Клиент сейчас на шаге 1') && analysisPrompt.includes('пройден, когда клиент посмотрел урок'));
      assert(!analysisPrompt.includes('сертификат'), 'A condition of another step is not looked for');
      lead = await db.get('SELECT * FROM clients WHERE project_id = ? AND external_client_id = ?', [projectA.id, (await authService.findOrCreateTelegramUser(tg, 'expert')).id]);
      assert.strictEqual(lead.step_id, 'stp_lesson', 'The client moved to the next step');
      let history = (await api('GET', `/api/chat/${projectA.slug}/messages`, token)).body.messages;
      assert.deepStrictEqual(history.slice(-2).map(m => m.text), ['Понимаю!', 'Вот бесплатный урок: https://example.com/lesson'], 'The material comes after the SI reply');
      assert(telegramBot.testOutbox.some(m => m.userId === expertA_InternalId && m.text.includes('Перешёл на шаг «Материал»') && m.text.includes('Клиент получил урок')));

      // On step 2: its condition is looked for; "steps_done" below the client's step never moves back
      stepsDone = 1;
      conditions = [1];
      await api('POST', `/api/chat/${projectA.slug}/messages`, token, { text: 'А сертификат будет?' });
      assert(system.includes('Сейчас клиент на шаге 2 «Материал»') && system.includes('уже получил отдельным сообщением'));
      assert(analysisPrompt.includes('1. клиент спрашивает про сертификат'));
      lead = await db.get('SELECT * FROM clients WHERE id = ?', [lead.id]);
      assert.strictEqual(lead.step_id, 'stp_lesson', 'The SI never moves a client back');
      assert(telegramBot.testOutbox.some(m => m.text.includes('клиент спрашивает про сертификат')));
      history = (await api('GET', `/api/chat/${projectA.slug}/messages`, token)).body.messages;
      assert.strictEqual(history.filter(m => m.text.includes('бесплатный урок')).length, 1);
    } finally {
      global.fetch = realFetch;
      config.openaiApiKey = originalKey;
    }

    // Without OpenAI: a word in quotes from "пройден, когда"
    const tg2 = { id: 700055, first_name: 'Готов' };
    const token2 = await tokenFor(tg2);
    await api('POST', `/api/chat/${projectA.slug}/messages`, token2, { text: 'Я готов!' });
    const lead2 = await db.get('SELECT * FROM clients WHERE project_id = ? AND external_client_id = ?', [projectA.id, (await authService.findOrCreateTelegramUser(tg2, 'expert')).id]);
    assert.strictEqual(lead2.step_id, 'stp_lesson', 'Quoted words move the client without OpenAI');

    // A person moves a client by hand (the assistant too); no material is sent
    const card = await api('GET', `/api/projects/${projectA.id}/clients/${lead.id}`, tokenAssistant);
    assert.deepStrictEqual(card.body.steps.map(s => s.title), ['Знакомство', 'Материал', 'Оффер']);
    assert.strictEqual(card.body.current_step_id, 'stp_lesson');
    assert.strictEqual((await api('POST', `/api/projects/${projectA.id}/clients/${lead.id}/step`, tokenA, { stepId: 'stp_nope' })).status, 400);
    const moved = await api('POST', `/api/projects/${projectA.id}/clients/${lead.id}/step`, tokenAssistant, { stepId: 'stp_offer' });
    assert.strictEqual(moved.status, 200);
    assert(moved.body.events.some(e => e.type === 'step_reached' && e.detail === '«Оффер»' && e.actorType === 'assistant'));
    assert.strictEqual((await db.get('SELECT step_id FROM clients WHERE id = ?', [lead.id])).step_id, 'stp_offer');
    assert.strictEqual((await api('POST', `/api/projects/${projectA.id}/clients/${lead.id}/step`, tokenOther, { stepId: 'stp_hello' })).status, 403, 'Strangers cannot move clients');

    // "По шагам": reached / here now / where they stop; the list of one step
    const report = await api('GET', `/api/business/funnel/steps?projectId=${projectA.id}`, tokenAssistant);
    assert.strictEqual(report.status, 200);
    const [s1, s2, s3] = report.body.steps;
    assert.strictEqual(s3.reached, 1);
    assert.strictEqual(s2.reached, 2);
    assert(s1.reached >= s2.reached + 1, 'Everyone reached the first step');
    assert.strictEqual(s2.here, 1);
    assert.strictEqual(report.body.stopStepId, s1.here > 1 ? 'stp_hello' : report.body.stopStepId);
    const onStep = await api('GET', `/api/business/funnel/steps?projectId=${projectA.id}&step=stp_lesson`, tokenA);
    assert.deepStrictEqual(onStep.body.clients.map(c => c.id), [lead2.id]);
    const first = await api('GET', `/api/business/funnel/steps?projectId=${projectA.id}&step=stp_hello`, tokenA);
    assert.strictEqual(first.body.clients.length, s1.here, 'The first step lists clients without a step too');
    assert.strictEqual((await api('GET', `/api/business/funnel/steps?projectId=${projectA.id}`, tokenOther)).status, 404);

    // A step is deleted: its scenarios go with it
    const fresh = projectService.safeJsonParse((await db.get('SELECT custom_ai_settings FROM projects WHERE id = ?', [projectA.id])).custom_ai_settings);
    const cut = await api('PUT', `/api/projects/${projectA.id}`, tokenA, { custom_ai_settings: { ...fresh, steps: fresh.steps.filter(s => s.id !== 'stp_lesson') } });
    assert.deepStrictEqual(cut.body.custom_ai_settings.scenarios, []);

    await projectService.updateProject(projectA.id, { custom_ai_settings: settings });
  });

  await test('55. Календарь Бадди: планы словами, напоминание только по просьбе, встречи с экспертами, голосовые', async () => {
    const buddyService = require('../server/services/buddy-service');
    const tg = { id: 700056, first_name: 'Календарь' };
    const token = await tokenFor(tg);
    const user = await authService.findOrCreateTelegramUser(tg, 'expert');
    const local = new Date(Date.now() + 300 * 60000);
    local.setUTCDate(local.getUTCDate() + 1);
    const day = local.toISOString().slice(0, 10);

    // A meeting with an expert: the person is the client of projectA
    const project = await db.get('SELECT * FROM projects WHERE id = ?', [projectA.id]);
    const lead = await chatService.leadForUser(project, user.id);
    await db.run(
      `INSERT INTO meetings (id, business_id, project_id, client_id, host_user_id, starts_at, ends_at, status) VALUES (?, ?, ?, ?, ?, ?, ?, 'booked')`,
      ['mtg_buddycal', lead.business_id, project.id, lead.id, expertA_InternalId, `${day} 04:00:00`, `${day} 04:30:00`]
    );

    const realFetch = global.fetch;
    const originalKey = config.openaiApiKey;
    config.openaiApiKey = 'sk-test-not-real';
    let answer = {};
    let prompt = '';
    global.fetch = async (url, options) => {
      if (String(url) === 'https://api.openai.com/v1/audio/transcriptions') {
        return new Response(JSON.stringify({ text: 'Завтра в 18:00 ужин с Айнур' }), { status: 200 });
      }
      if (String(url).startsWith('https://api.openai.com/')) {
        prompt = JSON.parse(options.body).messages[0].content;
        return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(answer) } }] }), { status: 200 });
      }
      return realFetch(url, options);
    };
    try {
      answer = { reply: 'Добавил!', plans: [
        { text: 'Созвон с коучем по нутрициологии', at: `${day} 13:00`, remind_before: null },
        { text: 'Позвонить маме', at: `${day} 20:00`, remind_before: 30 }
      ], cancel: [], open: 'none' };
      const res = await api('POST', '/api/buddy/messages', token, { text: 'Завтра в 13 созвон с коучем, и напомни за полчаса позвонить маме в 20', tzOffset: 300 });
      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.body.calendarChanged, true);
      assert(prompt.includes('Встречи с экспертами') && prompt.includes(`Встреча: «${project.name}»`), 'Buddy knows the meetings');

      // Voice: transcribed and answered like text; the recording is not kept
      answer = { reply: 'Записал ужин.', plans: [{ text: 'Ужин с Айнур', at: `${day} 18:00`, remind_before: null }], cancel: [], open: 'none' };
      const webm = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(2000, 7)]);
      const voice = await fetch(`${baseUrl}/api/buddy/voice?seconds=4&tzOffset=300`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'audio/webm' }, body: webm
      }).then(async r => ({ status: r.status, body: await r.json() }));
      assert.strictEqual(voice.status, 201);
      assert.strictEqual(voice.body.messages[0].kind, 'voice');
      assert.strictEqual(voice.body.messages[0].text, 'Завтра в 18:00 ужин с Айнур');
      const bad = await fetch(`${baseUrl}/api/buddy/voice`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: Buffer.from('not audio, just text') });
      assert.strictEqual(bad.status, 400);
    } finally {
      global.fetch = realFetch;
      config.openaiApiKey = originalKey;
    }

    // The calendar of tomorrow (Almaty day): meeting 09:00, call 13:00, dinner 18:00, mama 20:00
    const from = new Date(Date.parse(`${day}T00:00:00Z`) - 300 * 60000).toISOString();
    const to = new Date(Date.parse(`${day}T00:00:00Z`) - 300 * 60000 + 86400000).toISOString();
    const cal = await api('GET', `/api/buddy/calendar?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, token);
    assert.strictEqual(cal.status, 200);
    assert.deepStrictEqual(cal.body.items.map(i => i.title), [`Встреча: «${project.name}»`, 'Созвон с коучем по нутрициологии', 'Ужин с Айнур', 'Позвонить маме']);
    const [meeting, coach, , mama] = cal.body.items;
    assert.strictEqual(meeting.kind, 'meeting');
    assert.strictEqual(coach.remindAt, null, 'No reminder unless asked');
    assert.strictEqual(new Date(mama.startsAt) - new Date(mama.remindAt), 30 * 60000, 'Reminded 30 minutes before');
    assert.strictEqual((await api('GET', `/api/buddy/calendar?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, tokenB)).body.items.length, 0, 'Nobody else sees it');

    // The alarm clock sends only what was asked, with the time of the plan
    telegramBot.testOutbox.length = 0;
    await buddyService.runReminders(new Date(Date.parse(mama.remindAt) + 1000));
    assert(telegramBot.testOutbox.some(m => m.text === '⏰ Скоро, в 20:00: Позвонить маме'));
    assert(!telegramBot.testOutbox.some(m => m.text.includes('коучем') || m.text.includes('Айнур')), 'Plans without a reminder stay quiet');

    // Remove a plan: only my own
    assert.strictEqual((await api('DELETE', `/api/buddy/plans/${coach.id}`, tokenB)).status, 404);
    assert.strictEqual((await api('DELETE', `/api/buddy/plans/${coach.id}`, token)).status, 200);
    const after = await api('GET', `/api/buddy/calendar?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, token);
    assert(!after.body.items.some(i => i.id === coach.id));
    await db.run('DELETE FROM meetings WHERE id = ?', ['mtg_buddycal']);
  });

  await test('56. Отзывы: только после «Купили», один на SI-продавца, короткое имя, ответ эксперта, жалоба и скрытие', async () => {
    const tg = { id: 700057, first_name: 'Анна', last_name: 'Каримова' };
    const token = await tokenFor(tg);
    const user = await authService.findOrCreateTelegramUser(tg, 'expert');
    await api('POST', `/api/chat/${projectA.slug}/messages`, token, { text: 'Здравствуйте, интересует курс' });
    const lead = await db.get('SELECT * FROM clients WHERE project_id = ? AND external_client_id = ?', [projectA.id, user.id]);
    await db.run('UPDATE projects SET is_listed = 1, status = ? WHERE id = ?', ['active', projectA.id]);

    let mine = await api('GET', `/api/chat/${projectA.slug}/review`, token);
    assert.strictEqual(mine.body.canReview, false);
    assert.strictEqual((await api('POST', `/api/chat/${projectA.slug}/review`, token, { rating: 5, text: 'Супер' })).status, 403, 'Only after a purchase');

    // The expert marks "Купил" → the client may write one review
    await api('POST', `/api/projects/${projectA.id}/clients/${lead.id}/funnel`, tokenA, { outcome: 'paid' });
    assert.strictEqual((await api('GET', `/api/chat/${projectA.slug}/review`, token)).body.canReview, true);
    assert.strictEqual((await api('POST', `/api/chat/${projectA.slug}/review`, token, { rating: 7 })).status, 400, 'Rating 1–5');
    telegramBot.testOutbox.length = 0;
    const created = await api('POST', `/api/chat/${projectA.slug}/review`, token, { rating: 4, text: 'Очень помогло разобраться в продажах' });
    assert.strictEqual(created.status, 201);
    assert(telegramBot.testOutbox.some(m => m.userId === expertA_InternalId && m.text.includes('4 из 5') && m.text.includes('Анна К.')), 'The expert learns about a new review');
    const changed = await api('POST', `/api/chat/${projectA.slug}/review`, token, { rating: 5, text: 'Очень помогло разобраться в продажах!' });
    assert.strictEqual(changed.status, 200, 'The same review is changed, not a second one');
    assert.strictEqual(Number((await db.get('SELECT COUNT(*) AS n FROM reviews WHERE project_id = ?', [projectA.id])).n), 1);

    // Public: the short name only, the average
    let pub = await api('GET', `/api/marketplace/consultants/${projectA.id}/reviews`);
    assert.strictEqual(pub.status, 200);
    assert.deepStrictEqual([pub.body.count, pub.body.average], [1, 5]);
    assert.strictEqual(pub.body.reviews[0].name, 'Анна К.');
    assert(!JSON.stringify(pub.body).includes('Каримова') && !JSON.stringify(pub.body).includes(user.id), 'No full name or id');
    const card = (await api('GET', `/api/marketplace/consultants/${projectA.id}`)).body.consultant;
    assert.deepStrictEqual(card.reviews, { count: 1, average: 5 });

    // The expert answers, cannot delete; the assistant and strangers cannot answer
    const reviewId = pub.body.reviews[0].id;
    assert.strictEqual((await api('POST', `/api/projects/${projectA.id}/reviews/${reviewId}/reply`, tokenB, { text: 'x' })).status, 403);
    const replied = await api('POST', `/api/projects/${projectA.id}/reviews/${reviewId}/reply`, tokenA, { text: 'Спасибо, Анна!' });
    assert.strictEqual(replied.status, 200);
    assert.strictEqual((await api('GET', `/api/marketplace/consultants/${projectA.id}/reviews`)).body.reviews[0].reply, 'Спасибо, Анна!');
    assert.strictEqual((await api('DELETE', `/api/projects/${projectA.id}/reviews/${reviewId}`, tokenA)).status, 404, 'There is no way to delete');

    // A complaint goes to the team; the team hides the review on the author's card
    assert.strictEqual((await api('POST', `/api/marketplace/reviews/${reviewId}/report`, tokenB, { reason: 'неправда' })).status, 200);
    const fb = await db.get(`SELECT text FROM feedback WHERE user_id = ? AND text LIKE ? LIMIT 1`, [expertB_InternalId, '%Жалоба на отзыв%']);
    assert(fb && fb.text.includes('неправда'));
    const fixes = require('../server/services/support-fixes');
    await fixes.applyFix('review_visibility', user.id, { reviewId, visible: false }, 1, { userId: expertA_InternalId, role: 'owner' });
    pub = await api('GET', `/api/marketplace/consultants/${projectA.id}/reviews`);
    assert.deepStrictEqual([pub.body.count, pub.body.reviews.length], [0, 0], 'A hidden review is not shown nor counted');
    assert.strictEqual((await api('GET', `/api/chat/${projectA.slug}/review`, token)).body.review.hidden, true, 'The author still sees it');
    await db.run('DELETE FROM reviews WHERE id = ?', [reviewId]);
  });

  await test('57. PostHog: события только с сервера, без личных данных; без ключа ничего не отправляется', async () => {
    const analytics = require('../server/services/analytics-service');
    const sent = [];
    analytics._setClientForTests({ capture: (e) => sent.push(e) });
    try {
      const tg = { id: 700058, first_name: 'Айгуль', last_name: 'Секретова', username: 'aigul_secret' };
      const login = await api('POST', '/api/auth/telegram', null, { initData: createTelegramInitData(process.env.TELEGRAM_BOT_TOKEN, tg), role: 'expert' });
      assert.strictEqual(login.status, 200);
      const token = login.body.token;
      const user = await authService.findOrCreateTelegramUser(tg, 'expert');
      await api('POST', `/api/chat/${projectA.slug}/start`, token);
      await api('POST', `/api/chat/${projectA.slug}/messages`, token, { text: 'Мой телефон +77011234567, хочу купить' });
      await api('POST', `/api/chat/${projectA.slug}/events`, token, { type: 'buy_clicked' });
      await api('POST', '/api/buddy/messages', token, { text: 'Привет', tzOffset: 300 });

      const names = sent.map(e => e.event);
      for (const e of ['app_opened', 'si_chat_started', 'funnel_client_message', 'funnel_buy_clicked', 'buddy_message']) {
        assert(names.includes(e), `${e} is sent`);
      }
      const all = JSON.stringify(sent);
      for (const secret of ['Айгуль', 'Секретова', 'aigul_secret', '700058', '+77011234567', 'хочу купить', user.id]) {
        assert(!all.includes(secret), `No personal data: ${secret}`);
      }
      const mine = sent.filter(e => e.event === 'funnel_buy_clicked')[0];
      assert.strictEqual(mine.distinctId, analytics.personId(user.id), 'The same pseudonymous id for the person');
      assert.strictEqual(mine.properties.project_id, projectA.id);
    } finally {
      analytics._setClientForTests(null);
    }
    // Without POSTHOG_API_KEY (and in tests) nothing is sent and nothing breaks
    assert.strictEqual(analytics.isConfigured(), false);
    analytics.capture('anything', 'usr_x', { name: 'x' });
    assert.strictEqual((await api('GET', '/api/health')).body.posthog.configured, false);
  });

  await test('58. Рассылки: помощник готовит, владелец одобряет; не получают отказавшиеся и отписавшиеся; лимиты и ночь', async () => {
    const broadcastService = require('../server/services/broadcast-service');
    const mk = async (id, name) => {
      const tg = { id, first_name: name };
      const token = await tokenFor(tg);
      const user = await authService.findOrCreateTelegramUser(tg, 'expert');
      await api('POST', `/api/chat/${projectA.slug}/messages`, token, { text: 'Здравствуйте!' });
      const lead = await db.get('SELECT * FROM clients WHERE project_id = ? AND external_client_id = ?', [projectA.id, user.id]);
      return { token, user, lead };
    };
    const night = await mk(700081, 'Сова');
    const refused = await mk(700082, 'Нет');
    const off = await mk(700083, 'Тишина');
    await api('POST', `/api/projects/${projectA.id}/clients/${refused.lead.id}/funnel`, tokenA, { outcome: 'refused' });
    const optOut = await api('POST', `/api/chat/${projectA.slug}/broadcasts`, off.token, { off: true });
    assert.strictEqual(optOut.body.broadcastsOff, true);
    assert.strictEqual((await api('GET', `/api/chat/${projectA.slug}/messages`, off.token)).body.broadcastsOff, true);
    // Noon for everybody else and 3 a.m. for this client right now (otherwise the test fails
    // at night by the default Almaty time, when nobody may get a broadcast)
    await db.run('UPDATE users SET tz_offset_minutes = ?', [((12 - new Date().getUTCHours() + 36) % 24 - 12) * 60]);
    await db.run('UPDATE users SET tz_offset_minutes = ? WHERE id = ?', [((3 - new Date().getUTCHours() + 36) % 24 - 12) * 60, night.user.id]);

    // Without OpenAI the form is filled by hand
    assert.strictEqual((await api('POST', `/api/projects/${projectA.id}/broadcasts/plan`, tokenA, { request: 'всем анонс эфира' })).body.plan, null);
    const pre = await api('POST', `/api/projects/${projectA.id}/broadcasts/preview`, tokenA, { audience: { statuses: ['refused', 'bogus'] } });
    assert.deepStrictEqual(pre.body.audience.statuses, [], 'Refused can never be chosen');
    const expected = pre.body.count;
    assert(expected >= 2);
    const ids = (await db.all(`SELECT id FROM clients WHERE project_id = ?`, [projectA.id])).map(r => r.id);
    assert(ids.includes(night.lead.id));

    // The assistant prepares → the owner is asked; the assistant cannot send
    telegramBot.testOutbox.length = 0;
    const draft = await api('POST', `/api/projects/${projectA.id}/broadcasts`, tokenAssistant, { request: 'анонс', audience: {}, text: 'Друзья, в субботу в 19:00 бесплатный эфир!', send: true });
    assert.strictEqual(draft.status, 201);
    assert.strictEqual(draft.body.broadcast.status, 'pending_approval', 'The assistant cannot send by themselves');
    assert(telegramBot.testOutbox.some(m => m.userId === expertA_InternalId && m.text.includes('Помощник подготовил рассылку')));
    assert.strictEqual((await api('POST', `/api/projects/${projectA.id}/broadcasts/${draft.body.broadcast.id}/approve`, tokenAssistant)).status, 403);
    assert.strictEqual((await api('POST', `/api/projects/${projectA.id}/broadcasts/${draft.body.broadcast.id}/approve`, tokenB)).status, 403, 'Strangers cannot');

    const approved = await api('POST', `/api/projects/${projectA.id}/broadcasts/${draft.body.broadcast.id}/approve`, tokenA);
    assert.strictEqual(approved.status, 200);
    assert.strictEqual(approved.body.broadcast.status, 'sending');
    assert.strictEqual(approved.body.broadcast.total, expected);
    const recipients = (await db.all('SELECT client_id FROM broadcast_recipients WHERE broadcast_id = ?', [draft.body.broadcast.id])).map(r => r.client_id);
    assert(!recipients.includes(refused.lead.id) && !recipients.includes(off.lead.id), 'No refused or opted-out');

    // A second one today is refused (1 a day)
    const second = await api('POST', `/api/projects/${projectA.id}/broadcasts`, tokenA, { audience: {}, text: 'Ещё новость', send: true });
    assert.strictEqual(second.status, 429);

    // The alarm clock: everybody but the "night" client now; the night one in the morning
    telegramBot.testOutbox.length = 0;
    await broadcastService.runBroadcasts(new Date());
    let row = await db.get('SELECT * FROM broadcasts WHERE id = ?', [draft.body.broadcast.id]);
    assert.strictEqual(row.status, 'sending', 'Waits for the night client');
    assert.strictEqual(Number(row.sent), expected - 1);
    const pending = await db.get(`SELECT status FROM broadcast_recipients WHERE broadcast_id = ? AND client_id = ?`, [row.id, night.lead.id]);
    assert.strictEqual(pending.status, 'pending');
    await broadcastService.runBroadcasts(new Date(Date.now() + 8 * 3600000));
    row = await db.get('SELECT * FROM broadcasts WHERE id = ?', [row.id]);
    assert.deepStrictEqual([row.status, Number(row.sent)], ['sent', expected]);
    assert(telegramBot.testOutbox.some(m => m.text.startsWith('📣 Рассылка') && m.text.includes(`получили ${expected} из ${expected}`)), 'The owner is told it is done');

    // In the client's chat: a message from the expert marked as a broadcast; the SI keeps answering
    const chat = (await api('GET', `/api/chat/${projectA.slug}/messages`, night.token)).body;
    const last = chat.messages.at(-1);
    assert.strictEqual(last.isBroadcast, true);
    assert.strictEqual(last.text, 'Друзья, в субботу в 19:00 бесплатный эфир!');
    assert.strictEqual(chat.siPaused, false, 'A broadcast does not pause the SI');
    assert(!(await api('GET', `/api/chat/${projectA.slug}/messages`, refused.token)).body.messages.some(m => m.isBroadcast));
    const events = (await api('GET', `/api/projects/${projectA.id}/clients/${night.lead.id}`, tokenA)).body.events;
    assert(events.some(e => e.type === 'broadcast'));

    // Follow-ups also wait for the client's morning
    assert.strictEqual(broadcastService.isDaytime(3), false);
    assert.strictEqual(broadcastService.isDaytime(12), true);
    await db.run(`UPDATE broadcasts SET started_at = '2020-01-01 00:00:00' WHERE project_id = ?`, [projectA.id]);
  });

  await test('59. Языки RU/EN для клиентов: язык из Telegram или выбранный, уведомления и Бадди на языке человека', async () => {
    const tg = { id: 700059, first_name: 'John', language_code: 'en' };
    const login = await api('POST', '/api/auth/telegram', null, { initData: createTelegramInitData(process.env.TELEGRAM_BOT_TOKEN, tg), role: 'expert' });
    assert.strictEqual(login.body.user.lang, 'en', 'English from Telegram');
    assert.strictEqual(login.body.user.langChosen, false);
    const token = login.body.token;
    const user = await authService.findOrCreateTelegramUser(tg, 'expert');

    // The SI greets in English (without OpenAI — the English template)
    const start = await api('POST', `/api/chat/${projectA.slug}/start`, token);
    assert(/^Hello! So glad you stopped by/.test(start.body.opener.text), 'The opener is in English');
    // Buddy's fixed texts are in English
    const buddy = await api('POST', '/api/buddy/messages', token, { text: 'Hi', tzOffset: 0 });
    assert(buddy.body.messages[1].text.startsWith('I cannot answer messages yet'));

    // Notifications to this client: English; the expert's stay Russian
    const lead = await db.get('SELECT * FROM clients WHERE project_id = ? AND external_client_id = ?', [projectA.id, user.id]);
    telegramBot.testOutbox.length = 0;
    const chatService = require('../server/services/chat-service');
    await chatService.humanReply(await db.get('SELECT * FROM projects WHERE id = ?', [projectA.id]), lead, 'Hello, John!', { userId: expertA_InternalId, role: 'owner' });
    const toJohn = telegramBot.testOutbox.find(m => m.userId === user.id);
    assert(toJohn && /replied to you personally/.test(toJohn.text), 'The client gets English');
    assert.strictEqual(toJohn.reply_markup.inline_keyboard[0][0].text, 'Open chat');

    // Chosen in Profile: Russian wins over Telegram; "auto" returns to Telegram's
    assert.strictEqual((await api('PUT', '/api/me/lang', token, { lang: 'ru' })).body.lang, 'ru');
    telegramBot.testOutbox.length = 0;
    await telegramBot.notifyUser(user.id, { ru: 'Привет', en: 'Hi' });
    assert.strictEqual(telegramBot.testOutbox[0].text, 'Привет');
    const relog = await api('POST', '/api/auth/telegram', null, { initData: createTelegramInitData(process.env.TELEGRAM_BOT_TOKEN, tg), role: 'expert' });
    assert.deepStrictEqual([relog.body.user.lang, relog.body.user.langChosen], ['ru', true], 'The choice is kept after a new sign-in');
    assert.strictEqual((await api('PUT', '/api/me/lang', token, { lang: 'auto' })).body.lang, 'en');

    // Russian-speaking Telegram languages stay Russian
    const i18n = require('../server/services/i18n');
    assert.strictEqual(i18n.langOf({ tg_lang: 'kk' }), 'ru');
    assert.strictEqual(i18n.langOf({ tg_lang: 'uk' }), 'ru');
    assert.strictEqual(i18n.langOf({ tg_lang: 'de' }), 'en');
    assert.strictEqual(i18n.langOf({}), 'ru');
  });

  await test('60. Альтернативный оффер: при возражении — до 3 SI-продавцов других экспертов, выше проработанные', async () => {
    const altService = require('../server/services/alt-offer-service');
    const chatService = require('../server/services/chat-service');
    const mkProject = async (ownerId, name, fields, settings = {}) => {
      const p = await projectService.createProject(ownerId, { name });
      const id = (p.project || p).id;
      await db.run(
        `UPDATE projects SET status = 'active', is_listed = ?, offer = ?, description = ?, price_label = ?, payment_url = ?, custom_ai_settings = ? WHERE id = ?`,
        [fields.listed === false ? 0 : 1, fields.offer, fields.description || '', fields.price || '', fields.pay || null, JSON.stringify(settings), id]
      );
      return id;
    };
    const otherOwner = await authService.findOrCreateTelegramUser({ id: 700060, first_name: 'Другой' }, 'expert');
    const strong = await mkProject(expertB_InternalId, 'Продажи в рассрочку', {
      offer: 'Курс продаж с оплатой частями', description: 'Подробно: модули, формат, поддержка, рассрочка без переплаты на 6 месяцев. '.repeat(5), price: '6 × 5 000 ₸', pay: 'https://pay.example.com/a'
    }, { methodology: 'Сначала узнаём бюджет, потом предлагаем рассрочку. '.repeat(20), scenarios: [
      { when: 'objection', words: 'дорого', then: 'si_says', text: 'Рассказать про оплату частями' },
      { when: 'custom', condition: 'клиент говорит, что нет денег', then: 'si_says', text: 'Предложить мини-курс' }
    ], steps: [{ title: 'Знакомство' }, { title: 'Оффер' }] });
    const weak = await mkProject(otherOwner.id, 'Мини-курс продаж', { offer: 'Мини-курс продаж за 3 дня', price: '9 000 ₸' });
    const own = await mkProject(expertA_InternalId, 'Ещё мой', { offer: 'Мой второй продукт про продажи' });
    const hidden = await mkProject(otherOwner.id, 'Скрытый', { offer: 'Скрытый курс продаж', listed: false });
    const rows = await db.all(`SELECT p.*, 0 AS review_count, 0 AS review_average, 0 AS materials FROM projects p WHERE p.id IN (?, ?)`, [strong, weak]);
    const score = (id) => altService.qualityScore(rows.find(r => r.id === id));
    assert(score(strong) > score(weak), 'A worked-out methodology scores higher');

    const tg = { id: 700061, first_name: 'Сомнение' };
    const token = await tokenFor(tg);
    const realFetch = global.fetch;
    const originalKey = config.openaiApiKey;
    config.openaiApiKey = 'sk-test-not-real';
    let pickPrompt = '';
    global.fetch = async (url, options) => {
      if (String(url).startsWith('https://api.openai.com/')) {
        const body = JSON.parse(options.body);
        const system = body.messages[0].content;
        if (system.includes('Клиент засомневался')) {
          pickPrompt = system;
          return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ ids: [weak, 'proj_bogus', strong, own] }) } }] }), { status: 200 });
        }
        const content = body.response_format
          ? JSON.stringify({ offer_made: false, offer_answered: true, objection: 'дорого', refused: false, conditions: [] })
          : 'Понимаю вас.';
        return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
      }
      return realFetch(url, options);
    };
    try {
      await api('POST', `/api/chat/${projectA.slug}/messages`, token, { text: 'Слишком дорого для меня сейчас' });
      await chatService.altOffersSettled();
    } finally {
      global.fetch = realFetch;
      config.openaiApiKey = originalKey;
    }
    assert(pickPrompt.indexOf(strong) < pickPrompt.indexOf(weak), 'Better worked-out ones come first in the list');
    assert(!pickPrompt.includes(own) && !pickPrompt.includes(hidden), 'Not the same expert, not unlisted');
    let chat = (await api('GET', `/api/chat/${projectA.slug}/messages`, token)).body;
    assert.deepStrictEqual(chat.altOffers.map(o => o.id), [weak, strong], 'SI’s choice, unknown ids dropped');
    assert.strictEqual(chat.altOffers[0].offer, 'Мини-курс продаж за 3 дня');
    const lead = await db.get('SELECT * FROM clients WHERE project_id = ? AND external_client_id = ?', [projectA.id, (await authService.findOrCreateTelegramUser(tg, 'expert')).id]);
    const events = (await api('GET', `/api/projects/${projectA.id}/clients/${lead.id}`, tokenA)).body.events;
    assert(!events.some(e => /alt|альтернатив/i.test(e.type + e.label)), 'Nothing about it in the first expert’s journal');

    // Without OpenAI: common words decide, then the quality
    const ids = await altService.refresh(await db.get('SELECT * FROM projects WHERE id = ?', [projectA.id]), lead, 'нет денег, нужна рассрочка', 'можно частями?');
    assert.strictEqual(ids[0], strong);
    // Bought here → no alternatives
    await db.run(`UPDATE clients SET funnel_status = 'bought' WHERE id = ?`, [lead.id]);
    chat = (await api('GET', `/api/chat/${projectA.slug}/messages`, token)).body;
    assert.deepStrictEqual(chat.altOffers, []);
    await db.run(`UPDATE projects SET is_listed = 0 WHERE id IN (?, ?, ?, ?)`, [strong, weak, own, hidden]);
  });

  await test('61. Ссылки с меткой источника, приглашения и партнёры: всё засчитывается своему SI-продавцу и человеку', async () => {
    const partnerService = require('../server/services/partner-service');
    const login = (tg, startParam) => api('POST', '/api/auth/telegram', null, { initData: createTelegramInitData(process.env.TELEGRAM_BOT_TOKEN, tg, 0, startParam), role: 'expert' });

    // Up to 3 links per SI-seller, the owner only
    assert.strictEqual((await api('POST', `/api/projects/${projectA.id}/links`, tokenA, { label: '' })).status, 400);
    assert.strictEqual((await api('POST', `/api/projects/${projectA.id}/links`, tokenAssistant, { label: 'Instagram' })).status, 403);
    const insta = (await api('POST', `/api/projects/${projectA.id}/links`, tokenA, { label: 'Instagram' })).body.link;
    const channel = (await api('POST', `/api/projects/${projectA.id}/links`, tokenA, { label: 'Канал' })).body.link;
    await api('POST', `/api/projects/${projectA.id}/links`, tokenA, { label: 'Блогер Айгерим' });
    assert.strictEqual((await api('POST', `/api/projects/${projectA.id}/links`, tokenA, { label: 'Четвёртая' })).status, 400, 'Not more than 3');
    assert.strictEqual(insta.url, `https://t.me/smartflow_ai_support_bot/app?startapp=${projectA.slug}__${insta.code}`);

    // A new person comes by the Instagram link and writes to the SI-seller
    const newbieTg = { id: 700071, first_name: 'Новичок' };
    const first = await login(newbieTg, `${projectA.slug}__${insta.code}`);
    assert.strictEqual(first.status, 200);
    await api('POST', `/api/chat/${projectA.slug}/messages`, first.body.token, { text: 'Привет из Instagram' });
    const newbie = await authService.findOrCreateTelegramUser(newbieTg, 'expert');
    assert.strictEqual((await db.get('SELECT referred_by_link FROM users WHERE id = ?', [newbie.id])).referred_by_link, insta.id);
    const lead = await db.get('SELECT * FROM clients WHERE project_id = ? AND external_client_id = ?', [projectA.id, newbie.id]);
    assert.strictEqual(lead.source_link_id, insta.id, 'The client belongs to the Instagram link');

    // A code glued to another SI-seller's name is not counted anywhere
    const fake = await login({ id: 700072, first_name: 'Хитрый' }, `another-seller__${insta.code}`);
    assert.strictEqual(fake.status, 200);
    // A known person: the visit counts, not as a new person; the first link of this SI-seller wins
    const knownTg = { id: 700073, first_name: 'Знакомый' };
    await login(knownTg, null);
    await login(knownTg, `${projectA.slug}__${channel.code}`);
    await login(knownTg, `${projectA.slug}__${insta.code}`);
    const known = await login(knownTg, `${projectA.slug}__${insta.code}`); // again within 12 hours: one visit
    await api('POST', `/api/chat/${projectA.slug}/messages`, known.body.token, { text: 'Здравствуйте' });
    const knownUser = await authService.findOrCreateTelegramUser(knownTg, 'expert');
    assert.strictEqual((await db.get('SELECT source_link_id FROM clients WHERE project_id = ? AND external_client_id = ?', [projectA.id, knownUser.id])).source_link_id, channel.id);
    assert.strictEqual((await db.get('SELECT referred_by_link FROM users WHERE id = ?', [knownUser.id])).referred_by_link, null, 'Not a new person');

    const links = (await api('GET', `/api/projects/${projectA.id}/links`, tokenA)).body;
    const instaStats = links.links.find(l => l.id === insta.id).stats;
    assert.deepStrictEqual([instaStats.opens, instaStats.people, instaStats.newPeople, instaStats.clients, instaStats.wrote], [2, 2, 1, 1, 1]);
    assert.strictEqual(links.links.find(l => l.id === channel.id).stats.clients, 1);

    // Hiding a link keeps it working and counted
    await api('DELETE', `/api/projects/${projectA.id}/links/${channel.id}`, tokenA);
    assert.strictEqual((await api('GET', `/api/projects/${projectA.id}/links`, tokenA)).body.links.length, 2);
    assert.strictEqual((await api('POST', `/api/projects/${projectA.id}/links`, tokenA, { label: 'TikTok' })).status, 201, 'A free place again');

    // Invitation link: people who come by it belong to the inviter; 10 people → SMARTFLOW PARTNER
    const ref = (await api('GET', '/api/me/referral', tokenB)).body;
    assert(/startapp=R_[a-z0-9]{6}$/.test(ref.url));
    assert.strictEqual(ref.partner, false);
    const code = ref.url.split('R_')[1];
    for (let i = 0; i < partnerService.PARTNER_MIN; i++) await login({ id: 700100 + i, first_name: `Друг${i}` }, `R_${code}`);
    const friend = await authService.findOrCreateTelegramUser({ id: 700100, first_name: 'Друг0' }, 'expert');
    const welcome = await db.get(`SELECT text FROM notifications WHERE user_id = ? AND sender = 'buddy'`, [friend.id]);
    assert(welcome && welcome.text.includes('Вас пригласил(а) Эксперт Борис'), 'The invited person is greeted by Buddy with the inviter\u2019s name');
    const again = (await api('GET', '/api/me/referral', tokenB)).body;
    assert.deepStrictEqual([again.brought, again.partner], [partnerService.PARTNER_MIN, true]);
    const pub = (await api('GET', `/api/marketplace/profiles/${expertB_InternalId}`)).body.profile;
    assert.deepStrictEqual(pub.partner, { count: partnerService.PARTNER_MIN });
    assert.strictEqual((await api('GET', `/api/marketplace/profiles/${expertA_InternalId}`)).body.profile.partner, null, 'Expert A brought 1 person: no medal yet');

    // The badge is shown next to the person everywhere: the phone gets the list of partners
    const partners = (await api('GET', '/api/marketplace/partners')).body.partners;
    assert.deepStrictEqual(partners, [{ id: expertB_InternalId, count: partnerService.PARTNER_MIN }]);
    // The partner writes their own invitation text; an empty one brings the standard text back
    assert.strictEqual(again.inviteText, null);
    const saved = await api('PUT', '/api/me/invite-text', tokenB, { text: '  Мой текст для друзей 🙂  ' });
    assert.strictEqual(saved.body.inviteText, 'Мой текст для друзей 🙂');
    assert.strictEqual((await api('GET', '/api/me/referral', tokenB)).body.inviteText, 'Мой текст для друзей 🙂');
    await api('PUT', '/api/me/profile', tokenB, { displayName: 'Эксперт Борис' });
    assert.strictEqual((await api('GET', '/api/me/referral', tokenB)).body.inviteText, 'Мой текст для друзей 🙂', 'Saving the profile keeps it');
    assert.strictEqual((await api('PUT', '/api/me/invite-text', tokenB, { text: ' ' })).body.inviteText, null);

    // Benefits: +10 Buddy messages a day for everyone brought; partners' SI-sellers go first in the Marketplace
    const buddyService = require('../server/services/buddy-service');
    assert.strictEqual((await buddyService.usage(expertB_InternalId, 0)).max, 30 + 10 * partnerService.PARTNER_MIN);
    assert.strictEqual((await buddyService.usage(expertA_InternalId, 0)).max, 40, 'Expert A brought 1 person');
    assert.strictEqual((await buddyService.usage(friend.id, 0)).max, 30);
    const bListed = await db.get(`SELECT id FROM projects WHERE owner_id = ? AND is_listed = 1 AND status = 'active' AND COALESCE(offer, '') <> ''`, [expertB_InternalId]);
    if (!bListed) {
      await db.run(`UPDATE projects SET is_listed = 1, status = 'active', offer = 'Разбор продаж' WHERE id = (SELECT id FROM projects WHERE owner_id = ? ORDER BY created_at LIMIT 1)`, [expertB_InternalId]);
    }
    const cards = (await api('GET', '/api/marketplace')).body.consultants;
    assert(cards.length > 1 && cards.some(c => c.author.id !== expertB_InternalId), 'There are other SI-sellers too');
    assert.strictEqual(cards[0].author.id, expertB_InternalId, 'The partner\u2019s SI-seller is in the top row');

    // The team sees who brings people and by which links
    assert.strictEqual((await api('GET', '/api/admin/partners', tokenB)).status, 403);
    config.adminUsers = [ownerTg.id.toString()];
    try {
      const board = (await api('GET', '/api/admin/partners', tokenOwner)).body;
      assert.strictEqual(board.people[0].userId, expertB_InternalId, 'Who brought most is first');
      const a = board.people.find(p => p.userId === expertA_InternalId);
      assert.deepStrictEqual([a.brought, a.clients], [1, 2]);
      assert(a.linkList.some(l => l.label === 'Instagram' && l.consultantName === projectA.name && l.clients === 1));
    } finally {
      config.adminUsers = [];
    }
  });

  await test('62. Пульс: новое сообщение от человека видно на любом экране; уведомления идут по каналам', async () => {
    const login = (tg) => api('POST', '/api/auth/telegram', null, { initData: createTelegramInitData(process.env.TELEGRAM_BOT_TOKEN, tg), role: 'expert' });
    const anna = (await login({ id: 700091, first_name: 'Пульс-Анна' })).body;
    const boris = (await login({ id: 700092, first_name: 'Пульс-Борис' })).body;
    assert.strictEqual((await api('GET', '/api/me/pulse', null)).status, 401, 'Only for the signed-in person');

    const before = (await api('GET', '/api/me/pulse', boris.token)).body;
    assert.strictEqual(before.people, null);
    await new Promise(r => setTimeout(r, 1100)); // times in the database are kept to the second
    assert.strictEqual((await api('POST', `/api/people/${boris.user.id}/messages`, anna.token, { text: 'Привет!' })).status, 201);
    const after = (await api('GET', '/api/me/pulse', boris.token)).body;
    assert.notStrictEqual(after.people, before.people, 'Boris sees that something new came from people');
    assert(after.unread > before.unread, 'and the Buddy notification about it');
    assert.notStrictEqual(after.notes, before.notes);

    // Notifications: always saved in SmartFlow first, then every delivery channel is tried;
    // a broken channel never breaks the others or the main action
    const notifyService = require('../server/services/notify-service');
    const got = [];
    notifyService.CHANNELS.push({ name: 'broken', send: async () => { throw new Error('down'); } });
    notifyService.CHANNELS.push({ name: 'test', send: async (userId, msg) => { got.push({ userId, ...msg }); return true; } });
    try {
      assert.strictEqual(await notifyService.notifyUser(boris.user.id, { ru: 'Проверка', en: 'Check' }, { startParam: 'S_support' }), true);
      assert.deepStrictEqual(got, [{ userId: boris.user.id, text: 'Проверка', buttonText: 'Открыть в SmartFlow', startParam: 'S_support' }]);
      const saved = await db.get(`SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND text = ?`, [boris.user.id, 'Проверка']);
      assert.strictEqual(Number(saved.n), 1, 'Saved in SmartFlow (Buddy) too');
    } finally {
      notifyService.CHANNELS.splice(1);
    }
  });

  await test('40. Владелец убирает помощника: доступ закрывается, его диалоги возвращаются владельцу', async () => {
    assert.strictEqual((await api('DELETE', `/api/business/assistants/${assistantUser.id}`, tokenAssistant)).status, 404, 'Only the owner removes');
    const removed = await api('DELETE', `/api/business/assistants/${assistantUser.id}`, tokenA);
    assert.strictEqual(removed.status, 200);
    assert(!removed.body.members.some(m => m.userId === assistantUser.id));
    assert.strictEqual((await api('GET', `/api/projects/${projectA.id}/clients`, tokenAssistant)).status, 403, 'No access after removal');
    assert.strictEqual(Number((await db.get(`SELECT COUNT(*) AS count FROM clients WHERE responsible_user_id = ?`, [assistantUser.id])).count), 0);
    const otherCode = (await api('GET', '/api/auth/me', tokenOther)).body.user.supportCode;
    assert.strictEqual((await api('POST', '/api/business/assistants', tokenA, { supportCode: otherCode })).status, 201, 'A new assistant can be invited');
  });

  await test('41. Миграция 007: старые данные переходят в бизнесы (SQLite-файл с данными до миграции)', async () => {
    const Database = require('better-sqlite3');
    const file = path.join(__dirname, '../data/test_migration_007.db');
    if (fs.existsSync(file)) fs.unlinkSync(file);
    const mdb = new Database(file);
    const dir = path.join(__dirname, '../server/db/migrations');
    const files = fs.readdirSync(dir).filter(f => /^\d+_.+\.sql$/.test(f)).sort();
    mdb.exec('CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)');
    for (const f of files.filter(f => parseInt(f, 10) < 7)) mdb.exec(migrator.sqlForDriver(fs.readFileSync(path.join(dir, f), 'utf8'), 'sqlite'));
    // Before: an expert who opened the Office with a paused chat, one who only signed in
    mdb.exec(`
      INSERT INTO users (id, display_name, profile) VALUES ('usr_on', 'On', '{"businessAgreedAt":"2026-10-01T00:00:00.000Z"}'), ('usr_off', 'Off', '{"businessAgreedAt":null}'), ('usr_cl', 'Client', NULL);
      INSERT INTO projects (id, owner_id, name, slug) VALUES ('proj_on', 'usr_on', 'On SI', 'on-si'), ('proj_off', 'usr_off', 'Off SI', 'off-si');
      INSERT INTO clients (id, project_id, external_client_id, name, status) VALUES ('cli_1', 'proj_on', 'usr_cl', 'Client', 'human_needed');
      INSERT INTO conversations (id, project_id, client_id, sender, text) VALUES ('m1', 'proj_on', 'cli_1', 'ai', 'Привет'), ('m2', 'proj_on', 'cli_1', 'client', 'Позовите'), ('m3', 'proj_on', 'cli_1', 'expert_human', 'Я тут');
      INSERT INTO direct_inquiries (id, project_id, client_id, lead_name, reason, status) VALUES ('inq_1', 'proj_on', 'cli_1', 'Client', 'Позовите', 'waiting');
    `);
    mdb.exec(migrator.sqlForDriver(fs.readFileSync(path.join(dir, files.find(f => parseInt(f, 10) === 7)), 'utf8'), 'sqlite'));
    const one = (sql) => mdb.prepare(sql).get();
    assert.strictEqual(one(`SELECT COUNT(*) AS n FROM businesses`).n, 1, 'Only the expert who turned the SI-seller on');
    assert.strictEqual(one(`SELECT business_id FROM projects WHERE id = 'proj_on'`).business_id, 'biz_usr_on');
    assert.strictEqual(one(`SELECT business_id FROM projects WHERE id = 'proj_off'`).business_id, null);
    assert.strictEqual(one(`SELECT role FROM business_members WHERE user_id = 'usr_on'`).role, 'owner');
    const client = one(`SELECT * FROM clients WHERE id = 'cli_1'`);
    assert.strictEqual(client.business_id, 'biz_usr_on');
    assert.strictEqual(client.responsible_type, 'human');
    assert.strictEqual(client.responsible_user_id, 'usr_on');
    assert.strictEqual(client.status, 'active');
    assert.strictEqual(client.funnel_status, 'waiting_human');
    assert.deepStrictEqual(mdb.prepare(`SELECT author_type, author_user_id, business_id FROM conversations ORDER BY id`).all(), [
      { author_type: 'si', author_user_id: null, business_id: 'biz_usr_on' },
      { author_type: 'client', author_user_id: null, business_id: 'biz_usr_on' },
      { author_type: 'owner', author_user_id: 'usr_on', business_id: 'biz_usr_on' }
    ]);
    assert.strictEqual(one(`SELECT business_id FROM direct_inquiries WHERE id = 'inq_1'`).business_id, 'biz_usr_on');
    mdb.close();
    fs.unlinkSync(file);
    for (const extra of ['-wal', '-shm']) if (fs.existsSync(file + extra)) fs.unlinkSync(file + extra);
  });

  await test('63. Тестовая копия и включение «сначала одному человеку»', async () => {
    const appInfo = require('../server/services/app-info');
    const saved = { appEnv: config.appEnv, isStaging: config.isStaging, features: config.features, betaUsers: config.betaUsers, bot: config.telegramBotUsername };
    try {
      // The working copy: no strip, the working bot, no flags
      let me = (await api('GET', '/api/auth/me', tokenOwner)).body;
      assert.strictEqual(me.app.env, 'production');
      assert.strictEqual(me.app.appLink, 'https://t.me/smartflow_ai_support_bot/app');
      assert.deepStrictEqual(me.app.features, []);
      assert.strictEqual((await api('GET', '/api/health')).body.appEnv, 'production');

      // The test copy: its own bot in every link, the server and the phone know it is the test one
      Object.assign(config, { appEnv: 'staging', isStaging: true, telegramBotUsername: 'smartflow_test_bot' });
      me = (await api('GET', '/api/auth/me', tokenOwner)).body;
      assert.strictEqual(me.app.env, 'staging');
      assert.strictEqual(me.app.appLink, 'https://t.me/smartflow_test_bot/app');
      assert.strictEqual((await api('GET', '/api/health')).body.appEnv, 'staging');

      // A risky change: only for the people from BETA_USERS (by SF-number or Telegram id), the rest do not get it
      assert.deepStrictEqual(appInfo.parseFeatures(['new-chat:beta', 'voice2', 'old:off', 'BAD NAME:all', 'x:weird']),
        { 'new-chat': 'beta', voice2: 'all', old: 'off', x: 'off' });
      config.features = ['new-chat:beta', 'voice2:all', 'old:off'];
      config.betaUsers = [me.user.supportCode.toLowerCase().replace('-', ' ')];
      assert.deepStrictEqual((await api('GET', '/api/auth/me', tokenOwner)).body.app.features, ['new-chat', 'voice2']);
      assert.deepStrictEqual((await api('GET', '/api/auth/me', tokenStudent)).body.app.features, ['voice2']);
      assert.strictEqual(await appInfo.isOn('new-chat', ownerUser.id), true);
      assert.strictEqual(await appInfo.isOn('new-chat', studentUser.id), false);
      assert.strictEqual(await appInfo.isOn('old', ownerUser.id), false);
      assert.strictEqual(await appInfo.isOn('unknown', ownerUser.id), false);
      config.betaUsers = [String(studentTg.id)];
      assert.strictEqual(await appInfo.isOn('new-chat', studentUser.id), true);
      assert.strictEqual(await appInfo.isOn('new-chat', ownerUser.id), false);
    } finally {
      Object.assign(config, { appEnv: saved.appEnv, isStaging: saved.isStaging, features: saved.features, betaUsers: saved.betaUsers, telegramBotUsername: saved.bot });
    }
  });

  await test('34. Неверный DB_DRIVER — понятная ошибка вместо тихого SQLite', async () => {
    assert.strictEqual(db.resolveDriver('postgres'), 'postgres');
    assert.strictEqual(db.resolveDriver('PostgreSQL'), 'postgres');
    assert.strictEqual(db.resolveDriver('sqlite'), 'sqlite');
    assert.throws(() => db.resolveDriver('postgress'), /DB_DRIVER/);
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
