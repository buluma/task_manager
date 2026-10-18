/* ---------- teams ----------
   Shared by the app (actions/teams.js) and the server (server/people.js). A member belongs to at most one team
   (member.team), and so does a project (project.team); '' means none. Callers check names and colours first. */
import { TEAMS_SEED } from './constants.js';

/* The workspace's teams, seeded with the defaults on first use (a workspace saved before teams existed has none). */
export function teamsOf(data) {
  if (!data.teams) data.teams = TEAMS_SEED.map(t => ({ ...t }));
  return data.teams;
}

export function addTeam(data, { name, desc, icon, c }, newId) {
  const t = { id: newId('tm'), name, desc: desc || 'No description yet.', icon, c };
  teamsOf(data).push(t);
  return t;
}

/* Makes `ids` the team's members: they join it (leaving any other team) and anyone else in it leaves. */
export function setTeamMembers(data, t, ids) {
  for (const m of data.members) {
    if (ids.includes(m.id)) m.team = t.id;
    else if (m.team === t.id) m.team = '';
  }
}

/* The team goes; its members and projects are kept, with no team. */
export function removeTeam(data, t) {
  data.teams = teamsOf(data).filter(x => x !== t);
  for (const m of data.members) if (m.team === t.id) m.team = '';
  for (const p of data.projects) if (p.team === t.id) p.team = '';
}
