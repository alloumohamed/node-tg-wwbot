const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const config = require('./config');

const DEFAULT_FLAGS = {
  EnableSecretLynch: false,
  RandomMode: false,
  AllowExtend: false,
  ShowRolesDeath: true,
  AllowFlee: true,
  ShowIDs: false,
  ThiefFull: false,
  SecretLynchShowVotes: false,
  SecretLynchShowVoters: false,
  ShufflePlayerList: false,
  BurningOverkill: false
};

fs.mkdirSync(config.dataDir, { recursive: true });
const sql = new DatabaseSync(path.join(config.dataDir, 'werewolf.sqlite'));
sql.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS groups (id TEXT PRIMARY KEY, json TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS players (id TEXT PRIMARY KEY, json TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS games (id INTEGER PRIMARY KEY, group_id TEXT, json TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS rankings (id TEXT PRIMARY KEY, json TEXT NOT NULL);
`);

const state = { groups: {}, players: {}, rankings: {}, games: [], meta: { nextGroupId: 1, nextGameId: 1, refreshDate: 0 }, notify: {}, idle: [] };
const cache = { groups: {}, players: {}, rankings: {}, games: {}, kv: {} };

function loadAll() {
  for (const r of sql.prepare('SELECT id, json FROM groups').all()) {
    state.groups[r.id] = JSON.parse(r.json);
    cache.groups[r.id] = r.json;
  }
  for (const r of sql.prepare('SELECT id, json FROM players').all()) {
    state.players[r.id] = JSON.parse(r.json);
    cache.players[r.id] = r.json;
  }
  for (const r of sql.prepare('SELECT id, json FROM rankings').all()) {
    state.rankings[r.id] = JSON.parse(r.json);
    cache.rankings[r.id] = r.json;
  }
  for (const r of sql.prepare('SELECT json FROM games ORDER BY id DESC LIMIT 200').all().reverse()) state.games.push(JSON.parse(r.json));
  for (const g of state.games) cache.games[g.Id] = JSON.stringify(g);
  for (const r of sql.prepare('SELECT k, v FROM kv').all()) {
    cache.kv[r.k] = r.v;
    const v = JSON.parse(r.v);
    if (r.k === 'meta') Object.assign(state.meta, v);
    if (r.k === 'notify') state.notify = v;
    if (r.k === 'idle') state.idle = v;
  }
}

function flushSync() {
  sql.exec('BEGIN');
  try {
    const upsert = (table, map, cacheMap) => {
      const st = sql.prepare(`INSERT INTO ${table} (id, json) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET json = excluded.json`);
      for (const [id, obj] of Object.entries(map)) {
        const j = JSON.stringify(obj);
        if (cacheMap[id] !== j) {
          st.run(id, j);
          cacheMap[id] = j;
        }
      }
    };
    upsert('groups', state.groups, cache.groups);
    upsert('players', state.players, cache.players);
    upsert('rankings', state.rankings, cache.rankings);
    const gst = sql.prepare('INSERT INTO games (id, group_id, json) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET json = excluded.json');
    for (const g of state.games) {
      const j = JSON.stringify(g);
      if (cache.games[g.Id] !== j) {
        gst.run(g.Id, String(g.GroupId), j);
        cache.games[g.Id] = j;
      }
    }
    const kst = sql.prepare('INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v');
    for (const [k, v] of [['meta', state.meta], ['notify', state.notify], ['idle', state.idle]]) {
      const j = JSON.stringify(v);
      if (cache.kv[k] !== j) {
        kst.run(k, j);
        cache.kv[k] = j;
      }
    }
    sql.exec('COMMIT');
  } catch (e) {
    try { sql.exec('ROLLBACK'); } catch (e2) {}
    console.error('store flush failed', e.message);
  }
  if (state.games.length > 200) state.games.splice(0, state.games.length - 200);
}

let timer = null;
function save() {
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    flushSync();
  }, 500);
}

function getGroup(groupId) {
  return state.groups[String(groupId)] || null;
}

function makeGroup(groupId, name) {
  const g = {
    Id: state.meta.nextGroupId++,
    GroupId: groupId,
    Name: name || '',
    Language: 'Arabic',
    Mode: 'Player',
    ShowRolesEnd: 'Living',
    flags: Object.assign({}, DEFAULT_FLAGS),
    disabledRoles: [],
    DayTime: null,
    NightTime: null,
    LynchTime: null,
    MaxPlayers: null,
    MaxExtend: null,
    GroupLink: null,
    MemberCount: 0
  };
  state.groups[String(groupId)] = g;
  save();
  return g;
}

function ensureGroup(groupId, name) {
  let g = getGroup(groupId);
  if (!g) g = makeGroup(groupId, name);
  else if (name && g.Name !== name) {
    g.Name = name;
    save();
  }
  for (const k of Object.keys(DEFAULT_FLAGS)) if (g.flags[k] === undefined) g.flags[k] = DEFAULT_FLAGS[k];
  return g;
}

function getPlayer(telegramId) {
  return state.players[String(telegramId)] || null;
}

function ensurePlayer(telegramId, name, userName) {
  let p = getPlayer(telegramId);
  if (!p) {
    p = { TelegramId: telegramId, Name: name || '', UserName: userName || null, achievements: [], gamesPlayed: 0, gamesSurvived: 0, gamesWon: 0, skKills: 0, gaSaves: 0, firstLynchStreak: 0, groupGames: {}, langGames: {} };
    state.players[String(telegramId)] = p;
  }
  if (name) p.Name = name;
  if (userName !== undefined) p.UserName = userName;
  for (const k of ['skKills', 'gaSaves', 'firstLynchStreak']) if (p[k] === undefined) p[k] = 0;
  for (const k of ['groupGames', 'langGames']) if (!p[k]) p[k] = {};
  save();
  return p;
}

function addGame(game) {
  game.Id = state.meta.nextGameId++;
  state.games.push(game);
  save();
  return game;
}

function addIdle(playerId, groupId) {
  const now = Date.now();
  state.idle = state.idle.filter(x => now - x.ts < 48 * 3600000);
  state.idle.push({ player: playerId, group: groupId, ts: now });
  save();
}

function idleCounts(playerId, groupId) {
  const now = Date.now();
  const list = state.idle.filter(x => x.player === playerId && now - x.ts < 24 * 3600000);
  return { total: list.length, group: list.filter(x => x.group === groupId).length };
}

function addNotify(groupId, userId) {
  const k = String(groupId);
  if (!state.notify[k]) state.notify[k] = [];
  if (!state.notify[k].includes(userId)) state.notify[k].push(userId);
  save();
}

function takeNotify(groupId) {
  const k = String(groupId);
  const list = state.notify[k] || [];
  delete state.notify[k];
  save();
  return list;
}

function removeNotify(groupId, userId) {
  const k = String(groupId);
  if (state.notify[k]) state.notify[k] = state.notify[k].filter(x => x !== userId);
  save();
}

function getRanking(groupId) {
  return state.rankings[String(groupId)] || null;
}

function ensureRanking(groupId, refreshDate) {
  const k = String(groupId);
  if (!state.rankings[k]) state.rankings[k] = { GroupId: groupId, GamesPlayed: 0, PlayersCount: 0, MinutesPlayed: 0, Ranking: 0, LastRefresh: refreshDate };
  return state.rankings[k];
}

function allRankings() {
  return Object.values(state.rankings);
}

function allGroups() {
  return Object.values(state.groups);
}

function allPlayers() {
  return Object.values(state.players);
}

function getMeta() {
  return state.meta;
}

loadAll();

module.exports = { getGroup, makeGroup, ensureGroup, getPlayer, ensurePlayer, addGame, addIdle, idleCounts, addNotify, takeNotify, removeNotify, getRanking, ensureRanking, allRankings, allGroups, allPlayers, getMeta, save, flushSync, DEFAULT_FLAGS };
