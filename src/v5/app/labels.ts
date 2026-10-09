import type { Status } from '../store/types.ts';
import type { IconName } from './ui.tsx';

export type Kind = 'distribution' | 'collection';

/** What each status is called and, where the name alone is not clear, what it means. One place, so every screen says the same. */
export const LABELS: Record<Kind, Record<Status, string>> = {
  distribution: { open: 'Offen', completed: 'Ausgeteilt', later: 'Später', 'not-deliverable': 'Nicht möglich' },
  collection: { open: 'Offen', completed: 'Abgeholt', later: 'Später', 'not-deliverable': 'Nicht möglich' },
};
export const HINTS: Record<Kind, Record<Status, string>> = {
  distribution: {
    open: 'Noch nicht bearbeitet.',
    completed: 'Flyer sind eingeworfen.',
    later: 'Wird später noch einmal angegangen.',
    'not-deliverable': 'Nicht möglich, z. B. kein Zugang oder Briefkasten nicht erreichbar.',
  },
  collection: {
    open: 'Noch nicht bearbeitet.',
    completed: 'Ist abgeholt.',
    later: 'Wird später abgeholt.',
    'not-deliverable': 'Nicht möglich, z. B. nichts bereitgestellt oder kein Zugang.',
  },
};
export const ORDER: Status[] = ['completed', 'later', 'not-deliverable', 'open'];
export const STATUS_ICON: Record<Status, IconName> = { completed: 'check', later: 'later', 'not-deliverable': 'blocked', open: 'open' };
