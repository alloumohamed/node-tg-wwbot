const config = require('../config');
const tg = require('../tg');
const { sleep, randInt, shuffle, toBold, getName, getPlayersForRoles, getPlayerForRole } = require('../util');
const { QT } = require('../player');
const { Werewolf } = require('./core');

const W = Werewolf.prototype;

W.sendNightActions = async function () {
  if (!this.Players) return;
  await sleep(1000);
  for (const player of this.Players.filter(x => !x.IsDead)) {
    player.CurrentQuestion = null;
    player.Choice = 0;
    let msg = '';
    const targetBase = this.Players.filter(x => !x.IsDead && x.Id !== player.Id);
    let targets = [];
    let qtype = QT.Lynch;

    switch (player.PlayerRole) {
      case 'SerialKiller':
        targets = targetBase.slice();
        msg = this.L('AskKill');
        qtype = QT.SerialKill;
        break;
      case 'Harlot':
        targets = targetBase.slice();
        msg = this.L('AskVisit');
        qtype = QT.Visit;
        break;
      case 'Fool':
      case 'Seer':
      case 'Sorcerer':
      case 'Oracle':
        targets = targetBase.slice();
        msg = this.L('AskSee');
        qtype = QT.See;
        break;
      case 'GuardianAngel':
        targets = targetBase.slice();
        msg = this.L('AskGuard');
        qtype = QT.Guard;
        break;
      case 'Wolf':
      case 'AlphaWolf':
      case 'WolfCub':
      case 'Lycan':
        if (!this._silverSpread) {
          targets = targetBase.filter(x => !this.WolfRoles.includes(x.PlayerRole) && x.PlayerRole !== 'SnowWolf');
          msg = this.L('AskEat');
          const others = getPlayersForRoles(targetBase, this.WolfRoles, true, player).filter(x => !x.Drunk);
          if (others.length) {
            const andStr = ` ${this.L('And').trim()} `;
            msg += this.L('DiscussWith', others.map(x => getName(x)).join(andStr));
          }
          qtype = QT.Kill;
        } else msg = null;
        break;
      case 'Cultist': {
        targets = targetBase.filter(x => x.PlayerRole !== 'Cultist');
        msg = this.L('AskConvert');
        const otherCults = targetBase.filter(x => x.PlayerRole === 'Cultist');
        if (otherCults.length) msg += this.L('DiscussWith', otherCults.map(x => getName(x)).join(this.L('And')));
        qtype = QT.Convert;
        break;
      }
      case 'CultistHunter':
        targets = targetBase.slice();
        msg = this.L('AskHunt');
        qtype = QT.Hunt;
        break;
      case 'WildChild':
        if (this.GameDay === 1) {
          targets = targetBase.slice();
          msg = this.L('AskRoleModel');
          qtype = QT.RoleModel;
        } else player.Choice = -1;
        break;
      case 'Doppelgänger':
        if (this.GameDay === 1) {
          targets = targetBase.slice();
          msg = this.L('AskDoppelganger');
          qtype = QT.RoleModel;
        } else player.Choice = -1;
        break;
      case 'Cupid':
        if (this.GameDay === 1) {
          targets = this.Players.filter(x => !x.IsDead);
          msg = this.L('AskCupid1');
          qtype = QT.Lover1;
        } else player.Choice = -1;
        break;
      case 'Thief':
        if ((!this.ThiefFull && this.GameDay === 1) || this.ThiefFull) {
          targets = targetBase.slice();
          msg = this.L('AskThief');
          qtype = QT.Thief;
        } else player.Choice = -1;
        break;
      case 'Chemist':
        if (player.HasUsedAbility) {
          targets = targetBase.slice();
          msg = this.L('AskChemist');
          qtype = QT.Chemistry;
        } else {
          player.HasUsedAbility = true;
          player.Choice = -1;
          this.send(this.L('ChemistBrewing'), player.Id);
        }
        break;
      case 'SnowWolf':
        if (!this._silverSpread) {
          targets = targetBase.filter(x => !this.WolfRoles.includes(x.PlayerRole) && !x.Frozen);
          msg = this.L('AskFreeze');
          qtype = QT.Freeze;
        }
        break;
      case 'Arsonist': {
        targets = targetBase.filter(x => !x.Doused);
        const alreadyDoused = targetBase.filter(x => !x.IsDead && x.Doused);
        if (alreadyDoused.length) {
          msg = this.L('AskArsonist') + '\n';
          msg += this.L('AlreadyDousedList', alreadyDoused.map(x => getName(x)).join(this.L('And')));
        } else msg = this.L('AskArsonistNoDoused');
        qtype = QT.Douse;
        break;
      }
      case 'GraveDigger': {
        const diedSinceLastGrave = this.Players.filter(x => x.IsDead && x.TimeDied > this.lastGrave && !x.DiedByFleeOrIdle);
        this.secondLastGrave = this.lastGrave;
        this.lastGrave = Date.now();
        player.DugGravesLastNight = diedSinceLastGrave.length;
        player.Choice = -1;
        if (diedSinceLastGrave.length < 1) {
          this.send(this.L('DigNoGraves'), player.Id);
        } else {
          this.send(this.L('DigGraves', diedSinceLastGrave.map(x => getName(x)).join(this.L('And'))), player.Id);
        }
        break;
      }
      default:
        continue;
    }

    if (player.Drunk || !msg) {
      player.Choice = -1;
      continue;
    }

    if (this.ShufflePlayerList) shuffle(targets);

    const buttons = targets.map(x => [{ text: x.Name, callback_data: this.cb(qtype, x.Id) }]);
    if (player.PlayerRole === 'Arsonist' && this.Players.some(x => !x.IsDead && x.Doused)) buttons.push([{ text: this.L('Spark'), callback_data: this.cb(qtype, -2) }]);
    if ((player.PlayerRole !== 'WildChild' && player.PlayerRole !== 'Cupid' && player.PlayerRole !== 'Doppelgänger' && player.PlayerRole !== 'Thief') || (player.PlayerRole === 'Thief' && this.ThiefFull)) {
      buttons.push([{ text: this.L('Skip'), callback_data: this.cb(qtype, -1) }]);
    }

    await this.sendMenu(buttons, player, msg, qtype);
    await sleep(100);
  }
  this._silverSpread = false;

  for (const p of this.Players) {
    p.Drunk = false;
    p.Frozen = false;
    p.Burning = false;
  }
};

