/* HTTP-facing wrappers over the shared label rules in src/core/labels.js, like priorities.js. Reading never writes. */
import { sameLabel } from '../src/core/constants.js';
import { LabelError, addLabel, labelList, patchLabel, removeLabel } from '../src/core/labels.js';
import { ApiError } from './tasks.js';

/* The core throws LabelError; the server's error handler only knows ApiError. */
const api =
  fn =>
  (...args) => {
    try {
      return fn(...args);
    } catch (e) {
      throw e instanceof LabelError ? new ApiError(e.status, e.message) : e;
    }
  };

export const listLabels = data => labelList(data).map(l => ({ ...l, tasks: data.tasks.filter(t => (t.labels || []).some(x => sameLabel(x, l.id))).length }));
export const createLabel = api(addLabel);
export const changeLabel = api(patchLabel);
export const deleteLabel = api(removeLabel);
