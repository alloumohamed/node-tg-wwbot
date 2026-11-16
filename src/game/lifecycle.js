const config = require('../config');
const store = require('../store');
const tg = require('../tg');
const { sleep, randInt, shuffle, toBold, getName, getPlayersForRoles } = require('../util');
const { IPlayer, QT } = require('../player');
const { Werewolf } = require('./core');

const W = Werewolf.prototype;

function mmss(seconds) {
  const s = Math.max(0, Math.trunc(seconds));
  return `${String(Math.trunc(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

W.run = async function () {
  try {
    let count = this.Players.length;
    let secondsElapsed = 0;
    for (let i = 0; i < config.GameJoinTime; i++) {
      if (!this.Players) return;

      if (this.KillTimer) {
        this.KillTimer = false;
        break;
      }

      this._requestPlayerListUpdate = true;

      if (count !== this.Players.length) {
        i = Math.min(i, Math.max(120, i - 30));
        count = this.Players.length;
      }

      if (secondsElapsed++ % 30 === 0 && this._joined.length) {
        const names = this._joined.map(p => getName(p) + (this.ShowIDs ? ` (ID: <code>${p.TeleUser.id}</code>)\n` : ', ')).join('');
        this.sendWithQueue(this.L('HaveJoined', names.replace(/[, ]+$/, '') + (this.ShowIDs ? '' : ' ')));
        this._joined = [];
      }

      try {
        let r = null;
        for (const s of [10, 30, 60]) {
          if (i === config.GameJoinTime - s) {
            const str = s === 60 ? this.L('MinuteLeftToJoin') : this.L('SecondsLeftToJoin', toBold(s));
            r = await this.send(str, 0, { menu: this._joinButton });
            break;
          }
        }

        if (this._secondsToAdd !== 0) {
          i = Math.max(i - this._secondsToAdd, config.GameJoinTime - config.MaxJoinTime);
          if (config.GameJoinTime > i) {
            r = await this.send(this.L(this._secondsToAdd > 0 ? 'SecondsAdded' : 'SecondsRemoved', toBold(Math.abs(this._secondsToAdd)), toBold(mmss(config.GameJoinTime - i))), 0, { menu: this._joinButton });
          }
          this._secondsToAdd = 0;
        }
        if (r) this._joinButtons.push(r.message_id);
      } catch (e) {
      }
      await sleep(1000);
    }

    tg.editMarkup(this.ChatId, this._joinMsgId, null).catch(() => {});
    this.IsJoining = false;
    this.IsInitializing = true;

    await sleep(2000);
    await this.cleanupButtons();

    if (this.Players.length < config.MinPlayers) {
      this.sendWithQueue(this.L('NotEnoughPlayers'));
      await sleep(5000);
      this.removeGame();
      return;
    }

    this.sendWithQueue(this.L('StartingGameWait'));
    this._playerListChanged = true;

    this.IsRunning = true;
    this.assignRoles();

    this._timeStarted = Date.now();
    const game = store.addGame({
      GroupName: this.ChatGroup,
      TimeStarted: this._timeStarted,
      GroupId: this.ChatId,
      Mode: this.GameMode,
      Players: this.Players.map(p => ({ id: p.Id, name: p.Name, role: p.PlayerRole, survived: true, won: false })),
      Kills: [],
      Winner: null,
      TimeEnded: null
    });
    this.GameId = game.Id;
    this.dbGame = game;

    game.Bots = this.HasBots;
    if (!this.HasBots) {
      for (const p of this.Players) {
        const dbp = store.ensurePlayer(p.Id, p.Name, p.TeleUser.username || null);
        dbp.gamesPlayed = (dbp.gamesPlayed || 0) + 1;
        dbp.groupGames[String(this.ChatId)] = (dbp.groupGames[String(this.ChatId)] || 0) + 1;
        dbp.langGames[this.Language] = (dbp.langGames[this.Language] || 0) + 1;
      }
    }
    store.takeNotify(this.ChatId);
    store.save();
    this.IsInitializing = false;

    if (this.Players.length < 20) {
      for (const p of this.Players.filter(x => x)) p.HasBeenVoted = true;
    }

    await this.notifyRoles();

    this.Time = 'Night';
    while (this.IsRunning) {
      this.GameDay++;
      if (!this.IsRunning) break;
      this.checkRoleChanges();
      this.checkLongHaul();
      await this.nightCycle();
      if (!this.IsRunning) break;
      this.checkRoleChanges();
      this.checkLongHaul();
      await this.dayCycle();
      if (!this.IsRunning) break;
      this.checkRoleChanges();
      this.checkLongHaul();
      await this.lynchCycle();
    }
  } catch (ex) {
    if (this.Players) {
      this.logException(ex);
      this.send('حدث خطأ فادح واضطررت إلى إلغاء اللعبة....\n' + ex.message.replace(/[<>&]/g, ''));
    }
  } finally {
    this.removeGame();
  }
};

W.addPlayer = async function (u) {
  try {
    if (!this.IsJoining || this.IsInitializing) return false;
    if (this.Players.some(x => x.Id === u.id)) return false;

    const p = new IPlayer(u);
    p.Name = `${u.first_name || ''} ${u.last_name || ''}`.replace(/\n/g, '').trim();
    if (p.Name.startsWith('/') || !p.Name || p.Name.trim().toLowerCase() === 'skip' || p.Name.trim().toLowerCase() === this.L('Skip').toLowerCase()) {
      this.send(this.L('ChangeNameToJoin', !u.username ? `${u.first_name || ''} ${u.last_name || ''}`.trim() : '@' + u.username), p.Id);
      return false;
    }
    if (this.Players.some(x => x.Name === p.Name)) {
      this.send(this.L('NameExists', getName(p), p.TeleUser.username), p.Id);
      return false;
    }
    if (this.Players.length >= config.MaxPlayers) {
      this.send(this.L('PlayerLimitReached'), p.Id);
      return false;
    }
    if (this.IsInitializing || !this.IsJoining) return false;
    this.Players.push(p);
    this._joined.push(p);
    const groupname = !this.DbGroup.GroupLink ? this.ChatGroup : `<a href="${this.DbGroup.GroupLink}">${this.ChatGroup.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</a>`;
    this.send(this.L('YouJoined', groupname), p.Id);

    if (!u.isBot) store.ensurePlayer(u.id, p.Name, u.username || null);

    this._playerListChanged = true;
    if (this.Players.length === (this.DbGroup.MaxPlayers || config.MaxPlayers)) this.KillTimer = true;
    return true;
  } catch (e) {
    console.error('Error in addPlayer:', e.message);
    return false;
  }
};

W.removePlayer = async function (u) {
  try {
    if (this.IsInitializing) return;
    if (!this.hasFlag('AllowFlee') && !this.IsJoining && this.IsRunning) {
      this.sendWithQueue(this.L('FleeDisabled'));
      return;
    }
    const p = this.Players.find(x => x.Id === u.id);
    if (!p) return;
    if (p.IsDead) {
      this.sendWithQueue(this.L('DeadFlee'));
      return;
    }

    this.sendWithQueue(this.L('Flee', getName(p)));
    if (this.IsRunning) {
      p.IsDead = true;
      p.TimeDied = Date.now();
      p.Fled = true;
      if (this.hasFlag('ShowRolesDeath')) this.sendWithQueue(this.L('PlayerRoleWas', getName(p), this.getDescription(p.PlayerRole)));

      this.checkRoleChanges();
      this.dbKill(p, p, 'Flee');
      await this.checkForGameEnd();
    } else if (this.IsJoining && !this.IsInitializing) {
      this.Players.splice(this.Players.indexOf(p), 1);
      this._playerListChanged = true;
      this.sendWithQueue(this.L('CountPlayersRemain', toBold(this.Players.length)));
    }
  } catch (e) {
    console.error('Error in removePlayer:', e.message);
  }
};

W.fleePlayer = async function (banid) {
  if (this.IsInitializing) {
    this.sendWithQueue('لا يمكن الهروب أثناء تجهيز اللعبة. حاول مجددًا بعد انتهاء التجهيز.');
    return;
  }
  const p = this.Players ? this.Players.find(x => x.Id === banid) : null;
  if (p) {
    if (p.IsDead) return;
    this.sendWithQueue(this.L('Flee', getName(p)));
    if (this.IsRunning) {
      await this.killPlayer(p, 'Flee', { killer: p, isNight: false, hunterFinalShot: false });
      p.Fled = true;
      if (this.hasFlag('ShowRolesDeath')) this.sendWithQueue(this.L('PlayerRoleWas', getName(p), this.getDescription(p.PlayerRole)));
      this.checkRoleChanges();
      await this.checkForGameEnd();
    } else if (this.IsJoining) {
      this._playerListChanged = true;
      this.Players.splice(this.Players.indexOf(p), 1);
    }
  }
};

W.handleReply = async function (query) {
  try {
    if (!this.IsRunning) return;

    const args = query.data.split('|');
    const player = this.Players.find(x => x.Id === query.from.id && !x.IsDead);
    const qtype = parseInt(args[2], 10);
    const choice = args[3];

    if (!player) return;

    if (qtype === QT.Mayor && player.PlayerRole === 'Mayor' && choice === 'reveal' && !player.HasUsedAbility) {
      player.HasUsedAbility = true;
      this.sendWithQueue(this.L('MayorReveal', getName(player)));
      this.replyToCallback(query, this.L('ChoiceAccepted'));
      return;
    } else if (qtype === QT.Mayor && player.PlayerRole === 'Mayor' && choice === 'reveal' && player.HasUsedAbility) return;

    if (qtype === QT.Pacifist && player.PlayerRole === 'Pacifist' && choice === 'peace' && !player.HasUsedAbility) {
      player.HasUsedAbility = true;
      this._pacifistUsed = true;
      this._doubleLynch = false;
      this.sendWithQueue(this.L('PacifistNoLynch', getName(player)));
      this.replyToCallback(query, this.L('ChoiceAccepted'));
      return;
    } else if (qtype === QT.Pacifist && player.PlayerRole === 'Pacifist' && choice === 'peace' && player.HasUsedAbility) return;

    const cq = player.CurrentQuestion;
    const valid = cq && cq.QType === qtype && cq.ValidAnswers.includes(query.data);
    if (!valid) return;

    if (qtype === QT.SpreadSilver && player.PlayerRole === 'Blacksmith') {
      if (choice === 'yes') {
        player.HasUsedAbility = true;
        this._silverSpread = true;
        this.sendWithQueue(this.L('BlacksmithSpreadSilver', getName(player)));
      }
      this.replyToCallback(query, this.L('ChoiceAccepted'));
      player.CurrentQuestion = null;
      return;
    }

    if (qtype === QT.Sandman && player.PlayerRole === 'Sandman') {
      if (choice === 'yes') {
        player.HasUsedAbility = true;
        this._sandmanSleep = true;
        this.sendWithQueue(this.L('SandmanSleepAll', getName(player)));
      }
      this.replyToCallback(query, this.L('ChoiceAccepted'));
      player.CurrentQuestion = null;
      return;
    }

    if (qtype === QT.Trouble && player.PlayerRole === 'Troublemaker' && !player.HasUsedAbility) {
      if (choice === 'yes') {
        player.HasUsedAbility = true;
        this._doubleLynch = true;
        this._pacifistUsed = false;
        this.sendWithQueue(this.L('TroublemakerDoubleLynch', getName(player)));
      }
      this.replyToCallback(query, this.L('ChoiceAccepted'));
      player.CurrentQuestion = null;
      return;
    }

    if (choice === '-1') {
      if (qtype === QT.Kill2) player.Choice2 = -1;
      else player.Choice = -1;
      this.replyToCallback(query, this.L('ChoiceAccepted') + ` - ${this.L('Skip')}`);
      player.CurrentQuestion = null;
      return;
    }

    if (qtype === QT.Kill2) player.Choice2 = Number(choice);
    else player.Choice = Number(choice);

    if (qtype === QT.Lynch && player.PlayerRole === 'ClumsyGuy') {
      if (randInt(100) < 50) {
        const clumsy = this.chooseRandomPlayerId(player, false);
        if (clumsy === player.Choice) player.ClumsyCorrectLynchCount++;
        player.Choice = clumsy;
      } else {
        player.ClumsyCorrectLynchCount++;
      }
    }

    if (choice === '-2' && qtype === QT.Douse && player.PlayerRole === 'Arsonist') {
      player.Choice = -2;
      this.replyToCallback(query, this.L('ChoiceAccepted') + ` - ${this.L('Spark')}`);
      player.CurrentQuestion = null;
      return;
    }

    const target = this.Players.find(x => qtype === QT.Kill2 ? x.Id === player.Choice2 : x.Id === player.Choice);
    if (!target) {
      this.send(this.L('NoPlayerName'), query.from.id);
      return;
    }

    if (qtype === QT.Kill2 && this.WolfRoles.includes(player.PlayerRole)) {
      for (const w of getPlayersForRoles(this.Players, this.WolfRoles, true, player)) {
        this.send(this.L('WolfVotedKill', getName(player), getName(target)), w.Id);
      }
    }

    let clearCurrent = true;
    if (qtype === QT.Kill && this.WolfRoles.includes(player.PlayerRole)) {
      for (const w of getPlayersForRoles(this.Players, this.WolfRoles, true, player)) {
        this.send(this.L('WolfVotedKill', getName(player), getName(target)), w.Id);
      }
      if (this.WolfCubKilled) {
        const targets = this.Players.filter(x => !this.WolfRoles.includes(x.PlayerRole) && x.PlayerRole !== 'SnowWolf' && !x.IsDead && x.Id !== player.Choice);
        const msg = this.L('AskEat');
        const buttons = targets.map(x => [{ text: x.Name, callback_data: this.cb(QT.Kill2, x.Id) }]);
        buttons.push([{ text: this.L('Skip'), callback_data: this.cb(QT.Kill2, -1) }]);
        await this.sendMenu(buttons, player, msg, QT.Kill2);
        clearCurrent = false;
      }
    }
    if (qtype === QT.RoleModel && player.PlayerRole === 'WildChild') {
      player.RoleModel = target.Id;
      player.Choice = -1;
    }
    if (qtype === QT.Lover1 && player.PlayerRole === 'Cupid') {
      const lover1 = this.Players.find(x => x.Id === player.Choice);
      if (lover1) {
        if (lover1.Id === player.Id) this.addAchievement(player, 'SelfLoving');
        lover1.InLove = true;
        const secondChoices = this.Players.filter(x => !x.IsDead && x.Id !== lover1.Id);
        const buttons = secondChoices.map(x => [{ text: x.Name, callback_data: this.cb(QT.Lover2, x.Id) }]);
        player.Choice = 0;
        this.replyToCallback(query, this.L('ChoiceAccepted') + ' - ' + target.Name);
        await this.sendMenu(buttons, player, this.L('AskCupid2'), QT.Lover2);
      }
      return;
    }
    if (qtype === QT.Lover2 && player.PlayerRole === 'Cupid') {
      const lover11 = this.Players.find(x => x.InLove);
      if (!lover11) return;
      lover11.LoverId = player.Choice;
      lover11.InLove = true;

      const id = lover11.Id;
      const lover2 = this.Players.find(x => x.Id === player.Choice);
      if (!lover2) return;
      if (lover2.Id === player.Id) this.addAchievement(player, 'SelfLoving');
      lover2.InLove = true;
      lover2.LoverId = id;
      player.Choice = -1;
    }

    if (player.PlayerRole === 'Doppelgänger' && qtype === QT.RoleModel) {
      player.RoleModel = target.Id;
      player.Choice = -1;
    }

    if (qtype === QT.Convert && player.PlayerRole === 'Cultist') {
      for (const w of this.Players.filter(x => !x.IsDead && x.PlayerRole === 'Cultist' && x.Id !== player.Id)) {
        this.send(this.L('CultistVotedConvert', getName(player), getName(target)), w.Id);
      }
    }

    if (qtype === QT.Lynch) {
      if (!this.hasFlag('EnableSecretLynch')) {
        this.sendWithQueue(this.L('PlayerVotedLynch', getName(player), getName(target)));
      } else {
        this.sendWithQueue(this.L('PlayerVoteCounts', this.Players.filter(x => !x.IsDead && x.Choice !== 0).length, this.Players.filter(x => !x.IsDead).length));
      }

      if (this.NoOneCastLynch) {
        player.FirstStone++;
        this.NoOneCastLynch = false;
      }

      if (player.FirstStone === 5) this.addAchievement(player, 'FirstStone');
    }
    this.replyToCallback(query, this.L('ChoiceAccepted') + ' - ' + getName(target, true));
    if (clearCurrent) player.CurrentQuestion = null;
  } catch (e) {
    console.error(`Error in handleReply: ${e.message}\n${query.from.first_name} ${query.data}`);
  }
};

W.cb = function (qtype, choice) {
  return `v|${this.Guid}|${qtype}|${choice}`;
};

W.replyToCallback = function (query, text = null, edit = true) {
  tg.answerCallback(query.id, edit ? null : text);
  if (edit && query.message) tg.edit(query.message.chat.id, query.message.message_id, text).catch(() => {});
};
