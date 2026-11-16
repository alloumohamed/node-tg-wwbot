const config = require('../config');
const tg = require('../tg');
const store = require('../store');
const { sleep, shuffle, toBold, getName } = require('../util');
const { QT } = require('../player');
const { Werewolf } = require('./core');

const W = Werewolf.prototype;

W.lynchCycle = async function () {
  if (!this.IsRunning) return;
  this.Time = 'Lynch';
  if (!this.Players) return;

  let lynchAttempt = 0;
  const doubleLynch = this._doubleLynch;
  this._doubleLynch = false;

  do {
    lynchAttempt++;

    for (const p of this.Players) {
      p.CurrentQuestion = null;
      p.VotedBy.clear();
      p.Votes = 0;
    }

    if (await this.checkForGameEnd()) return;
    if (this._pacifistUsed) {
      this.sendWithQueue(this.L('PacifistNoLynchNow'));
      this._pacifistUsed = false;
      return;
    }

    if (lynchAttempt === 2) this.sendWithQueue(this.L('TroubleDoubleLynchNow'));
    const lynchTime = this.DbGroup.LynchTime || config.TimeLynch;
    this.sendWithQueue(this.L('LynchTime', toBold(lynchTime)));
    this.sendPlayerList();
    await this.sendLynchMenu();

    for (let i = 0; i < lynchTime; i++) {
      await sleep(1000);
      if (!this.Players) return;
      if (await this.checkForGameEnd()) return;
      if (this._pacifistUsed) {
        this.sendWithQueue(this.L('PacifistNoLynchNow'));
        this._pacifistUsed = false;
        for (const p of this.Players.filter(x => x.CurrentQuestion)) {
          try {
            if (p.CurrentQuestion.MessageId !== 0) tg.edit(p.Id, p.CurrentQuestion.MessageId, this.L('LynchPeaceTimeout')).catch(() => {});
          } catch (e) {
          }
          p.CurrentQuestion = null;
        }
        const pacifist = this.Players.find(x => x.PlayerRole === 'Pacifist' && !x.IsDead);
        if (pacifist) {
          if (this.Players.filter(x => x.Choice === pacifist.Id).length > this.Players.filter(x => !x.IsDead).length / 2) {
            this.addAchievement(pacifist, 'EveryManForHimself');
          } else if (pacifist.LoverId !== 0 && this.Players.filter(x => x.Choice === pacifist.LoverId).length > this.Players.filter(x => !x.IsDead).length / 2) {
            this.addAchievement(this.Players.find(x => x.Id === pacifist.LoverId), 'MySweetieSoStrong');
          }
        }
        return;
      }
      if (this.Players.filter(x => !x.IsDead).every(x => x.Choice !== 0)) break;
    }

    for (const p of this.Players.filter(x => x.CurrentQuestion)) {
      try {
        if (p.CurrentQuestion.MessageId !== 0) tg.edit(p.Id, p.CurrentQuestion.MessageId, this.L('TimesUp')).catch(() => {});
      } catch (e) {
      }
      p.CurrentQuestion = null;
    }

    if (await this.checkForGameEnd()) return;
    for (const p of this.Players.filter(x => !x.IsDead)) {
      if (p.Choice !== 0 && p.Choice !== -1) {
        const target = this.Players.find(x => x.Id === p.Choice);
        if (target) {
          target.HasBeenVoted = true;
          target.Votes++;

          if (this.SecretLynch && this.SecretLynchShowVotes && this.SecretLynchShowVoters && !target.VotedBy.has(p)) target.VotedBy.set(p, 1);

          if (p.PlayerRole === 'Mayor' && p.HasUsedAbility) {
            p.MayorLynchAfterRevealCount++;
            target.Votes++;
            if (this.SecretLynch && this.SecretLynchShowVotes && this.SecretLynchShowVoters) target.VotedBy.set(p, target.VotedBy.get(p) + 1);
          }
        }
        p.NonVote = 0;
      } else if (!p.IsDead && lynchAttempt < 2) {
        p.NonVote++;
        if (p.NonVote < 2) continue;
        const counts = store.idleCounts(p.Id, this.ChatId);
        store.addIdle(p.Id, this.ChatId);
        this.sendWithQueue(this.L('IdleKill', getName(p), (this.hasFlag('ShowRolesDeath') ? `${getName(p)} ${this.L('Was')} ${this.getDescription(p.PlayerRole)}\n` : '') + this.L('IdleCount', getName(p) + `(id: <code>${p.TeleUser.id}</code>)`, counts.total + 1) + ' ' + this.L('GroupIdleCount', counts.group + 1)));

        await this.killPlayer(p, 'Idle', { killer: p, isNight: false, hunterFinalShot: false });
        this.checkRoleChanges();
      }
    }

    try {
      const maxVotes = Math.max(...this.Players.map(x => x.Votes));
      const choices = this.Players.filter(x => x.Votes === maxVotes);
      let lynched = { Votes: -1 };

      if (this.Players.every(x => x.Votes === 0)) {
        lynched.Votes = -2;
      } else if (choices.length > 1) {
        if (config.RandomLynch) {
          shuffle(choices);
          shuffle(choices);
          lynched = this.Players.find(x => x.Id === choices[0].Id);
        }
      } else {
        lynched = this.Players.find(x => x.Id === choices[0].Id);
      }

      if (this.SecretLynch && this.SecretLynchShowVotes) {
        let sendMsg = '';
        const playerGotVoted = this.Players.filter(x => x.Votes > 0).sort((a, b) => b.Votes - a.Votes);
        for (const p of playerGotVoted) {
          if (this.SecretLynchShowVoters) {
            const voterList = [];
            for (const [voter, n] of p.VotedBy) voterList.push(n > 1 ? `${getName(voter)} (${n})` : getName(voter));
            sendMsg += this.L('SecretLynchResultEach', p.Votes, getName(p), voterList.join(', ')) + '\n';
          } else {
            sendMsg += this.L('SecretLynchResultNumber', p.Votes, getName(p)) + '\n';
          }
        }
        this.sendWithQueue(this.L('SecretLynchResultFull', sendMsg));
      }

      if (lynched.Votes > 0) {
        if (lynched.PlayerRole === 'Prince' && !lynched.HasUsedAbility) {
          this.sendWithQueue(this.L('PrinceLynched', getName(lynched)));
          lynched.HasUsedAbility = true;
        } else {
          if (lynched.PlayerRole === 'Tanner') {
            if (this.Players.filter(x => !x.IsDead).length === 3) this.addAchievement(lynched, 'ThatCameUnexpected');
            if (lynched.InLove) this.addAchievement(this.Players.find(x => x.Id === lynched.LoverId), 'RomeoAndJuliet');
          }

          if (lynched.PlayerRole === 'Seer' && this.GameDay === 1) this.addAchievement(lynched, 'LackOfTrust');
          if (lynched.PlayerRole === 'Prince' && lynched.HasUsedAbility) this.addAchievement(lynched, 'SpoiledRichBrat');
          this.sendWithQueue(this.L('LynchKill', getName(lynched), this.hasFlag('ShowRolesDeath') ? `${getName(lynched)} ${this.L('Was')} ${this.getDescription(lynched.PlayerRole)}` : ''));
          if (!this.firstLynchDone) {
            lynched.LynchedFirst = true;
            this.firstLynchDone = true;
          }
          await this.killPlayer(lynched, 'Lynch', { killers: this.Players.filter(x => x.Choice === lynched.Id), isNight: false });
          if (lynched.PlayerRole === 'Tanner') {
            if (this.Players.filter(x => !x.IsDead).every(x => x.Choice === lynched.Id)) this.addAchievement(lynched, 'TannerOverkill');
            lynched.DiedLastNight = true;
            await this.doGameEnd('Tanner');
            return;
          }

          this.checkRoleChanges(true);
        }
      } else if (lynched.Votes === -1) {
        this.sendWithQueue(this.L('LynchTie'));
        const t = choices.find(x => x.PlayerRole === 'Tanner');
        if (t && t.Votes > 0) this.addAchievement(t, 'SoClose');
      } else {
        this.sendWithQueue(this.L('NoLynchVotes'));
      }

      if (await this.checkForGameEnd(true)) return;
    } catch (e) {
      if (!this.Players) return;
      this.send('أوه لا، حدث خطأ ما :( يتم إرسال تقرير الخطأ للمطورين\n' + e.message);
      this.logException(e);
      this.removeGame();
      return;
    }
  } while (lynchAttempt < (doubleLynch ? 2 : 1));
};

