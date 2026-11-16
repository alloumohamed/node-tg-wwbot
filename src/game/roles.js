const config = require('../config');
const store = require('../store');
const { sleep, randInt, shuffle, toBold, getName, getPlayersForRoles, getPlayerForRole, isDateAnywhere } = require('../util');
const { QT } = require('../player');
const { teamOf } = require('../roles');
const balancing = require('../balance');
const { Werewolf } = require('./core');

const W = Werewolf.prototype;

const names = list => list.map(x => getName(x)).join(', ');

W.assignRoles = function () {
  try {
    const { roles, possibleRoles } = balancing.balance(this.DbGroup.disabledRoles || [], this.Players.length, this.GameMode === 'Chaos', this.BurningOverkill);
    this.PossibleRoles = possibleRoles;
    const rolesToAssign = roles;

    for (let i = 0; i < 5; i++) shuffle(this.Players);
    shuffle(rolesToAssign);
    shuffle(rolesToAssign);

    for (let i = 0; i < this.Players.length; i++) this.Players[i].PlayerRole = rolesToAssign[i];

    this.setRoleAttributes();

    for (let i = 0; i < 10; i++) shuffle(this.Players);

    for (const p of this.Players) p.CultLeader = p.PlayerRole === 'Cultist';
  } catch (ex) {
    this.send(`خطأ أثناء توزيع الأدوار: ${ex.message}\nالرجاء بدء لعبة جديدة`);
    this.logException(ex);
    this.removeGame();
    throw ex;
  }
};

W.setRoleAttributes = function () {
  for (const p of this.Players) this.setTeam(p);
};

W.setTeam = function (p) {
  p.Team = teamOf(p.PlayerRole);
};

W.notifyRoles = async function () {
  if (!this.Players) return;
  for (const p of this.Players.slice()) {
    if (!p || !p.PlayerRole) continue;
    const msg = this.getRoleInfo(p.PlayerRole);
    try {
      await this.send(msg, p.Id, { clearKeyboard: true });
      if (p.PlayerRole === 'Spumpkin') this.addAchievement(p, 'TodaysSpecial');
    } catch (e) {
      this.logException(e);
    }
    await sleep(50);
  }
};

W.getRoleInfo = function (role) {
  try {
    let msg;
    switch (role) {
      case 'Fool':
        return this.L('RoleInfoSeer');
      case 'Beholder': {
        msg = this.L('RoleInfoBeholder');
        const seer = this.Players.find(x => x.PlayerRole === 'Seer' && !x.IsDead);
        if (seer) msg += this.L('BeholderSeer', getName(seer));
        else msg += '  ' + this.L('NoSeer');
        return msg;
      }
      case 'Mason': {
        msg = this.L('RoleInfoMason');
        const masons = this.Players.filter(x => x.PlayerRole === 'Mason' && !x.IsDead);
        if (masons.length > 1) msg += ' ' + this.L('MasonTeam', names(masons)).trim();
        return msg;
      }
      case 'Doppelgänger':
        return this.L('RoleInfoDoppelganger');
      case 'Thief':
        return this.L(this.ThiefFull ? 'RoleInfoThiefFull' : 'RoleInfoThief');
      case 'Wolf':
      case 'WolfCub':
      case 'AlphaWolf':
      case 'Lycan':
      case 'SnowWolf': {
        msg = this.L(`RoleInfo${role}`);
        const wolves = this.Players.filter(x => !x.IsDead && (this.WolfRoles.includes(x.PlayerRole) || x.PlayerRole === 'SnowWolf'));
        if (wolves.length > 1) {
          if (wolves.some(x => x.PlayerRole === 'SnowWolf')) {
            msg += ' ' + this.L('WolfPackSnowList', names(wolves.filter(x => this.WolfRoles.includes(x.PlayerRole))), getName(wolves.find(x => x.PlayerRole === 'SnowWolf')));
          } else {
            msg += ' ' + this.L('WolfPackList', names(wolves));
          }
        }
        return msg;
      }
      case 'Cultist': {
        msg = this.L('RoleInfoCultist');
        const cultists = this.Players.filter(x => x.PlayerRole === 'Cultist' && !x.IsDead);
        if (cultists.length > 1) msg += ' ' + this.L('CultistsList', names(cultists));
        return msg;
      }
      default:
        return this.L(`RoleInfo${role}`);
    }
  } catch (e) {
    this.logException(e);
  }
  return '';
};

