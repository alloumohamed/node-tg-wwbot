const store = require('../store');
const tg = require('../tg');
const achievements = require('../achievements');
const { sleep, randInt, toBold, getName, getPlayersForRoles, getPlayerForRole, shuffle } = require('../util');
const { QT } = require('../player');
const { Werewolf } = require('./core');

const W = Werewolf.prototype;

const TEAM_ORDER = ['Village', 'Cult', 'Wolf', 'Tanner', 'Neutral', 'SerialKiller', 'Lovers', 'Arsonist', 'SKHunter', 'NoOne', 'Thief'];

W.killPlayer = async function (p, killMethod, o = {}) {
  const { isNight = true, diedByVisitingVictim = false, diedByVisitingKiller = false, hunterFinalShot = true, dyingSimultaneously = null } = o;
  let killers;
  let killedByRole = o.killedByRole || null;
  if (o.killers !== undefined) {
    killers = Array.from(o.killers);
  } else {
    const killer = o.killer || null;
    killers = [killer];
    killedByRole = killedByRole || (killer ? killer.PlayerRole : null);
  }

  p.DiedLastNight = isNight && killMethod !== 'LoverDied';
  p.TimeDied = Date.now();
  if (killedByRole) p.KilledByRole = killedByRole;
  p.DiedByVisitingKiller = diedByVisitingKiller;
  p.DiedByVisitingVictim = diedByVisitingVictim;
  p.IsDead = true;
  if (killMethod) {
    for (const k of killers) if (k) this.dbKill(k, p, killMethod);
    if (isNight) for (const k of killers) if (k) k.KilledLastNight++;
  }
  if (killMethod === 'Idle' || killMethod === 'Flee') {
    p.DiedByFleeOrIdle = true;
    return;
  }

  if (p.InLove && this.Players.some(x => x.Id === p.LoverId && !x.IsDead && !(dyingSimultaneously && dyingSimultaneously.includes(x)))) {
    if (killMethod && ['HunterShot', 'Shoot'].includes(killMethod) && killers.length === 1 && killers[0] &&
      ![p, this.Players.find(x => x.Id === p.LoverId)].some(x => ['Village', 'Neutral', 'Thief'].includes(x.Team))) {
      this.addAchievement(killers[0], 'DoubleShot');
    }
    await this.killLover(p, isNight);
  }

  switch (p.PlayerRole) {
    case 'WolfCub':
      this.WolfCubKilled = true;
      break;
    case 'Hunter':
      if (killMethod && hunterFinalShot) await this.hunterFinalShot(p, killMethod, isNight);
      break;
  }
};

W.killLover = async function (victim, sendNoMessage = false) {
  const p = this.Players.find(x => x.Id === victim.LoverId && !x.IsDead);
  if (p) {
    const msg = this.L('LoverDied', getName(victim), getName(p), !this.hasFlag('ShowRolesDeath') ? '' : `${getName(p)} ${this.L('Was')} ${this.getDescription(p.PlayerRole)}`);
    if (!sendNoMessage) this.sendWithQueue(msg);
    else p.LoverMsg = msg;
    await this.killPlayer(p, 'LoverDied', { killer: victim, isNight: sendNoMessage });
  }
  this.checkRoleChanges();
};

