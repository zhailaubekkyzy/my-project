// server/services/badge-service.js - Красная цифра на значке SmartFlow, установленного на экран (решение владелицы
// 24 нояб.). Цифра уходит вместе с каждым уведомлением на телефон (push-service), пока приложение закрыто;
// открытое приложение само пересчитывает её по тем же красным отметкам, что на вкладках.
// Сколько непрочитанного: уведомления Бадди + переписки с людьми с новым сообщением (или вопросом «Принять?»)
// + группы с новым сообщением или приглашением. Чаты с SI-продавцами отмечаются прочитанными только на телефоне —
// их новые сообщения сервер считает через уведомления Бадди.
const db = require('../db');

async function count(userId) {
  if (!userId) return 0;
  const row = await db.get(
    `SELECT
       (SELECT COUNT(*) FROM notifications WHERE user_id = ? AND sender = 'buddy' AND read_at IS NULL) AS buddy,
       (SELECT COUNT(*) FROM dm_threads WHERE user_a = ? AND status <> 'blocked'
          AND ((last_sender IS NOT NULL AND last_sender <> ? AND (a_read_at IS NULL OR a_read_at < last_activity))
               OR (status = 'pending' AND started_by <> ?))) AS dm_a,
       (SELECT COUNT(*) FROM dm_threads WHERE user_b = ? AND status <> 'blocked'
          AND ((last_sender IS NOT NULL AND last_sender <> ? AND (b_read_at IS NULL OR b_read_at < last_activity))
               OR (status = 'pending' AND started_by <> ?))) AS dm_b,
       (SELECT COUNT(*) FROM chat_group_members m JOIN chat_groups g ON g.id = m.group_id
          WHERE m.user_id = ? AND (m.status = 'invited'
            OR (m.status = 'active' AND g.last_sender IS NOT NULL AND g.last_sender <> ? AND (m.read_at IS NULL OR m.read_at < g.last_activity)))) AS grp`,
    [userId, userId, userId, userId, userId, userId, userId, userId, userId]
  );
  const total = (Number(row.buddy) || 0) + (Number(row.dm_a) || 0) + (Number(row.dm_b) || 0) + (Number(row.grp) || 0);
  return Math.min(total, 99);
}

module.exports = { count };