W.checkRoleChanges = function (checkbitten = false) {
  if (!this.Players) return;
  const aps = this.Players.find(x => x.PlayerRole === 'ApprenticeSeer' && !x.IsDead);
  if (aps && (!checkbitten || !aps.Bitten)) {
    if (!this.Players.some(x => x.PlayerRole === 'Seer' && !x.IsDead)) {
      const ds = this.Players.find(x => x.PlayerRole === 'Seer' && x.IsDead);
      this.transform(aps, 'Seer', 'ApprenticeSeer', { roleModel: ds });
    }
  }

  this.checkWildChild(checkbitten);
  this.checkDoppelganger(checkbitten);

  const wolves = getPlayersForRoles(this.Players, this.WolfRoles.concat(['SnowWolf']));
  if (wolves.length >= 7) for (const w of wolves) this.addAchievement(w, 'PackHunter');

  const seers = getPlayersForRoles(this.Players, ['Seer']);
  if (seers.length > 1) for (const s of seers) this.addAchievement(s, 'DoubleVision');
};

W.validateSpecialRoleChoices = function () {
  if (this.GameDay !== 1) return;
  const wc = getPlayerForRole(this.Players, 'WildChild');
  if (wc && wc.RoleModel === 0) {
    const choice = this.Players.find(x => x.Id === this.chooseRandomPlayerId(wc));
    if (choice) {
      wc.RoleModel = choice.Id;
      this.send(this.L('RoleModelChosen', getName(choice)), wc.Id);
    }
  }

  const dg = this.Players.find(x => x.PlayerRole === 'Doppelgänger');
  if (dg && dg.RoleModel === 0) {
    const choice = this.Players.find(x => x.Id === this.chooseRandomPlayerId(dg));
    if (choice) {
      dg.RoleModel = choice.Id;
      this.send(this.L('RoleModelChosen', getName(choice)), dg.Id);
    }
  }

  if (this.Players.some(x => x.PlayerRole === 'Cupid')) this.notifyLovers();
};

W.createLovers = function () {
  const count = this.Players.filter(x => x.InLove).length;
  if (count === 2) return;
  if (count > 2) {
    const lovers = this.Players.filter(x => x.InLove);
    const l1 = this.Players.find(x => x.Id === lovers[0].Id);
    const l2 = this.Players.find(x => x.Id === lovers[1].Id);
    if (l1 && l2) {
      l1.LoverId = l2.Id;
      l2.LoverId = l1.Id;
    }
    for (const p of lovers.slice(2)) {
      const alone = this.Players.find(x => x.Id === p.Id);
      if (alone) {
        alone.InLove = false;
        alone.LoverId = 0;
      }
    }
  }
  if (count < 2) {
    const exist = this.Players.find(x => x.InLove) || this.addLover();
    this.addLover(exist);
  }
};

W.notifyLovers = function () {
  let loversNotify = this.Players.filter(x => x.InLove);
  if (loversNotify.length !== 2) {
    this.createLovers();
    loversNotify = this.Players.filter(x => x.InLove);
  }

  for (const lover of loversNotify) {
    if (lover.SpeedDating) this.addAchievement(lover, 'OnlineDating');
    if (lover.PlayerRole === 'Doppelgänger' && lover.RoleModel === lover.LoverId) this.addAchievement(lover, 'DeepLove');
    if (loversNotify.some(x => x.PlayerRole === 'Seer') && loversNotify.some(x => x.PlayerRole === 'Sorcerer')) this.addAchievement(lover, 'SeeingBetweenTeams');
  }

  this.send(this.L('CupidChosen', getName(loversNotify[0])), loversNotify[1].Id);
  this.send(this.L('CupidChosen', getName(loversNotify[1])), loversNotify[0].Id);
};

