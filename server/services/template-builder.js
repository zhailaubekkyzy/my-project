// server/services/template-builder.js - Конструктор шаблона («Бизнес-режим 2.0», шаг 5; решения владелицы 22 нояб.).
// Автор (маркетолог или эксперт) в Офисе → «Новый SI-продавец» → «Шаблон для продажи другим» отвечает на бриф
// по одному вопросу: ниша и продукт · чек и клиенты · цель и кому подходит / не подходит · стиль и возражения ·
// путь клиента шаг за шагом и что на каждом шаге. ИИ (своя модель TEMPLATE_MODEL) собирает черновик: шаги по пути
// автора, общее описание, инструкции, сценарии на возражения и молчание, пазл для покупателей и условие запуска.
// Получается новый SI-продавец-шаблон в выбранном бизнесе — автор правит его на обычных экранах «Методологии»,
// проверяет на демо-бизнесах SmartFlow (demo-businesses.js) и публикует как раньше.
// Без ключа OpenAI (или если ИИ не ответил) черновик собирается из ответов автора как есть — ничего не выдумываем.
const config = require('../config');
const funnelService = require('./funnel-service');
const puzzleSpec = require('./puzzle-spec');

const PRODUCT_TYPES = {
  consult: 'консультация', course: 'курс', mentoring: 'наставничество', service: 'услуга', webinar: 'вебинар или интенсив', goods: 'товар', other: 'другое'
};
const GOALS = { sale: 'продать', booking: 'записать на встречу или консультацию', lead: 'собрать заявку', free: 'выдать бесплатный материал и прогреть' };
const AUDIENCES = { warm: 'тёплые — подписчики, уже знают эксперта', cold: 'холодные — из рекламы, видят впервые', both: 'и тёплые, и холодные' };
const TONES = { soft: 'мягкий и бережный', expert: 'экспертный, уверенный', friendly: 'дружеский, на лёгкой ноте' };
const MAX_PATH = funnelService.MAX_STEPS || 8;

class BuilderError extends Error {
  constructor(message, status = 400, code = 'BRIEF') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const text = (v, max) => String(v === undefined || v === null ? '' : v).replace(/\r/g, '').trim().slice(0, max);
const pick = (v, map, def) => (Object.prototype.hasOwnProperty.call(map, v) ? v : def);

/** The author's brief as it may be kept: known answers only, limits kept; what is missing — a clear error. */
function cleanBrief(input = {}) {
  const b = {
    title: text(input.title, 80),
    nicheName: text(input.nicheName, 60),
    nicheSection: text(input.nicheSection, 30),
    productType: pick(input.productType, PRODUCT_TYPES, 'other'),
    product: text(input.product, 600),
    check: text(input.check, 80),
    audience: pick(input.audience, AUDIENCES, 'both'),
    sources: text(input.sources, 300),
    goal: pick(input.goal, GOALS, 'sale'),
    fitsFor: text(input.fitsFor, 500),
    notFor: text(input.notFor, 500),
    tone: pick(input.tone, TONES, 'soft'),
    objections: text(input.objections, 800),
    path: (Array.isArray(input.path) ? input.path : [])
      .map(s => ({ title: text(s && s.title, 60), content: text(s && s.content, 600) }))
      .filter(s => s.title)
      .slice(0, MAX_PATH)
  };
  if (!b.product) throw new BuilderError('Опишите продукт: что получает клиент', 400, 'NO_PRODUCT');
  if (!b.fitsFor) throw new BuilderError('Напишите, кому подходит шаблон', 400, 'NO_FIT');
  if (b.path.length < 2) throw new BuilderError('Опишите путь клиента хотя бы в 2 шага', 400, 'NO_PATH');
  if (!b.title) b.title = `${PRODUCT_TYPES[b.productType] === 'другое' ? 'Продажа' : PRODUCT_TYPES[b.productType][0].toUpperCase() + PRODUCT_TYPES[b.productType].slice(1)}${b.nicheName ? ` · ${b.nicheName}` : ''}`.slice(0, 80);
  return b;
}

function briefLines(b) {
  return [
    `Название шаблона: ${b.title}`,
    `Ниша: ${b.nicheName || 'не указана'}`,
    `Тип продукта: ${PRODUCT_TYPES[b.productType]}. Что это: ${b.product}`,
    `Средний чек: ${b.check || 'не указан'}`,
    `Клиенты: ${AUDIENCES[b.audience]}${b.sources ? `. Откуда приходят: ${b.sources}` : ''}`,
    `Цель SI-продавца: ${GOALS[b.goal]}`,
    `Кому подходит: ${b.fitsFor}`,
    `Кому не подходит: ${b.notFor || 'не указано'}`,
    `Стиль общения: ${TONES[b.tone]}`,
    `Главные возражения клиентов: ${b.objections || 'не указаны'}`,
    'Путь клиента по шагам (от автора):',
    ...b.path.map((s, i) => `${i + 1}. ${s.title}${s.content ? ` — ${s.content}` : ''}`)
  ];
}

// Without OpenAI: the author's own words become the draft (nothing invented)
function fromBrief(b) {
  const steps = b.path.map(s => ({ title: s.title, goal: s.content || '', doneWhen: '' }));
  const objections = b.objections.split(/[\n;]+/).map(x => x.replace(/^[-•\d.)\s]+/, '').trim()).filter(Boolean).slice(0, 5);
  return {
    goal: GOALS[b.goal],
    instructions: [`Стиль: ${TONES[b.tone]}.`, `Подходит: ${b.fitsFor}.`, b.notFor ? `Не подходит: ${b.notFor} — таким клиентам честно скажи, что продукт им не подойдёт.` : '']
      .filter(Boolean).join(' '),
    methodology: `Путь клиента: ${b.path.map(s => s.title).join(' → ')}. Клиенты: ${AUDIENCES[b.audience]}. Цель — ${GOALS[b.goal]}.`,
    steps,
    scenarios: objections.map(o => ({ title: `Возражение: ${o}`.slice(0, 60), when: 'objection', words: o.slice(0, 120), then: 'handover', text: '' })),
    puzzle: {
      pieces: [
        { title: 'Продукт', required: true, questions: [{ text: 'Как называется ваш продукт и что получает клиент?', source: 'product.description' }, { text: 'Сколько стоит?', source: 'product.price_label' }] },
        { title: 'Ваш клиент', required: true, questions: [{ text: 'Кто ваш идеальный клиент?', hint: 'Возраст, ситуация, что болит' }] },
        { title: 'Возражения', required: false, questions: [{ text: 'Что чаще всего останавливает клиентов и как вы отвечаете?' }] }
      ],
      release: { mode: 'required' }
    }
  };
}