W.dayCycle = async function () {
  if (!this.IsRunning) return;
  this.Time = 'Day';

  if (!this.Players) return;
  for (const p of this.Players) p.CurrentQuestion = null;
  const timeToAdd = Math.max((Math.trunc(this.Players.filter(x => !x.IsDead).length / 5) - 1) * 30, 60);
  const dayTime = this.DbGroup.DayTime || config.TimeDay;
  this.sendWithQueue(this.L('DayTime', toBold(dayTime + timeToAdd)));
  this.sendWithQueue(this.L('Day', toBold(this.GameDay)));
  this.sendPlayerList();

  await this.sendDayActions();
  await sleep((dayTime + timeToAdd) * 1000);

  if (!this.IsRunning) return;
  try {
    for (const p of this.Players.filter(x => x.CurrentQuestion)) {
      try {
        if (p.CurrentQuestion.MessageId !== 0 && ![QT.Mayor, QT.Pacifist].includes(p.CurrentQuestion.QType)) {
          tg.edit(p.Id, p.CurrentQuestion.MessageId, this.L('TimesUp')).catch(() => {});
        }
      } catch (e) {
      }
      p.CurrentQuestion = null;
    }
  } catch (e) {
  }

  if (!this.Players) return;

  if (this._sandmanSleep && this._silverSpread) {
    const bs = this.Players.find(x => x.PlayerRole === 'Blacksmith' && !x.IsDead);
    if (bs) this.addAchievement(bs, 'WastedSilver');
  }

  const chef = this.Players.find(x => x.PlayerRole === 'Chef' && !x.IsDead && x.Choice !== -1);
  if (chef) {
    const target = this.Players.find(x => x.Id === chef.Choice && !x.IsDead);
    if (target) target.IsActionTracked = true;
  }

  const gunner = this.Players.find(x => x.PlayerRole === 'Gunner' && !x.IsDead && x.Choice !== 0 && x.Choice !== -1);
  if (gunner) {
    const check = this.Players.find(x => x.Id === gunner.Choice);
    if (check) {
      gunner.Bullet--;
      gunner.HasUsedAbility = true;
      if (['Wolf', 'AlphaWolf', 'WolfCub', 'Cultist', 'SerialKiller', 'Lycan', 'SnowWolf', 'Arsonist'].includes(check.PlayerRole)) gunner.BulletHitBaddies++;
      const roleText = !this.hasFlag('ShowRolesDeath') ? '' : `${getName(check)} ${this.L('Was')} ${this.getDescription(check.PlayerRole)}`;
      switch (check.PlayerRole) {
        case 'Harlot':
          this.sendWithQueue(this.hasFlag('ShowRolesDeath') ? this.L('HarlotShot', getName(gunner), getName(check)) : this.L('DefaultShot', getName(gunner), getName(check), ''));
          break;
        case 'WiseElder':
          this.sendWithQueue(this.L('DefaultShot', getName(gunner), getName(check), roleText));
          this.sendWithQueue(this.L('GunnerShotWiseElder', getName(gunner), getName(check)));
          this.transform(gunner, 'Villager', 'KillElder', { bullet: 0 });
          break;
        default:
          this.sendWithQueue(this.L('DefaultShot', getName(gunner), getName(check), roleText));
      }
      await this.killPlayer(check, 'Shoot', { killer: gunner, isNight: false });
    }
  }

  const spumpkin = this.Players.find(x => x.PlayerRole === 'Spumpkin' && !x.IsDead && x.Choice !== 0 && x.Choice !== -1);
  if (spumpkin) {
    const check = this.Players.find(x => x.Id === spumpkin.Choice);
    if (check) {
      if (require('../util').randInt(100) < 40) {
        const roleText = !this.hasFlag('ShowRolesDeath') ? '' : `${getName(check)} ${this.L('Was')} ${this.getDescription(check.PlayerRole)}`;
        switch (check.PlayerRole) {
          case 'WiseElder':
            this.sendWithQueue(this.L('Detonation', getName(spumpkin), getName(check), roleText));
            this.sendWithQueue(this.L('DetonatedWiseElder', getName(spumpkin), getName(check)));
            this.transform(spumpkin, 'Villager', 'KillElder');
            break;
          default:
            this.sendWithQueue(this.L('Detonation', getName(spumpkin), getName(check), roleText));
        }
        await this.killPlayer(spumpkin, null, { killer: null, isNight: false });
        await this.killPlayer(check, 'Shoot', { killer: spumpkin, isNight: false });
      } else {
        this.send(this.L('SpumpkinFailDetonate', getName(check)), spumpkin.Id);
      }
    }
  }

  const detect = this.Players.find(x => x.PlayerRole === 'Detective' && !x.IsDead && x.Choice !== 0 && x.Choice !== -1);
  if (detect) {
    if (require('../util').randInt(100) < config.ChanceDetectiveCaught) {
      for (const w of this.Players.filter(x => !x.IsDead && ['Wolf', 'AlphaWolf', 'WolfCub', 'Lycan', 'SnowWolf'].includes(x.PlayerRole))) {
        this.send(this.L('DetectiveCaught', getName(detect)), w.Id);
      }
    }

    const check = this.Players.find(x => x.Id === detect.Choice);
    if (check) {
      this.send(this.L('DetectiveSnoop', getName(check), this.getDescription(check.PlayerRole)), detect.Id);

      if (!['Wolf', 'AlphaWolf', 'WolfCub', 'Lycan', 'Cultist', 'SerialKiller', 'SnowWolf', 'Arsonist'].includes(check.PlayerRole)) {
        detect.CorrectSnooped = [];
      } else {
        if (detect.CorrectSnooped.includes(check.Id)) detect.CorrectSnooped = [];
        detect.CorrectSnooped.push(check.Id);
        if (detect.CorrectSnooped.length >= 4) {
          this.addAchievement(detect, 'Streetwise');
          detect.CorrectSnooped = [];
        }
      }
    }
  }
  this.checkRoleChanges();
};