W.addLover = function (existing = null) {
  const loverId = this.chooseRandomPlayerId(existing);
  const lover = this.Players.find(x => x.Id === loverId);
  if (!lover) return null;
  lover.InLove = true;
  lover.SpeedDating = true;
  if (!existing) return lover;
  existing.LoverId = lover.Id;
  lover.LoverId = existing.Id;
  return lover;
};

W.checkWildChild = function (checkbitten = false) {
  const wc = this.Players.find(x => x.PlayerRole === 'WildChild' && !x.IsDead);
  if (wc && (!checkbitten || !wc.Bitten)) {
    const rm = this.Players.find(x => x.Id === wc.RoleModel);
    if (rm && rm.IsDead) this.transform(wc, 'Wolf', 'WildChild', { roleModel: rm });
  }
};

W.checkDoppelganger = function (checkbitten = false) {
  const p = this.Players.find(x => x.PlayerRole === 'Doppelgänger' && !x.IsDead);
  if (p && (!checkbitten || !p.Bitten)) {
    const rm = this.Players.find(x => x.Id === p.RoleModel);
    if (rm && rm.IsDead) {
      this.transform(p, rm.PlayerRole, 'Doppelgänger', {
        newRoleModel: rm.RoleModel,
        bullet: ['Spumpkin', 'Gunner'].includes(rm.PlayerRole) ? 2 : null,
        hasUsedAbility: false,
        roleModel: rm
      });
    }
  }
};

W.bitePlayer = function (target, alpha) {
  target.Bitten = true;
  for (const wolf of getPlayersForRoles(this.Players, this.WolfRoles.concat(['SnowWolf']))) {
    this.send(this.L('PlayerBittenWolves', getName(target), alpha), wolf.Id);
  }
};

