import { Logger } from './log.ts';
import { Metrics } from './metrics.ts';

/** The one logger and the one metrics registry of a page (and of an engine worker, which has its own). */
export const log = new Logger();
export const metrics = new Metrics();