W.sendLynchMenu = async function () {
  if (!this.Players) return;
  this.NoOneCastLynch = true;
  for (const player of this.Players.filter(x => !x.IsDead).sort((a, b) => a.Name.localeCompare(b.Name))) {
    player.CurrentQuestion = null;
    player.Choice = 0;
    const possible = this.Players.filter(x => !x.IsDead && x.Id !== player.Id);
    if (this.ShufflePlayerList) shuffle(possible);
    const choices = possible.map(x => [{ text: x.Name, callback_data: this.cb(QT.Lynch, x.Id) }]);
    await this.sendMenu(choices, player, this.L('AskLynch'), QT.Lynch);
    await sleep(100);
  }
};

W.sendMenu = async function (choices, to, text, qtype) {
  choices = choices.slice();
  const skipText = this.L('Skip');
  const skip = choices.find(x => x[0].text === skipText);
  if (skip) {
    choices.splice(choices.indexOf(skip), 1);
    choices.push(skip);
  }
  let msgId = 0;
  try {
    const r = await tg.send(text, to.Id, { menu: { inline_keyboard: choices } });
    msgId = r.message_id;
  } catch (e) {
    console.error(`Error sending menu to ${to.Name}: ${e.message}`);
  }
  to.CurrentQuestion = { QType: qtype, ValidAnswers: choices.flat().map(x => x.callback_data), MessageId: msgId };
};

