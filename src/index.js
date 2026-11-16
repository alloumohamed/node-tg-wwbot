const config = require('./config');
if (!config.token) {
  console.error('BOT_TOKEN is required');
  process.exit(1);
}
const tg = require('./tg');
const store = require('./store');
const { getLocaleString, languages } = require('./locale');
const bots = require('./bots');
const gifs = require('./gifs');
const { Werewolf } = require('./game');
const balancing = require('./balance');
const { ALL_ROLES, EMOJI, CAN_BE_DISABLED } = require('./roles');
const achievements = require('./achievements');
const { toBold, formatHTML } = require('./util');

const bot = tg.bot;
const games = new Map();
let me = null;

const L = (k, ...a) => getLocaleString(k, ...a);

function removeGame(game) {
  bots.removeGame(game);
  if (games.get(game.ChatId) === game) games.delete(game.ChatId);
}

function gameByGuid(guid) {
  for (const g of games.values()) if (g.Guid === guid) return g;
  return null;
}

function playerGame(userId) {
  for (const g of games.values()) if (g.Players && g.Players.some(p => p.Id === userId)) return g;
  return null;
}

async function isGroupAdmin(chatId, userId) {
  if (config.adminIds.includes(userId)) return true;
  try {
    const m = await bot.getChatMember(chatId, userId);
    return ['creator', 'administrator'].includes(m.status);
  } catch (e) {
    return false;
  }
}

function isGlobalAdmin(id) {
  return config.adminIds.includes(id);
}

async function startGame(msg, mode) {
  const chat = msg.chat;
  if (chat.type === 'private') {
    tg.send('استخدم هذا الأمر داخل مجموعة.', chat.id).catch(() => {});
    return;
  }
  const existing = games.get(chat.id);
  if (existing) {
    existing.showJoinButton();
    return;
  }
  const group = store.ensureGroup(chat.id, chat.title);
  const game = new Werewolf({ chatId: chat.id, user: msg.from, chatTitle: chat.title, gameMode: mode, botUsername: me.username, onRemove: removeGame });
  games.set(chat.id, game);
  try {
    await game.init();
    game.run();
  } catch (e) {
    console.error(e);
    games.delete(chat.id);
    game.dispose();
    tg.send('حدث خطأ، حاول بدء اللعبة مرة أخرى...\n' + formatHTML(e.message), chat.id).catch(() => {});
  }
  return group;
}

function configKeyboard(group) {
  const flagLabels = [
    ['EnableSecretLynch', 'التصويت السري'],
    ['SecretLynchShowVotes', 'إظهار نتائج التصويت السري'],
    ['SecretLynchShowVoters', 'إظهار المصوتين'],
    ['ShowRolesDeath', 'كشف الدور عند الموت'],
    ['AllowFlee', 'السماح بالهروب'],
    ['AllowExtend', 'السماح بالتمديد'],
    ['ShowIDs', 'إظهار المعرفات'],
    ['ThiefFull', 'اللص الكامل'],
    ['ShufflePlayerList', 'خلط قائمة اللاعبين'],
    ['BurningOverkill', 'السماح بقاتل + مشعل معًا'],
    ['RandomMode', 'الوضع العشوائي']
  ];
  const rows = flagLabels.map(([k, t]) => [{ text: `${group.flags[k] ? '✅' : '❌'} ${t}`, callback_data: `cfg|f|${k}` }]);
  rows.push([{ text: `النمط: ${group.Mode === 'Player' ? 'يختار اللاعب' : group.Mode === 'Chaos' ? 'فوضوي' : 'عادي'}`, callback_data: 'cfg|mode' }]);
  rows.push([{ text: `كشف الأدوار بالنهاية: ${{ None: 'لا', Living: 'الأحياء', All: 'الكل' }[group.ShowRolesEnd]}`, callback_data: 'cfg|end' }]);
  rows.push([{ text: '🎭 الأدوار', callback_data: 'cfg|roles' }]);
  return { inline_keyboard: rows };
}

