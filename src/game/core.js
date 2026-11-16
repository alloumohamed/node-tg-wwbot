const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('../config');
const store = require('../store');
const tg = require('../tg');
const { forLang, languages } = require('../locale');
const bots = require('../bots');
const gifs = require('../gifs');
const { sleep, randInt, shuffle, toBold, getName, getPlayersForRoles, getPlayerForRole, byteLength } = require('../util');
const { IPlayer, QT } = require('../player');
const { WOLF_ROLES } = require('../roles');
const achievements = require('../achievements');


function randomGuid() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < 12; i++) s += chars[crypto.randomInt(0, chars.length)];
  return s;
}

class Werewolf {
  constructor({ chatId, user, chatTitle, gameMode, botUsername, onRemove }) {
    this.ChatId = chatId;
    this.ChatGroup = chatTitle || '';
    this.GameDay = 0;
    this.GameId = 0;
    this.Players = [];
    this.IsRunning = false;
    this.IsJoining = true;
    this.KillTimer = false;
    this.IsInitializing = false;
    this.MessageQueueing = true;
    this.WolfCubKilled = false;
    this.NoOneCastLynch = false;
    this.GameMode = 'Normal';
    this.Guid = randomGuid();
    this.Time = null;
    this.Language = 'Arabic';
    this.LastPlayersOutput = Date.now();
    this.HaveExtended = [];
    this.RandomMode = false;
    this.ShowRolesOnDeath = false;
    this.SecretLynch = false;
    this.ShowIDs = false;
    this.ThiefFull = false;
    this.BurningOverkill = false;
    this.SecretLynchShowVoters = false;
    this.SecretLynchShowVotes = false;
    this.ShufflePlayerList = false;
    this.ShowRolesEnd = 'Living';
    this.PossibleRoles = [];
    this.WolfRoles = WOLF_ROLES;
    this.BotUsername = botUsername;
    this.StartUser = user;
    this.RequestedMode = gameMode;
    this.onRemove = onRemove;
    this._secondsToAdd = 0;
    this._playerListChanged = true;
    this._silverSpread = false;
    this._sandmanSleep = false;
    this._pacifistUsed = false;
    this._doubleLynch = false;
    this._timeStarted = null;
    this._timePlayed = null;
    this._joined = [];
    this._joinMsgId = 0;
    this._joinButtons = [];
    this._playerListId = 0;
    this._requestPlayerListUpdate = false;
    this._messageQueue = [];
    this._longHaulReached = false;
    this._lastJoinButtonShowed = 0;
    this.lastGrave = 0;
    this.secondLastGrave = 0;
    this.kills = [];
    this.Gifs = gifs.load();
    this.L = forLang('Arabic');
    this.HasBots = false;
    this.firstLynchDone = false;
  }

  hasFlag(name) {
    return Boolean(this.DbGroup.flags[name]);
  }

  async init() {
    const u = this.StartUser;
    this.DbGroup = store.ensureGroup(this.ChatId, this.ChatGroup);
    this.Language = languages().includes(this.DbGroup.Language) ? this.DbGroup.Language : 'Arabic';
    this.L = forLang(this.Language);
    try {
      this.DbGroup.MemberCount = await tg.bot.getChatMemberCount(this.ChatId);
      store.save();
    } catch (e) {
    }

    this.ShowIDs = this.hasFlag('ShowIDs');
    this.ShufflePlayerList = this.hasFlag('ShufflePlayerList');
    this.RandomMode = this.hasFlag('RandomMode');

    const modes = ['Normal', 'Chaos'];
    const rnd = () => randInt(100);
    if (this.RandomMode) {
      this.GameMode = modes[randInt(modes.length)];
      this.ThiefFull = rnd() < 50;
      this.SecretLynch = rnd() < 50;
      this.ShowRolesOnDeath = rnd() < 50;
      this.SecretLynchShowVotes = rnd() < 50;
      this.SecretLynchShowVoters = rnd() < 50;
      this.BurningOverkill = rnd() < 1;
      const r = rnd();
      this.ShowRolesEnd = r < 33 ? 'None' : r < 67 ? 'Living' : 'All';
    } else {
      this.GameMode = this.DbGroup.Mode === 'Player' ? this.RequestedMode : (modes.find(x => x === this.DbGroup.Mode) || 'Normal');
      this.ShowRolesEnd = this.DbGroup.ShowRolesEnd;
      this.ThiefFull = this.hasFlag('ThiefFull');
      this.SecretLynch = this.hasFlag('EnableSecretLynch');
      this.ShowRolesOnDeath = this.hasFlag('ShowRolesDeath');
      this.SecretLynchShowVotes = this.hasFlag('SecretLynchShowVotes');
      this.SecretLynchShowVoters = this.hasFlag('SecretLynchShowVoters');
      this.BurningOverkill = this.hasFlag('BurningOverkill');
    }

    this._requestPMButton = { inline_keyboard: [[{ text: 'ابدأ البوت', url: `https://t.me/${this.BotUsername}` }]] };
    this._joinButton = { inline_keyboard: [[{ text: this.L('JoinButton'), url: `https://t.me/${this.BotUsername}?start=join${this.Guid}` }]] };

    const chaos = this.GameMode === 'Chaos';
    const firstMessage = this.L(chaos ? 'PlayerStartedChaosGame' : 'PlayerStartedGame', u.first_name);
    const gif = this.getRandomImage(chaos ? this.Gifs.StartChaosGame : this.Gifs.StartGame);
    let sent = null;
    if (gif) {
      try {
        sent = await tg.sendAnimation(this.ChatId, gif, firstMessage, { reply_markup: this._joinButton });
      } catch (e) {
        sent = null;
      }
    }
    if (!sent) sent = await tg.send(firstMessage, this.ChatId, { menu: this._joinButton });
    this._joinMsgId = sent.message_id;

    this.groupQueue();
    this.sendPlayerList(true);
  }

