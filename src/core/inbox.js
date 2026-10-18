/* ---------- inbox tabs ---------- */
/* Mentions and assignments need a second person, so they only get a tab once the workspace has another human
   member, or when such items already exist (nothing is ever hidden that has data). Agents do not count. */
export function inboxCats(members, notifs) {
  const people = members.filter(m => !m.agent).length > 1;
  const has = type => people || notifs.some(n => n.type === type);
  return [
    ['all', 'All'],
    ['needs', 'Needs you'],
    ...(has('mention') ? [['mention', 'Mentions']] : []),
    ...(has('assign') ? [['assign', 'Assignments']] : []),
    ['comment', 'Comments'],
    ['update', 'Updates'],
  ];
}