function rolesKeyboard(group) {
  const rows = [];
  let row = [];
  for (const r of ALL_ROLES) {
    if (!CAN_BE_DISABLED[r]) continue;
    const off = group.disabledRoles.includes(r);
    row.push({ text: `${off ? '❌' : '✅'} ${EMOJI[r]} ${L(r).replace(/[^\p{L}\p{N} ]/gu, '').trim()}`, callback_data: `cfg|r|${r}` });
    if (row.length === 2) {
      rows.push(row);
      row = [];
    }
  }
  if (row.length) rows.push(row);
  rows.push([{ text: '⬅️ رجوع', callback_data: 'cfg|back' }]);
  return { inline_keyboard: rows };
}

async function handleConfig(q) {
  const chatId = q.message.chat.id;
  if (!(await isGroupAdmin(chatId, q.from.id))) {
    tg.answerCallback(q.id, 'للمشرفين فقط', true);
    return;
  }
  const group = store.ensureGroup(chatId, q.message.chat.title);
  const parts = q.data.split('|');
  let note = null;
  let kb;
  if (parts[1] === 'f') {
    group.flags[parts[2]] = !group.flags[parts[2]];
    kb = configKeyboard(group);
  } else if (parts[1] === 'mode') {
    const order = ['Player', 'Normal', 'Chaos'];
    group.Mode = order[(order.indexOf(group.Mode) + 1) % order.length];
    kb = configKeyboard(group);
  } else if (parts[1] === 'end') {
    const order = ['None', 'Living', 'All'];
    group.ShowRolesEnd = order[(order.indexOf(group.ShowRolesEnd) + 1) % order.length];
    kb = configKeyboard(group);
  } else if (parts[1] === 'roles') {
    kb = rolesKeyboard(group);
  } else if (parts[1] === 'back') {
    kb = configKeyboard(group);
  } else if (parts[1] === 'r') {
    const role = parts[2];
    const off = group.disabledRoles.includes(role);
    const next = off ? group.disabledRoles.filter(x => x !== role) : group.disabledRoles.concat([role]);
    if (!off && !balancing.tryBalance(next, group.MaxPlayers || config.MaxPlayers)) {
      note = 'لا يمكن تعطيل هذا الدور: لن تتمكن اللعبة من موازنة الأدوار';
    } else {
      group.disabledRoles = next;
    }
    kb = rolesKeyboard(group);
  }
  store.save();
  tg.answerCallback(q.id, note, Boolean(note));
  bot.editMessageReplyMarkup(kb, { chat_id: chatId, message_id: q.message.message_id }).catch(() => {});
}

bot.onText(/^\/startgame(@\w+)?$/i, msg => startGame(msg, 'Normal'));
bot.onText(/^\/startchaos(@\w+)?$/i, msg => startGame(msg, 'Chaos'));

bot.onText(/^\/join(@\w+)?$/i, msg => {
  if (msg.chat.type === 'private') {
    tg.send(L('JoinFromGroup'), msg.chat.id).catch(() => {});
    return;
  }
  const game = games.get(msg.chat.id);
  if (game) game.showJoinButton();
  else tg.send(L('NoGame'), msg.chat.id).catch(() => {});
});

bot.onText(/^\/forcestart(@\w+)?$/i, async msg => {
  if (msg.chat.type === 'private') return;
  if (!(await isGroupAdmin(msg.chat.id, msg.from.id))) {
    tg.send(L('GroupAdminOnly'), msg.chat.id).catch(() => {});
    return;
  }
  const game = games.get(msg.chat.id);
  if (game) game.forceStart();
  else tg.send(L('NoGame'), msg.chat.id).catch(() => {});
});

bot.onText(/^\/players(@\w+)?$/i, msg => {
  if (msg.chat.type === 'private') return;
  const game = games.get(msg.chat.id);
  if (game) game.outputPlayers();
  else tg.send(L('NoGame'), msg.chat.id).catch(() => {});
});