  getRandomImage(list) {
    if (!list || list.length === 0) return null;
    return list[randInt(list.length)];
  }

  getDescription(role) {
    return toBold(this.L(role));
  }

  async send(message, id = 0, opts = {}) {
    if (id === 0) id = this.ChatId;
    try {
      return await tg.send(message, id, opts);
    } catch (e) {
      return null;
    }
  }

  sendGif(text, image, id = 0) {
    if (id === 0) id = this.ChatId;
    if (image) {
      tg.sendAnimation(id, image, text).catch(() => this.send(text, id));
    } else {
      this.send(text, id);
    }
  }

  sendWithQueue(text, gif = null, requestPM = false) {
    this._messageQueue.push({ Msg: text, GifId: gif, RequestPM: requestPM, PlayerList: false, Joining: false });
  }

  async groupQueue() {
    try {
      while (this.MessageQueueing) {
        if (this._requestPlayerListUpdate) {
          this.sendPlayerList(true);
          this._requestPlayerListUpdate = false;
        }
        let final = '';
        let requestPM = false;
        let byteMax = false;
        let pList = false;
        let i = 0;
        while (this._messageQueue.length > 0 && !byteMax) {
          i++;
          const m = this._messageQueue[0];
          if (m.Joining) {
            this._messageQueue.shift();
            if (this._playerListId === 0) {
              const r = await this.send(m.Msg);
              if (r) this._playerListId = r.message_id;
            } else {
              tg.edit(this.ChatId, this._playerListId, m.Msg, null, true).catch(() => {});
            }
            continue;
          }
          if (m.GifId) {
            if (final) this.send(final);
            await sleep(1000);
            this._messageQueue.shift();
            this.sendGif(m.Msg, m.GifId);
            await sleep(1000);
            final = '';
          } else {
            const temp = final + m.Msg + '\n\n';
            if (byteLength(temp) > 512 && i > 1) {
              byteMax = true;
            } else {
              this._messageQueue.shift();
              final += m.Msg + '\n\n';
              if (m.RequestPM) requestPM = true;
              if (m.PlayerList) pList = true;
            }
          }
        }
        if (final) {
          if (requestPM) {
            this.send(final, 0, { menu: this._requestPMButton });
          } else if (pList) {
            const r = await this.send(final);
            this._playerListId = r ? r.message_id : 0;
          } else {
            this.send(final, 0, { notify: true, preview: true });
          }
        }
        await sleep(4000);
      }
      let final = '';
      while (this._messageQueue.length > 0) {
        const m = this._messageQueue.shift();
        if (!m) continue;
        if (m.GifId) {
          if (final) this.send(final);
          await sleep(500);
          this.sendGif(m.Msg, m.GifId);
          await sleep(500);
          final = '';
        } else {
          final += m.Msg + '\n';
        }
      }
      if (final) this.send(final, 0, { preview: true });
    } catch (e) {
      this.logException(e);
    }
  }

