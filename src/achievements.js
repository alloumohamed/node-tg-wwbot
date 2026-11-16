const path = require('path');
const list = require(path.join(__dirname, '..', 'data', 'achievements.json'));
const store = require('./store');
const { toBold } = require('./util');

const byKey = Object.fromEntries(list.map(a => [a.key, a]));

function has(player, key) {
  return player.achievements.includes(key);
}

function unlock(telegramId, key) {
  const p = store.getPlayer(telegramId);
  if (!p) return null;
  if (has(p, key)) return null;
  p.achievements.push(key);
  store.save();
  return byKey[key] || null;
}

function describe(a) {
  return `${toBold(a.name)}\n${a.desc}`;
}

module.exports = { byKey, has, unlock, describe, list };