bot.onText(/^\/flee(@\w+)?$/i, msg => {
  if (msg.chat.type === 'private') return;
  const game = games.get(msg.chat.id);
  if (!game) {
    tg.send(L('NoGame'), msg.chat.id).catch(() => {});
    return;
  }
  if (game.Players.some(p => p.Id === msg.from.id)) game.removePlayer(msg.from);
  else tg.send(L('NotPlaying'), msg.chat.id).catch(() => {});
});

bot.onText(/^\/extend(@\w+)?(?:\s+(-?\d+))?$/i, async (msg, m) => {
  if (msg.chat.type === 'private') return;
  const game = games.get(msg.chat.id);
  if (!game) {
    tg.send(L('NoGame'), msg.chat.id).catch(() => {});
    return;
  }
  const isAdmin = await isGroupAdmin(msg.chat.id, msg.from.id);
  const inGame = game.Players.some(p => p.Id === msg.from.id);
  if (!inGame && !isAdmin) {
    tg.send(L('NotPlaying'), msg.chat.id).catch(() => {});
    return;
  }
  let seconds = m[2] !== undefined ? parseInt(m[2], 10) : 30;
  if (seconds < 0 && !isAdmin) {
    tg.send(L('GroupAdminOnly'), msg.chat.id).catch(() => {});
    return;
  }
  const group = store.ensureGroup(msg.chat.id, msg.chat.title);
  if (isAdmin || group.flags.AllowExtend) {
    const maxextend = group.MaxExtend || config.MaxExtend;
    seconds = Math.abs(seconds) > maxextend ? maxextend * Math.sign(seconds) : seconds;
    game.extendTime(msg.from.id, isAdmin, seconds);
  } else {
    tg.send(L('GroupAdminOnly'), msg.chat.id).catch(() => {});
  }
});

bot.onText(/^\/notify(@\w+)?$/i, msg => {
  if (msg.chat.type === 'private') return;
  if (games.get(msg.chat.id)) {
    tg.send('اللعبة جارية بالفعل.', msg.chat.id).catch(() => {});
    return;
  }
  store.addNotify(msg.chat.id, msg.from.id);
  tg.send('سأخبرك عند بدء لعبة جديدة في هذه المجموعة.', msg.from.id).catch(() => {});
});

bot.onText(/^\/stopwaiting(@\w+)?$/i, msg => {
  if (msg.chat.type === 'private') return;
  store.removeNotify(msg.chat.id, msg.from.id);
  tg.send(L('DeletedFromWaitList', toBold(msg.chat.title)), msg.from.id).catch(() => {});
});

bot.onText(/^\/config(@\w+)?$/i, async msg => {
  if (msg.chat.type === 'private') return;
  if (!(await isGroupAdmin(msg.chat.id, msg.from.id))) {
    tg.send(L('GroupAdminOnly'), msg.chat.id).catch(() => {});
    return;
  }
  const group = store.ensureGroup(msg.chat.id, msg.chat.title);
  tg.send('⚙️ إعدادات المجموعة', msg.chat.id, { menu: configKeyboard(group) }).catch(() => {});
});

bot.onText(/^\/settime\s+(day|night|lynch)\s+(\d+)(@\w+)?$/i, async (msg, m) => {
  if (msg.chat.type === 'private') return;
  if (!(await isGroupAdmin(msg.chat.id, msg.from.id))) return;
  const group = store.ensureGroup(msg.chat.id, msg.chat.title);
  const v = Math.min(Math.max(parseInt(m[2], 10), 30), 300);
  group[{ day: 'DayTime', night: 'NightTime', lynch: 'LynchTime' }[m[1].toLowerCase()]] = v;
  store.save();
  tg.send(`تم الضبط: ${v} ثانية`, msg.chat.id).catch(() => {});
});

