class IPlayer {
  constructor(teleUser) {
    this.TeleUser = teleUser;
    this.Id = teleUser.id;
    this.PlayerRole = 'Villager';
    this.HasUsedAbility = false;
    this.Choice = 0;
    this.Choice2 = 0;
    this.IsDead = false;
    this.NonVote = 0;
    this.DiedLastNight = false;
    this.KilledLastNight = 0;
    this.Votes = 0;
    this.VotedBy = new Map();
    this.Bullet = 2;
    this.Drunk = false;
    this.HasPM = false;
    this.Fled = false;
    this.Team = 'Village';
    this.DayCult = 0;
    this.RoleModel = 0;
    this.KilledByRole = null;
    this.DiedByVisitingKiller = false;
    this.DiedByVisitingVictim = false;
    this.DiedByFleeOrIdle = false;
    this.WasSavedLastNight = false;
    this.ChemistFailed = false;
    this.Frozen = false;
    this.DugGravesLastNight = 0;
    this.StumbledGrave = 0;
    this.MessageId = 0;
    this.Name = '';
    this.InLove = false;
    this.LoverId = 0;
    this.Doused = false;
    this.Burning = false;
    this.TimeDied = Number.MAX_SAFE_INTEGER;
    this.SawRoles = [];
    this.IsActionTracked = false;
    this.BarVisits = 0;
    this.Won = false;
    this.CurrentQuestion = null;
    this.SurvivedDB = true;
    this.HasBeenVoted = false;
    this.HasStayedHome = false;
    this.HasRepeatedVisit = false;
    this.PlayersVisited = new Set();
    this.ChangedRolesCount = 0;
    this.FirstToLynchCount = 0;
    this.BulletHitBaddies = 0;
    this.FoolCorrectSeeCount = 0;
    this.SerialKilledWolvesCount = 0;
    this.Bitten = false;
    this.CorrectSnooped = [];
    this.SpeedDating = false;
    this.FirstStone = 0;
    this.CHHuntedCultCount = 0;
    this.ClumsyCorrectLynchCount = 0;
    this.AlphaConvertCount = 0;
    this.GAGuardWolfCount = 0;
    this.MayorLynchAfterRevealCount = 0;
    this.VisitingSameNightCount = 0;
    this.BeingVisitedSameNightCount = 0;
    this.ChemistVisitSurviveCount = 0;
    this.BusyNight = false;
    this.StrongestAlpha = false;
    this.FoolCorrectlySeenBH = false;
    this.Trustworthy = false;
    this.CultLeader = false;
    this.ConvertedToCult = false;
    this.FrozeHarlot = false;
    this.HasCleanedDoused = 0;
    this.HasShotHunterAttacker = 0;
    this.HasShotHunterAttackerThisNight = false;
    this.HasSeenImpossible = false;
    this.InMiddleOfTrouble = false;
    this.JustPromotedFromTraitor = false;
    this.ConsecutiveNoBarVisitors = 0;
    this.FoodWastedOnPlayers = new Set();
    this.LoverMsg = null;
    this.SKKills = 0;
    this.GASaves = 0;
    this.LynchedFirst = false;
    this.FinalShotDelay = null;
  }
}

const QT = {
  Lynch: 0, Kill: 1, Visit: 2, See: 3, Shoot: 4, Guard: 5, Detect: 6, Convert: 7, RoleModel: 8, Hunt: 9,
  HunterKill: 10, SerialKill: 11, Lover1: 12, Lover2: 13, Mayor: 14, SpreadSilver: 15, Kill2: 16, Sandman: 17,
  Pacifist: 18, Thief: 19, Trouble: 20, Chemistry: 21, Freeze: 22, Douse: 23, ScatterRice: 24
};

module.exports = { IPlayer, QT };
