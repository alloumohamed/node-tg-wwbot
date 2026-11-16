const config = require('./config');
const { randInt } = require('./util');

const BASE = 9000000000000;
const NAMES = ['سامي', 'ليلى', 'خالد', 'نور', 'ياسر', 'هدى', 'عمر', 'سلمى', 'زياد', 'رنا', 'ماجد', 'دانة', 'فهد', 'لمى', 'بدر', 'ريم', 'طارق', 'جود', 'وليد', 'سارة', 'حسن', 'مي', 'كريم', 'أمل', 'رامي', 'هالة', 'أنس', 'دعاء', 'نبيل', 'شهد'];

const bots = new Map();
const pendingMsgs = new Map();
let counter = 0;
let msgCounter = 0;

const tgMod = () => require('./tg');
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function isBot(id) {
  return typeof id === 'number' && id >= BASE;
}

function create(owner, game) {
  const used = new Set(game.Players.map(p => p.Name));
  const free = NAMES.filter(n => !used.has('🤖 ' + n));
  let name = free.length ? '🤖 ' + free[randInt(free.length)] : '🤖 بوت ' + (counter + 1);
  const bot = { id: BASE + (++counter), name, owner, game, mode: 'auto', lastMenu: null };
  bots.set(bot.id, bot);
  return bot;
}

function remove(id) {
  bots.delete(id);
}

function removeGame(game) {
  for (const [id, b] of bots) if (b.game === game) bots.delete(id);
}

function ownedBy(owner) {
  return Array.from(bots.values()).filter(b => b.owner === owner && b.game.Players && b.game.Players.some(p => p.Id === b.id));
}

function chooseAuto(menu) {
  const flat = menu.inline_keyboard.flat();
  if (!flat.length) return null;
  const last = b => b.callback_data.split('|').pop();
  const choices = flat.map(last);
  if (choices.includes('yes') && choices.includes('no')) return flat[choices.indexOf(randInt(100) < 25 ? 'yes' : 'no')];
  if (choices.length === 1 && (choices[0] === 'reveal' || choices[0] === 'peace')) return randInt(100) < 15 ? flat[0] : null;
  const targets = flat.filter(b => last(b) !== '-1' && last(b) !== '-2');
  const skip = flat.find(b => last(b) === '-1');
  const spark = flat.find(b => last(b) === '-2');
  if (spark && randInt(100) < 20) return spark;
  if (skip && (randInt(100) < 10 || !targets.length)) return skip;
  if (!targets.length) return null;
  return targets[randInt(targets.length)];
}

function autoAnswer(bot, menu, msgId) {
  const delay = config.BotDelayMin + randInt(Math.max(1, config.BotDelayMax - config.BotDelayMin));
  setTimeout(async () => {
    try {
      if (bot.mode !== 'auto' || !bot.game.Players) return;
      const player = bot.game.Players.find(p => p.Id === bot.id);
      if (!player || !player.CurrentQuestion || player.CurrentQuestion.MessageId !== msgId) return;
      const pick = chooseAuto(menu);
      if (!pick) return;
      await bot.game.handleReply({ id: 'bot', from: { id: bot.id, first_name: bot.name }, data: pick.callback_data, message: { chat: { id: bot.id }, message_id: msgId } });
    } catch (e) {
      console.error('bot answer failed', e.message);
    }
  }, delay);
}

function forward(bot, text, menu, msgId) {
  const tg = tgMod();
  const body = `🤖 <b>${esc(bot.name)}</b>\n${text}`;
  const wrapped = menu ? { inline_keyboard: menu.inline_keyboard.map(row => row.map(b => ({ text: b.text, callback_data: `b|${bot.id}|${b.callback_data}` }))) } : null;
  tg.send(body, bot.owner, { menu: wrapped, notify: Boolean(menu) }).then(r => {
    if (r && menu) pendingMsgs.set(msgId, { chat: bot.owner, id: r.message_id });
  }).catch(() => {});
}

