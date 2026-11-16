process.env.DATA_DIR = require('path').join(require('os').tmpdir(), 'wwtest' + Date.now());
process.env.MIN_PLAYERS = '5';
process.env.JOIN_TIME = '4';
const util = require('./util');
const realSleep = util.sleep;
util.sleep = ms => realSleep(Math.max(1, Math.round(ms / 200)));

const path = require('path');
const tgPath = require.resolve('./tg');
const sent = [];
let games = [];
const mock = {
  bot: { getChatMemberCount: async () => 10 },
  send: async (text, chatId, opts = {}) => {
    const id = sent.length + 1;
    sent.push({ chatId, text });
    if (opts.menu && chatId > 0 && mock.onMenu) setTimeout(() => mock.onMenu(chatId, opts.menu, id), 5);
    return { message_id: id };
  },
  sendAnimation: async () => ({ message_id: 1 }),
  edit: async () => ({}),
  editMarkup: async () => ({}),
  remove: async () => ({}),
  answerCallback: async () => {}
};
require.cache[tgPath] = { id: tgPath, filename: tgPath, loaded: true, exports: mock };

const { Werewolf } = require('./game');
const { getLocaleString } = require('./locale');

async function playGame(n, mode, seed) {
  sent.length = 0;
  const game = new Werewolf({ chatId: -1000 - n, user: { id: 1, first_name: 'P1' }, chatTitle: 'Test', gameMode: mode, botUsername: 'bot', onRemove: g => {} });
  mock.onMenu = async (chatId, menu, mid) => {
    const flat = menu.inline_keyboard.flat();
    if (!flat.length) return;
    const pick = flat[Math.floor(Math.random() * flat.length)];
    try {
      await game.handleReply({ id: 'q', from: { id: chatId }, data: pick.callback_data, message: { chat: { id: chatId }, message_id: mid } });
    } catch (e) {
      console.error('handleReply error', e);
    }
  };
  await game.init();
  const runP = game.run();
  for (let i = 1; i <= n; i++) await game.addPlayer({ id: i, first_name: 'P' + i, last_name: 'X' });
  game.forceStart();
  await Promise.race([runP, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 120000))]);
  const roles = game.Players ? game.Players.map(p => p.PlayerRole) : [];
  const last = sent.filter(s => s.chatId < 0).slice(-3).map(s => s.text.slice(0, 80).replace(/\n/g, ' '));
  return { winner: game.dbGame && game.dbGame.Winner, days: game.GameDay, last };
}

(async () => {
  const results = [];
  let failures = 0;
  for (const n of [5, 6, 8, 10, 12, 16, 20, 25, 35]) {
    for (const mode of ['Normal', 'Chaos']) {
      try {
        const r = await playGame(n, mode);
        results.push(`${n}/${mode}: ${r.winner} day ${r.days}`);
        if (!r.winner) failures++;
      } catch (e) {
        failures++;
        results.push(`${n}/${mode}: ERROR ${e.stack}`);
      }
    }
  }
  console.log(results.join('\n'));
  console.log('failures', failures);
  process.exit(failures ? 1 : 0);
})();