  sendPlayerList(joining = false) {
    if (!this._playerListChanged && (!this.ShufflePlayerList || joining)) return;
    if (!this.Players) return;
    try {
      const players = this.Players.slice();
      let msg = '';
      if (joining) {
        msg = `#players: ${players.length}\n` + players.map(p => `${getName(p)}\n`).join('');
      } else {
        this.LastPlayersOutput = Date.now();
        msg = `${this.L('PlayersAlive')}: ${players.filter(x => !x.IsDead).length}/${players.length}\n`;
        const showRoles = this.hasFlag('ShowRolesDeath');
        const deadLine = p => `${getName(p, false, true)}: ` + (p.Fled ? this.L('RanAway') : this.L('Dead')) + (showRoles ? ' - ' + this.getDescription(p.PlayerRole) + (p.InLove ? '❤️' : '') : '') + '\n';
        if (this.ShufflePlayerList) {
          msg += players.filter(x => x.IsDead).sort((a, b) => a.TimeDied - b.TimeDied).map(deadLine).join('');
          msg += shuffle(players.filter(x => !x.IsDead)).map(p => `${getName(p)}: ${this.L('Alive')}\n`).join('');
        } else {
          msg += players.slice().sort((a, b) => a.TimeDied - b.TimeDied).map(p => p.IsDead ? deadLine(p) : `${getName(p)}: ${this.L('Alive')}\n`).join('');
        }
      }
      this._playerListChanged = false;
      this._messageQueue.push({ Msg: msg, GifId: null, RequestPM: false, PlayerList: true, Joining: joining });
    } catch (e) {
      this.logException(e);
    }
  }

  outputPlayers() {
    if (!(Date.now() - this.LastPlayersOutput > 10000)) return;
    this.LastPlayersOutput = Date.now();
    this.send(this.L(this._playerListId !== 0 ? 'LatestList' : 'UnableToGetList'), 0, { replyTo: this._playerListId || null });
  }

  async showJoinButton() {
    if (!this.IsJoining) return;
    if (!(Date.now() - this._lastJoinButtonShowed > 15000)) return;
    this._lastJoinButtonShowed = Date.now();
    const r = await this.send(this.L('JoinByButton'), 0, { menu: this._joinButton });
    if (r) this._joinButtons.push(r.message_id);
  }

  async cleanupButtons() {
    for (const id of this._joinButtons) {
      tg.remove(this.ChatId, id).catch(() => {});
      await sleep(500);
    }
  }

  forceStart() {
    this.KillTimer = true;
  }

  extendTime(id, admin, seconds) {
    if (!this.IsJoining) return;
    const p = this.Players.find(x => x.TeleUser.id === id);
    if (p) {
      if (this.HaveExtended.includes(p.TeleUser.id) && !admin) {
        this.sendWithQueue(this.L('CantExtend'));
        return;
      }
      this._secondsToAdd = seconds;
      this.HaveExtended.push(p.TeleUser.id);
    }
  }

  skipVote() {
    for (const p of this.Players.filter(x => x.Choice === 0)) p.Choice = -1;
  }

  logException(e) {
    console.error(e);
    if (config.errorChatId) {
      tg.send(`Group: ${this.ChatId} (${this.ChatGroup})\n${e.message}\n${e.stack}`.replace(/[<>&]/g, ''), config.errorChatId).catch(() => {});
    }
  }

  dispose() {
    this.Players = null;
    this.MessageQueueing = false;
  }

  kill() {
    try {
      if (this.IsJoining && this._joinMsgId) tg.editMarkup(this.ChatId, this._joinMsgId, null).catch(() => {});
    } catch (e) {
    }
    this.send('تمت إزالة اللعبة');
    this.removeGame();
  }

  removeGame() {
    if (this.onRemove) this.onRemove(this);
    this.dispose();
  }

  async addBot(owner) {
    if (!this.IsJoining || this.IsInitializing) return null;
    const bot = bots.create(owner, this);
    const user = { id: bot.id, first_name: bot.name, last_name: '', username: null, isBot: true };
    this.HasBots = true;
    const ok = await this.addPlayer(user);
    if (!ok) {
      bots.remove(bot.id);
      return null;
    }
    return bot;
  }

  async removeBot(bot) {
    if (!this.IsJoining || this.IsInitializing || !this.Players) return;
    const p = this.Players.find(x => x.Id === bot.id);
    if (p) this.Players.splice(this.Players.indexOf(p), 1);
    bots.remove(bot.id);
    this._playerListChanged = true;
    if (!this.Players.some(x => x.TeleUser.isBot)) this.HasBots = false;
  }

  addAchievement(player, key) {
    if (!player || player.TeleUser.isBot || this.HasBots) return;
    const a = achievements.unlock(player.Id, key);
    if (a) this.send(`🏆 إنجاز جديد!\n${achievements.describe(a)}`, player.Id);
  }

  chooseRandomPlayerId(exclude, all = true) {
    try {
      let possible = this.Players.filter(x => x.Id !== (exclude ? exclude.Id : undefined));
      if (!all) possible = possible.filter(x => !x.IsDead);
      shuffle(possible);
      shuffle(possible);
      return possible[0].Id;
    } catch (e) {
      console.error(e.message);
      return -1;
    }
  }
}

module.exports = { Werewolf };