function onSend(chatId, text, menu) {
  const bot = bots.get(chatId);
  const msgId = ++msgCounter;
  if (!bot) return { message_id: msgId };
  if (menu) {
    bot.lastMenu = { menu, msgId };
    if (bot.mode === 'auto') autoAnswer(bot, menu, msgId);
    else forward(bot, text, menu, msgId);
  } else if (bot.mode === 'manual') {
    forward(bot, text, null, msgId);
  }
  return { message_id: msgId };
}

function onEdit(chatId, messageId, text) {
  const p = pendingMsgs.get(messageId);
  if (p) {
    pendingMsgs.delete(messageId);
    tgMod().edit(p.chat, p.id, text).catch(() => {});
  }
  return {};
}

async function handleOwnerCallback(q) {
  const tg = tgMod();
  const parts = q.data.split('|');
  const id = Number(parts[1]);
  const bot = bots.get(id);
  tg.answerCallback(q.id);
  if (!bot || bot.owner !== q.from.id) return;
  const data = parts.slice(2).join('|');
  const msgId = bot.lastMenu ? bot.lastMenu.msgId : 0;
  await bot.game.handleReply({ id: 'bot', from: { id: bot.id, first_name: bot.name }, data, message: { chat: { id: bot.id }, message_id: msgId } });
  pendingMsgs.delete(msgId);
}

function panel(owner) {
  const list = ownedBy(owner);
  if (!list.length) return { text: 'ليس لديك بوتات في ألعاب جارية.\nأضف بوتات من المجموعة بالأمر /addbot', keyboard: { inline_keyboard: [] } };
  const rows = [];
  let text = '🤖 بوتاتك:\n';
  for (const b of list) {
    const state = b.game.IsRunning ? (b.game.Players.find(p => p.Id === b.id).IsDead ? '💀' : '✅') : '⏳';
    text += `\n${state} ${b.name} — ${b.game.ChatGroup} — ${b.mode === 'auto' ? 'تلقائي' : 'يدوي'}`;
    const row = [{ text: `${b.name}: ${b.mode === 'auto' ? '⚙️ تلقائي' : '🎮 يدوي'}`, callback_data: `bm|${b.id}|t` }];
    if (b.game.IsJoining) row.push({ text: '🗑', callback_data: `bm|${b.id}|x` });
    rows.push(row);
  }
  rows.push([{ text: 'الكل تلقائي', callback_data: 'bm|0|a' }, { text: 'الكل يدوي', callback_data: 'bm|0|m' }]);
  rows.push([{ text: '🔄 تحديث', callback_data: 'bm|0|r' }]);
  return { text, keyboard: { inline_keyboard: rows } };
}

function setMode(bot, mode) {
  bot.mode = mode;
  if (mode === 'auto' && bot.lastMenu && bot.game.Players) {
    const player = bot.game.Players.find(p => p.Id === bot.id);
    if (player && player.CurrentQuestion && player.CurrentQuestion.MessageId === bot.lastMenu.msgId) autoAnswer(bot, bot.lastMenu.menu, bot.lastMenu.msgId);
  }
}

async function handlePanelCallback(q) {
  const tg = tgMod();
  const parts = q.data.split('|');
  const id = Number(parts[1]);
  const act = parts[2];
  if (act === 'a' || act === 'm') {
    for (const b of ownedBy(q.from.id)) setMode(b, act === 'a' ? 'auto' : 'manual');
  } else if (act === 't' || act === 'x') {
    const b = bots.get(id);
    if (b && b.owner === q.from.id) {
      if (act === 't') setMode(b, b.mode === 'auto' ? 'manual' : 'auto');
      else if (b.game.IsJoining) await b.game.removeBot(b);
    }
  }
  tg.answerCallback(q.id);
  const p = panel(q.from.id);
  tg.edit(q.message.chat.id, q.message.message_id, p.text, p.keyboard).catch(() => {});
}

module.exports = { isBot, create, remove, removeGame, ownedBy, onSend, onEdit, handleOwnerCallback, handlePanelCallback, panel, setMode, BASE };
