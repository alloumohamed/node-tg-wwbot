const fs = require('fs');
const path = require('path');
const { formatHTML, randInt } = require('./util');

const langDir = path.join(__dirname, '..', 'data', 'lang');
const packs = {};
for (const f of fs.readdirSync(langDir)) {
  if (f.endsWith('.json')) packs[f.slice(0, -5)] = JSON.parse(fs.readFileSync(path.join(langDir, f), 'utf8'));
}
const english = packs.English;

function format(template, args) {
  return template.replace(/\{\{|\}\}|\{(\d+)(?::[^}]*)?\}/g, (m, i) => {
    if (m === '{{') return '{';
    if (m === '}}') return '}';
    const v = args[Number(i)];
    return v === undefined || v === null ? '' : String(v);
  });
}

function pick(table, key) {
  const values = table && table[key];
  if (!values || values.length === 0) return null;
  return values[randInt(values.length)];
}

function getString(lang, key, args) {
  const table = packs[lang] || packs.Arabic;
  let selected = pick(table, key);
  if (selected !== null && selected.toLowerCase().includes('/join')) selected = null;
  if (selected === null || selected.trim() === '') selected = pick(english, key);
  if (selected === null) throw new Error(`Error getting string ${key}`);
  return format(formatHTML(selected.trim()), args).replace(/\\n/g, '\n');
}

function forLang(lang) {
  return (key, ...args) => getString(lang, key, args);
}

function getLocaleString(key, ...args) {
  return getString('Arabic', key, args);
}

function languages() {
  return Object.keys(packs);
}

module.exports = { getLocaleString, forLang, languages };
