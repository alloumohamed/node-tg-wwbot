process.env.DATA_DIR = require('path').join(require('os').tmpdir(), 'wwbots' + Date.now());
process.env.MIN_PLAYERS = '5';
process.env.JOIN_TIME = '3';
process.env.BOT_TOKEN = 'x';
process.env.BOT_DELAY_MIN = '5';
process.env.BOT_DELAY_MAX = '40';
const util = require('./util');
const realSleep = util.sleep;
util.sleep = ms => realSleep(Math.max(1, Math.round(ms / 200)));

const Module = require('module');
const OWNER = 555;
const sent = [];
class FakeBot {
  async sendMessage(chatId, text, opts = {}) {
    const id = sent.length + 1;
    sent.push({ chatId, text, opts, id });
    if (chatId === OWNER && opts.reply_markup && opts.reply_markup.inline_keyboard && FakeBot.onOwnerMenu) setTimeout(() => FakeBot.onOwnerMenu(opts.reply_markup, id, text), 3);
    return { message_id: id };
  }
  async sendAnimation() { return { message_id: 1 }; }
  async editMessageText() { return {}; }
  async editMessageReplyMarkup() { return {}; }
  async deleteMessage() { return {}; }
  async answerCallbackQuery() { return {}; }
  async getChatMemberCount() { return 7; }
}
const origLoad = Module._load;
Module._load = function (req, ...a) {
  if (req === 'node-telegram-bot-api') return FakeBot;
  return origLoad.call(this, req, ...a);
};

const { Werewolf } = require('./game');
const bots = require('./bots');
const store = require('./store');

(async () => {
  let manualAnswers = 0;
  FakeBot.onOwnerMenu = async (markup, id, text) => {
    const flat = markup.inline_keyboard.flat().filter(b => b.callback_data.startsWith('b|'));
    if (!flat.length) return;
    const pick = flat[Math.floor(Math.random() * flat.length)];
    manualAnswers++;
    await bots.handleOwnerCallback({ id: 'q', from: { id: OWNER }, data: pick.callback_data, message: { chat: { id: OWNER }, message_id: id } });
  };

  const game = new Werewolf({ chatId: -777, user: { id: OWNER, first_name: 'Admin' }, chatTitle: 'BotTest', gameMode: 'Normal', botUsername: 'bot', onRemove: g => bots.removeGame(g) });
  await game.init();
  const runP = game.run();
  for (let i = 0; i < 9; i++) await game.addBot(OWNER);
  const list = bots.ownedBy(OWNER);
  for (const b of list.slice(0, 3)) bots.setMode(b, 'manual');
  console.log('panel:\n' + bots.panel(OWNER).text);
  await game.removeBot(list[8]);
  game.forceStart();
  await Promise.race([runP, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 150000))]);
  console.log('winner', game.dbGame && game.dbGame.Winner, 'manualAnswers', manualAnswers, 'hasBots', game.HasBots, 'playersStored', Object.keys(store.allPlayers()).length);
  process.exit(0);
})().catch(e => {
  console.error('FAIL', e);
  process.exit(1);
});
