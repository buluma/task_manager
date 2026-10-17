/* HTTP-facing wrappers over the shared scale rules in src/core/priorities.js. Reading never writes. */
import { ScaleError, addLevel, patchLevel, removeLevel, scaleOf } from '../src/core/priorities.js';
import { ApiError } from './tasks.js';

/* The core throws ScaleError; the server's error handler only knows ApiError. */
const api =
  fn =>
  (...args) => {
    try {
      return fn(...args);
    } catch (e) {
      throw e instanceof ScaleError ? new ApiError(e.status, e.message) : e;
    }
  };

export function listPriorities(data) {
  return scaleOf(data)
    .map(p => ({ id: p.id, name: p.name, w: p.w, tasks: data.tasks.filter(t => (t.priority || 'none') === p.id).length }))
    .sort((a, b) => b.w - a.w);
}
export const addPriority = api(addLevel);
export const patchPriority = api(patchLevel);
export const deletePriority = api(removeLevel);