bot.onText(/^\/setmax\s+(\d+)(@\w+)?$/i, async (msg, m) => {
  if (msg.chat.type === 'private') return;
  if (!(await isGroupAdmin(msg.chat.id, msg.from.id))) return;
  const group = store.ensureGroup(msg.chat.id, msg.chat.title);
  group.MaxPlayers = Math.min(Math.max(parseInt(m[1], 10), config.MinPlayers), config.MaxPlayers);
  store.save();
  tg.send(`الحد الأقصى للاعبين: ${group.MaxPlayers}`, msg.chat.id).catch(() => {});
});

bot.onText(/^\/killgame(@\w+)?$/i, async msg => {
  if (msg.chat.type === 'private') return;
  if (!(await isGroupAdmin(msg.chat.id, msg.from.id))) return;
  const game = games.get(msg.chat.id);
  if (game) game.kill();
});

bot.onText(/^\/(rolelist|roles)(@\w+)?$/i, msg => {
  const text = ALL_ROLES.map(r => `${EMOJI[r]} ${L(r)}`).join('\n');
  tg.send(text, msg.chat.id).catch(() => {});
});

bot.onText(/^\/about(@\w+)?\s+(\S+)$/i, (msg, m) => {
  const role = ALL_ROLES.find(r => r.toLowerCase() === m[2].toLowerCase());
  if (!role) return;
  tg.send(L(`About${role}`), msg.chat.id).catch(() => {});
});

bot.onText(/^\/myachievements(@\w+)?$/i, msg => {
  const p = store.getPlayer(msg.from.id);
  const list = p ? p.achievements : [];
  const text = list.length ? list.map(k => achievements.describe(achievements.byKey[k])).join('\n\n') : 'لم تفتح أي إنجاز بعد!';
  tg.send(text, msg.from.id).catch(() => tg.send('ابدأ البوت في الخاص أولًا.', msg.chat.id).catch(() => {}));
});

bot.onText(/^\/addbots?(@\w+)?(?:\s+(\d+))?$/i, async (msg, m) => {
  if (msg.chat.type === 'private') {
    tg.send('استخدم هذا الأمر داخل المجموعة أثناء فترة الانضمام.', msg.chat.id).catch(() => {});
    return;
  }
  if (!(await isGroupAdmin(msg.chat.id, msg.from.id))) {
    tg.send(L('GroupAdminOnly'), msg.chat.id).catch(() => {});
    return;
  }
  const game = games.get(msg.chat.id);
  if (!game || !game.IsJoining || game.IsInitializing) {
    tg.send('لا توجد لعبة في مرحلة الانضمام.', msg.chat.id).catch(() => {});
    return;
  }
  try {
    await bot.sendMessage(msg.from.id, '🤖 ستتحكم ببوتات المجموعة من هنا. استخدم /mybots لإدارتها.');
  } catch (e) {
    tg.send('ابدأ البوت في الخاص أولًا ثم أعد الأمر.', msg.chat.id).catch(() => {});
    return;
  }
  const count = Math.min(Math.max(m[2] ? parseInt(m[2], 10) : 1, 1), 34);
  let added = 0;
  for (let i = 0; i < count; i++) {
    if (game.Players.length >= config.MaxPlayers) break;
    const b = await game.addBot(msg.from.id);
    if (!b) break;
    added++;
  }
  tg.send(`🤖 تمت إضافة ${added} بوت. التحكم من الخاص: /mybots`, msg.chat.id).catch(() => {});
  if (added) {
    const p = bots.panel(msg.from.id);
    tg.send(p.text, msg.from.id, { menu: p.keyboard }).catch(() => {});
  }
});

bot.onText(/^\/mybots(@\w+)?$/i, msg => {
  if (msg.chat.type !== 'private') {
    tg.send('استخدم /mybots في الخاص مع البوت.', msg.chat.id).catch(() => {});
    return;
  }
  const p = bots.panel(msg.from.id);
  tg.send(p.text, msg.chat.id, { menu: p.keyboard }).catch(() => {});
});

