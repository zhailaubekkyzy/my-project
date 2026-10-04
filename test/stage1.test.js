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
process.env.DB_DRIVER = 'sqlite';
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
    db.initDatabase({ dbFile: TEST_DB_FILE, driver: 'sqlite' });
    const applied = await migrator.runMigrations({ silent: true });
    assert(applied.length >= 2, 'Should apply at least 2 migrations');

    const versions = await migrator.getAppliedMigrations();
    assert.deepStrictEqual(versions, [1, 2], 'Migrations 1 and 2 must be recorded');
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
    db.initDatabase({ dbFile: TEST_DB_FILE, driver: 'sqlite' });

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