W.hunterFinalShot = async function (hunter, method, delay = false) {
  this.checkRoleChanges();
  if (delay) {
    hunter.FinalShotDelay = method;
    return;
  }

  const possibleTargets = this.Players.filter(x => !x.IsDead);
  const hunterChoices = this.pickMenu(possibleTargets, QT.HunterKill);

  hunter.IsDead = false;

  await this.sendMenu(hunterChoices, hunter, this.L(method === 'Lynch' ? 'HunterLynchedChoice' : 'HunterShotChoice'), QT.HunterKill);

  hunter.Choice = 0;
  for (let i = 0; i < 30; i++) {
    if (hunter.Choice !== 0) break;
    await sleep(1000);
  }
  hunter.IsDead = true;
  if (hunter.Choice === 0) {
    this.sendWithQueue(this.L(method === 'Lynch' ? 'HunterNoChoiceLynched' : 'HunterNoChoiceShot', getName(hunter)));
    if (hunter.CurrentQuestion && hunter.CurrentQuestion.MessageId) tg.edit(hunter.Id, hunter.CurrentQuestion.MessageId, this.L('TimesUp')).catch(() => {});
    hunter.CurrentQuestion = null;
  } else if (hunter.Choice === -1) {
    this.sendWithQueue(this.L(method === 'Lynch' ? 'HunterSkipChoiceLynched' : 'HunterSkipChoiceShot', getName(hunter)));
  } else {
    const killed = this.Players.find(x => x.Id === hunter.Choice);
    if (killed) {
      this.sendWithQueue(this.L(method === 'Lynch' ? 'HunterKilledFinalLynched' : 'HunterKilledFinalShot', getName(hunter), getName(killed), !this.hasFlag('ShowRolesDeath') ? '' : `${getName(killed)} ${this.L('Was')} ${this.getDescription(killed.PlayerRole)}`));
      if (killed.PlayerRole === 'WiseElder') {
        this.sendWithQueue(this.L('HunterKilledWiseElder', getName(hunter), getName(killed)));
        this.transform(hunter, 'Villager', 'KillElder');
        this.addAchievement(hunter, 'DemotedByTheDeath');
      }
      if (['Wolf', 'AlphaWolf', 'WolfCub', 'SerialKiller', 'Lycan', 'SnowWolf'].includes(killed.PlayerRole)) this.addAchievement(hunter, 'HeyManNiceShot');

      this.checkRoleChanges();
      if (killed.PlayerRole === 'Hunter') this.addAchievement(hunter, 'Domino');
      await this.killPlayer(killed, 'HunterShot', { killer: hunter, isNight: false });

      this.checkRoleChanges();
    }
  }
};

W.dbKill = function (killer, victim, method) {
  this._playerListChanged = true;
  if (method === 'SerialKilled' && killer.PlayerRole === 'SerialKiller' && killer.Id !== victim.Id) killer.SKKills++;
  try {
    victim.SurvivedDB = false;
    const gp = this.dbGame && this.dbGame.Players.find(x => x.id === victim.Id);
    if (gp) gp.survived = false;
    if (this.dbGame) this.dbGame.Kills.push({ day: this.GameDay, killer: killer.Id, victim: victim.Id, method, ts: Date.now() });
    store.save();
  } catch (e) {
  }

  if (victim.LoverId === killer.Id && this.Time === 'Night' && method !== 'LoverDied') {
    if (this.GameDay === 1) this.addAchievement(killer, 'OhShi');
    else if (this.WolfRoles.includes(killer.PlayerRole)) this.addAchievement(killer, 'ShouldveMentioned');
  }
};

W.checkLongHaul = function () {
  if (!this.Players) return;
  if (this._timeStarted && Date.now() - this._timeStarted >= 3600000 && !this._longHaulReached) {
    for (const p of this.Players.filter(x => !x.IsDead && !x.Fled)) this.addAchievement(p, 'LongHaul');
    this._longHaulReached = true;
  }
};

