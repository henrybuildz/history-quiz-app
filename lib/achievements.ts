export type AchievementCategory = 'progression' | 'quiz' | 'accuracy' | 'era' | 'score' | 'secret';

export interface AchievementDef {
  id: string;
  name: string;
  description: string;
  icon: string;
  category: AchievementCategory;
  isSecret: boolean;
  rewardCoins: number;
}

// Mirrors the DB seed in 20260608_achievements_schema.sql.
// The DB is authoritative for unlock logic; this is display-only.
export const ACHIEVEMENTS: readonly AchievementDef[] = [
  // Progression
  { id: 'level_2',      name: 'Apprentice',          description: 'Reach level 2',                                     icon: '📜', category: 'progression', isSecret: false, rewardCoins: 25  },
  { id: 'level_5',      name: 'Scholar',              description: 'Reach level 5',                                     icon: '🎓', category: 'progression', isSecret: false, rewardCoins: 30  },
  { id: 'level_10',     name: 'Historian',            description: 'Reach level 10',                                    icon: '📚', category: 'progression', isSecret: false, rewardCoins: 150 },
  { id: 'level_20',     name: 'Grand Archivist',      description: 'Reach level 20',                                    icon: '🏛', category: 'progression', isSecret: false, rewardCoins: 300 },
  // Quiz count
  { id: 'quiz_1',       name: 'First Chronicle',      description: 'Complete your first quiz',                          icon: '✍️', category: 'quiz',        isSecret: false, rewardCoins: 10  },
  { id: 'quiz_10',      name: 'Diligent Student',     description: 'Complete 10 quizzes',                               icon: '🔟', category: 'quiz',        isSecret: false, rewardCoins: 50  },
  { id: 'quiz_50',      name: 'History Buff',         description: 'Complete 50 quizzes',                               icon: '📖', category: 'quiz',        isSecret: false, rewardCoins: 150 },
  { id: 'quiz_100',     name: 'Living Encyclopedia',  description: 'Complete 100 quizzes',                              icon: '📕', category: 'quiz',        isSecret: false, rewardCoins: 300 },
  // Accuracy / skill
  { id: 'perfect_1',    name: 'Flawless',             description: 'Finish a quiz without a wrong answer',              icon: '💎', category: 'accuracy',    isSecret: false, rewardCoins: 75  },
  { id: 'perfect_5',    name: 'Untouchable',          description: 'Finish 5 perfect quizzes',                          icon: '🏆', category: 'accuracy',    isSecret: false, rewardCoins: 200 },
  { id: 'streak_5',     name: 'On a Roll',            description: '5 correct answers in a row in one quiz',            icon: '🔥', category: 'accuracy',    isSecret: false, rewardCoins: 30  },
  { id: 'streak_10',    name: 'Hot Streak',           description: '10 correct answers in a row in one quiz',           icon: '⚡', category: 'accuracy',    isSecret: false, rewardCoins: 75  },
  { id: 'accuracy_90',  name: 'Sharp Mind',           description: 'Achieve 90%+ accuracy across 10+ quizzes',          icon: '🎯', category: 'accuracy',    isSecret: false, rewardCoins: 100 },
  // Score milestones
  { id: 'score_1k',     name: 'Bronze Annals',        description: 'Reach 1,000 total score',                           icon: '🥉', category: 'score',       isSecret: false, rewardCoins: 25  },
  { id: 'score_10k',    name: 'Silver Annals',        description: 'Reach 10,000 total score',                          icon: '🥈', category: 'score',       isSecret: false, rewardCoins: 75  },
  { id: 'score_50k',    name: 'Gold Annals',          description: 'Reach 50,000 total score',                          icon: '🥇', category: 'score',       isSecret: false, rewardCoins: 200 },
  { id: 'score_100k',   name: 'Legendary',            description: 'Reach 100,000 total score',                         icon: '👑', category: 'score',       isSecret: false, rewardCoins: 400 },
  // Era mastery
  { id: 'era_rome',     name: 'Roman Senator',        description: 'Complete 3 Ancient Rome quizzes',                   icon: '🏟', category: 'era',         isSecret: false, rewardCoins: 50  },
  { id: 'era_egypt',    name: "Pharaoh's Pupil",      description: 'Complete 3 Ancient Egypt quizzes',                  icon: '🔱', category: 'era',         isSecret: false, rewardCoins: 50  },
  { id: 'era_ww2',      name: 'War Correspondent',    description: 'Complete 3 World War II quizzes',                   icon: '🎖', category: 'era',         isSecret: false, rewardCoins: 50  },
  { id: 'era_10',       name: 'Global Scholar',       description: 'Play quizzes in 10 different eras',                 icon: '🌍', category: 'era',         isSecret: false, rewardCoins: 100 },
  { id: 'era_all',      name: 'Omniscient',           description: 'Play at least one quiz in every era',               icon: '🌐', category: 'era',         isSecret: false, rewardCoins: 500 },
  // Secret / hidden
  { id: 'ancients',     name: 'Voice of Antiquity',   description: 'Complete quizzes in Rome, Greece & Egypt',          icon: '🗿', category: 'secret',      isSecret: true,  rewardCoins: 100 },
  { id: 'wartime',      name: 'The Great Wars',       description: 'Complete quizzes in both World Wars',               icon: '⚔️', category: 'secret',      isSecret: true,  rewardCoins: 100 },
  { id: 'iron_will',    name: 'Last Gasp',            description: 'Finish a quiz on your final life',                  icon: '❤️', category: 'secret',      isSecret: true,  rewardCoins: 75  },
  { id: 'dawn_of_time', name: 'Dawn of Time',         description: 'Play Early Civilizations as your very first quiz',  icon: '🌅', category: 'secret',      isSecret: true,  rewardCoins: 50  },
];

export const ACHIEVEMENT_MAP = new Map(ACHIEVEMENTS.map(a => [a.id, a]));