bot.onText(/^\/grouplist(@\w+)?$/i, msg => {
  const list = store.allRankings()
    .filter(r => r.Ranking > 0)
    .map(r => ({ r, g: store.getGroup(r.GroupId) }))
    .filter(x => x.g && x.g.GroupLink)
    .sort((a, b) => b.r.Ranking - a.r.Ranking)
    .slice(0, 20);
  if (!list.length) {
    tg.send('لا توجد مجموعات عامة مصنفة بعد.', msg.chat.id).catch(() => {});
    return;
  }
  const text = '🏆 أفضل المجموعات:\n\n' + list.map((x, i) => `${i + 1}. <a href="${formatHTML(x.g.GroupLink)}">${formatHTML(x.g.Name)}</a> — ${x.r.Ranking.toFixed(2)}`).join('\n');
  tg.send(text, msg.chat.id, { preview: false }).catch(() => {});
});

bot.onText(/^\/setlink(@\w+)?\s+(https?:\/\/t\.me\/\S+)$/i, async (msg, m) => {
  if (msg.chat.type === 'private') return;
  if (!(await isGroupAdmin(msg.chat.id, msg.from.id))) return;
  store.ensureGroup(msg.chat.id, msg.chat.title).GroupLink = m[2];
  store.save();
  tg.send('تم حفظ رابط المجموعة.', msg.chat.id).catch(() => {});
});

bot.onText(/^\/setlang(@\w+)?$/i, async msg => {
  if (msg.chat.type === 'private') return;
  if (!(await isGroupAdmin(msg.chat.id, msg.from.id))) return;
  const rows = languages().map(l => [{ text: l, callback_data: `lang|${l}` }]);
  tg.send('اختر لغة اللعبة:', msg.chat.id, { menu: { inline_keyboard: rows } }).catch(() => {});
});

bot.onText(/^\/grant(@\w+)?\s+(\d+)\s+(\w+)$/i, (msg, m) => {
  if (!isGlobalAdmin(msg.from.id)) return;
  const key = m[3];
  if (!achievements.byKey[key]) {
    tg.send('مفتاح إنجاز غير معروف.', msg.chat.id).catch(() => {});
    return;
  }
  const p = store.ensurePlayer(Number(m[2]));
  if (!achievements.has(p, key)) p.achievements.push(key);
  store.save();
  tg.send('تم.', msg.chat.id).catch(() => {});
});

bot.onText(/^\/setgif(@\w+)?\s+(\w+)$/i, (msg, m) => {
  if (!isGlobalAdmin(msg.from.id)) return;
  if (!gifs.GIF_KEYS.includes(m[2])) {
    tg.send('المفاتيح المتاحة:\n' + gifs.GIF_KEYS.join('\n'), msg.chat.id).catch(() => {});
    return;
  }
  const r = msg.reply_to_message;
  const id = r && ((r.animation && r.animation.file_id) || (r.video && r.video.file_id) || (r.document && r.document.file_id));
  if (!id) {
    tg.send('استخدم الأمر كرد على رسالة تحتوي صورة متحركة (GIF).', msg.chat.id).catch(() => {});
    return;
  }
  gifs.add(m[2], id);
  tg.send('تمت إضافة الصورة المتحركة.', msg.chat.id).catch(() => {});
});

bot.onText(/^\/cleargif(@\w+)?\s+(\w+)$/i, (msg, m) => {
  if (!isGlobalAdmin(msg.from.id) || !gifs.GIF_KEYS.includes(m[2])) return;
  gifs.clear(m[2]);
  tg.send('تم المسح.', msg.chat.id).catch(() => {});
});