W.checkForGameEnd = async function (checkbitten = false) {
  if (!this.Players) return true;
  if (!this.IsRunning) return true;
  const alive = () => this.Players.filter(x => !x.IsDead);
  const isWolfish = x => this.WolfRoles.includes(x.PlayerRole) || x.PlayerRole === 'SnowWolf';

  if (alive().every(x => !this.WolfRoles.includes(x.PlayerRole))) {
    const snowwolf = alive().find(x => x.PlayerRole === 'SnowWolf');
    if (snowwolf) {
      if (!checkbitten || alive().every(x => !x.Bitten)) {
        snowwolf.PlayerRole = 'Wolf';
        snowwolf.ChangedRolesCount++;
        this.send(this.L('SnowWolfTurnWolf'), snowwolf.Id);
      } else return false;
    } else {
      const traitor = alive().find(x => x.PlayerRole === 'Traitor');
      if (traitor) {
        if (!checkbitten || alive().every(x => !x.Bitten)) {
          this.transform(traitor, 'Wolf', 'Traitor');
        } else return false;
      }
    }
  }

  const alivePlayers = alive();
  switch (alivePlayers.length) {
    case 0:
      return await this.doGameEnd('NoOne');
    case 1: {
      const p = alivePlayers[0];
      if (['Tanner', 'Sorcerer', 'Thief', 'Doppelgänger'].includes(p.PlayerRole)) return await this.doGameEnd('NoOne');
      return await this.doGameEnd(p.Team);
    }
    case 2: {
      if (alivePlayers.every(x => x.InLove)) return await this.doGameEnd('Lovers');
      if (alivePlayers.map(x => x.PlayerRole).every(x => ['Sorcerer', 'Tanner', 'Thief', 'Doppelgänger'].includes(x))) return await this.doGameEnd('NoOne');
      if (alivePlayers.some(x => x.PlayerRole === 'Hunter')) {
        const other = alivePlayers.find(x => x.PlayerRole !== 'Hunter');
        if (!other) return await this.doGameEnd('Village');
        if (other.PlayerRole === 'SerialKiller') return await this.doGameEnd('SKHunter');
        if (isWolfish(other)) {
          const hunter = alivePlayers.find(x => x.PlayerRole === 'Hunter');
          if (randInt(100) < require('../config').HunterKillWolfChanceBase) {
            this.sendWithQueue(this.L('HunterKillsWolfEnd', getName(hunter), getName(other)));
            await this.killPlayer(other, 'HunterShot', { killer: hunter, isNight: false });
            return await this.doGameEnd('Village');
          }
          this.sendWithQueue(this.L('WolfKillsHunterEnd', getName(hunter), getName(other)));
          await this.killPlayer(hunter, 'Eat', { killer: other, isNight: false, hunterFinalShot: false });
          return await this.doGameEnd('Wolf');
        }
      }
      if (alivePlayers.some(x => x.PlayerRole === 'SerialKiller')) return await this.doGameEnd('SerialKiller');
      if (alivePlayers.some(x => x.PlayerRole === 'Arsonist') && !alivePlayers.some(x => x.PlayerRole === 'Gunner' && x.Bullet > 0)) return await this.doGameEnd('Arsonist');
      if (alivePlayers.some(x => x.PlayerRole === 'Cultist')) {
        const other = alivePlayers.find(x => x.PlayerRole !== 'Cultist');
        if (!other) return await this.doGameEnd('Cult');
        switch (other.PlayerRole) {
          case 'Wolf':
          case 'WolfCub':
          case 'AlphaWolf':
          case 'Lycan':
          case 'SnowWolf':
            return await this.doGameEnd('Wolf');
          case 'CultistHunter': {
            const cultist = alivePlayers.find(x => x.PlayerRole === 'Cultist');
            this.sendWithQueue(this.L('CHKillsCultistEnd', getName(cultist), getName(other)));
            this.dbKill(other, cultist, 'Hunt');
            return await this.doGameEnd('Village');
          }
          default:
            if (other.PlayerRole !== 'Doppelgänger' && other.PlayerRole !== 'Thief') this.transform(other, 'Cultist', 'AutoConvertToCult');
            return await this.doGameEnd('Cult');
        }
      }
      break;
    }
    case 3:
      if (alivePlayers.map(x => x.PlayerRole).every(x => ['Sorcerer', 'Thief', 'Doppelgänger'].includes(x))) return await this.doGameEnd('NoOne');
      break;
    default:
      break;
  }

  if (alive().some(x => x.Team === 'SerialKiller')) return false;
  if (alive().some(x => x.Team === 'Arsonist')) return false;
  if (alive().every(x => x.Team === 'Cult')) return await this.doGameEnd('Cult');

  const ap = alive();
  if (ap.filter(isWolfish).length >= ap.filter(x => !isWolfish(x)).length) {
    if (ap.some(x => x.PlayerRole === 'Gunner' && x.Bullet > 0)) {
      const wolves = ap.filter(isWolfish);
      const others = ap.filter(x => !isWolfish(x));
      const gunnermakesthedifference = (wolves.length === others.length) || (wolves.length === others.length + 1 && wolves.filter(x => x.InLove).length === 2);
      if (gunnermakesthedifference) {
        for (const p of ap.filter(x => x.Team === 'Village')) this.addAchievement(p, 'GunnerSaves');
        return false;
      }
    }
    return await this.doGameEnd('Wolf');
  }

  if (ap.every(x => !isWolfish(x) && x.PlayerRole !== 'Cultist' && x.PlayerRole !== 'SerialKiller' && x.PlayerRole !== 'Arsonist')) {
    if (!checkbitten || ap.every(x => !x.Bitten)) return await this.doGameEnd('Village');
  }

  return false;
};

