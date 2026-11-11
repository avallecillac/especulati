const trunc = (s, n = 80) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const one = (s) => s.replace(/\s+/g, ' ').trim();

export function candidateLine(c, i) {
  const orig = c.originalTitle && c.originalTitle !== c.title ? ` / ${c.originalTitle}` : '';
  const head = `${i}) ${c.title}${c.year ? ` (${c.year})` : ''} ${c.kind}${orig}`;
  return c.overview ? `${head} · ${trunc(one(c.overview))}` : head;
}

/** review.md: confident matches collapsed, uncertain ones with numbered alternatives. Answers go in decisions.json. */
export function renderReview(matches) {
  const confident = matches.filter((m) => m.status === 'confident');
  const uncertain = matches.filter((m) => m.status === 'uncertain');
  const out = [
    '# Import review',
    '',
    `${matches.length} lines: ${confident.length} confident, ${uncertain.length} to review.`,
    'Record answers in `decisions.json` as `{ "<id>": <n> }` (`0` = skip, `"m"` = manual).',
    '',
    '## To review',
    '',
  ];
  for (const m of uncertain) {
    const hints = [m.list, m.year && `year ${m.year}`, m.kind, m.hint && `hint: ${m.hint}`].filter(Boolean).join(', ');
    out.push(`### ${m.id}. ${m.title}`, '', `_${hints}_`, '');
    m.candidates.forEach((c, i) => out.push(candidateLine(c, i + 1)));
    out.push('0) skip', 'm) manual', '');
  }
  out.push('## Confident', '', '<details>', `<summary>${confident.length} matches</summary>`, '');
  for (const m of confident) out.push(`- ${m.id}. ${m.title} → ${m.chosen.title}${m.chosen.year ? ` (${m.chosen.year})` : ''} ${m.chosen.kind} #${m.chosen.tmdbId}`);
  out.push('', '</details>', '');
  return out.join('\n');
}
