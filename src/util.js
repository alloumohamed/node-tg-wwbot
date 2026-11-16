const crypto = require('crypto');

const sleep = ms => new Promise(r => setTimeout(r, ms));

function randInt(n) {
  if (n <= 0) return 0;
  return crypto.randomInt(0, n);
}

function shuffle(list) {
  let n = list.length;
  while (n > 1) {
    const k = randInt(n);
    n--;
    const v = list[k];
    list[k] = list[n];
    list[n] = v;
  }
  return list;
}

function formatHTML(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function toBold(s) {
  if (s === null || s === undefined) return null;
  return `<b>${formatHTML(String(s))}</b>`;
}

function getName(player, menu = false, dead = false) {
  const name = player.Name;
  if (menu) return name;
  if (player.TeleUser.isBot) return toBold(name);
  if (!dead) return `<a href="tg://user?id=${player.TeleUser.id}">${formatHTML(name)}</a>`;
  return toBold(name);
}

function getPlayersForRoles(players, roles, aliveOnly = true, exceptPlayer = null) {
  return players.filter(x => roles.includes(x.PlayerRole) && (!aliveOnly || !x.IsDead) && x.Id !== (exceptPlayer ? exceptPlayer.Id : undefined));
}

function getPlayerForRole(players, role, aliveOnly = true, exceptPlayer = null) {
  const list = players
    .filter(x => x.PlayerRole === role && (!aliveOnly || !x.IsDead) && x.Id !== (exceptPlayer ? exceptPlayer.Id : undefined))
    .sort((a, b) => b.TimeDied - a.TimeDied);
  return list[0] || null;
}

function groupBy(list, keyFn) {
  const m = new Map();
  for (const x of list) {
    const k = keyFn(x);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(x);
  }
  return m;
}

function isDateAnywhere(day, month, year = null) {
  const now = Date.now();
  const dates = [new Date(now - 11 * 3600000), new Date(now), new Date(now + 14 * 3600000)];
  return dates.some(d => d.getUTCDate() === day && d.getUTCMonth() + 1 === month && (year === null || d.getUTCFullYear() === year));
}

function byteLength(s) {
  return Buffer.byteLength(s, 'utf8');
}

module.exports = { sleep, randInt, shuffle, formatHTML, toBold, getName, getPlayersForRoles, getPlayerForRole, groupBy, isDateAnywhere, byteLength };