W.doGameEnd = async function (team) {
  if (!this.IsRunning) return true;
  this.IsRunning = false;
  this.checkLongHaul();
  let msg = '';
  const game = this.dbGame || {};
  game.TimeEnded = Date.now();
  const markWon = p => {
    p.Won = true;
    const gp = game.Players && game.Players.find(x => x.id === p.Id);
    if (gp) gp.won = true;
  };

  if (team === 'Lovers') {
    const lovers = this.Players.filter(x => x.InLove);
    const forbidden = lovers.some(x => this.WolfRoles.includes(x.PlayerRole)) && lovers.some(x => x.PlayerRole === 'Villager');
    for (const w of lovers) {
      if (forbidden) this.addAchievement(w, 'ForbiddenLove');
      markWon(w);
    }
  } else {
    for (const w of this.Players.filter(x => x.Team === team)) {
      if ((team === 'SerialKiller' || team === 'Arsonist') && w.IsDead) continue;
      if (team === 'Tanner' && !w.DiedLastNight) continue;
      markWon(w);
      if (w.InLove) {
        const lover = this.Players.find(x => x.Id === w.LoverId);
        if (lover) markWon(lover);
      }
    }
  }

  switch (team) {
    case 'NoOne': {
      const alives = this.Players.filter(x => !x.IsDead);
      let deathmessage = '';
      switch (alives.length) {
        case 3:
          if (['Sorcerer', 'Thief', 'Doppelgänger'].every(x => alives.some(y => y.PlayerRole === x))) {
            const doppelganger = alives.find(x => x.PlayerRole === 'Doppelgänger');
            const thief = alives.find(x => x.PlayerRole === 'Thief');
            const sorc = alives.find(x => x.PlayerRole === 'Sorcerer');
            if (doppelganger && thief && sorc) {
              this.addAchievement(sorc, 'TimeToRetire');
              deathmessage = this.L('SorcererEnd', getName(sorc)) + '\n';
              deathmessage += '\n' + this.L('DoppelgangerEnd', getName(doppelganger)) + '\n';
              deathmessage += '\n' + this.L('ThiefEnd', getName(thief));
            }
          }
          break;
        case 2:
          if (alives.some(x => x.PlayerRole === 'Tanner') && ['Sorcerer', 'Thief', 'Doppelgänger'].includes(alives.find(x => x.PlayerRole !== 'Tanner').PlayerRole)) {
            const other = alives.find(x => ['Sorcerer', 'Thief', 'Doppelgänger'].includes(x.PlayerRole));
            const tann = alives.find(x => x.PlayerRole === 'Tanner');
            if (other && tann) {
              await this.killPlayer(tann, 'Suicide', { killer: tann, isNight: false });
              deathmessage = this.L('TannerEnd', getName(tann)) + '\n';
              if (other.PlayerRole === 'Doppelgänger') {
                this.checkDoppelganger();
                if (other.PlayerRole === 'Tanner') {
                  await this.killPlayer(other, 'Suicide', { killer: other, isNight: false });
                  deathmessage += '\n' + this.L('TannerEnd', getName(other));
                } else {
                  deathmessage += '\n' + this.L('DoppelgangerEnd', getName(other));
                }
              } else {
                deathmessage += '\n' + this.L(`${other.PlayerRole}End`, getName(other));
              }
              if (other.PlayerRole === 'Sorcerer') this.addAchievement(other, 'TimeToRetire');
            }
          } else if (alives.some(x => x.PlayerRole === 'Sorcerer') && ['Thief', 'Doppelgänger'].includes(alives.find(x => x.PlayerRole !== 'Sorcerer').PlayerRole)) {
            const sorcerer = alives.find(x => x.PlayerRole === 'Sorcerer');
            const thiefOrDG = alives.find(x => x.PlayerRole === 'Thief' || x.PlayerRole === 'Doppelgänger');
            if (sorcerer && thiefOrDG) {
              deathmessage = this.L('SorcererEnd', getName(sorcerer)) + '\n';
              this.addAchievement(sorcerer, 'TimeToRetire');
              if (thiefOrDG.PlayerRole === 'Doppelgänger') deathmessage += '\n' + this.L('DoppelgangerEnd', getName(thiefOrDG));
              else deathmessage += '\n' + this.L('ThiefEnd', getName(thiefOrDG));
            }
          } else if (alives.some(x => x.PlayerRole === 'Thief') && alives.find(x => x.PlayerRole !== 'Thief').PlayerRole === 'Doppelgänger') {
            const theThief = alives.find(x => x.PlayerRole === 'Thief');
            const dg = alives.find(x => x.PlayerRole === 'Doppelgänger');
            if (theThief && dg) {
              deathmessage = this.L('ThiefEnd', getName(theThief)) + '\n';
              deathmessage += '\n' + this.L('DoppelgangerEnd', getName(dg));
            }
          }
          break;
        case 1: {
          const lastone = alives.find(x => x.PlayerRole === 'Sorcerer' || x.PlayerRole === 'Thief' || x.PlayerRole === 'Doppelgänger');
          if (lastone) {
            if (lastone.PlayerRole === 'Tanner') await this.killPlayer(lastone, 'Suicide', { killer: lastone, isNight: false });
            else if (lastone.PlayerRole === 'Sorcerer') this.addAchievement(lastone, 'TimeToRetire');
            if (lastone.PlayerRole === 'Doppelgänger') deathmessage = this.L('DoppelgangerEnd', getName(lastone));
            else deathmessage = this.L(`${lastone.PlayerRole}End`, getName(lastone));
          }
          break;
        }
      }
      if (deathmessage) this.sendWithQueue(deathmessage);
      msg += this.L('NoWinner');
      game.Winner = 'NoOne';
      this.sendWithQueue(msg, this.getRandomImage(this.Gifs.NoWinner));
      break;
    }
    case 'Wolf':
      if (this.Players.filter(x => (!x.IsDead && this.WolfRoles.includes(x.PlayerRole)) || x.PlayerRole === 'SnowWolf').length > 1) {
        msg += this.L('WolvesWin');
        game.Winner = 'Wolves';
        this.sendWithQueue(msg, this.getRandomImage(this.Gifs.WolvesWin));
      } else {
        msg += this.L('WolfWins');
        game.Winner = 'Wolf';
        this.sendWithQueue(msg, this.getRandomImage(this.Gifs.WolfWin));
      }
      break;
    case 'Tanner':
      msg += this.L('TannerWins');
      game.Winner = 'Tanner';
      this.sendWithQueue(msg, this.getRandomImage(this.Gifs.TannerWin));
      break;
    case 'Arsonist':
      if (this.Players.filter(x => !x.IsDead).length > 1) {
        const alive = this.Players.filter(x => !x.IsDead);
        const otherPerson = alive.find(x => x.PlayerRole !== 'Arsonist');
        const arsonist = alive.find(x => x.PlayerRole === 'Arsonist');
        this.sendWithQueue(this.L('ArsonistWinsOverpower', getName(arsonist), getName(otherPerson)));
        this.dbKill(arsonist, otherPerson, 'Burn');
        if (otherPerson) {
          otherPerson.IsDead = true;
          otherPerson.TimeDied = Date.now();
        }
      }
      msg += this.L('ArsonistWins');
      game.Winner = 'Arsonist';
      this.sendWithQueue(msg, this.getRandomImage(this.Gifs.ArsonistWins));
      break;
    case 'Cult':
      msg += this.L('CultWins');
      game.Winner = 'Cult';
      this.sendWithQueue(msg, this.getRandomImage(this.Gifs.CultWins));
      break;
    case 'SerialKiller':
      if (this.Players.filter(x => !x.IsDead).length > 1) {
        const alive = this.Players.filter(x => !x.IsDead);
        const otherPerson = alive.find(x => x.PlayerRole !== 'SerialKiller');
        const sk = alive.find(x => x.PlayerRole === 'SerialKiller');
        this.sendWithQueue(this.L('SerialKillerWinsOverpower', getName(sk), getName(otherPerson)));
        if (otherPerson) await this.killPlayer(otherPerson, 'SerialKilled', { killer: sk, isNight: false, hunterFinalShot: false });
      }
      msg += this.L('SerialKillerWins');
      game.Winner = 'SerialKiller';
      this.sendWithQueue(msg, this.getRandomImage(this.Gifs.SerialKillerWins));
      break;
    case 'Lovers':
      msg += this.L('LoversWin');
      game.Winner = 'Lovers';
      this.sendWithQueue(msg, this.getRandomImage(this.Gifs.LoversWin));
      break;
    case 'SKHunter': {
      const skhunter = this.Players.filter(x => !x.IsDead);
      const hunter = skhunter.find(x => x.PlayerRole !== 'SerialKiller');
      const skh = skhunter.find(x => x.PlayerRole === 'SerialKiller');
      msg += this.L('NoWinner');
      game.Winner = 'NoOne';
      this.addAchievement(skh, 'DoubleKill');
      this.addAchievement(hunter, 'DoubleKill');
      if (skh) {
        await this.killPlayer(skh, 'HunterShot', { killer: hunter, isNight: false });
        if (hunter) {
          await this.killPlayer(hunter, 'SerialKilled', { killer: skh, isNight: false, hunterFinalShot: false });
          this.sendWithQueue(this.L('SKHunterEnd', getName(skh), getName(hunter)));
        }
      }
      this.sendWithQueue(msg, this.getRandomImage(this.Gifs.NoWinner));
      break;
    }
    default:
      msg += this.L('VillageWins');
      game.Winner = 'Village';
      this.sendWithQueue(msg, this.getRandomImage(this.Gifs.VillagersWin));
  }
  store.save();

  const header = `${this.L('PlayersAlive')}: ${this.Players.filter(x => !x.IsDead).length} / ${this.Players.length}\n`;
  const byDeath = this.Players.slice().sort((a, b) => a.TimeDied - b.TimeDied);
  switch (this.DbGroup.ShowRolesEnd) {
    case 'None':
      msg = header + byDeath.reduce((cur, p) => cur + `\n${getName(p)}`, msg);
      break;
    case 'All':
      msg = header + byDeath.reduce((cur, p) => cur + `${getName(p)}: ${p.IsDead ? (p.Fled ? this.L('RanAway') : this.L('Dead')) : this.L('Alive')} - ${this.getDescription(p.PlayerRole)}${p.InLove ? '❤️' : ''} ${p.Won ? this.L('Won') : this.L('Lost')}\n`, '');
      break;
    default:
      msg = this.L('RemainingPlayersEnd') + '\n';
      msg = this.Players.filter(x => !x.IsDead).sort((a, b) => TEAM_ORDER.indexOf(a.Team) - TEAM_ORDER.indexOf(b.Team))
        .reduce((cur, p) => cur + `\n${getName(p)}: ${this.getDescription(p.PlayerRole)} ${this.L(p.Team + 'TeamEnd')} ${p.InLove ? '❤️' : ''} ${this.L(p.Won ? 'Won' : 'Lost')}`, msg);
  }
  if (this._timeStarted) {
    const secs = Math.trunc((game.TimeEnded - this._timeStarted) / 1000);
    this._timePlayed = secs;
    const hh = String(Math.trunc(secs / 3600)).padStart(2, '0');
    const mm = String(Math.trunc((secs % 3600) / 60)).padStart(2, '0');
    const ss = String(secs % 60).padStart(2, '0');
    msg += '\n' + this.L('EndTime', `${hh}:${mm}:${ss}`);
  }
  this.sendWithQueue(msg);
  this.updateAchievements();
  this.updateGroupRanking();

  await sleep(10000);
  this.removeGame();
  return true;
};