async function fromAI(b) {
  const siEngine = require('./si-engine');
  if (!siEngine.isConfigured()) return null;
  const sources = Object.keys(puzzleSpec.SOURCES).join(', ');
  const reply = await siEngine.callOpenAI([
    {
      role: 'system',
      content: [
        'Ты — сильный маркетолог. По брифу автора собери скелет AI-продавца, который ведёт клиента к цели в переписке.',
        'Скелет потом купят другие эксперты этой ниши и дополнят своими сведениями, поэтому не вписывай конкретные цены,',
        'имена, гарантии и цифры — только как продавать. Пиши по-русски, просто, без канцелярита.',
        'Ответь только JSON:',
        '{"goal": string, "instructions": string, "methodology": string,',
        ' "steps": [{"title": string, "goal": string, "doneWhen": string}],',
        ' "scenarios": [{"title": string, "when": "objection"|"silent"|"custom", "words": string, "condition": string,',
        '   "minutes": number, "after": "any"|"offer"|"objection"|"buy_clicked", "then": "si_says"|"handover"|"notify", "text": string}],',
        ' "puzzle": {"pieces": [{"title": string, "required": bool, "questions": [{"text": string, "hint": string, "source": string}]}],',
        '   "release": {"mode": "required"|"all"|"count", "count": number}}}',
        'Правила:',
        '- steps: ровно шаги автора в том же порядке, названия — как у автора (можно короче); goal — что SI делает на шаге',
        '  (по содержанию от автора), doneWhen — когда шаг пройден, коротко.',
        '- instructions: стиль, что можно и нельзя, кому продукт не подходит и что тогда говорить. До 800 знаков.',
        '- methodology: как SI ведёт к цели, связным текстом, до 1500 знаков.',
        '- scenarios: 3–6 штук — на главные возражения (when "objection", words — суть в 2–4 словах, then "si_says",',
        '  text — как ответить) и 1–2 напоминания при молчании (when "silent", minutes 60–1440, after "offer" или "any").',
        '- puzzle: 3–6 кусочков — что эксперт-покупатель обязан дать, чтобы этот скелет продавал без выдумок',
        `  (продукт, цена, клиент, кейсы, возражения и т. п.); в каждом 1–4 коротких вопроса; source — одно из: ${sources}, или "".`,
        '  release: обычно {"mode": "required"}.'
      ].join('\n')
    },
    { role: 'user', content: briefLines(b).join('\n') }
  ], { model: config.templateModel, response_format: { type: 'json_object' }, max_completion_tokens: 6000, timeoutMs: 120000 });
  if (!reply) return null;
  try {
    const r = JSON.parse(reply);
    return r && typeof r === 'object' && Array.isArray(r.steps) && r.steps.length ? r : null;
  } catch (e) {
    return null;
  }
}

/** The draft for the brief: { settings, source: 'openai' | 'brief' }. */
async function draft(b) {
  const ai = await fromAI(b).catch(() => null);
  const raw = ai || fromBrief(b);
  const steps = funnelService.normalizeSteps(raw.steps);
  const settings = {
    goal: text(raw.goal, 160) || GOALS[b.goal],
    instructions: text(raw.instructions, 800),
    methodology: text(raw.methodology, 3000),
    steps,
    scenarios: funnelService.normalizeScenarios(raw.scenarios, steps),
    puzzle: puzzleSpec.normalizePuzzle(raw.puzzle),
    clientLimit: 40,
    // The brief itself: the author sees it and may build again
    brief: b
  };
  return { settings, source: ai ? 'openai' : 'brief' };
}

/**
 * Builds a new SI-продавец-шаблон in the author's business from the brief. Returns { project, source }.
 */
async function build(userId, input = {}) {
  const b = cleanBrief(input);
  const { settings, source } = await draft(b);
  const projectService = require('./project-service');
  const project = await projectService.createProject(userId, {
    name: `Шаблон: ${b.title}`.slice(0, 80),
    businessId: input.businessId ? String(input.businessId) : null,
    customAiSettings: settings
  });
  if (b.nicheName) {
    const n = await require('./niche-service').resolve(userId, b.nicheName, b.nicheSection);
    if (n) await require('../db').run('UPDATE projects SET niche_id = ? WHERE id = ?', [n.id, project.id]);
  }
  return { project, source };
}

module.exports = { BuilderError, PRODUCT_TYPES, GOALS, AUDIENCES, TONES, cleanBrief, briefLines, fromBrief, draft, build };
