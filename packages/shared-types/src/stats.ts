export interface HeroSummaryStats {
  heroId: string;
  gamesPlayed: number;
  wins: number;
  winrate: number;
  avgKills: number;
  avgDeaths: number;
  avgAssists: number;
  avgKillParticipation: number;
}

export interface TalentTierStats {
  tier: 1 | 4 | 7 | 10 | 13 | 16 | 20;
  talentId: string;
  talentName: string;
  pickRate: number;
  winrate: number;
}

export interface PlayerEncounterStats {
  battletag: string;
  gamesTogether: number;
  gamesAsAlly: number;
  gamesAsOpponent: number;
  winsAsAlly: number;
  winsAsOpponent: number;
}