W.updateAchievements = function () {
  if (!this.Players || this.HasBots) return;
  const convention = this.Players.filter(x => x.PlayerRole === 'Cultist' && !x.IsDead).length >= 10;
  const beastResisted = ['WildChild', 'Cursed', 'Traitor'].filter(r => this.Players.some(x => x.Won && x.PlayerRole === r)).length === 3;
  const chaos = this.GameMode === 'Chaos';

  for (const player of this.Players.filter(x => !x.Fled)) {
    const p = store.getPlayer(player.Id);
    if (!p) continue;
    if (player.SurvivedDB) p.gamesSurvived = (p.gamesSurvived || 0) + 1;
    if (player.Won) p.gamesWon = (p.gamesWon || 0) + 1;
    p.skKills += player.SKKills;
    p.gaSaves += player.GASaves;
    p.firstLynchStreak = player.LynchedFirst ? p.firstLynchStreak + 1 : 0;

    const n = [];
    const add = (key, cond) => { if (cond && !achievements.has(p, key)) n.push(key); };
    add('WelcomeToHell', true);
    add('WelcomeToAsylum', chaos);
    add('SpyVsSpy', !this.hasFlag('ShowRolesDeath'));
    add('Enochlophobia', this.Players.length === 35);
    add('Introvert', this.Players.length === 5);
    add('Dedicated', (p.gamesPlayed || 0) >= 100);
    add('Obsessed', (p.gamesPlayed || 0) >= 1000);
    add('Veteran', (p.gamesPlayed || 0) >= 500);
    add('Masochist', player.Won && player.PlayerRole === 'Tanner');
    add('Wobble', !player.IsDead && player.PlayerRole === 'Drunk' && this.Players.length >= 10);
    add('Survivalist', (p.gamesSurvived || 0) >= 100);
    add('MasonBrother', player.PlayerRole === 'Mason' && !player.IsDead && this.Players.filter(x => x.PlayerRole === 'Mason' && !x.IsDead).length >= 2);
    add('ChangingSides', player.ChangedRolesCount > 0 && player.Won);
    add('LoneWolf', chaos && this.Players.length >= 10 && this.WolfRoles.includes(player.PlayerRole) && getPlayersForRoles(this.Players, this.WolfRoles, false).length === 1 && player.Won);
    add('Inconspicuous', !player.HasBeenVoted && !player.IsDead);
    add('Promiscuous', !player.HasStayedHome && !player.HasRepeatedVisit && player.PlayersVisited.size >= 5);
    add('DoubleShifter', player.ChangedRolesCount - (player.ConvertedToCult ? 1 : 0) >= 2);
    add('BrokenClock', player.FoolCorrectSeeCount >= 2);
    add('SmartGunner', player.PlayerRole === 'Gunner' && player.BulletHitBaddies >= 2);
    add('CultCon', player.PlayerRole === 'Cultist' && !player.IsDead && convention);
    add('SerialSamaritan', player.PlayerRole === 'SerialKiller' && player.SerialKilledWolvesCount >= 3);
    add('CultistTracker', player.PlayerRole === 'CultistHunter' && player.CHHuntedCultCount >= 3);
    add('ImNotDrunk', player.PlayerRole === 'ClumsyGuy' && player.ClumsyCorrectLynchCount >= 3);
    add('WuffieCult', player.PlayerRole === 'AlphaWolf' && player.AlphaConvertCount >= 3);
    add('DidYouGuardYourself', player.PlayerRole === 'GuardianAngel' && player.GAGuardWolfCount >= 3);
    add('ThreeLittleWolves', player.PlayerRole === 'Sorcerer' && !player.IsDead && getPlayersForRoles(this.Players, this.WolfRoles, true).length >= 3);
    add('President', player.PlayerRole === 'Mayor' && player.MayorLynchAfterRevealCount >= 3);
    add('ItWasABusyNight', player.BusyNight);
    add('StrongestAlpha', player.StrongestAlpha);
    add('AmIYourSeer', player.FoolCorrectlySeenBH);
    add('Trustworthy', player.Trustworthy && !player.IsDead && player.Won);
    add('CultLeader', player.CultLeader && !player.IsDead && player.Won);
    add('DeathVillage', this.Players.filter(x => x.Won).length === 0);
    add('PsychopathKiller', this.Players.length >= 35 && player.PlayerRole === 'SerialKiller' && player.Won);
    add('ColdAsIce', player.FrozeHarlot);
    add('ResistTheBeast', beastResisted && player.Won && ['WildChild', 'Cursed', 'Traitor'].includes(player.PlayerRole));
    add('AmIHallucinating', player.HasSeenImpossible);
    add('InTheMiddleOfTheTrouble', player.InMiddleOfTrouble);
    add('HereJohnny', p.skKills >= 50);
    add('GotYourBack', p.gaSaves >= 50);
    add('BlackSheep', p.firstLynchStreak >= 3);
    add('Explorer', Object.values(p.groupGames).filter(c => c >= 2).length >= 10);
    add('Linguist', Object.values(p.langGames).filter(c => c >= 2).length >= 10);
    add('AlzheimerPatient', this.Language.includes('Amnesia'));
    add('NoIdeaWhat', !this.hasFlag('ShowRolesDeath') && this.Language.includes('Amnesia'));
    add('Naughty', /nsfw/i.test(this.Language));
    add('AlcoholicsAnonymous', player.PlayerRole === 'Drunk' && this.Players.filter(x => x.PlayerRole === 'Drunk').length >= 3);

    for (const k of n) p.achievements.push(k);
    store.save();
    if (n.length) {
      const text = '🏆 إنجازات جديدة!\n' + n.map(k => achievements.describe(achievements.byKey[k])).join('\n\n');
      this.send(text, p.TelegramId);
    }
  }
};

