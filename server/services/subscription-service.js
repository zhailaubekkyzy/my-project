// server/services/subscription-service.js - SmartFlow & Funnel Subscriptions Lifecycle
const crypto = require('crypto');
const db = require('../db');
const projectService = require('./project-service');

/**
 * Get or create SmartFlow platform subscription for a user
 */
async function getPlatformSubscription(userId) {
  let sub = await db.get(
    'SELECT * FROM platform_subscriptions WHERE user_id = ? ORDER BY created_at DESC',
    [userId]
  );

  if (!sub) {
    const subId = `sub_plat_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
    const trialDays = 14;
    const trialEndsAt = new Date(Date.now() + trialDays * 24 * 60 * 60 * 1000).toISOString();

    await db.run(
      `INSERT INTO platform_subscriptions (id, user_id, plan_code, status, trial_ends_at, current_period_ends_at, auto_renew)
       VALUES (?, ?, 'founder_free_100', 'trial', ?, ?, 1)`,
      [subId, userId, trialEndsAt, trialEndsAt]
    );

    sub = await db.get('SELECT * FROM platform_subscriptions WHERE id = ?', [subId]);
  }

  const isExpired = sub.current_period_ends_at && new Date(sub.current_period_ends_at) < new Date();
  return {
    ...sub,
    hasActiveAccess: sub.status === 'active' || (sub.status === 'trial' && !isExpired)
  };
}

/**
 * Get all funnel subscriptions for an expert
 */
async function getExpertFunnelSubscriptions(expertUserId) {
  const rows = await db.all(
    `SELECT fs.*, ft.title as template_title, ft.niche as template_niche,
            u.display_name as marketer_name, u.username as marketer_username
     FROM funnel_subscriptions fs
     JOIN funnel_templates ft ON fs.funnel_template_id = ft.id
     JOIN users u ON fs.marketer_user_id = u.id
     WHERE fs.expert_user_id = ?
     ORDER BY fs.created_at DESC`,
    [expertUserId]
  );

  return rows.map(r => {
    const isPeriodEnded = r.current_period_ends_at && new Date(r.current_period_ends_at) < new Date();
    // Access is preserved until the end of the paid/trial period even after cancellation
    const isAccessible = (r.status === 'active' || r.status === 'trial' || r.status === 'cancelled') && !isPeriodEnded;
    return {
      ...r,
      isAccessible,
      isPeriodEnded
    };
  });
}

/**
 * Subscribe expert to a marketer's funnel template.
 * Each marketer configures their own trial and price.
 * Experts can subscribe to multiple funnels without limit.
 * Subscribing creates an independent instance for the expert.
 */
async function subscribeToTemplate(expertUserId, templateId, customPaymentUrl = null) {
  const template = await db.get('SELECT * FROM funnel_templates WHERE id = ?', [templateId]);
  if (!template) {
    throw new Error('Template not found');
  }

  const marketerUserId = template.creator_id;
  const trialDays = template.trial_days || 14;
  const now = new Date();
  const trialEnds = new Date(now.getTime() + trialDays * 24 * 60 * 60 * 1000);
  const periodEnds = trialEnds; // First period is the trial period

  const subId = `sub_fnl_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;

  await db.run(
    `INSERT INTO funnel_subscriptions (
      id, expert_user_id, marketer_user_id, funnel_template_id, status, price, currency,
      trial_ends_at, current_period_starts_at, current_period_ends_at, auto_renew, custom_payment_url
    ) VALUES (?, ?, ?, ?, 'trial', ?, ?, ?, ?, ?, 1, ?)`,
    [
      subId,
      expertUserId,
      marketerUserId,
      templateId,
      template.monthly_price,
      template.currency,
      trialEnds.toISOString(),
      now.toISOString(),
      periodEnds.toISOString(),
      customPaymentUrl
    ]
  );

  // Automatically spawn an isolated expert project instance cloned from this template
  const newProject = await projectService.createProject(expertUserId, {
    name: `${template.title}`,
    templateId: template.id,
    niche: template.niche,
    customAiSettings: projectService.safeJsonParse(template.ai_clone_settings),
    pricingOptions: [
      { id: 'p1', name: 'Консультация', price: 15000 },
      { id: 'p2', name: 'Полная программа', price: 100000 }
    ]
  });

  return {
    subscriptionId: subId,
    project: newProject,
    trialDays,
    trialEndsAt: trialEnds.toISOString()
  };
}

/**
 * Cancel funnel subscription.
 * RULE: Data is NEVER deleted upon cancellation.
 * The expert keeps access until the current paid period ends.
 */
async function cancelFunnelSubscription(subscriptionId, expertUserId, cancellationReason = 'User requested cancellation') {
  const sub = await db.get(
    'SELECT * FROM funnel_subscriptions WHERE id = ? AND expert_user_id = ?',
    [subscriptionId, expertUserId]
  );

  if (!sub) {
    return { success: false, reason: 'subscription_not_found_or_forbidden' };
  }

  await db.run(
    `UPDATE funnel_subscriptions
     SET status = 'cancelled', auto_renew = 0, cancellation_reason = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [cancellationReason, subscriptionId]
  );

  const updatedSub = await db.get('SELECT * FROM funnel_subscriptions WHERE id = ?', [subscriptionId]);
  return {
    success: true,
    message: 'Подписка отменена. Доступ сохраняется до конца текущего периода. Все ваши данные и переписки в безопасности.',
    currentPeriodEndsAt: updatedSub.current_period_ends_at,
    subscription: updatedSub
  };
}

module.exports = {
  getPlatformSubscription,
  getExpertFunnelSubscriptions,
  subscribeToTemplate,
  cancelFunnelSubscription
};
