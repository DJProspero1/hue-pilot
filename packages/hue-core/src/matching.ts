/** Fuzzy name resolution used by the assistant tools ("the office lights" -> room "Office"). */

export interface Named {
  id: string;
  name: string;
}

export interface MatchResult<T extends Named> {
  match?: T;
  /** Populated when the query is ambiguous (several equally good matches). */
  candidates: T[];
  score: number;
}

const FILLER = new Set([
  'the', 'a', 'an', 'my', 'our', 'in', 'of', 'at', 'to', 'on', 'room', 'rooms', 'zone', 'light', 'lights', 'lamp', 'lamps',
  'bulb', 'bulbs', 'please', 'all', 'and', 'o', 'a', 'as', 'os', 'do', 'da', 'no', 'na', 'luz', 'luzes', 'sala', 'quarto',
]);

export function normalizeName(s: string): string {
  return String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function tokens(s: string): string[] {
  return normalizeName(s).split(' ').filter(Boolean);
}

function meaningfulTokens(s: string): string[] {
  const t = tokens(s).filter((w) => !FILLER.has(w));
  return t.length ? t : tokens(s);
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

/** Score how well `query` designates `name`. 0 = no match, 100 = exact. */
export function scoreMatch(query: string, name: string, id?: string): number {
  const q = normalizeName(query);
  const n = normalizeName(name);
  if (!q || !n) return 0;
  if (id && query.trim() === id) return 100;
  if (q === n) return 100;
  const qm = meaningfulTokens(query).join(' ');
  if (qm && qm === n) return 98;
  if (n.startsWith(qm) || n.startsWith(q)) return 85;
  if (n.includes(qm) || n.includes(q)) return 75;
  const qt = meaningfulTokens(query);
  const nt = tokens(name);
  if (qt.length && qt.every((t) => nt.includes(t))) return 70;
  const nJoined = nt.join(' ');
  if (qt.length && qt.every((t) => nJoined.includes(t))) return 62;
  const overlap = qt.filter((t) => nt.some((w) => w === t || (t.length > 3 && (w.startsWith(t) || t.startsWith(w))))).length;
  if (overlap > 0) return 40 + Math.round((overlap / Math.max(qt.length, nt.length)) * 20);
  const dist = levenshtein(qm || q, n);
  const maxLen = Math.max((qm || q).length, n.length);
  if (maxLen >= 4 && dist <= Math.max(1, Math.floor(maxLen * 0.25))) return 45;
  return 0;
}

/** Resolve a free-form query to one of the items. Returns candidates when ambiguous. */
export function resolveByName<T extends Named>(query: string, items: T[]): MatchResult<T> {
  if (!items.length) return { candidates: [], score: 0 };
  const scored = items
    .map((item) => ({ item, score: scoreMatch(query, item.name, item.id) }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || a.item.name.localeCompare(b.item.name));
  if (!scored.length) return { candidates: [], score: 0 };
  const top = scored[0].score;
  const tied = scored.filter((s) => s.score === top);
  if (tied.length === 1) return { match: tied[0].item, candidates: [tied[0].item], score: top };
  return { candidates: tied.map((s) => s.item), score: top };
}
