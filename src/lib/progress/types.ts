/** Local, single-user profile and reading progress. Persisted as data/profile.json via /api/profile. */

export type Theme = "light" | "dark";

export interface ProblemProgress {
  /** Stage indexes 0–6 that count as read */
  completedStages: number[];
  /** Exactly where the reader was last */
  position: {
    stage: number;
    /** StageEvolve's step (0 = v1 … evolution.length) */
    evolveStep?: number;
    /** StageFlows' selected flow */
    flowId?: string;
  };
  /** Furthest evolution step reached */
  evolveMaxStep: number;
  /** Flow ids opened */
  flowsViewed: string[];
  /** Free-text note ('' if none) */
  note: string;
  firstVisited: string;
  lastVisited: string;
  /** Quiz history (optional so older profiles and backups stay valid) */
  quiz?: QuizProgress;
}

export type QuizLevel = "core" | "interviewer";

export interface QuizAttempt {
  at: string;
  level: QuizLevel;
  /** Question ids asked, in order */
  ids: string[];
  /** The subset answered correctly */
  correct: string[];
}

export interface QuizProgress {
  /** Most recent last; capped */
  attempts: QuizAttempt[];
  /** Every question id ever asked */
  seen: string[];
  /** Ids whose latest answer was wrong (they come back first) */
  wrong: string[];
}

export type Position = ProblemProgress["position"];

export interface Profile {
  name: string;
  role?: string;
  /** YYYY-MM-DD */
  interviewDate?: string;
  theme: Theme;
  createdAt: string;
}

export interface ProfileFile {
  version: 1;
  profile: Profile;
  /** YYYY-MM-DD local days with any activity (last ~60), for the streak */
  activityDays: string[];
  problems: Record<string, ProblemProgress>;
}