W.pickMenu = function (list, qtype, withSkip = true) {
  const opts = list.slice();
  if (this.ShufflePlayerList) shuffle(opts);
  const choices = opts.map(x => [{ text: x.Name, callback_data: this.cb(qtype, x.Id) }]);
  if (withSkip) choices.push([{ text: this.L('Skip'), callback_data: this.cb(qtype, -1) }]);
  return choices;
};

W.sendDayActions = async function () {
  if (!this.Players) return;
  for (const p of this.Players) {
    p.CurrentQuestion = null;
    p.Choice = 0;
  }
  await sleep(1000);
  const alive = role => this.Players.find(x => x && x.PlayerRole === role && !x.IsDead);
  const yesNo = (qt, role) => [[{ text: this.L('Yes'), callback_data: this.cb(qt, 'yes') }, { text: this.L('No'), callback_data: this.cb(qt, 'no') }]];

  const detective = alive('Detective');
  if (detective) {
    detective.Choice = 0;
    const options = this.Players.filter(x => !x.IsDead && x.Id !== detective.Id);
    if (options.length) await this.sendMenu(this.pickMenu(options, QT.Detect), detective, this.L('AskDetect'), QT.Detect);
  }

  const mayor = alive('Mayor');
  if (mayor && this.GameDay === 1) {
    await this.sendMenu([[{ text: this.L('Reveal'), callback_data: this.cb(QT.Mayor, 'reveal') }]], mayor, this.L('AskMayor'), QT.Mayor);
  }

  const pacifist = alive('Pacifist');
  if (pacifist && this.GameDay === 1) {
    await this.sendMenu([[{ text: this.L('Peace'), callback_data: this.cb(QT.Pacifist, 'peace') }]], pacifist, this.L('AskPacifist'), QT.Pacifist);
  }

  const sandman = this.Players.find(x => x.PlayerRole === 'Sandman' && !x.IsDead && !x.HasUsedAbility);
  if (sandman) await this.sendMenu(yesNo(QT.Sandman), sandman, this.L('AskSandman'), QT.Sandman);

  const blacksmith = this.Players.find(x => x.PlayerRole === 'Blacksmith' && !x.IsDead && !x.HasUsedAbility);
  if (blacksmith) await this.sendMenu(yesNo(QT.SpreadSilver), blacksmith, this.L('SpreadDust'), QT.SpreadSilver);

  const gunner = alive('Gunner');
  if (gunner) {
    gunner.Choice = 0;
    if (gunner.Bullet > 0) {
      const options = this.Players.filter(x => !x.IsDead && x.Id !== gunner.Id);
      if (options.length) await this.sendMenu(this.pickMenu(options, QT.Shoot), gunner, this.L('AskShoot', gunner.Bullet), QT.Shoot);
    }
  }

  const spumpkin = alive('Spumpkin');
  if (spumpkin) {
    spumpkin.Choice = 0;
    const options = this.Players.filter(x => !x.IsDead && x.Id !== spumpkin.Id);
    if (options.length) await this.sendMenu(this.pickMenu(options, QT.Shoot), spumpkin, this.L('AskDetonate'), QT.Shoot);
  }

  const troublemaker = this.Players.find(x => x.PlayerRole === 'Troublemaker' && !x.IsDead && !x.HasUsedAbility);
  if (troublemaker) {
    troublemaker.Choice = 0;
    await this.sendMenu(yesNo(QT.Trouble), troublemaker, this.L('AskTroublemaker'), QT.Trouble);
  }

  const chef = alive('Chef');
  if (chef) {
    chef.Choice = 0;
    const options = this.Players.filter(x => !x.IsDead && x.Id !== chef.Id);
    if (options.length) await this.sendMenu(this.pickMenu(options, QT.ScatterRice), chef, this.L('AskChef'), QT.ScatterRice);
  }
};
