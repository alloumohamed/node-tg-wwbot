const TelegramBot = require('node-telegram-bot-api');
const config = require('./config');
const { sleep } = require('./util');

const bot = new TelegramBot(config.token, { polling: false });

const chains = new Map();
let lastGlobal = 0;

async function throttle() {
  const now = Date.now();
  const wait = Math.max(0, lastGlobal + 40 - now);
  lastGlobal = now + wait;
  if (wait) await sleep(wait);
}

function enqueue(chatId, fn) {
  const prev = chains.get(chatId) || Promise.resolve();
  const next = prev.catch(() => {}).then(async () => {
    await throttle();
    return fn();
  });
  chains.set(chatId, next);
  next.catch(() => {}).then(() => {
    if (chains.get(chatId) === next) chains.delete(chatId);
  });
  return next;
}

function botsMod() {
  return require('./bots');
}

function send(text, chatId, { menu = null, notify = false, preview = false, clearKeyboard = false, replyTo = null } = {}) {
  if (botsMod().isBot(chatId)) return Promise.resolve(botsMod().onSend(chatId, text, menu));
  const opts = { parse_mode: 'HTML', disable_notification: !notify, disable_web_page_preview: !preview };
  if (menu) opts.reply_markup = menu;
  else if (clearKeyboard) opts.reply_markup = { remove_keyboard: true };
  if (replyTo) opts.reply_to_message_id = replyTo;
  return enqueue(chatId, () => bot.sendMessage(chatId, text, opts));
}

function sendAnimation(chatId, animation, caption, extra = {}) {
  if (botsMod().isBot(chatId)) return Promise.resolve(botsMod().onSend(chatId, caption || '', null));
  return enqueue(chatId, () => bot.sendAnimation(chatId, animation, Object.assign({ caption, parse_mode: 'HTML' }, extra)));
}

function edit(chatId, messageId, text, markup = null, html = false) {
  if (botsMod().isBot(chatId)) return Promise.resolve(botsMod().onEdit(chatId, messageId, text));
  const opts = { chat_id: chatId, message_id: messageId, disable_web_page_preview: true };
  if (html) opts.parse_mode = 'HTML';
  if (markup) opts.reply_markup = markup;
  return enqueue(chatId, () => bot.editMessageText(text, opts));
}

function editMarkup(chatId, messageId, markup) {
  if (botsMod().isBot(chatId)) return Promise.resolve({});
  return enqueue(chatId, () => bot.editMessageReplyMarkup(markup || { inline_keyboard: [] }, { chat_id: chatId, message_id: messageId }));
}

function remove(chatId, messageId) {
  if (botsMod().isBot(chatId)) return Promise.resolve({});
  return enqueue(chatId, () => bot.deleteMessage(chatId, messageId));
}

function answerCallback(id, text = null, showAlert = false) {
  return bot.answerCallbackQuery(id, { text: text || undefined, show_alert: showAlert }).catch(() => {});
}

module.exports = { bot, send, sendAnimation, edit, editMarkup, remove, answerCallback };
