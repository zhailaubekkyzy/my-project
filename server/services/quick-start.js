// server/services/quick-start.js - «Быстрый старт»: a working SI-seller in a minute (owner's decision 21 Nov.).
// Four simple goals that fit any niche. Each fills in the goal, instructions, three steps of the funnel
// and one gentle reminder — nothing niche-specific, so it never competes with marketers' funnels
// (those are for experts who want more). Everything stays editable in the Office afterwards.
const crypto = require('crypto');

const stepId = () => `stp_${crypto.randomBytes(5).toString('hex')}`;
const scenarioId = () => `scn_${crypto.randomBytes(5).toString('hex')}`;

// What the expert answers: about («нутрициолог»), offer (what the client gets), price, link
const TEMPLATES = {
  consult: {
    title: 'Записать на консультацию',
    cta: 'book',
    priceMode: 'free',
    build({ offer }) {
      const steps = [
        { id: stepId(), title: 'Знакомство', goal: 'Узнать ситуацию клиента и чего он хочет добиться', doneWhen: 'клиент рассказал о своей задаче' },
        { id: stepId(), title: 'Польза', goal: 'Коротко объяснить, чем поможет консультация именно в его ситуации', doneWhen: 'клиенту интересно' },
        { id: stepId(), title: 'Запись', goal: 'Предложить консультацию и помочь записаться', doneWhen: '' }
      ];
      return {
        goal: 'записать клиента на консультацию',
        instructions: 'Сначала узнай ситуацию клиента и чего он хочет добиться. Потом коротко объясни, чем поможет консультация, и предложи записаться. Подробных советов в чате не давай — их эксперт даст на консультации.',
        methodology: `Узнать задачу клиента → показать, чем поможет консультация${offer ? ` («${offer}»)` : ''} → записать.`,
        steps,
        scenarios: [
          { id: scenarioId(), title: 'Напомнить о записи', when: 'silent', minutes: 120, after: 'offer', then: 'si_says', text: 'Мягко спросить, удобно ли записаться и есть ли вопросы, без давления' }
        ]
      };
    }
  },
  sell: {
    title: 'Продать продукт или услугу',
    cta: 'buy',
    priceMode: 'fixed',
    build({ offer }) {
      const steps = [
        { id: stepId(), title: 'Знакомство', goal: 'Узнать, какую задачу клиент хочет решить', doneWhen: 'клиент рассказал о своей задаче' },
        { id: stepId(), title: 'Решение', goal: 'Показать, как продукт помогает именно ему', doneWhen: 'клиенту интересно' },
        { id: stepId(), title: 'Покупка', goal: 'Предложить купить по кнопке «Купить», после оплаты попросить чек', doneWhen: '' }
      ];
      return {
        goal: `помочь клиенту выбрать и купить${offer ? `: ${offer}` : ''}`,
        instructions: 'Узнай задачу клиента и покажи, как продукт помогает именно ему. Когда клиент готов — предложи купить по кнопке «Купить». На сомнения отвечай спокойно, по сведениям эксперта, без давления.',
        methodology: 'Понять задачу → показать решение → предложить купить.',
        steps,
        scenarios: [
          { id: scenarioId(), title: 'Помочь с оплатой', when: 'silent', minutes: 24 * 60, after: 'buy_clicked', then: 'si_says', text: 'Мягко спросить, получилось ли оплатить и нужна ли помощь' }
        ]
      };
    }
  },
  leads: {
    title: 'Собрать заявки',
    cta: 'ask',
    ctaLabel: 'Оставить заявку',
    priceMode: 'on_request',
    build() {
      const steps = [
        { id: stepId(), title: 'Задача', goal: 'Узнать, с какой задачей пришёл клиент', doneWhen: 'клиент описал задачу' },
        { id: stepId(), title: 'Детали', goal: 'Задать 2–3 уточняющих вопроса по его ситуации', doneWhen: 'понятна ситуация клиента' },
        { id: stepId(), title: 'Контакт', goal: 'Попросить поделиться контактом — эксперт свяжется сам', doneWhen: '' }
      ];
      return {
        goal: 'узнать задачу клиента и передать заявку эксперту',
        instructions: 'Узнай задачу клиента и задай 2–3 уточняющих вопроса. Потом предложи нажать «Поделиться контактом» — эксперт свяжется сам. Цену не называй, если её нет в сведениях.',
        methodology: 'Задача → детали → контакт для эксперта.',
        steps,
        scenarios: [
          { id: scenarioId(), title: 'Новая заявка', when: 'step_reached', step: steps[2].id, then: 'notify', text: 'Клиент готов оставить заявку' }
        ]
      };
    }
  },
  free: {
    title: 'Выдать бесплатный материал',
    cta: 'free',
    priceMode: 'free',
    needsLink: true,
    build({ link }) {
      const steps = [
        { id: stepId(), title: 'Материал', goal: 'Поздороваться и выдать бесплатный материал', doneWhen: '', material: link },
        { id: stepId(), title: 'Впечатление', goal: 'Спросить, был ли материал полезен', doneWhen: 'клиент ответил' },
        { id: stepId(), title: 'Следующий шаг', goal: 'Мягко предложить следующий шаг с экспертом', doneWhen: '' }
      ];
      return {
        goal: 'выдать бесплатный материал и предложить следующий шаг',
        instructions: 'Материал клиент получает сразу. Потом спроси, был ли он полезен, и мягко предложи следующий шаг с экспертом — по сведениям эксперта, без давления.',
        methodology: 'Выдать материал → узнать впечатление → предложить следующий шаг.',
        steps,
        scenarios: [
          { id: scenarioId(), title: 'Спросить про материал', when: 'silent', minutes: 24 * 60, after: 'any', then: 'si_says', text: 'Спросить, удалось ли посмотреть материал и чем помочь дальше' }
        ]
      };
    }
  }
};

const GOALS = Object.keys(TEMPLATES);

module.exports = { TEMPLATES, GOALS };
