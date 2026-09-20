/**
 * Missoes diarias e streak de login: o motivo para abrir o jogo todo dia,
 * sem prender ninguem por uma barra de energia.
 */
import type { QuestProgress, SaveData } from '../save/schema.js';

export interface QuestDefinition {
  id: string;
  label: string;
  goal: number;
  reward: { money?: number; items?: { id: string; count: number }[]; trainerXp?: number };
}

export const DAILY_QUESTS: QuestDefinition[] = [
  {
    id: 'catch3',
    label: 'Capture 3 Pokemon',
    goal: 3,
    reward: { money: 900, items: [{ id: 'pokeball', count: 5 }], trainerXp: 120 },
  },
  {
    id: 'win5',
    label: 'Vença 5 batalhas',
    goal: 5,
    reward: { money: 1200, items: [{ id: 'potion', count: 3 }], trainerXp: 160 },
  },
  {
    id: 'walk300',
    label: 'Caminhe 300 passos',
    goal: 300,
    reward: { money: 600, items: [{ id: 'greatball', count: 2 }], trainerXp: 90 },
  },
  {
    id: 'expedition1',
    label: 'Complete 1 expedicao',
    goal: 1,
    reward: { money: 1000, items: [{ id: 'superpotion', count: 2 }], trainerXp: 140 },
  },
];

export type QuestEvent = 'catch' | 'win' | 'step' | 'expedition';

const EVENT_TO_QUEST: Record<QuestEvent, string> = {
  catch: 'catch3',
  win: 'win5',
  step: 'walk300',
  expedition: 'expedition1',
};

export function todayKey(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

/** Zera as missoes quando o dia vira e atualiza o streak de login. */
export function rolloverDaily(save: SaveData): { newDay: boolean; streak: number } {
  const today = todayKey();
  if (save.dailies.lastLoginDay === today) {
    return { newDay: false, streak: save.dailies.streak };
  }

  const yesterday = todayKey(new Date(Date.now() - 86_400_000));
  const streak = save.dailies.lastLoginDay === yesterday ? save.dailies.streak + 1 : 1;

  save.dailies = { lastLoginDay: today, streak };
  save.quests = Object.fromEntries(
    DAILY_QUESTS.map((quest) => [
      quest.id,
      { id: quest.id, progress: 0, goal: quest.goal, claimed: false } satisfies QuestProgress,
    ]),
  );
  return { newDay: true, streak };
}

export function advanceQuest(save: SaveData, event: QuestEvent, amount = 1): void {
  const id = EVENT_TO_QUEST[event];
  const quest = save.quests[id];
  if (!quest || quest.claimed) return;
  const definition = DAILY_QUESTS.find((q) => q.id === id);
  if (!definition) return;
  save.quests = {
    ...save.quests,
    [id]: { ...quest, progress: Math.min(definition.goal, quest.progress + amount) },
  };
}

export function isComplete(quest: QuestProgress): boolean {
  return quest.progress >= quest.goal && !quest.claimed;
}

/** Recompensa do streak: cresce ate o setimo dia e estabiliza. */
export function streakReward(streak: number): { money: number; items: { id: string; count: number }[] } {
  const day = Math.min(7, Math.max(1, streak));
  return {
    money: 300 * day,
    items:
      day >= 7
        ? [{ id: 'ultraball', count: 2 }]
        : day >= 4
          ? [{ id: 'greatball', count: 3 }]
          : [{ id: 'pokeball', count: 3 }],
  };
}