W.nightCycle = async function () {
  if (!this.IsRunning) return;
  this.Time = 'Night';
  const nightStart = Date.now();
  if (await this.checkForGameEnd(true)) return;
  for (const p of this.Players) {
    p.Choice = 0;
    p.Choice2 = 0;
    p.CurrentQuestion = null;
    p.Votes = 0;
    p.DiedLastNight = false;
    p.KilledLastNight = 0;
    p.VisitingSameNightCount = 0;
    p.BeingVisitedSameNightCount = 0;
    if (p.Bitten) {
      p.Bitten = false;
      if (!p.IsDead && !this.WolfRoles.includes(p.PlayerRole) && p.PlayerRole !== 'SnowWolf') {
        const oldTeamMembers = p.PlayerRole === 'Cultist'
          ? this.Players.filter(x => x.PlayerRole === 'Cultist' && !x.IsDead && x.Id !== p.Id)
          : this.Players.filter(x => x.PlayerRole === 'Mason' && !x.IsDead && x.Id !== p.Id);
        this.transform(p, 'Wolf', 'AlphaBitten', {
          oldTeamMates: oldTeamMembers,
          newTeamMembers: this.Players.filter(x => !x.IsDead && (this.WolfRoles.includes(x.PlayerRole) || x.PlayerRole === 'SnowWolf'))
        });
      }
    }
  }
  this.checkRoleChanges();
  if (await this.checkForGameEnd()) return;
  let nightTime = this.DbGroup.NightTime || config.TimeNight;
  if (this.GameDay === 1) {
    if (this.Players.some(x => ['Cupid', 'Doppelgänger', 'WildChild'].includes(x.PlayerRole))) nightTime = Math.max(nightTime, 120);
    if (!this.ThiefFull && this.Players.some(x => x.PlayerRole === 'Thief')) nightTime = Math.max(nightTime, 120);
  }
  if (this._sandmanSleep) {
    this._sandmanSleep = false;
    this._silverSpread = false;
    this.WolfCubKilled = false;
    for (const p of this.Players) p.Drunk = false;
    this.sendWithQueue(this.L('SandmanNight'));
    return;
  }

  const aliveWolves = getPlayersForRoles(this.Players, this.WolfRoles, true);
  if (aliveWolves.some(x => x.Drunk)) {
    for (const w of aliveWolves.filter(x => !x.Drunk)) this.addAchievement(w, 'ThanksJunior');
  }

  this.sendWithQueue(this.L('NightTime', toBold(nightTime)));
  this.sendPlayerList();
  await this.sendNightActions();

  const nightPlayers = () => this.Players.filter(x => !x.IsDead && !x.Drunk);
  for (let i = 0; i < nightTime; i++) {
    await sleep(1000);
    if (!this.Players) return;
    if (await this.checkForGameEnd()) return;
    if (nightPlayers().every(x => x.CurrentQuestion === null)) break;
  }

  try {
    for (const p of this.Players.filter(x => x.CurrentQuestion)) {
      try {
        if (p.CurrentQuestion.MessageId !== 0) tg.edit(p.Id, p.CurrentQuestion.MessageId, this.L('TimesUp')).catch(() => {});
      } catch (e) {
      }
      p.CurrentQuestion = null;
    }
  } catch (e) {
  }

  this.validateSpecialRoleChoices();

  let ga = this.Players.find(x => x.PlayerRole === 'GuardianAngel' && !x.IsDead && x.Choice !== 0 && x.Choice !== -1) || null;

  const snowwolf = this.Players.find(x => x.PlayerRole === 'SnowWolf' && !x.IsDead);
  if (snowwolf && snowwolf.Choice !== -1 && snowwolf.Choice !== 0) {
    const target = this.Players.find(x => x.Id === snowwolf.Choice);
    if ((await this.visitPlayer(snowwolf, target)) === 'Success') {
      if (target.PlayerRole === 'SerialKiller') {
        target.Frozen = true;
        this.send(this.L('SKFrozen'), target.Id);
        this.send(this.L('SuccessfulFreeze', getName(target)), snowwolf.Id);
      } else if (ga && ga.Choice === target.Id) {
        target.WasSavedLastNight = true;
        this.send(this.L('GuardBlockedSnowWolf', getName(target)), snowwolf.Id);
      } else if (target.PlayerRole === 'Hunter') {
        if (randInt(100) < 50) {
          target.Frozen = true;
          this.send(this.L('DefaultFrozen'), target.Id);
          this.send(this.L('SuccessfulFreeze', getName(target)), snowwolf.Id);
        } else {
          await this.killPlayer(snowwolf, 'HunterShot', { killer: target, diedByVisitingKiller: true });
        }
      } else {
        target.Frozen = true;
        switch (target.PlayerRole) {
          case 'Harlot':
            snowwolf.FrozeHarlot = true;
            this.send(this.L('HarlotFrozen'), target.Id);
            break;
          case 'Chemist':
            this.send(this.L('ChemistFrozen'), target.Id);
            break;
          case 'Cultist':
            this.send(this.L('CultistFrozen'), target.Id);
            break;
          case 'CultistHunter':
            this.send(this.L('CHFrozen'), target.Id);
            break;
          case 'Fool':
          case 'Seer':
          case 'Sorcerer':
          case 'Oracle':
          case 'Augur':
            this.send(this.L('SeeingFrozen'), target.Id);
            break;
          case 'GuardianAngel':
            this.send(this.L('GAFrozen'), target.Id);
            ga = null;
            break;
          case 'Thief':
            this.send(this.L(this.ThiefFull ? 'ThiefFrozen' : 'DefaultFrozen'), target.Id);
            break;
          case 'GraveDigger':
            if (target.DugGravesLastNight < 1) this.send(this.L('DefaultFrozen'), target.Id);
            else {
              this.lastGrave = this.secondLastGrave;
              this.send(this.L('GraveDiggerFrozen'), target.Id);
              target.DugGravesLastNight = 0;
            }
            break;
          case 'Chef':
            this.send(this.L('ChefFrozen'), target.Id);
            break;
          case 'Barkeep':
            this.send(this.L('BarkeepFrozen'), target.Id);
            break;
          case 'Arsonist':
            this.send(this.L('ArsonistNotFrozen'), target.Id);
            break;
          default:
            this.send(this.L('DefaultFrozen'), target.Id);
        }
        this.send(this.L('SuccessfulFreeze', getName(target)), snowwolf.Id);
      }
    }
  }

  const arsonist = this.Players.find(x => !x.IsDead && x.PlayerRole === 'Arsonist');
  if (arsonist) {
    if (arsonist.Choice === -2) {
      const burning = this.Players.filter(x => !x.IsDead && x.Doused && x.PlayerRole !== 'Arsonist');
      for (const burn of burning) {
        if (ga && ga.Choice === burn.Id) burn.WasSavedLastNight = true;
        else {
          await this.killPlayer(burn, 'Burn', { killer: arsonist, hunterFinalShot: false, dyingSimultaneously: burning.filter(x => (ga ? ga.Choice : 0) !== x.Id) });
          burn.Doused = false;
          burn.Burning = true;
          this.sendGif(this.L('Burn'), this.getRandomImage(this.Gifs.BurnToDeath), burn.Id);
        }
      }

      if (this.Players.filter(x => x.Burning).length >= 5) {
        this.addAchievement(arsonist, 'PlayingWithTheFire');
        if (this.Players.filter(x => x.Burning).length >= 10) this.addAchievement(arsonist, 'Firework');
      }
    } else {
      const doused = this.Players.find(x => x.Id === arsonist.Choice);
      if (doused) {
        if ((await this.visitPlayer(arsonist, doused)) === 'Success') {
          doused.Doused = true;
          this.send(this.L('Doused', getName(doused)), arsonist.Id);
        }
      }
    }
  }

  const wolves = getPlayersForRoles(nightPlayers(), this.WolfRoles);
  let voteWolves = wolves.filter(x => !x.Drunk);
  let voteWolvesCount = voteWolves.length;
  this.WolfCubKilled = false;
  const wolfChoices = [];

  if (voteWolves.length) {
    const noChoice = c => c === 0 || c === -1;
    const votechoice = voteWolves.filter(x => !noChoice(x.Choice) || !noChoice(x.Choice2));

    for (const w of votechoice) for (const pl of this.Players.filter(x => x.Id === w.Choice)) pl.Votes++;
    const top = () => {
      const l = this.Players.filter(x => x.Votes > 0).sort((a, b) => b.Votes - a.Votes);
      return l.length ? l[0].Id : 0;
    };
    wolfChoices.push(top());

    for (const p of this.Players) p.Votes = 0;
    for (const w of votechoice) for (const pl of this.Players.filter(x => x.Id === w.Choice2 && x.Id !== wolfChoices[0])) pl.Votes++;
    wolfChoices.push(top());
    let eatCount = 0;
    for (const choice of wolfChoices.filter(x => x !== 0 && x !== -1)) {
      voteWolves = wolves.filter(x => !x.Drunk && !x.IsDead);
      if (!voteWolves.length) break;
      const target = this.Players.find(x => x.Id === choice);
      const visitorWuff = voteWolves[randInt(voteWolves.length)] || voteWolves[0];
      const result = await this.visitPlayer(visitorWuff, target);
      if (result === 'Success') {
        if (ga && ga.Choice === target.Id) {
          for (const wolf of voteWolves) this.send(this.L('GuardBlockedWolf', getName(target)), wolf.Id);
          target.WasSavedLastNight = true;
        } else {
          const bitten = voteWolves.some(x => x.PlayerRole === 'AlphaWolf') && randInt(100) < config.AlphaWolfConversionChance;
          let alpha = '';
          if (bitten) alpha = getName(voteWolves.find(x => x.PlayerRole === 'AlphaWolf'));
          const defaultEat = async () => {
            if (bitten) {
              this.bitePlayer(target, alpha);
            } else {
              await this.killPlayer(target, 'Eat', { killers: voteWolves, killedByRole: 'Wolf', hunterFinalShot: false });
              if (target.PlayerRole === 'Sorcerer') for (const w of voteWolves) this.addAchievement(w, 'NoSorcery');
              this.sendGif(this.L('WolvesEatYou'), this.getRandomImage(this.Gifs.VillagerDieImages), target.Id);
            }
          };
          switch (target.PlayerRole) {
            case 'Harlot':
              for (const w of voteWolves) this.addAchievement(w, 'DontStayHome');
              await defaultEat();
              break;
            case 'Cursed':
              this.transform(target, 'Wolf', 'BiteCursed', { newTeamMembers: wolves.filter(x => !x.IsDead) });
              break;
            case 'Drunk':
              if (bitten) {
                this.addAchievement(voteWolves.find(x => x.PlayerRole === 'AlphaWolf'), 'LuckyDay');
                this.bitePlayer(target, alpha);
              } else {
                await this.killPlayer(target, 'Eat', { killers: voteWolves, killedByRole: 'Wolf' });
                this.sendGif(this.L('WolvesEatYou'), this.getRandomImage(this.Gifs.VillagerDieImages), target.Id);
                for (const w of voteWolves) {
                  const secondvictim = this.Players.find(x => x.Id === wolfChoices[1]);
                  this.send(target !== (secondvictim || target)
                    ? this.L('WolvesEatDrunkBlockSecondKill', getName(target), getName(secondvictim))
                    : this.L('WolvesEatDrunk', getName(target)), w.Id);
                  w.Drunk = true;
                }
              }
              break;
            case 'Hunter': {
              voteWolvesCount = voteWolves.length;
              const chance = config.HunterKillWolfChanceBase + ((voteWolves.length - 1) * 20);
              if (randInt(100) < chance) {
                const shotWuff = voteWolves[randInt(voteWolves.length)] || voteWolves[0];
                if (shotWuff) {
                  target.HasShotHunterAttacker++;
                  if (target.HasShotHunterAttacker === 2) this.addAchievement(target, 'HelpfulParanoia');
                  if (target.HasShotHunterAttackerThisNight) this.addAchievement(target, 'STierHunter');
                  target.HasShotHunterAttackerThisNight = true;

                  if (voteWolves.length > 1) {
                    this.sendGif(this.L('WolvesEatYou'), this.getRandomImage(this.Gifs.VillagerDieImages), target.Id);
                    await this.killPlayer(target, 'Eat', { killers: voteWolves, killedByRole: 'Wolf', hunterFinalShot: false });
                  }
                  await this.killPlayer(shotWuff, 'HunterShot', { killer: target, diedByVisitingKiller: true });
                }
              } else {
                await defaultEat();
              }
              break;
            }
            case 'SerialKiller':
              if (bitten) {
                this.bitePlayer(target, alpha);
                voteWolves.find(x => x.PlayerRole === 'AlphaWolf').StrongestAlpha = true;
              } else await defaultEat();
              break;
            case 'WiseElder':
              if (bitten) this.bitePlayer(target, alpha);
              else if (target.HasUsedAbility) await defaultEat();
              else {
                target.HasUsedAbility = true;
                for (const wolf of voteWolves) this.send(this.L('WolvesTriedToEatWiseElder', getName(target)), wolf.Id);
                this.send(this.L('WolvesAteWiseElderPM'), target.Id);
              }
              break;
            case 'Traitor':
              if (bitten) this.bitePlayer(target, alpha);
              else {
                if (this.Players.filter(x => !x.IsDead && (this.WolfRoles.includes(x.PlayerRole) || x.PlayerRole === 'SnowWolf')).length === 1) this.addAchievement(voteWolves[0], 'ConditionRed');
                await defaultEat();
              }
              break;
            default:
              await defaultEat();
          }
        }
        eatCount++;
      } else if (result === 'Fail') {
        switch (target.PlayerRole) {
          case 'Harlot':
            for (const wolf of voteWolves) this.send(this.L('HarlotNotHome', getName(target)), wolf.Id);
            break;
          case 'GraveDigger':
            for (const wolf of voteWolves) this.send(this.L('GraveDiggerNotHome', getName(target)), wolf.Id);
            break;
        }
      } else if (result === 'VisitorDied') {
        if (target.Burning) for (const wolf of voteWolves) this.send(this.L('WolvesVisitBurn', getName(target), getName(visitorWuff)), wolf.Id);
        else if (target.PlayerRole === 'GraveDigger') for (const wolf of voteWolves) this.send(this.L('WolfFellWolves', getName(target), getName(visitorWuff)), wolf.Id);
      }
      const gd = this.Players.find(x => x.PlayerRole === 'GraveDigger' && !x.IsDead && x.DugGravesLastNight > 0);
      if (gd) {
        const spotChance = (20 + (30 - (30 * Math.pow(0.5, gd.DugGravesLastNight - 1)))) / 2;
        if (randInt(100) < spotChance) {
          await this.killPlayer(gd, 'Spotted', { killers: voteWolves, diedByVisitingKiller: true, killedByRole: 'Wolf' });
          for (const w of voteWolves) this.send(this.L('WolvesSpotted', getName(gd)), w.Id);
          this.sendGif(this.L('WolvesSpottedYou'), this.getRandomImage(this.Gifs.VillagerDieImages), gd.Id);
        }
      }
    }
    if (eatCount === 2) {
      const cub = getPlayersForRoles(this.Players, ['WolfCub'], false).sort((a, b) => b.TimeDied - a.TimeDied).find(x => x.IsDead);
      if (cub) this.addAchievement(cub, 'IHelped');
      if (this.Players.filter(x => wolfChoices.includes(x.Id) && x.Bitten).length === 2) this.addAchievement(voteWolves.find(x => x.PlayerRole === 'AlphaWolf'), 'IncreaseThePack');
    }
    eatCount = 0;
  }

  const sk = this.Players.find(x => x.PlayerRole === 'SerialKiller' && !x.IsDead);
  if (sk && !sk.Frozen) {
    let skilled = this.Players.find(x => x.Id === sk.Choice);
    if ((await this.visitPlayer(sk, skilled)) === 'Success') {
      let oldSkilled = null;
      if (sk.StumbledGrave > 0 && sk.StumbledGrave + 1 === this.GameDay && randInt(100) < 50) {
        oldSkilled = skilled;
        const pool = this.Players.filter(x => x.PlayerRole !== 'SerialKiller' && !x.IsDead);
        skilled = pool[randInt(pool.length)];
        await this.visitPlayer(sk, skilled);
        this.send(this.L('KillerRandomKill', getName(oldSkilled), getName(skilled)), sk.Id);
      }
      if (ga && ga.Choice === skilled.Id && skilled.PlayerRole !== 'Harlot') {
        if (!oldSkilled) this.send(this.L('GuardBlockedKiller', getName(skilled)), sk.Id);
        else {
          this.send(this.L('GuardBlockedRandomKiller', getName(skilled)), sk.Id);
          this.addAchievement(sk, 'ReallyBadLuck');
        }
        skilled.WasSavedLastNight = true;
      } else {
        await this.killPlayer(skilled, 'SerialKilled', { killer: sk });
        if (this.WolfRoles.includes(skilled.PlayerRole) || skilled.PlayerRole === 'SnowWolf') sk.SerialKilledWolvesCount++;
        this.sendGif(this.L('SerialKillerKilledYou'), this.getRandomImage(this.Gifs.SKKilled), skilled.Id);
      }
    }
    const gd = this.Players.find(x => x.PlayerRole === 'GraveDigger' && !x.IsDead && x.DugGravesLastNight > 0);
    if (gd) {
      const spotChance = (20 + (30 - (30 * Math.pow(0.5, gd.DugGravesLastNight - 1)))) / 2;
      if (randInt(100) < spotChance) {
        await this.killPlayer(gd, 'Spotted', { killer: sk, diedByVisitingKiller: true });
        this.send(this.L('SerialKillerSpotted', getName(gd)), sk.Id);
        this.sendGif(this.L('SerialKillerSpottedYou'), this.getRandomImage(this.Gifs.SKKilled), gd.Id);
      }
    }
  }

  if (!this.Players) return;

  const hunter = getPlayerForRole(this.Players, 'CultistHunter');
  if (hunter && !hunter.Frozen) {
    const hunted = this.Players.find(x => x.Id === hunter.Choice);
    const res = await this.visitPlayer(hunter, hunted);
    let failed = false;
    if (res === 'Success') {
      if (hunted.PlayerRole === 'Cultist') {
        this.send(this.L('HunterFindCultist', getName(hunted)), hunter.Id);
        this.send(this.L('CHHuntedYou'), hunted.Id);
        await this.killPlayer(hunted, 'Hunt', { killer: hunter });
        hunter.CHHuntedCultCount++;
      } else failed = true;
    } else if (res === 'Fail') failed = true;
    else if (res === 'AlreadyDead') this.send(this.L('HunterVisitDead', getName(hunted)), hunter.Id);
    if (failed) this.send(this.L('HunterFailedToFind', getName(hunted)), hunter.Id);
  }

  const voteCult = this.Players.filter(x => x.PlayerRole === 'Cultist' && !x.IsDead && !x.Frozen);
  if (voteCult.length) {
    const votechoice = voteCult.filter(x => x.Choice !== 0 && x.Choice !== -1);
    let choice = 0;
    if (votechoice.length) {
      const counts = new Map();
      for (const x of votechoice) counts.set(x.Choice, (counts.get(x.Choice) || 0) + 1);
      choice = Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0][0];
    }

    if (choice !== 0 && choice !== -1) {
      const target = this.Players.find(x => x.Id === choice);
      const newbie = voteCult.slice().sort((a, b) => b.DayCult - a.DayCult)[0];
      const tellCult = (key, ...args) => { for (const c of voteCult) this.send(this.L(key, ...args), c.Id); };
      const res = await this.visitPlayer(newbie, target);
      if (res === 'Success') {
        switch (target.PlayerRole) {
          case 'Hunter':
            if (randInt(100) < config.HunterConversionChance) {
              this.convertToCult(target, voteCult);
            } else if (randInt(100) < config.HunterKillCultChance) {
              target.HasShotHunterAttacker++;
              if (target.HasShotHunterAttacker === 2) this.addAchievement(target, 'HelpfulParanoia');
              if (target.HasShotHunterAttackerThisNight) this.addAchievement(target, 'STierHunter');
              target.HasShotHunterAttackerThisNight = true;
              await this.killPlayer(newbie, 'HunterCult', { killer: target, diedByVisitingKiller: true });
              tellCult('CultConvertHunter', getName(newbie), getName(target));
            } else {
              tellCult('CultUnableToConvert', getName(newbie), getName(target));
              this.send(this.L('CultAttempt'), target.Id);
            }
            break;
          case 'CultistHunter':
            await this.killPlayer(newbie, 'Hunt', { killer: target, diedByVisitingKiller: true });
            this.addAchievement(newbie, 'CultFodder');
            tellCult('CultConvertCultHunter', getName(newbie), getName(target));
            this.send(this.L('CultHunterKilledCultVisit', getName(newbie), this.countCultistsAlive()), target.Id);
            break;
          case 'Wolf':
          case 'AlphaWolf':
          case 'WolfCub':
          case 'Lycan':
            if (voteWolves.some(x => (x.Choice !== 0 && x.Choice !== -1) || (x.Choice2 !== 0 && x.Choice2 !== -1))) {
              tellCult('CultVisitEmpty', getName(newbie), getName(target));
            } else {
              await this.killPlayer(newbie, 'VisitWolf', { killer: target, diedByVisitingKiller: true, killedByRole: 'Wolf' });
              tellCult('CultConvertWolf', getName(newbie), getName(target));
              this.send(this.L('CultAttempt'), target.Id);
            }
            break;
          case 'SnowWolf':
            if (target.Choice !== -1 && target.Choice !== 0) {
              tellCult('CultVisitEmpty', getName(newbie), getName(target));
            } else {
              await this.killPlayer(newbie, 'VisitWolf', { killer: target, diedByVisitingKiller: true, killedByRole: 'Wolf' });
              tellCult('CultConvertWolf', getName(newbie), getName(target));
              this.send(this.L('CultAttempt'), target.Id);
            }
            break;
          case 'GuardianAngel': this.convertToCult(target, voteCult, config.GuardianAngelConversionChance); break;
          case 'Harlot': this.convertToCult(target, voteCult, config.HarlotConversionChance); break;
          case 'Arsonist':
            if (target.Choice === -1 || target.Frozen) this.convertToCult(target, voteCult, 0);
            else tellCult('CultVisitEmpty', getName(newbie), getName(target));
            break;
          case 'Seer': this.convertToCult(target, voteCult, config.SeerConversionChance); break;
          case 'Sorcerer': this.convertToCult(target, voteCult, config.SorcererConversionChance); break;
          case 'Blacksmith': this.convertToCult(target, voteCult, config.BlacksmithConversionChance); break;
          case 'Detective': this.convertToCult(target, voteCult, config.DetectiveConversionChance); break;
          case 'Cursed': this.convertToCult(target, voteCult, config.CursedConversionChance); break;
          case 'Doppelgänger':
          case 'Thief':
          case 'Spumpkin': this.convertToCult(target, voteCult, 0); break;
          case 'Oracle': this.convertToCult(target, voteCult, config.OracleConversionChance); break;
          case 'Sandman': this.convertToCult(target, voteCult, config.SandmanConversionChance); break;
          case 'WiseElder': this.convertToCult(target, voteCult, config.WiseElderConversionChance); break;
          case 'Pacifist': this.convertToCult(target, voteCult, config.PacifistConversionChance); break;
          case 'GraveDigger': this.convertToCult(target, voteCult, config.GraveDiggerConversionChance); break;
          case 'Augur': this.convertToCult(target, voteCult, config.AugurConversionChance); break;
          default: this.convertToCult(target, voteCult);
        }
      } else if (res === 'AlreadyDead') {
        if (!target.Burning) tellCult('CultTargetDead', getName(target));
      } else if (res === 'VisitorDied') {
        if (target.PlayerRole === 'SerialKiller') tellCult('CultConvertSerialKiller', getName(newbie), getName(target));
        else if (target.PlayerRole === 'GraveDigger') tellCult('CultConvertGraveDigger', getName(newbie), getName(target));
      } else if (res === 'Fail') {
        tellCult('CultVisitEmpty', getName(newbie), getName(target));
      }
    }
  }

  const chemist = this.Players.find(x => x.PlayerRole === 'Chemist' && !x.IsDead);
  if (chemist && !chemist.Frozen) {
    const target = this.Players.find(x => x.Id === chemist.Choice);
    const res = await this.visitPlayer(chemist, target);
    if (res === 'Success') {
      if (randInt(100) < config.ChemistSuccessChance) {
        chemist.HasUsedAbility = false;
        await this.killPlayer(target, 'Chemistry', { killer: chemist });
        this.send(this.L('ChemistVisitYouSuccess'), target.Id);
        this.send(this.L('ChemistSuccess', getName(target)), chemist.Id);
        if (++chemist.ChemistVisitSurviveCount === 3) this.addAchievement(chemist, 'GoodChoiceForYou');
        if (target.WasSavedLastNight && ga) this.addAchievement(ga, 'AtLeastYouTried');
      } else {
        chemist.HasUsedAbility = false;
        await this.killPlayer(chemist, 'Chemistry', { killer: chemist });
        chemist.ChemistFailed = true;
        this.send(this.L('ChemistVisitYouFail', getName(chemist)), target.Id);
        this.send(this.L('ChemistFail', getName(target)), chemist.Id);
      }
    } else if (res === 'AlreadyDead') {
      this.send(this.L('ChemistTargetDead', getName(target)), chemist.Id);
    } else if (res === 'Fail') {
      this.send(this.L('ChemistTargetEmpty', getName(target)), chemist.Id);
    } else if (res === 'VisitorDied') {
      if (target.PlayerRole === 'SerialKiller') {
        this.send(this.L('ChemistVisitYouSK', getName(chemist)), target.Id);
        this.send(this.L('ChemistSK', getName(target)), chemist.Id);
      } else if (target.PlayerRole === 'GraveDigger') {
        this.send(this.L('ChemistFellDigger', getName(chemist)), target.Id);
        this.send(this.L('ChemistFell', getName(target)), chemist.Id);
      }
    }
  }

  const barkeep = this.Players.find(x => x.PlayerRole === 'Barkeep' && (!x.IsDead || x.Burning));
  if (barkeep && !barkeep.Frozen) {
    const goToBarChance = 1000.0 / (this.Players.length + 5);
    const barGoers = this.Players.filter(x => !x.IsDead && x.PlayerRole === 'Villager' && randInt(100) < goToBarChance);

    if (barGoers.length === 0) {
      this.send(this.L('BarOpenEmpty'), barkeep.Id);
      barkeep.ConsecutiveNoBarVisitors++;
      if (this.Players.length >= 10 && barkeep.ConsecutiveNoBarVisitors >= 3) this.addAchievement(barkeep, 'GoingOutOfBusiness');
    } else {
      barkeep.ConsecutiveNoBarVisitors = 0;
      if (barGoers.length >= 3) this.addAchievement(barkeep, 'LiquidBusiness');
      const newDrunks = [];
      for (const barGoer of barGoers) {
        const res = await this.visitPlayer(barGoer, barkeep);
        if (res === 'Success') {
          barGoer.BarVisits++;
          if (barGoer.BarVisits >= config.BarVisitsTillDrunk) {
            this.transform(barGoer, 'Drunk', 'VisitBarTooOften');
            this.send(this.L('VillagerVisitBarTurns', getName(barkeep)), barGoer.Id);
            newDrunks.push(getName(barGoer));
          } else this.send(this.L('VillagerVisitBar', barGoer.BarVisits), barGoer.Id);
        } else if (res === 'VisitorDied') {
          if (barGoer.DiedByVisitingVictim && barGoer.KilledByRole === 'Arsonist') {
            this.addAchievement(barGoer, 'GoingDownWithMyBeer');
            this.sendGif(this.L('VillagerVisitBurningBar'), this.getRandomImage(this.Gifs.BurnToDeath), barGoer.Id);
          }
        }
      }

      let barkeepMsg = this.L('BarOpenFull', barGoers.length);
      if (newDrunks.length) barkeepMsg += '\n' + this.L('BarNewDrunks', newDrunks.join(', '));
      if (!barkeep.IsDead) this.send(barkeepMsg, barkeep.Id);
    }
  }

  const harlot = this.Players.find(x => x.PlayerRole === 'Harlot' && !x.IsDead);
  if (harlot && !harlot.Frozen) {
    const target = this.Players.find(x => x.Id === harlot.Choice);
    if (target) {
      if (harlot.LoverId === target.Id) this.addAchievement(harlot, 'Affectionate');
      if (harlot.PlayersVisited.has(target.TeleUser.id)) harlot.HasRepeatedVisit = true;
      harlot.PlayersVisited.add(target.TeleUser.id);
    } else harlot.HasStayedHome = true;

    const res = await this.visitPlayer(harlot, target);
    if (res === 'Success') {
      this.send(target.PlayerRole === 'Cultist' && randInt(100) < config.HarlotDiscoverCultChance
        ? this.L('HarlotDiscoverCult', getName(target))
        : this.L('HarlotVisitNonWolf', getName(target)), harlot.Id);
      if (!target.IsDead) {
        this.send(this.L('HarlotVisitYou'), target.Id);
        if (chemist && chemist.Choice === target.Id && chemist.ChemistFailed) this.addAchievement(target, 'LuckyNight');
      }
    } else if (res === 'VisitorDied') {
      if (!target.Burning) {
        switch (target.PlayerRole) {
          case 'Wolf':
          case 'AlphaWolf':
          case 'WolfCub':
          case 'Lycan':
          case 'SnowWolf':
            this.send(this.L('HarlotFuckWolf', getName(target)), harlot.Id);
            break;
          case 'SerialKiller':
            this.send(this.L('HarlotFuckKiller', getName(target)), harlot.Id);
            break;
          case 'GraveDigger':
            this.send(this.L('HarlotFell', getName(target)), harlot.Id);
            break;
        }
      }
    } else if (res === 'AlreadyDead') {
      if (target.DiedLastNight && (this.WolfRoles.includes(target.KilledByRole) || target.KilledByRole === 'SerialKiller') && !target.DiedByVisitingKiller && !target.DiedByVisitingVictim) {
        await this.killPlayer(harlot, 'VisitVictim', { killer: target, diedByVisitingVictim: true, killedByRole: target.KilledByRole });
        harlot.RoleModel = target.Id;
      } else {
        this.send(this.L('HarlotVisitNotHome', getName(target)), harlot.Id);
      }
    } else if (res === 'Fail') {
      if (target.PlayerRole === 'GraveDigger') this.send(this.L('HarlotVisitDigger', getName(target)), harlot.Id);
      else this.send(this.L('HarlotVisitNotHome', getName(target)), harlot.Id);
    }
  }

  for (const seer of this.Players.filter(x => x.PlayerRole === 'Seer' && !x.IsDead && !x.Frozen)) {
    const target = this.Players.find(x => x.Id === seer.Choice);
    if (target) {
      let role = target.PlayerRole;
      switch (role) {
        case 'Beholder':
          this.addAchievement(seer, 'ShouldHaveKnown');
          break;
        case 'Traitor':
          role = randInt(100) < 50 ? 'Wolf' : 'Villager';
          break;
        case 'WolfCub':
        case 'AlphaWolf':
          role = 'Wolf';
          break;
        case 'WolfMan':
          role = 'Wolf';
          target.Trustworthy = true;
          break;
        case 'Lycan':
          role = 'Villager';
          break;
      }
      this.send(this.L('SeerSees', getName(target), this.getDescription(role)), seer.Id);
    }
  }
  const sorcerer = this.Players.find(x => x.PlayerRole === 'Sorcerer' && !x.IsDead);
  if (sorcerer && !sorcerer.Frozen) {
    const target = this.Players.find(x => x.Id === sorcerer.Choice);
    if (target) {
      switch (target.PlayerRole) {
        case 'AlphaWolf':
        case 'Wolf':
        case 'WolfCub':
          this.send(this.L('SeerSees', getName(target), this.getDescription('Wolf')), sorcerer.Id);
          break;
        case 'Seer':
          this.send(this.L('SeerSees', getName(target), this.getDescription('Seer')), sorcerer.Id);
          break;
        case 'SnowWolf':
          this.send(this.L('SeerSees', getName(target), this.getDescription('SnowWolf')), sorcerer.Id);
          break;
        default:
          this.send(this.L('SorcererOther', getName(target)), sorcerer.Id);
      }
    }
  }
  const fool = this.Players.find(x => x.PlayerRole === 'Fool' && !x.IsDead);
  if (fool && !fool.Frozen) {
    const target = this.Players.find(x => x.Id === fool.Choice);
    if (target) {
      const possibleRoles = this.Players.filter(x => !x.IsDead && x.Id !== fool.Id && x.PlayerRole !== 'Seer').map(x => x.PlayerRole);
      shuffle(possibleRoles);
      shuffle(possibleRoles);
      if (possibleRoles.length) {
        if (this.WolfRoles.includes(possibleRoles[0])) possibleRoles[0] = 'Wolf';
        if (possibleRoles[0] === target.PlayerRole || (possibleRoles[0] === 'Wolf' && this.WolfRoles.includes(target.PlayerRole))) fool.FoolCorrectSeeCount++;
        if (possibleRoles[0] === 'Beholder' && target.PlayerRole === 'Beholder') fool.FoolCorrectlySeenBH = true;
        if (['WolfMan', 'Traitor'].includes(possibleRoles[0])) fool.HasSeenImpossible = true;
        this.send(this.L('SeerSees', getName(target), this.getDescription(possibleRoles[0])), fool.Id);
      }
    }
  }

  const oracle = this.Players.find(x => x.PlayerRole === 'Oracle' && !x.IsDead);
  if (oracle && !oracle.Frozen) {
    const target = this.Players.find(x => x.Id === oracle.Choice);
    if (target) {
      const possibleRoles = this.Players.filter(x => !x.IsDead && x.Id !== oracle.Id && x.PlayerRole !== target.PlayerRole).map(x => x.PlayerRole);
      shuffle(possibleRoles);
      shuffle(possibleRoles);
      if (possibleRoles.length) this.send(this.L('NegSeerSees', getName(target), this.getDescription(possibleRoles[0])), oracle.Id);
      else this.addAchievement(oracle, 'NowImBlind');
    }
  }

  const augur = this.Players.find(x => !x.IsDead && x.PlayerRole === 'Augur');
  if (augur && !augur.Frozen) {
    const isNotInGame = x => !augur.SawRoles.includes(x) && !this.Players.some(y => (!y.IsDead || y.DiedLastNight) && y.PlayerRole === x);
    shuffle(this.PossibleRoles);
    if (this.PossibleRoles.some(isNotInGame)) {
      let roleToSee = this.PossibleRoles.find(isNotInGame);
      if (roleToSee === 'Seer' && this.Players.some(x => !x.IsDead && x.PlayerRole === 'ApprenticeSeer') && !this.Players.some(x => x.PlayerRole === 'Seer' && !x.IsDead)) roleToSee = 'ApprenticeSeer';
      this.send(this.L('AugurSees', this.getDescription(roleToSee)), augur.Id);
      augur.SawRoles.push(roleToSee);
    } else {
      this.send(this.L('AugurSeesNothing'), augur.Id);
    }
  }

  if (ga && !ga.Frozen && (!ga.IsDead || ga.DiedLastNight)) {
    const save = this.Players.find(x => x.Id === ga.Choice);
    const res = await this.visitPlayer(ga, save);
    if (res === 'AlreadyDead' || res === 'Success') {
      if (this.WolfRoles.includes(save.PlayerRole) && !save.WasSavedLastNight) ga.GAGuardWolfCount++;
      let cleanedDoused = false;
      if (save.WasSavedLastNight) {
        ga.GASaves++;
        if (save.Doused && arsonist && arsonist.Choice === -2) {
          this.send(this.L('GuardSavedFromFire', getName(save)), ga.Id);
          this.send(this.L('GuardSavedYouFromFire'), save.Id);
          save.Doused = false;
        } else {
          this.send(this.L('GuardSaved', getName(save)), ga.Id);
          this.send(this.L('GuardSavedYou'), save.Id);
        }
      } else if (save.Doused) {
        this.send(this.L('CleanDoused', getName(save)), ga.Id);
        save.Doused = false;
        cleanedDoused = true;
        ga.HasCleanedDoused++;
        if (ga.HasCleanedDoused === 3) this.addAchievement(ga, 'Firefighter');
      }
      if (!save.WasSavedLastNight && !save.DiedLastNight && !cleanedDoused) this.send(this.L('GuardNoAttack', getName(save)), ga.Id);
    } else if (res === 'Fail') {
      this.send(this.L('GuardEmptyHouse', getName(save)), ga.Id);
    } else if (res === 'VisitorDied') {
      switch (save.PlayerRole) {
        case 'AlphaWolf':
        case 'WolfCub':
        case 'Wolf':
        case 'Lycan':
        case 'SnowWolf':
          this.send(this.L('GuardWolf'), ga.Id);
          break;
        case 'SerialKiller':
          this.send(this.L('GuardKiller'), ga.Id);
          break;
        case 'GraveDigger':
          this.send(this.L('GAFell', getName(save)), ga.Id);
          break;
      }
    }
  }

  this.checkRoleChanges();

  const chef = this.Players.find(x => x.PlayerRole === 'Chef' && !x.IsDead);
  const chefTarget = this.Players.find(x => x.IsActionTracked && (!x.IsDead || x.DiedLastNight));
  const chefTargetLeft = Boolean(chefTarget) &&
    ((chefTarget.PlayerRole === 'GraveDigger' && chefTarget.DugGravesLastNight > 0) ||
      (chefTarget.PlayerRole === 'Arsonist' && chefTarget.Choice === -2) ||
      (voteWolves.includes(chefTarget) && wolfChoices.some(x => x !== 0 && x !== 1)));

  const thief = this.Players.find(x => x.PlayerRole === 'Thief' && !x.IsDead);
  if (thief) {
    if (!this.ThiefFull) {
      if (this.GameDay === 1) {
        let target = this.Players.find(x => x.Id === thief.Choice);
        let tries = 0;
        while (!target && tries < 10) {
          tries++;
          target = this.Players.find(x => x.Id === this.chooseRandomPlayerId(thief, false));
        }
        if (tries > 0) this.send(this.L('ThiefStealChosen', getName(target)), thief.Id);
        const res = await this.visitPlayer(thief, target);
        if (res === 'Success') await this.stealRole(thief, target);
      }
    } else if (!thief.Frozen) {
      const target = this.Players.find(x => x.Id === thief.Choice);
      const res = await this.visitPlayer(thief, target);
      let failed = false;
      if (res === 'Success') {
        if (randInt(100) < config.ThiefStealChance && !this.WolfRoles.includes(target.PlayerRole) && target.PlayerRole !== 'Cultist' && target.PlayerRole !== 'SnowWolf') await this.stealRole(thief, target);
        else failed = true;
      } else if (res === 'VisitorDied') {
        if (!target.Burning && target.PlayerRole === 'GraveDigger') this.send(this.L('ThiefFell', getName(target)), thief.Id);
        else if (target.PlayerRole === 'SerialKiller') this.send(this.L('StealKiller'), thief.Id);
      } else if (res === 'Fail') failed = true;
      else if (res === 'AlreadyDead') this.send(this.L('ThiefStealDead', getName(target)), thief.Id);
      if (failed) this.send(this.L('ThiefStealFailed', getName(target)), thief.Id);
    }
  }

  if (chef && !chef.Frozen && chefTarget) {
    const leftHouse = chefTargetLeft || chefTarget.VisitingSameNightCount > 0;
    const visitors = chefTarget.BeingVisitedSameNightCount;
    let actionTracked;
    if (leftHouse) {
      if (visitors > 1) actionTracked = this.L('ActionTrackNotHomeVisitedByMul', getName(chefTarget), visitors);
      else if (visitors === 1) actionTracked = this.L('ActionTrackNotHomeVisitedByOne', getName(chefTarget));
      else actionTracked = this.L('ActionTrackNotHomeNotVisited', getName(chefTarget));
    } else if (visitors > 1) actionTracked = this.L('ActionTrackHomeVisitedByMul', getName(chefTarget), visitors);
    else if (visitors === 1) actionTracked = this.L('ActionTrackHomeVisitedByOne', getName(chefTarget));
    else {
      actionTracked = this.L('ActionTrackHomeNotVisited', getName(chefTarget));
      chef.FoodWastedOnPlayers.add(chefTarget.Id);
      if (chef.FoodWastedOnPlayers.size >= 3) this.addAchievement(chef, 'FoodWaste');
    }
    this.send(actionTracked, chef.Id);
    if (visitors >= 3) this.addAchievement(chef, 'TrafficControl');
    if (chefTarget.DiedLastNight) this.addAchievement(chef, 'DefinitelyDead');
  }

  const hunterFinalShot = new Map();
  const secret = !this.hasFlag('ShowRolesDeath');
  const was = p => `${getName(p)} ${this.L('Was')} ${this.getDescription(p.PlayerRole)}`;
  if (this.Players.some(x => x.DiedLastNight)) {
    if (!secret && this.Players.some(x => x.DiedLastNight && !x.DiedByVisitingVictim && x.KilledByRole === 'Arsonist')) {
      const burnDeaths = this.Players.filter(x => x.DiedLastNight && !x.DiedByVisitingVictim && x.KilledByRole === 'Arsonist');
      this.sendWithQueue(this.L('Burning', burnDeaths.map(was).join('\n')));
      for (const p of burnDeaths.filter(x => x.InLove && !burnDeaths.some(y => y.Id === x.LoverId) && this.Players.some(y => y.LoverMsg && y.Id === x.LoverId))) {
        const lover = this.Players.find(x => x.Id === p.LoverId);
        this.sendWithQueue(lover.LoverMsg);
        if (lover.PlayerRole === 'Hunter') hunterFinalShot.set(lover, 'LoverDied');
      }
      for (const p of burnDeaths.filter(x => x.FinalShotDelay)) hunterFinalShot.set(p, p.FinalShotDelay);
    }
    for (const p of this.Players.filter(x => x.DiedLastNight && (secret || !(!x.DiedByVisitingVictim && x.KilledByRole === 'Arsonist')))) {
      let msg = '';
      let msg2 = '';
      if (secret) {
        this.sendWithQueue(this.L('GenericDeathNoReveal', getName(p)));
      } else {
        if (p.KilledByRole === 'Wolf' && !p.DiedByVisitingKiller && !p.DiedByVisitingVictim) {
          switch (p.PlayerRole) {
            case 'ApprenticeSeer':
            case 'Detective':
            case 'Drunk':
            case 'Fool':
            case 'Gunner':
            case 'Harlot':
            case 'Mason':
            case 'Seer':
            case 'Sorcerer':
            case 'WildChild':
              msg = this.L(p.PlayerRole + 'Eaten', getName(p));
              break;
            case 'GuardianAngel':
              msg = this.L('GuardianEaten', getName(p));
              break;
            default:
              msg = this.L('DefaultEaten', getName(p), was(p));
          }
        } else if (p.KilledByRole === 'SerialKiller' && !p.DiedByVisitingKiller && !p.DiedByVisitingVictim) {
          switch (p.PlayerRole) {
            case 'Blacksmith':
            case 'Cultist':
            case 'Cupid':
            case 'Drunk':
            case 'GuardianAngel':
            case 'Gunner':
            case 'Mayor':
            case 'Prince':
            case 'Seer':
              msg = this.L(p.PlayerRole + 'Killed', getName(p));
              break;
            default:
              msg = this.L('DefaultKilled', getName(p), was(p));
          }
        } else if (p.KilledByRole === 'Chemist') {
          if (p.ChemistFailed) {
            msg = this.L('ChemistFailPublic', getName(p));
          } else {
            msg = this.L('ChemistSuccessPublic', getName(p), was(p));
            if (p.PlayerRole === 'WiseElder' && chemist && !chemist.IsDead) {
              chemist.PlayerRole = 'Villager';
              chemist.ChangedRolesCount++;
              msg2 = this.L('ChemistKillWiseElder');
            }
          }
        } else if (p.KilledByRole === 'GraveDigger') {
          switch (p.PlayerRole) {
            case 'Wolf':
            case 'AlphaWolf':
            case 'Lycan':
            case 'WolfCub':
              msg = this.L('WolfFellPublic', getName(p), was(p));
              break;
            case 'Harlot':
            case 'Cultist':
            case 'Thief':
              msg = this.L(p.PlayerRole + 'FellPublic', getName(p));
              break;
            default:
              msg = this.L('DefaultFellPublic', getName(p), was(p));
          }
        } else if (p.KilledByRole === 'Arsonist' && p.DiedByVisitingVictim) {
          switch (p.PlayerRole) {
            case 'AlphaWolf':
            case 'Lycan':
            case 'WolfCub':
            case 'Wolf':
              msg = this.L('WolfVisitBurn', getName(p), was(p));
              break;
            case 'Villager':
              msg = this.L('BarVisitorBurn', getName(p), was(p));
              break;
            default:
              msg = this.L('DefaultVisitBurn', getName(p), was(p));
          }
        } else {
          switch (p.PlayerRole) {
            case 'WolfCub':
            case 'AlphaWolf':
            case 'Lycan':
            case 'Wolf':
              if (p.KilledByRole === 'SerialKiller') msg = this.L('SerialKillerKilledWolf', getName(p));
              else msg = this.L(voteWolvesCount > 1 ? 'HunterShotWolfMulti' : 'HunterShotWolf', getName(p)) + ' ' + this.L('PlayerRoleWas', getName(p), this.getDescription(p.PlayerRole));
              break;
            case 'CultistHunter':
              msg = this.L('SerialKillerKilledCH', getName(p));
              break;
            case 'Cultist':
              switch (p.KilledByRole) {
                case 'CultistHunter':
                  msg = this.L('HunterKilledCultist', getName(p));
                  break;
                case 'Hunter':
                  msg = this.L('HunterKilledVisiter', getName(p), `${this.getDescription(p.PlayerRole)} ${this.L('IsDead')}`);
                  break;
                case 'Wolf':
                  msg = this.L('CultConvertWolfPublic', getName(p));
                  break;
                case 'SerialKiller':
                  msg = this.L('CultConvertKillerPublic', getName(p));
                  break;
              }
              break;
            case 'Harlot':
              switch (p.KilledByRole) {
                case 'Wolf':
                  if (p.DiedByVisitingKiller) msg = this.L('HarlotFuckedWolfPublic', getName(p));
                  else if (p.DiedByVisitingVictim) msg = this.L('HarlotFuckedVictimPublic', getName(p), getName(this.Players.find(x => x.Id === p.RoleModel)));
                  break;
                case 'SerialKiller':
                  if (p.DiedByVisitingKiller) msg = this.L('HarlotFuckKillerPublic', getName(p));
                  else if (p.DiedByVisitingVictim) msg = this.L('HarlotFuckedKilledPublic', getName(p), getName(this.Players.find(x => x.Id === p.RoleModel)));
                  break;
              }
              break;
            case 'GuardianAngel':
              if (p.KilledByRole === 'Wolf') msg = this.L('GAGuardedWolf', getName(p));
              else if (p.KilledByRole === 'SerialKiller') msg = this.L('GAGuardedKiller', getName(p));
              break;
            case 'Thief':
              if (p.KilledByRole === 'SerialKiller') msg = this.L('ThiefStoleKiller', getName(p));
              break;
            case 'Chemist':
              if (p.KilledByRole === 'SerialKiller') msg = this.L('ChemistSKPublic', getName(p));
              break;
            case 'SnowWolf':
              if (p.KilledByRole === 'SerialKiller') msg = this.L('SnowFrozeKiller', getName(p));
              else msg = this.L('SnowFrozeHunter', getName(p));
              break;
            case 'Arsonist':
              msg = this.L('ArsonistVisitKiller', getName(p));
              break;
            case 'GraveDigger':
              if (p.KilledByRole === 'SerialKiller') msg = this.L('KillerSpottedDiggerPublic', getName(p));
              else msg = this.L('WolvesSpottedDiggerPublic', getName(p));
              break;
          }
        }

        for (const pl of this.Players) {
          if ((this.WolfRoles.includes(pl.PlayerRole) || pl.PlayerRole === 'SerialKiller') && pl.KilledLastNight >= 3) this.addAchievement(pl, 'TripleKill');
        }
      }
      if (msg) this.sendWithQueue(msg);
      if (msg2) this.sendWithQueue(msg2);
      const lover = this.Players.find(x => x.Id === p.LoverId && x.LoverMsg);
      if (lover) this.sendWithQueue(lover.LoverMsg);
      if (p.FinalShotDelay) hunterFinalShot.set(p, p.FinalShotDelay);
      if (lover && lover.FinalShotDelay) hunterFinalShot.set(lover, lover.FinalShotDelay);
    }

    for (const [h, method] of hunterFinalShot) await this.hunterFinalShot(h, method);

    const bloodyVictims = this.Players.filter(x => x.TimeDied > nightStart && x.IsDead);
    if (bloodyVictims.length >= 4) for (const p of bloodyVictims) this.addAchievement(p, 'BloodyNight');
  } else if (this.IsRunning) {
    this.sendWithQueue(this.L('NoAttack'));
  }

  if (await this.checkForGameEnd()) return;

  for (const p of this.Players) {
    p.DiedLastNight = false;
    p.KilledLastNight = 0;
    p.WasSavedLastNight = false;
    p.Choice = 0;
    p.Votes = 0;
    if (p.BeingVisitedSameNightCount >= 3) p.BusyNight = true;
    if (p.Bitten && !p.IsDead) this.send(this.L('PlayerBitten'), p.Id);
    p.VisitingSameNightCount = 0;
    p.BeingVisitedSameNightCount = 0;
    p.HasShotHunterAttackerThisNight = false;
    p.JustPromotedFromTraitor = false;
    p.IsActionTracked = false;
  }
};

W.countCultistsAlive = function () {
  let cultists = 0;
  cultists += this.Players.filter(x => x.PlayerRole === 'Cultist' && !x.IsDead).length;
  cultists += this.Players.filter(x => {
    if (x.PlayerRole !== 'Doppelgänger' || x.IsDead) return false;
    const rm = this.Players.find(r => r.Id === x.RoleModel);
    return rm && rm.IsDead && rm.PlayerRole === 'Cultist';
  }).length;
  return cultists;
};