W.transform = function (p, toRole, method, o = {}) {
  const { newRoleModel = 0, newTeamMembers = null, bullet = null, hasUsedAbility = null, roleModel = null, oldTeamMates = null } = o;
  if (p.IsDead) {
    if (method !== 'KillElder' && method !== 'AutoConvertToCult') return;
  }
  if (toRole === 'Thief' && !this.ThiefFull) toRole = 'Villager';
  p.ChangedRolesCount++;

  if (p.PlayerRole === 'WiseElder') this.addAchievement(p, 'ILostMyWisdom');
  if (p.PlayerRole === 'WolfMan' && method === 'AlphaBitten') this.addAchievement(p, 'JustABeardyGuy');
  if (p.Id === newRoleModel) this.addAchievement(p, 'Indestructible');

  if (method === 'ConvertToCult') {
    p.ConvertedToCult = true;
    p.DayCult = this.GameDay;
  }
  if (method === 'AutoConvertToCult') p.ConvertedToCult = true;

  if (p.PlayerRole === 'Mason' && toRole !== 'Mason' && oldTeamMates) {
    for (const m of oldTeamMates) this.send(this.L('MasonConverted', getName(p)), m.Id);
  }
  if (p.PlayerRole === 'Cultist' && toRole !== 'Cultist' && oldTeamMates) {
    for (const c of oldTeamMates) this.send(this.L('CultistBitten', getName(p)), c.Id);
  }

  if (bullet !== null) p.Bullet = bullet;
  if (hasUsedAbility !== null) p.HasUsedAbility = hasUsedAbility;
  p.RoleModel = newRoleModel;
  p.PlayerRole = toRole;
  this.setTeam(p);

  switch (method) {
    case 'BiteCursed': {
      let msg = this.L('CursedBitten');
      const snowwolf = getPlayerForRole(this.Players, 'SnowWolf');
      const members = Array.from(newTeamMembers);
      if (snowwolf) {
        this.send(this.L('CursedBittenToWolves', getName(p)), snowwolf.Id);
        msg += ' ' + this.L('WolfPackSnowList', names(members), getName(snowwolf));
      } else {
        msg += ' ' + this.L('WolfPackList', names(members));
      }
      this.send(msg, p.Id);
      for (const w of members) this.send(this.L('CursedBittenToWolves', getName(p)), w.Id);
      break;
    }
    case 'Traitor':
      this.send(this.L('TraitorTurnWolf'), p.Id);
      break;
    case 'ApprenticeSeer': {
      this.send(this.L('ApprenticeNowSeer', roleModel ? getName(roleModel) : this.getDescription('Seer')), p.Id);
      const beholder = this.Players.find(x => x.PlayerRole === 'Beholder' && !x.IsDead);
      if (beholder) this.send(this.L('BeholderNewSeer', getName(p), roleModel ? getName(roleModel) : this.getDescription('Seer')), beholder.Id);
      break;
    }
    case 'ConvertToCult': {
      const cultists = getPlayersForRoles(this.Players, ['Cultist'], true, p);
      this.send(this.L('CultConvertYou'), p.Id);
      this.send(this.L('CultTeam', names(cultists)), p.Id);
      let cultMsg = this.L('CultJoin', getName(p));
      cultMsg += '\n' + this.L('CultistsList', names(this.Players.filter(x => x.PlayerRole === 'Cultist' && !x.IsDead)));
      for (const c of cultists) this.send(cultMsg, c.Id);
      break;
    }
    case 'WildChild': {
      const wolves = getPlayersForRoles(this.Players, this.WolfRoles, true, p);
      const snowwolf1 = getPlayerForRole(this.Players, 'SnowWolf');
      const teammates = wolves.map(x => getName(x)).join(', ');
      for (const w of wolves) this.send(this.L('WildChildToWolves', getName(p)), w.Id);
      if (snowwolf1) {
        this.send(this.L('WildChildToWolves', getName(p)), snowwolf1.Id);
        this.send(this.L('WildChildSnowTransform', getName(roleModel), teammates, getName(snowwolf1)), p.Id);
      } else this.send(this.L('WildChildTransform', getName(roleModel), teammates), p.Id);
      break;
    }
    case 'Doppelgänger': {
      let teammates2 = '';
      if (!['Mason', 'Wolf', 'AlphaWolf', 'WolfCub', 'Cultist', 'WildChild', 'Lycan', 'SnowWolf'].includes(p.PlayerRole)) {
        this.send(this.getRoleInfo(p.PlayerRole), p.Id);
      }
      switch (p.PlayerRole) {
        case 'Mason':
          for (const w of this.Players.filter(x => x.PlayerRole === 'Mason' && !x.IsDead && x.Id !== p.Id)) {
            this.send(this.L('DGToMason', getName(p)), w.Id);
            teammates2 += `${getName(w)}, `;
          }
          this.send(this.L('DGTransformToMason', getName(roleModel), teammates2), p.Id);
          break;
        case 'Seer': {
          const bh = this.Players.find(x => x.PlayerRole === 'Beholder' && !x.IsDead);
          if (bh) this.send(this.L('BeholderNewSeer', getName(p), getName(roleModel) || this.getDescription('Seer')), bh.Id);
          break;
        }
        case 'AlphaWolf':
        case 'WolfCub':
        case 'Wolf':
        case 'Lycan': {
          const wolves2 = getPlayersForRoles(this.Players, this.WolfRoles, true, p);
          const snowwolf2 = getPlayerForRole(this.Players, 'SnowWolf');
          teammates2 = wolves2.map(x => getName(x)).join(', ');
          for (const w of wolves2) this.send(this.L('DGToWolf', getName(p)), w.Id);
          const suffix = { AlphaWolf: 'Alpha', WolfCub: 'WolfCub', Wolf: 'Wolf', Lycan: 'Lycan' }[p.PlayerRole];
          if (snowwolf2) {
            this.send(this.L('DGToWolf', getName(p)), snowwolf2.Id);
            this.send(this.L(`DGTransformTo${suffix}WithSnow`, getName(roleModel), teammates2, getName(snowwolf2)), p.Id);
          } else {
            this.send(this.L(`DGTransformTo${suffix}`, getName(roleModel), teammates2), p.Id);
          }
          break;
        }
        case 'SnowWolf': {
          const wolves = getPlayersForRoles(this.Players, this.WolfRoles);
          teammates2 = wolves.map(x => getName(x)).join(', ');
          for (const w of wolves) this.send(this.L('DGToSnowWolf', getName(p)), w.Id);
          this.send(this.L('DGTransformToSnowWolf', getName(roleModel), teammates2), p.Id);
          break;
        }
        case 'Cultist':
          for (const w of this.Players.filter(x => x.PlayerRole === 'Cultist' && !x.IsDead && x.Id !== p.Id)) {
            this.send(this.L('DGToCult', getName(p)), w.Id);
            teammates2 += `${getName(w)}, `;
          }
          this.send(this.L('DGTransformToCult', getName(roleModel), teammates2), p.Id);
          break;
      }
      break;
    }
    case 'AlphaBitten': {
      if (p.PlayerRole === 'Cultist') {
        for (const m of this.Players.filter(x => x.PlayerRole === 'Cultist' && !x.IsDead && x.Id !== p.Id)) this.send(this.L('CultistBitten', getName(p)), m.Id);
      }
      let msg1 = this.L('BittenTurned');
      const members = newTeamMembers ? Array.from(newTeamMembers) : [];
      if (members.length > 1) {
        if (members.some(x => x.PlayerRole === 'SnowWolf')) {
          msg1 += ' ' + this.L('WolfPackSnowList', names(members.filter(x => this.WolfRoles.includes(x.PlayerRole))), getName(members.find(x => x.PlayerRole === 'SnowWolf')));
        } else {
          msg1 += ' ' + this.L('WolfPackList', names(members.filter(x => this.WolfRoles.includes(x.PlayerRole))));
        }
      }
      const alpha = getPlayerForRole(this.Players, 'AlphaWolf', false);
      if (alpha) alpha.AlphaConvertCount++;
      this.send(msg1, p.Id);
      break;
    }
    case 'ThiefSteal': {
      this.send(this.L('ThiefStoleRole', getName(roleModel)), p.Id);
      this.send(this.getRoleInfo(p.PlayerRole), p.Id);
      switch (p.PlayerRole) {
        case 'Mason':
          for (const w of this.Players.filter(x => x.PlayerRole === 'Mason' && !x.IsDead && x.Id !== p.Id)) this.send(this.L('ThiefToMason', getName(roleModel), getName(p)), w.Id);
          break;
        case 'Seer': {
          const bh = this.Players.find(x => x.PlayerRole === 'Beholder' && !x.IsDead);
          if (bh) this.send(this.L('BeholderSeerStolen', getName(p), getName(roleModel)), bh.Id);
          break;
        }
        case 'AlphaWolf':
        case 'WolfCub':
        case 'Wolf':
        case 'Lycan':
          for (const w of this.Players.filter(x => !x.IsDead && x.Id !== p.Id && (this.WolfRoles.includes(x.PlayerRole) || x.PlayerRole === 'SnowWolf'))) this.send(this.L('ThiefToWolf', getName(roleModel), getName(p)), w.Id);
          break;
        case 'SnowWolf':
          for (const w of getPlayersForRoles(this.Players, this.WolfRoles)) this.send(this.L('ThiefToSnowWolf', getName(roleModel), getName(p)), w.Id);
          break;
        case 'Cultist':
          for (const w of this.Players.filter(x => x.PlayerRole === 'Cultist' && !x.IsDead && x.Id !== p.Id)) this.send(this.L('ThiefToCult', getName(roleModel), getName(p)), w.Id);
          break;
        case 'Doppelgänger':
          this.send(this.L('NewDGRoleModel', getName(this.Players.find(x => x.Id === p.RoleModel))), p.Id);
          break;
        case 'WildChild':
          this.send(this.L('NewWCRoleModel', getName(this.Players.find(x => x.Id === p.RoleModel))), p.Id);
          break;
      }
      break;
    }
    case 'ThiefStolen':
      this.send(this.L(this.ThiefFull ? 'ThiefStoleYourRoleThief' : 'ThiefStoleYourRoleVillager'), p.Id);
      break;
  }

  switch (p.PlayerRole) {
    case 'ApprenticeSeer':
      if (this.Players.filter(x => !x.IsDead && x.PlayerRole === 'Seer').length === 0) this.transform(p, 'Seer', 'ApprenticeSeer', { roleModel });
      break;
    case 'Traitor':
      if (this.Players.filter(x => !x.IsDead && this.WolfRoles.includes(x.PlayerRole)).length === 0) this.transform(p, 'Wolf', 'Traitor');
      break;
    case 'WildChild': {
      const rm = this.Players.find(x => x.Id === p.RoleModel);
      this.send(this.L('NewWCRoleModel', rm ? getName(rm) : 'None was chosen!'), p.Id);
      break;
    }
    case 'Mayor':
      if (!p.HasUsedAbility && (this.GameDay !== 1 || this.Time !== 'Night')) {
        this.sendMenu([[{ text: this.L('Reveal'), callback_data: this.cb(QT.Mayor, 'reveal') }]], p, this.L('AskMayor'), QT.Mayor);
      }
      break;
    case 'Pacifist':
      if (!p.HasUsedAbility && (this.GameDay !== 1 || this.Time !== 'Night')) {
        this.sendMenu([[{ text: this.L('Peace'), callback_data: this.cb(QT.Pacifist, 'peace') }]], p, this.L('AskPacifist'), QT.Pacifist);
      }
      break;
  }
};

