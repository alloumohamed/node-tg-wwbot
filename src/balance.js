const { ALL_ROLES, WOLF_ROLES } = require('./roles');
const { shuffle, randInt, isDateAnywhere } = require('./util');

const WolfRoles = WOLF_ROLES;

function count(list, fn) {
  let c = 0;
  for (const x of list) if (fn(x)) c++;
  return c;
}

function getStrength(role, allRoles) {
  const wolfRoles = ['Wolf', 'WolfCub', 'AlphaWolf', 'Lycan'];
  const nonConvertibleRoles = ['Seer', 'GuardianAngel', 'Detective', 'Cursed', 'Harlot', 'Hunter', 'Doppelgänger', 'Wolf', 'AlphaWolf', 'WolfCub', 'SerialKiller', 'Lycan', 'Thief', 'SnowWolf'];
  const n = r => count(allRoles, x => x === r);
  switch (role) {
    case 'Villager': return 1;
    case 'Drunk': return 3;
    case 'Harlot': return 6;
    case 'Seer': return 7 - n('Lycan') - n('WolfMan') * 2;
    case 'Traitor': return 0;
    case 'GuardianAngel': return 7 + (allRoles.includes('Arsonist') ? 1 : 0);
    case 'Detective': return 6;
    case 'Wolf': return 10;
    case 'Cursed': return 1 - Math.trunc(count(allRoles, x => wolfRoles.includes(x) || x === 'SnowWolf') / 2);
    case 'Gunner': return 6;
    case 'Tanner': return Math.trunc(allRoles.length / 2);
    case 'Fool': return 3;
    case 'WildChild': return 1;
    case 'Beholder': return 1 + (allRoles.includes('Seer') ? 4 : 0) + (allRoles.includes('Fool') ? 1 : 0);
    case 'ApprenticeSeer': return 6;
    case 'Cultist': return 10 + count(allRoles, x => !nonConvertibleRoles.includes(x));
    case 'CultistHunter': return n('Cultist') === 0 ? 1 : 7;
    case 'Mason': return n('Mason') <= 1 ? 1 : n('Mason') + 3;
    case 'Doppelgänger': return 2;
    case 'Cupid': return 2;
    case 'Hunter': return 6;
    case 'SerialKiller': return 15;
    case 'Sorcerer': return 2;
    case 'AlphaWolf': return 12;
    case 'WolfCub':
      return ['AlphaWolf', 'Wolf', 'Lycan', 'SnowWolf', 'WildChild', 'Doppelgänger', 'Cursed', 'Traitor'].some(x => allRoles.includes(x)) ? 12 : 10;
    case 'Blacksmith': return 5;
    case 'ClumsyGuy': return -1;
    case 'Mayor': return 4;
    case 'Prince': return 3;
    case 'WolfMan': return 1;
    case 'Augur': return 5;
    case 'Pacifist': return 3;
    case 'WiseElder': return 3;
    case 'Oracle': return 4;
    case 'Sandman': return 3;
    case 'Lycan': return 10;
    case 'Thief': return 0;
    case 'Troublemaker': return 5;
    case 'Chemist': return 0;
    case 'SnowWolf': return 15;
    case 'GraveDigger': return 5;
    case 'Arsonist': return 8;
    case 'Spumpkin': return 2;
    case 'Chef': return 3;
    case 'Barkeep': return 1 + n('Villager');
    default: throw new Error('Unknown role ' + role);
  }
}

function getRoleList(playerCount, disabledRoles) {
  const rolesToAssign = [];
  const possiblewolves = ['Wolf', 'AlphaWolf', 'WolfCub', 'Lycan', 'SnowWolf'].filter(x => !disabledRoles.includes(x));

  let wolftoadd = possiblewolves[randInt(possiblewolves.length)];
  const wolfCount = Math.min(Math.max(Math.trunc(playerCount / 5), 1), 5);
  for (let i = 0; i < wolfCount; i++) {
    rolesToAssign.push(wolftoadd);
    if (wolftoadd !== 'Wolf') possiblewolves.splice(possiblewolves.indexOf(wolftoadd), 1);
    wolftoadd = possiblewolves[randInt(possiblewolves.length)];
  }

  if (rolesToAssign.length === 1 && rolesToAssign[0] === 'SnowWolf') rolesToAssign[0] = 'Wolf';

  for (const role of ALL_ROLES) {
    switch (role) {
      case 'Wolf':
      case 'Lycan':
      case 'WolfCub':
      case 'AlphaWolf':
      case 'SnowWolf':
        break;
      case 'CultistHunter':
      case 'Cultist':
        if (playerCount > 10) rolesToAssign.push(role);
        break;
      case 'Spumpkin':
        if (isDateAnywhere(28, 10) || isDateAnywhere(29, 10) || isDateAnywhere(30, 10) || isDateAnywhere(31, 10)) rolesToAssign.push(role);
        break;
      default:
        rolesToAssign.push(role);
    }
  }

  rolesToAssign.push('Mason');
  rolesToAssign.push('Mason');

  if (rolesToAssign.includes('CultistHunter')) {
    rolesToAssign.push('Cultist');
    rolesToAssign.push('Cultist');
  }
  for (let i = 0; i < Math.trunc(playerCount / 4); i++) rolesToAssign.push('Villager');
  return rolesToAssign.filter(x => !disabledRoles.includes(x));
}

