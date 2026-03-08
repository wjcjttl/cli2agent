import { ProcessPool } from './process-pool.js';
import { config } from '../config.js';

/** Single shared process pool for all route handlers */
export const pool = new ProcessPool(config.maxConcurrent, config.queueTimeout);