W.visitPlayer = async function (visitor, visited) {
  if (!visited) return 'TargetNull';
  visitor.VisitingSameNightCount++;
  visited.BeingVisitedSameNightCount++;
  if (visited.IsDead && !visited.Burning && (this.ThiefFull || visitor.PlayerRole !== 'Thief')) return 'AlreadyDead';
  if (visitor.PlayerRole === 'SerialKiller' && visited.PlayerRole !== 'GraveDigger') return visited.IsDead ? 'AlreadyDead' : 'Success';
  if (visited.Burning) {
    if (visitor.PlayerRole === 'SerialKiller') return 'AlreadyDead';
    await this.killPlayer(visitor, 'VisitBurning', { killer: getPlayerForRole(this.Players, 'Arsonist', false), diedByVisitingVictim: true });
    return 'VisitorDied';
  }
  if (visited.PlayerRole === 'SerialKiller') {
    if ((!this.WolfRoles.includes(visitor.PlayerRole) && visitor.PlayerRole !== 'SnowWolf') || visited.Choice === 0 || visited.Choice === -1 || visited.Frozen || randInt(100) < 80) {
      await this.killPlayer(visitor, 'VisitKiller', { killer: visited, diedByVisitingKiller: true });
      return 'VisitorDied';
    }
    return 'Success';
  }
  if (visitor.PlayerRole === 'Thief' && !this.ThiefFull) return 'Success';
  if (visitor.PlayerRole === 'SnowWolf') return 'Success';
  if ((this.WolfRoles.includes(visited.PlayerRole) || visited.PlayerRole === 'SnowWolf') &&
    (['Harlot', 'GuardianAngel'].includes(visitor.PlayerRole) || (this.ThiefFull && visitor.PlayerRole === 'Thief'))) {
    switch (visitor.PlayerRole) {
      case 'Harlot':
        await this.killPlayer(visitor, 'VisitWolf', { killer: visited, diedByVisitingKiller: true, killedByRole: 'Wolf' });
        return 'VisitorDied';
      case 'GuardianAngel':
        if (visited.WasSavedLastNight) {
          visitor.InMiddleOfTrouble = true;
          return 'Success';
        } else if (randInt(100) < 50) {
          await this.killPlayer(visitor, 'GuardWolf', { killer: visited, diedByVisitingKiller: true, killedByRole: 'Wolf' });
          return 'VisitorDied';
        }
        return 'Success';
      case 'Thief':
        return 'Fail';
    }
  }
  if (visited.PlayerRole === 'GraveDigger') {
    if (visited.DugGravesLastNight < 1) return 'Success';
    if (visitor.PlayerRole === 'SerialKiller') {
      visitor.StumbledGrave = this.GameDay;
      this.send(this.L('KillerStumbled', getName(visited)), visitor.Id);
      return 'Success';
    }
    if (visitor.PlayerRole === 'GuardianAngel' && visited.WasSavedLastNight) return 'Success';
    let fallChance = 20 + (30 - (30 * Math.pow(0.5, visited.DugGravesLastNight - 1)));
    if (visitor.Team === 'Village') fallChance /= 2;
    if (randInt(100) < fallChance) {
      await this.killPlayer(visitor, 'FallGrave', { killer: visited, diedByVisitingKiller: true, hunterFinalShot: false });
      switch (visitor.PlayerRole) {
        case 'AlphaWolf':
        case 'Lycan':
        case 'Wolf':
        case 'WolfCub':
          this.send(this.L('WolfFell', getName(visitor)), visited.Id);
          break;
        case 'CultistHunter':
          this.send(this.L('HunterFellDigger', getName(visitor)), visited.Id);
          break;
        case 'Cultist':
          this.send(this.L('CultFell', getName(visitor)), visited.Id);
          break;
        case 'GuardianAngel':
          this.send(this.L('GAFellDigger', getName(visitor)), visited.Id);
          break;
        default:
          this.send(this.L(`${visitor.PlayerRole}FellDigger`, getName(visitor)), visited.Id);
      }
      return 'VisitorDied';
    } else if (visitor.PlayerRole !== 'Arsonist') return 'Fail';
  }
  if (visitor.PlayerRole === 'Arsonist') return 'Success';
  if ((visited.PlayerRole === 'Harlot' || (visited.PlayerRole === 'GuardianAngel' && !this.WolfRoles.includes(visitor.PlayerRole))) && visited.Choice !== 0 && visited.Choice !== -1 && !visited.Frozen) {
    if (visitor.PlayerRole === 'Thief' && !this.ThiefFull) return 'Success';
    return 'Fail';
  }
  return 'Success';
};