function balance(disabledRoles, playerCount, chaos, burningOverkill) {
  let rolesToAssign;
  let possibleRoles;
  let balanced = false;
  let attempts = 0;
  const nonVgRoles = ['Cultist', 'SerialKiller', 'Tanner', 'Wolf', 'AlphaWolf', 'Sorcerer', 'WolfCub', 'Lycan', 'Thief', 'SnowWolf', 'Arsonist'];
  const revealedVgRoles = ['Blacksmith', 'Mayor', 'Pacifist', 'Gunner', 'Sandman', 'Troublemaker'];

  do {
    attempts++;
    if (attempts >= 500) throw new RangeError('Unable to create a balanced game.  Please try again.\nPlayer count: ' + playerCount);

    rolesToAssign = getRoleList(playerCount, disabledRoles);
    while (rolesToAssign.length < playerCount) rolesToAssign.push('Villager');

    possibleRoles = rolesToAssign.slice();
    shuffle(rolesToAssign);
    rolesToAssign = rolesToAssign.slice(0, playerCount);

    if ((rolesToAssign.includes('Sorcerer') || rolesToAssign.includes('Traitor') || rolesToAssign.includes('SnowWolf')) &&
      !rolesToAssign.some(x => WolfRoles.includes(x))) {
      const towolf = rolesToAssign.findIndex(x => x === 'Sorcerer' || x === 'Traitor' || x === 'SnowWolf');
      const possibleWolves = WolfRoles.filter(x => !disabledRoles.includes(x));
      rolesToAssign[towolf] = possibleWolves[randInt(possibleWolves.length)];
    }

    if (rolesToAssign.includes('Cultist') && !rolesToAssign.includes('CultistHunter') && !disabledRoles.includes('CultistHunter')) {
      const vg = rolesToAssign.findIndex(x => !nonVgRoles.includes(x));
      rolesToAssign[vg] = 'CultistHunter';
    }

    if (rolesToAssign.includes('ApprenticeSeer') && !rolesToAssign.includes('Seer')) {
      const apps = rolesToAssign.indexOf('ApprenticeSeer');
      rolesToAssign[apps] = 'Seer';
    }

    balanced = false;
    if (rolesToAssign.some(x => !nonVgRoles.includes(x)) &&
      rolesToAssign.some(x => nonVgRoles.includes(x) && x !== 'Sorcerer' && x !== 'Tanner' && x !== 'Thief')) balanced = true;

    if (count(rolesToAssign, x => nonVgRoles.includes(x)) >= count(rolesToAssign, x => !nonVgRoles.includes(x))) balanced = false;

    if (rolesToAssign.includes('SerialKiller') && rolesToAssign.includes('Arsonist')) balanced = balanced && burningOverkill;

    if (!chaos) {
      const villageStrength = rolesToAssign.filter(x => !nonVgRoles.includes(x)).reduce((s, x) => s + getStrength(x, rolesToAssign), 0);
      const enemyStrength = rolesToAssign.filter(x => nonVgRoles.includes(x)).reduce((s, x) => s + getStrength(x, rolesToAssign), 0);

      const varianceAllowed = Math.trunc(playerCount / 4) + 1;
      balanced = balanced && Math.abs(villageStrength - enemyStrength) <= varianceAllowed;

      const revealedVgRoleCount = count(rolesToAssign, x => revealedVgRoles.includes(x));
      if (revealedVgRoleCount * 3 > rolesToAssign.length) balanced = false;

      const onlyWolfBaddies = !rolesToAssign.some(x => ['Arsonist', 'SerialKiller', 'Cultist'].includes(x));
      const killStoppingRoleCount = count(rolesToAssign, x => x === 'Troublemaker' || x === 'Sandman' || (onlyWolfBaddies && x === 'Blacksmith'));
      if (killStoppingRoleCount * 4 > rolesToAssign.length) balanced = false;
    }
  } while (!balanced);

  return { roles: rolesToAssign, possibleRoles };
}

function tryBalance(disabledRoles, maxPlayers) {
  for (let playerCount = 5; playerCount <= maxPlayers; playerCount++) {
    try {
      balance(disabledRoles, playerCount, false, true);
    } catch (e) {
      if (e instanceof RangeError) return false;
      throw e;
    }
  }
  return true;
}

module.exports = { balance, tryBalance, getRoleList, getStrength };