bot.onText(/^\/gifs(@\w+)?$/i, msg => {
  if (!isGlobalAdmin(msg.from.id)) return;
  const data = gifs.load();
  tg.send(gifs.GIF_KEYS.map(k => `${k}: ${data[k].length}`).join('\n'), msg.chat.id).catch(() => {});
});

bot.onText(/^\/(start|help)(@\w+)?(?:\s+(\S+))?$/i, async (msg, m) => {
  const payload = m[3] || '';
  if (msg.chat.type === 'private' && payload.startsWith('join')) {
    const game = gameByGuid(payload.slice(4));
    if (!game) {
      tg.send(L('NoGame'), msg.chat.id).catch(() => {});
      return;
    }
    await game.addPlayer(msg.from);
    return;
  }
  const text = 'مرحبًا بك في لعبة المستذئب! 🐺\n\n' +
    '/startgame - بدء لعبة عادية\n/startchaos - بدء لعبة فوضوية\n/join - إظهار زر الانضمام\n' +
    '/flee - الهروب من اللعبة\n/players - قائمة اللاعبين\n/extend [ثواني] - تمديد وقت الانضمام\n' +
    '/forcestart - بدء اللعبة فورًا (للمشرفين)\n/addbot [عدد] - إضافة بوتات للعب (للمشرفين)\n/mybots - التحكم ببوتاتك (في الخاص)\n/setlang - لغة اللعبة\n/setlink رابط - رابط المجموعة\n/grouplist - أفضل المجموعات\n/config - الإعدادات (للمشرفين)\n' +
    '/settime day|night|lynch ثواني - ضبط الأوقات (للمشرفين)\n/setmax عدد - أقصى عدد لاعبين (للمشرفين)\n' +
    '/rolelist - قائمة الأدوار\n/about الدور - وصف الدور بالإنجليزية (مثال: /about Seer)\n/myachievements - إنجازاتي\n/notify - تنبيهي عند بدء لعبة';
  tg.send(text, msg.chat.id).catch(() => {});
});

bot.on('callback_query', async q => {
  try {
    if (!q.data) return;
    if (q.data.startsWith('cfg|')) {
      await handleConfig(q);
      return;
    }
    if (q.data.startsWith('b|')) {
      await bots.handleOwnerCallback(q);
      return;
    }
    if (q.data.startsWith('bm|')) {
      await bots.handlePanelCallback(q);
      return;
    }
    if (q.data.startsWith('lang|')) {
      if (!(await isGroupAdmin(q.message.chat.id, q.from.id))) {
        tg.answerCallback(q.id, 'للمشرفين فقط', true);
        return;
      }
      const lang = q.data.slice(5);
      if (languages().includes(lang)) {
        store.ensureGroup(q.message.chat.id, q.message.chat.title).Language = lang;
        store.save();
        tg.answerCallback(q.id, 'تم');
        tg.edit(q.message.chat.id, q.message.message_id, `تم ضبط اللغة: ${lang}`).catch(() => {});
      }
      return;
    }
    if (q.data.startsWith('v|')) {
      const guid = q.data.split('|')[1];
      const game = gameByGuid(guid);
      tg.answerCallback(q.id);
      if (game) await game.handleReply(q);
    }
  } catch (e) {
    console.error(e);
  }
});

bot.on('new_chat_members', msg => {
  if (me && msg.new_chat_members.some(u => u.id === me.id)) store.ensureGroup(msg.chat.id, msg.chat.title);
});

bot.on('polling_error', e => console.error('polling_error', e.message));

(async () => {
  me = await bot.getMe();
  await bot.deleteWebHook().catch(() => {});
  bot.startPolling({ polling: { params: { allowed_updates: ['message', 'callback_query'] } } });
  console.log(`Bot @${me.username} started`);
})();

process.on('SIGINT', () => {
  store.flushSync();
  process.exit(0);
});
process.on('SIGTERM', () => {
  store.flushSync();
  process.exit(0);
});
process.on('unhandledRejection', e => console.error('unhandledRejection', e));
