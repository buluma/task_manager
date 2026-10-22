/* ---------- workspaces: Personal and Work ----------
   Each project is in one; the app's workspace switcher (per device) shows one at a time, or all. A project without a
   workspace, from before there were any, is Personal. The data stays one workspace (`data.ws`, ShadowNet). */
export const WORKSPACES = [
  { id: 'personal', name: 'Personal', icon: 'house' },
  { id: 'work', name: 'Work', icon: 'briefcase' },
];
export const isWorkspace = id => WORKSPACES.some(w => w.id === id);
export const workspaceOf = p => (isWorkspace(p?.workspace) ? p.workspace : 'personal');
/* `ws` is a workspace id, or 'all' (or nothing) for every project. */
export const inWorkspace = (p, ws) => !ws || ws === 'all' || workspaceOf(p) === ws;
