const fs = require('fs');
const path = require('path');
const config = require('./config');

const GIF_KEYS = ['VillagerDieImages', 'WolfWin', 'WolvesWin', 'VillagersWin', 'NoWinner', 'StartGame', 'StartChaosGame', 'TannerWin', 'CultWins', 'SerialKillerWins', 'LoversWin', 'SKKilled', 'ArsonistWins', 'BurnToDeath'];
const file = () => path.join(config.dataDir, 'gifs.json');

function load() {
  const out = Object.fromEntries(GIF_KEYS.map(k => [k, []]));
  try {
    if (fs.existsSync(file())) {
      const data = JSON.parse(fs.readFileSync(file(), 'utf8'));
      for (const k of GIF_KEYS) if (Array.isArray(data[k])) out[k] = data[k];
    }
  } catch (e) {
    console.error('gifs load failed', e.message);
  }
  return out;
}

function write(data) {
  fs.writeFileSync(file(), JSON.stringify(data, null, 1));
}

function add(key, id) {
  const data = load();
  if (!data[key].includes(id)) data[key].push(id);
  write(data);
}

function clear(key) {
  const data = load();
  data[key] = [];
  write(data);
}

module.exports = { GIF_KEYS, load, add, clear };
