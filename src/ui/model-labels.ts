const stem = (fileName: string) => fileName.replace(/\.(ifc|ifczip)$/i, "");

/** Where a name may be cut: after a separator. */
const SEPARATOR = /[_\-.\s]/;

/**
 * The part of each model's name that tells the models apart: the common
 * prefix and suffix are dropped, cut back to a separator so no token is
 * split. `KNM_ARK`, `KNM_RIV`, `KNM_RIB` read `ARK`, `RIV`, `RIB`; the full
 * file name stays in the column's title. One model, or a cut that would leave
 * any name empty or two names equal, keeps the stems whole.
 */
export function shortModelLabels(fileNames: string[]): string[] {
  const stems = fileNames.map(stem);
  if (stems.length < 2) return stems;
  const first = stems[0];
  let pre = 0;
  while (pre < first.length && stems.every((s) => s[pre] === first[pre])) pre += 1;
  while (pre > 0 && !SEPARATOR.test(first[pre - 1])) pre -= 1;
  const rest = stems.map((s) => s.slice(pre));
  const head = rest[0];
  let suf = 0;
  while (
    suf < head.length &&
    rest.every((s) => s.length > suf && s[s.length - 1 - suf] === head[head.length - 1 - suf])
  )
    suf += 1;
  while (suf > 0 && !SEPARATOR.test(head[head.length - suf])) suf -= 1;
  const out = rest.map((s) => s.slice(0, s.length - suf));
  return out.every((s) => s.length > 0) && new Set(out).size === out.length ? out : stems;
}
