const ROLE_LIST = [
  ['Villager', '👱', false],
  ['Drunk', '🍻', true],
  ['Harlot', '💋', true],
  ['Seer', '👳', true],
  ['Traitor', '🖕', true],
  ['GuardianAngel', '👼', true],
  ['Detective', '🕵', true],
  ['Wolf', '🐺', false],
  ['Cursed', '😾', true],
  ['Gunner', '🔫', true],
  ['Tanner', '👺', true],
  ['Fool', '🃏', true],
  ['WildChild', '👶', true],
  ['Beholder', '👁', true],
  ['ApprenticeSeer', '🙇', true],
  ['Cultist', '👤', true],
  ['CultistHunter', '💂', true],
  ['Mason', '👷', true],
  ['Doppelgänger', '🎭', true],
  ['Cupid', '🏹', true],
  ['Hunter', '🎯', true],
  ['SerialKiller', '🔪', true],
  ['Sorcerer', '🔮', true],
  ['AlphaWolf', '⚡️', true],
  ['WolfCub', '🐶', true],
  ['Blacksmith', '⚒', true],
  ['ClumsyGuy', '🤕', true],
  ['Mayor', '🎖', true],
  ['Prince', '👑', true],
  ['Lycan', '🐺🌝', true],
  ['Pacifist', '☮️', true],
  ['WiseElder', '📚', true],
  ['Oracle', '🌀', true],
  ['Sandman', '💤', true],
  ['WolfMan', '👱🌚', true],
  ['Thief', '😈', true],
  ['Troublemaker', '🤯', true],
  ['Chemist', '👨‍🔬', true],
  ['SnowWolf', '🐺☃️', true],
  ['GraveDigger', '☠️', true],
  ['Augur', '🦅', true],
  ['Arsonist', '🔥', true],
  ['Spumpkin', '🎃', false],
  ['Chef', '🍚', true],
  ['Barkeep', '🍸', true]
];

const ALL_ROLES = ROLE_LIST.map(r => r[0]);
const EMOJI = Object.fromEntries(ROLE_LIST.map(r => [r[0], r[1]]));
const CAN_BE_DISABLED = Object.fromEntries(ROLE_LIST.map(r => [r[0], r[2]]));

const WOLF_ROLES = ['Wolf', 'AlphaWolf', 'WolfCub', 'Lycan'];

const VILLAGE_TEAM = ['Villager', 'Cursed', 'Drunk', 'Beholder', 'ApprenticeSeer', 'Traitor', 'Mason', 'Hunter', 'Mayor', 'ClumsyGuy', 'Prince', 'WolfMan', 'Pacifist', 'WiseElder', 'Blacksmith', 'Troublemaker', 'Fool', 'Harlot', 'CultistHunter', 'Seer', 'GuardianAngel', 'WildChild', 'Cupid', 'Sandman', 'Oracle', 'Chemist', 'Detective', 'Gunner', 'Spumpkin', 'Augur', 'GraveDigger', 'Chef', 'Barkeep'];

function teamOf(role) {
  if (VILLAGE_TEAM.includes(role)) return 'Village';
  if (role === 'Doppelgänger' || role === 'Thief') return 'Thief';
  if (['Sorcerer', 'AlphaWolf', 'WolfCub', 'Wolf', 'Lycan', 'SnowWolf'].includes(role)) return 'Wolf';
  if (role === 'Tanner') return 'Tanner';
  if (role === 'Cultist') return 'Cult';
  if (role === 'SerialKiller') return 'SerialKiller';
  if (role === 'Arsonist') return 'Arsonist';
  throw new Error('Unknown role ' + role);
}

module.exports = { ALL_ROLES, EMOJI, CAN_BE_DISABLED, WOLF_ROLES, teamOf };
