/* Agents: automated writers (scripts, assistants) registered as workspace members with `agent: true`, so what
   they do shows up in comments and activity under their own name instead of the owner's. Attribution only: the
   API still has one shared token. */
import { bad } from './tasks.js';

const MAX_NAME = 60;
const GRAY = '#8a867e';

export const listAgents = data => data.members.filter(m => m.agent);

/* The agent a request names, by id or case-insensitive name. Humans are refused: the header must never let a
   client write as someone else. */
export function findAgent(data, ref) {
  const r = String(ref).trim().toLowerCase();
  const a = listAgents(data).find(a => a.id.toLowerCase() === r || a.name.toLowerCase() === r);
  if (!a) throw bad(`unknown agent ${ref}: register it first (POST /api/agents, gr8r agent add NAME)`);
  return a;
}

export function addAgent(data, input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw bad('body must be a JSON object');
  for (const k of Object.keys(input)) if (k !== 'name') throw bad(`unknown field: ${k}`);
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (!name) throw bad('name is required');
  if (name.length > MAX_NAME) throw bad(`name is over ${MAX_NAME} characters`);
  const id =
    'agent-' +
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
  if (id === 'agent-') throw bad('name needs letters or digits');
  if (data.members.some(m => m.id.toLowerCase() === id || m.name.toLowerCase() === name.toLowerCase())) throw bad(`a member named ${name} already exists`);
  const agent = { id, name, email: '', role: 'Agent', team: '', title: 'Agent', c: GRAY, status: 'active', last: 0, tz: '', agent: true };
  data.members.push(agent);
  return agent;
}