W.updateGroupRanking = function () {
  if (this.HasBots) return;
  const DAY = 86400000;
  const meta = store.getMeta();
  const d = new Date();
  const today = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  let refresh = meta.refreshDate || today;
  if (today - refresh >= 7 * DAY) refresh = today;
  meta.refreshDate = refresh;

  const cur = store.ensureRanking(this.ChatId, refresh);

  for (const r of store.allRankings().filter(x => x.LastRefresh < refresh && x.GamesPlayed !== 0)) {
    let daysspan = Math.floor((refresh - r.LastRefresh) / DAY);
    if (daysspan === 0) daysspan = 1;
    const avgPlayersPerGame = r.PlayersCount / r.GamesPlayed;
    const avgGameLength = r.MinutesPlayed / r.GamesPlayed;
    const avgMinutesPerDay = r.MinutesPlayed / daysspan;
    const PPGFactor = -(2 / 45) * avgPlayersPerGame * avgPlayersPerGame + (16 / 9) * avgPlayersPerGame - 70 / 9;
    const GLFactor = -(1 / 90) * avgGameLength * avgGameLength + (2 / 3) * avgGameLength;
    const PlayerFactor = PPGFactor + GLFactor;
    const TimeFactor = avgMinutesPerDay / 54;
    const malus = (PlayerFactor - TimeFactor) * (PlayerFactor - TimeFactor) / 20;
    r.Ranking = Math.round((PlayerFactor + TimeFactor - malus) * 1e10) / 1e10;
    r.PlayersCount = 0;
    r.MinutesPlayed = 0;
    r.GamesPlayed = 0;
    r.LastRefresh = refresh;
  }

  if (this._timePlayed !== null) {
    cur.GamesPlayed++;
    cur.PlayersCount += this.Players.length;
    cur.MinutesPlayed += this._timePlayed / 60;
  }
  store.save();
};