W.stealRole = async function (thief, target) {
  if (target.IsDead) {
    this.send(this.L('ThiefStealDead', getName(target)), thief.Id);
    try {
      let tries = 0;
      do {
        tries++;
        const choiceid = this.chooseRandomPlayerId(thief, false);
        target = this.Players.find(x => x.Id === choiceid);
      } while (!target && tries < 10);
      thief.Choice = target.Id;
      this.send(this.L('ThiefStealChosen', getName(target)), thief.Id);
    } catch (e) {
      this.logException(e);
      target = this.Players.find(x => !x.IsDead && x !== thief);
    }
  }

  if ((await this.visitPlayer(thief, target)) !== 'Success') return;

  const targetRole = target.PlayerRole;
  const targetRoleModel = target.RoleModel;
  const targetBullet = target.Bullet;
  const targetHasUsedAbility = target.HasUsedAbility;

  this.transform(target, this.ThiefFull ? 'Thief' : 'Villager', 'ThiefStolen');
  this.transform(thief, targetRole, 'ThiefSteal', { newRoleModel: targetRoleModel, bullet: targetBullet, hasUsedAbility: targetHasUsedAbility, roleModel: target });
};

W.convertToCult = function (target, voteCult, chance = 100) {
  const cultists = getPlayersForRoles(this.Players, ['Cultist']);
  const voters = Array.from(voteCult);

  if (randInt(100) < chance) {
    if (target.PlayerRole === 'Harlot') for (const c of voters) this.addAchievement(c, 'DontStayHome');
    this.transform(target, 'Cultist', 'ConvertToCult', {
      newTeamMembers: cultists,
      oldTeamMates: this.Players.filter(x => x.PlayerRole === 'Mason' && x.Id !== target.Id && !x.IsDead)
    });
  } else {
    const newest = voters.slice().sort((a, b) => b.DayCult - a.DayCult)[0];
    for (const c of cultists) this.send(this.L('CultUnableToConvert', getName(newest), getName(target)), c.Id);
    this.send(this.L('CultAttempt'), target.Id);
  }
};
