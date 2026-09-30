/** `body-no-mesh`: the element declares a Body representation, and ifcfast's
 * tessellation came back empty for it.
 *
 * edkjo 2026-09-28: *"we need to know about instances that present as having
 * a mesh, but they dont."* An element with no Body at all (an assembly whose
 * parts carry the geometry, a spatial element, an annotation) is not this:
 * it never presented as having a mesh. The finding is the pair "Body declared"
 * AND "nothing streamed", which is either a file whose Body builds nothing or
 * a representation ifcfast failed to tessellate. This check cannot tell the
 * two apart, and says so by being ADVISORY; `ifcos-worker.ts` asks
 * ifcopenshell, in the browser, which one it is.
 *
 * ── Where "declares a Body" comes from ────────────────────────────────────
 * No wasm accessor exposes an element's representation, so it is read from
 * the STEP bytes, the way `quantityUnits` reads the units and `spaceLongNames`
 * the LongNames. Only for the elements that streamed no mesh: a handful of
 * targeted passes over the bytes, one per level of the chain
 *
 *   IfcProduct.Representation -> IfcProductDefinitionShape.Representations
 *     -> IfcShapeRepresentation (RepresentationIdentifier = 'Body') .Items
 *     -> the item's class; IfcMappedItem followed into its mapped
 *        representation, a boolean result into its first operand
 *
 * The result rides on the graph as `body_declared` (the cache stores it; the
 * restore worker re-runs the check from it). Absent = not read (an ifczip,
 * a CLI that did not pass the bytes, a failed mesh pass), and the check is
 * then `not_applicable` with that reason, never a pass.
 *
 * ── The ifcfast issue ─────────────────────────────────────────────────────
 * Where ifcopenshell builds geometry ifcfast did not, that is an ifcfast bug.
 * `issueFacts` / `issueBody` build the prefilled issue. THE BODY CARRIES NO
 * CLIENT DATA (see `issueBody`).
 */

import type { CheckResult, Finding, IfcGraph } from "./types";
import { finding, line, literal, physicalProducts, result, share } from "./fundamentals.ts";
import { argsFrom } from "./quantities.ts";
import { splitArgs, stepText } from "./rooms.ts";

/** The vendored engine (vendor/ifcfast-wasm/PROVENANCE.md): crate version
 *  plus commit. The wasm module exposes no version accessor, so this is set
 *  by hand when `scripts/build-wasm.sh` vendors a new build. */
export const IFCFAST_VERSION = "0.5.3+6a16c16";

export const IFCFAST_REPO = "EdvardGK/ifcfast";

/** One element's Body, as the STEP declares it. */
export interface BodyDecl {
  /** RepresentationIdentifier as written ('Body'; matched case-insensitively). */
  identifier: string;
  /** RepresentationType ('Brep', 'SweptSolid', 'MappedRepresentation', ...),
   *  null for `$`. Distinct values joined with ',' when several Body
   *  representations exist. */
  type: string | null;
  /** The item class chains, distinct, sorted: `IfcFacetedBrep`,
   *  `IfcMappedItem>IfcExtrudedAreaSolid`. Empty for a Body with no items. */
  items: string[];
}

/* ── class names ────────────────────────────────────────────────────────── */

/** The STEP spelling is upper case; the signature reads the schema's. The
 *  geometric items a Body carries, IFC2X3 and IFC4. An item not listed keeps
 *  its STEP spelling rather than a guessed casing. */
const ITEM_CLASSES = [
  "IfcAdvancedBrep", "IfcAdvancedBrepWithVoids", "IfcBlock", "IfcBooleanClippingResult",
  "IfcBooleanResult", "IfcBoundingBox", "IfcBoxedHalfSpace", "IfcCsgSolid",
  "IfcExtrudedAreaSolid", "IfcExtrudedAreaSolidTapered", "IfcFaceBasedSurfaceModel",
  "IfcFacetedBrep", "IfcFacetedBrepWithVoids", "IfcFixedReferenceSweptAreaSolid",
  "IfcGeometricCurveSet", "IfcGeometricSet", "IfcHalfSpaceSolid", "IfcIndexedPolyCurve",
  "IfcMappedItem", "IfcPolygonalBoundedHalfSpace", "IfcPolygonalFaceSet", "IfcPolyline",
  "IfcRectangularPyramid", "IfcRevolvedAreaSolid", "IfcRevolvedAreaSolidTapered",
  "IfcRightCircularCone", "IfcRightCircularCylinder", "IfcSectionedSolidHorizontal",
  "IfcSectionedSpine", "IfcShellBasedSurfaceModel", "IfcSphere", "IfcSurfaceCurveSweptAreaSolid",
  "IfcSweptDiskSolid", "IfcSweptDiskSolidPolygonal", "IfcTessellatedFaceSet",
  "IfcTriangulatedFaceSet", "IfcTriangulatedIrregularNetwork", "IfcCsgPrimitive3D",
  "IfcCartesianPointList3D", "IfcTextLiteral", "IfcTextLiteralWithExtent", "IfcAnnotationFillArea",
  "IfcCompositeCurve", "IfcTrimmedCurve", "IfcCircle", "IfcLine", "IfcCartesianPoint",
];
const PRETTY = new Map(ITEM_CLASSES.map((c) => [c.toUpperCase(), c]));
const prettyClass = (step: string) => PRETTY.get(step.toUpperCase()) ?? step.toUpperCase();

/* ── the STEP reader ────────────────────────────────────────────────────── */

const STATEMENT = /#(\d+)\s*=\s*([A-Za-z0-9_]+)\s*\(/g;
/** A statement whose first argument is a quoted 22-character GlobalId. */
const ROOTED = /#(\d+)\s*=\s*([A-Za-z0-9_]+)\s*\(\s*'([0-9A-Za-z_$]{22})'/g;

interface Stmt {
  cls: string;
  args: string[];
}

/** One chunked pass over the bytes (the carry logic of `spaceLongNames`),
 *  handing every statement `pattern` matches, and `want` accepts, to `take`
 *  with its split arguments. `pattern` must end inside the argument list's
 *  opening paren or on the first argument; parsing restarts at the "(". */
function scan(
  bytes: Uint8Array,
  chunk: number,
  pattern: RegExp,
  want: (m: RegExpExecArray) => boolean,
  take: (m: RegExpExecArray, args: string[]) => void,
): void {
  const decoder = new TextDecoder("latin1");
  let carry = "";
  for (let at = 0; at < bytes.length; at += chunk) {
    const text = carry + decoder.decode(bytes.subarray(at, Math.min(bytes.length, at + chunk)));
    const last = at + chunk >= bytes.length;
    pattern.lastIndex = 0;
    let keepFrom = last ? text.length : Math.max(0, text.lastIndexOf(";") + 1);
    for (let m = pattern.exec(text); m; m = pattern.exec(text)) {
      if (!last && m.index >= keepFrom) break;
      if (!want(m)) continue;
      const open = text.indexOf("(", m.index) + 1;
      const body = argsFrom(text, open);
      if (!body) {
        if (!last) keepFrom = Math.min(keepFrom, m.index);
        break;
      }
      pattern.lastIndex = body.end;
      take(m, splitArgs(body.args));
    }
    carry = last ? "" : text.slice(keepFrom);
  }
}

const refs = (arg: string | undefined): number[] =>
  (arg?.match(/#\d+/g) ?? []).map((r) => Number(r.slice(1)));

/** Deepest chain followed through mapped items and boolean operands. */
const CHAIN_DEPTH = 6;

/**
 * The Body declaration of each element in `guids`, read from the STEP bytes.
 * `null` = the element declares no Body representation. An element not found
 * in the bytes is absent from the result.
 */
export function bodyDeclarations(
  bytes: Uint8Array,
  guids: ReadonlySet<string>,
  chunk = 8 << 20,
): Record<string, BodyDecl | null> {
  const out: Record<string, BodyDecl | null> = {};
  if (guids.size === 0) return out;

  // Pass 0: the elements themselves, found by GlobalId. IfcProduct's 7th
  // attribute is Representation in IFC2X3 and IFC4 alike, for every subtype.
  const representationOf = new Map<string, number | null>();
  scan(
    bytes,
    chunk,
    ROOTED,
    (m) => guids.has(m[3]),
    (m, args) => {
      const ref = refs(args[6]);
      representationOf.set(m[3], ref.length ? ref[0] : null);
    },
  );

  const fetched = new Map<number, Stmt>();
  const walkAll = (missing: Set<number>) => {
    const get = (id: number): Stmt | undefined => {
      const stmt = fetched.get(id);
      if (!stmt) missing.add(id);
      return stmt;
    };
    const chain = (id: number, depth: number): string | undefined => {
      const node = get(id);
      if (!node) return undefined;
      const cls = prettyClass(node.cls);
      if (depth >= CHAIN_DEPTH) return cls;
      const upper = node.cls.toUpperCase();
      if (upper === "IFCMAPPEDITEM") {
        const mapId = refs(node.args[0])[0];
        if (mapId === undefined) return cls;
        const map = get(mapId);
        if (!map) return undefined;
        const repId = refs(map.args[1])[0];
        if (repId === undefined) return cls;
        const rep = get(repId);
        if (!rep) return undefined;
        // Every item walked even after one is missing, so a round fetches
        // all of a level at once rather than one statement per pass.
        const inner: string[] = [];
        let whole = true;
        for (const item of refs(rep.args[3])) {
          const c = chain(item, depth + 1);
          if (c === undefined) whole = false;
          else inner.push(c);
        }
        if (!whole) return undefined;
        return inner.length ? `${cls}>${[...new Set(inner)].sort().join("+")}` : cls;
      }
      if (upper === "IFCBOOLEANRESULT" || upper === "IFCBOOLEANCLIPPINGRESULT") {
        const first = refs(node.args[1])[0];
        if (first === undefined) return cls;
        const c = chain(first, depth + 1);
        return c === undefined ? undefined : `${cls}>${c}`;
      }
      return cls;
    };
    const done: Record<string, BodyDecl | null> = {};
    for (const [guid, rep] of representationOf) {
      if (rep === null) {
        done[guid] = null;
        continue;
      }
      const shape = get(rep);
      if (!shape) continue;
      let decl: BodyDecl | null = null;
      const types = new Set<string>();
      const items = new Set<string>();
      let complete = true;
      for (const r of refs(shape.args[2])) {
        const sr = get(r);
        if (!sr) {
          complete = false;
          continue;
        }
        const identifier = stepText(sr.args[1]);
        if (identifier === null || identifier.toLowerCase() !== "body") continue;
        decl ??= { identifier, type: null, items: [] };
        const type = stepText(sr.args[2]);
        if (type !== null) types.add(type);
        for (const item of refs(sr.args[3])) {
          const c = chain(item, 0);
          if (c === undefined) complete = false;
          else items.add(c);
        }
      }
      if (!complete) continue;
      if (decl) {
        decl.type = types.size ? [...types].sort().join(",") : null;
        decl.items = [...items].sort();
      }
      done[guid] = decl;
    }
    return done;
  };

  for (let round = 0; round < 2 * CHAIN_DEPTH + 4; round += 1) {
    const missing = new Set<number>();
    const done = walkAll(missing);
    if (missing.size === 0) {
      Object.assign(out, done);
      return out;
    }
    const before = fetched.size;
    scan(
      bytes,
      chunk,
      STATEMENT,
      (m) => missing.has(Number(m[1])),
      (m, args) => fetched.set(Number(m[1]), { cls: m[2], args }),
    );
    if (fetched.size === before) {
      // A reference to a statement the file does not contain: take what is
      // complete, leave the rest unread (the check counts them, never guesses).
      Object.assign(out, done);
      return out;
    }
  }
  Object.assign(out, walkAll(new Set()));
  return out;
}

/* ── the check ──────────────────────────────────────────────────────────── */

/** In-scope elements with no streamed mesh: the ones `bodyDeclarations` is
 *  asked about. Openings and copy-object exclusions are out, as in
 *  `mesh-placement`. */
export function unmeshedGuids(
  graph: IfcGraph,
  boxes: ReadonlyMap<string, unknown>,
  excluded?: ReadonlySet<string>,
): Set<string> {
  return new Set(physicalProducts(graph, excluded).filter((p) => !boxes.has(p.guid)).map((p) => p.guid));
}

/** The item chains of a finding's Body, as one string: the signature's
 *  second part. */
export const itemChain = (decl: Pick<BodyDecl, "items">) => (decl.items.length ? decl.items.join(", ") : "(no items)");

/* ── the second check: ifcopenshell on what ifcfast left unmeshed ───────── */

/** What ifcopenshell said about one element, computed in the browser.
 *  `none.why`: `no-representation` (the element has none), `no-body` (it has
 *  representations, none of them Body, and create_shape raised on it),
 *  `empty` (create_shape returned a shape with no vertices). */
export type IfcosVerdict =
  | { kind: "geometry"; vertices: number; faces: number }
  | { kind: "none"; why?: "no-representation" | "no-body" | "empty" }
  | { kind: "error"; message: string };

/**
 * The second check's state for one model, as the checks read it. edkjo
 * 2026-09-30: *"i dont trust ifcfast on that yet, so just add the second
 * check"*. Every statement that an element has no geometry is ifcfast's
 * alone until ifcopenshell has looked at the same element:
 *
 *   pending      not run yet, or running: every no-mesh count is unverified
 *   unavailable  cannot run in this session (`why`: no-file, ifczip,
 *                no-mesh-pass, capped); unverified, and says why
 *   failed       ifcopenshell did not load, or did not open the file; shown
 *                as that, never as a pass
 *   done         one verdict per element ifcfast streamed no mesh for
 */
export type NomeshVerification =
  | { state: "pending" }
  | { state: "unavailable"; why: string }
  | { state: "failed"; stage: string; message: string }
  | { state: "done"; version: string; verdicts: Readonly<Record<string, IfcosVerdict>> };

export const NOMESH_PENDING: NomeshVerification = { state: "pending" };

/** `guids` (elements ifcfast streamed no mesh for) by verdict. Before
 *  `done`, every one is unverified. */
export function nomeshCounts(
  guids: Iterable<string>,
  verification: NomeshVerification = NOMESH_PENDING,
): { none: number; miss: number; errors: number; unverified: number } {
  const out = { none: 0, miss: 0, errors: 0, unverified: 0 };
  const verdicts = verification.state === "done" ? verification.verdicts : null;
  for (const guid of guids) {
    const v = verdicts?.[guid];
    if (!v) out.unverified += 1;
    else if (v.kind === "geometry") out.miss += 1;
    else if (v.kind === "none") out.none += 1;
    else out.errors += 1;
  }
  return out;
}

/** The detail-line params every no-mesh statement carries: the state, the
 *  failed stage or the reason it could not run, the ifcopenshell version. */
export function verifyParams(verification: NomeshVerification): Record<string, string> {
  if (verification.state === "done") return { verify: "done", ifcos: verification.version };
  if (verification.state === "failed") return { verify: "failed", stage: verification.stage };
  if (verification.state === "unavailable") return { verify: "unavailable", why: verification.why };
  return { verify: "pending" };
}

/** The item chain on a finding for an element that declares no Body: only
 *  an ifcfast miss (ifcopenshell built geometry anyway) is ever a finding
 *  with it. */
export const NO_BODY = "(no Body)";

/**
 * ADVISORY. `boxes` null = no geometry this session (mesh pass failed, or a
 * restore whose batches were capped); `graph.body_declared` absent = the
 * Body representations were not read. Both are `not_applicable` with the
 * reason.
 *
 * `verification` is the second check. Pending (or failed, or unavailable):
 * the findings are ifcfast's, Body declared and no mesh, and the line says
 * they are unverified. Done: the findings are every element ifcopenshell
 * built geometry for (`verdict: geometry`, an ifcfast miss, Body or not),
 * plus the Body declared ones ifcopenshell also finds nothing for or raised
 * on. Failed or unavailable with unmeshed elements and no finding is
 * `review`, never a pass: nothing confirmed ifcfast.
 */
export function checkBodyWithoutMesh(
  graph: IfcGraph,
  boxes: ReadonlyMap<string, unknown> | null,
  excluded?: ReadonlySet<string>,
  noGeometry = "no geometry: the mesh pass failed",
  verification: NomeshVerification = NOMESH_PENDING,
): CheckResult {
  const id = "body-no-mesh";
  if (boxes === null) {
    return { ...result(id, "advisory", 0, [], literal("—"), noGeometry), reason: noGeometry };
  }
  const declared = graph.body_declared;
  if (declared === undefined) {
    const why = "Body representations not read from the STEP bytes (ifczip, or not supplied)";
    return { ...result(id, "advisory", 0, [], literal("—"), why), reason: why };
  }
  const verdicts = verification.state === "done" ? verification.verdicts : null;
  const inScope = physicalProducts(graph, excluded);
  const findings: Finding[] = [];
  let meshed = 0;
  let noBody = 0;
  let unread = 0;
  let unmeshed = 0;
  let miss = 0;
  let bodyNone = 0;
  let errors = 0;
  for (const p of inScope) {
    if (boxes.has(p.guid)) {
      meshed += 1;
      continue;
    }
    unmeshed += 1;
    const v = verdicts?.[p.guid];
    const read = p.guid in declared;
    const decl = read ? declared[p.guid] : null;
    const params: Record<string, string | number> = decl
      ? { identifier: decl.identifier, type: decl.type ?? "-", items: itemChain(decl) }
      : { identifier: "-", type: "-", items: NO_BODY };
    if (v?.kind === "geometry") {
      miss += 1;
      findings.push(finding(p, "body-no-mesh", { ...params, verdict: "geometry", vertices: v.vertices, faces: v.faces }));
      continue;
    }
    if (v?.kind === "error") errors += 1;
    if (!decl) {
      // No Body (or not read): the STEP and ifcfast agree there is nothing
      // to mesh. Counted, and a finding only where ifcopenshell raised.
      if (!read) unread += 1;
      else if (v?.kind !== "error") noBody += 1;
      if (v?.kind === "error") findings.push(finding(p, "body-no-mesh", { ...params, verdict: "error" }));
      continue;
    }
    if (v?.kind === "none") bodyNone += 1;
    findings.push(finding(p, "body-no-mesh", { ...params, verdict: v ? v.kind : "unverified" }));
  }
  const applicable = meshed + findings.length;
  const checked = result(
    id,
    "advisory",
    applicable,
    findings,
    share(meshed, applicable),
    line("body-mesh", {
      bodyNoMesh: verdicts ? bodyNone : findings.length,
      meshed,
      noBody,
      unread,
      ...(verdicts ? { miss, errors } : {}),
      ...verifyParams(verification),
    }),
  );
  const tally: Record<string, number> = verdicts
    ? { meshed, body_no_mesh: bodyNone, no_body: noBody, unread, ifcfast_miss: miss, ifcopenshell_error: errors }
    : { meshed, body_no_mesh: findings.length, no_body: noBody, unread, unverified: unmeshed };
  // Nothing confirmed ifcfast's "no mesh": not a pass.
  if ((verification.state === "failed" || verification.state === "unavailable") && unmeshed > 0 && findings.length === 0) {
    const why =
      verification.state === "failed"
        ? `ifcopenshell failed (${verification.stage}): ${verification.message}`
        : `not verified with ifcopenshell: ${verification.why}`;
    return { ...checked, state: "review", applicable: Math.max(applicable, 1), reason: why, tally };
  }
  return { ...checked, tally };
}

/* ── ifcopenshell's verdict and the ifcfast issue ───────────────────────── */

/** The facts an ifcfast issue may carry, and nothing else. Built from class
 *  names and counts only; no field of this type can hold a GUID, a name, a
 *  file name or a coordinate. */
export interface IssueFacts {
  signature: string;
  elementClass: string;
  identifier: string;
  types: string[];
  itemClasses: string;
  ifcfastVersion: string;
  ifcopenshellVersion: string;
  /** ifcopenshell vertex counts over the elements where it found geometry. */
  vertices: { min: number; max: number };
  faces: { min: number; max: number };
  /** Elements in the file with this signature. */
  inFile: number;
  geometry: number;
  none: number;
  errors: number;
}

/** The only strings an issue may carry, each held to its own shape. The
 *  element class and the item chains are schema class names (the chain is
 *  built from STEP entity names, `[A-Za-z0-9_]` only). RepresentationType and
 *  RepresentationIdentifier are exporter text, so anything that is not one
 *  plain word never reaches an issue. */
const OTHER = "(other)";
const classToken = (v: unknown) => (/^Ifc[A-Za-z0-9_]{1,80}$/i.test(String(v ?? "")) ? String(v) : OTHER);
const chainToken = (v: unknown) =>
  /^(\(no items\)|\(no Body\)|[A-Za-z0-9_>+, ]{1,400})$/.test(String(v ?? "")) ? String(v) : OTHER;
const wordToken = (v: unknown) => (/^([A-Za-z0-9]{1,40}|-)$/.test(String(v ?? "")) ? String(v) : OTHER);
const versionToken = (v: unknown) => (/^[A-Za-z0-9.+_-]{1,40}$/.test(String(v ?? "")) ? String(v) : OTHER);

/** `IfcWall / IfcFacetedBrep / ifcfast 0.5.3+6a16c16`: element class + item
 *  class chain + ifcfast version. The dedup key an existing issue is found by. */
export function bodySignature(elementClass: string, items: string, version = IFCFAST_VERSION): string {
  return `${classToken(elementClass)} / ${chainToken(items)} / ifcfast ${versionToken(version)}`;
}

/** One `IssueFacts` per signature where ifcopenshell found geometry ifcfast
 *  did not. `findings` are the check's; `verdicts` ifcopenshell's by GUID. */
export function issueFacts(
  findings: readonly Finding[],
  verdicts: Readonly<Record<string, IfcosVerdict>>,
  ifcopenshellVersion: string,
): IssueFacts[] {
  const groups = new Map<string, IssueFacts>();
  for (const f of findings) {
    if (f.code !== "body-no-mesh") continue;
    const signature = bodySignature(f.entity, String(f.params?.items ?? ""));
    let g = groups.get(signature);
    if (!g) {
      g = {
        signature,
        elementClass: classToken(f.entity),
        identifier: wordToken(f.params?.identifier),
        types: [],
        itemClasses: chainToken(f.params?.items),
        ifcfastVersion: IFCFAST_VERSION,
        ifcopenshellVersion: versionToken(ifcopenshellVersion),
        vertices: { min: Infinity, max: 0 },
        faces: { min: Infinity, max: 0 },
        inFile: 0,
        geometry: 0,
        none: 0,
        errors: 0,
      };
      groups.set(signature, g);
    }
    g.inFile += 1;
    for (const part of String(f.params?.type ?? "-").split(",")) {
      const type = part === "-" ? "-" : wordToken(part);
      if (!g.types.includes(type)) g.types.push(type);
    }
    const v = verdicts[f.guid];
    if (!v) continue;
    if (v.kind === "geometry") {
      g.geometry += 1;
      g.vertices = { min: Math.min(g.vertices.min, v.vertices), max: Math.max(g.vertices.max, v.vertices) };
      g.faces = { min: Math.min(g.faces.min, v.faces), max: Math.max(g.faces.max, v.faces) };
    } else if (v.kind === "none") g.none += 1;
    else g.errors += 1;
  }
  return [...groups.values()].filter((g) => g.geometry > 0).map((g) => ({ ...g, types: g.types.sort() }));
}

/** `Body declared, no mesh: <signature>`, the title an existing issue is
 *  found by. An element that declares no Body (`NO_BODY`) says so instead. */
export function issueTitle(facts: IssueFacts): string {
  return facts.itemClasses === NO_BODY ? `No Body, no mesh: ${facts.signature}` : `Body declared, no mesh: ${facts.signature}`;
}

/**
 * The issue body. NO CLIENT DATA, by construction and by rule (edkjo
 * 2026-09-28): no file name, no project, site or building names, no property
 * values, no GUIDs, no coordinates. Only the element class, the representation
 * identifier, type and item classes, the two engine versions, the vertex and
 * face counts and how many elements in the file share the signature. It
 * reads `IssueFacts`, which has no field for anything else; the selftest in
 * `scripts/ids-cli.ts` asserts a finding's GUID and name and a file name
 * never reach it. Fields and values, no prose.
 */
export function issueBody(facts: IssueFacts): string {
  const range = (r: { min: number; max: number }) => (r.min === r.max ? `${r.min}` : `${r.min}..${r.max}`);
  const lines = [
    `check: body-no-mesh`,
    `signature: ${facts.signature}`,
    `element_class: ${facts.elementClass}`,
    `representation_identifier: ${facts.identifier}`,
    `representation_type: ${facts.types.join(", ")}`,
    `item_classes: ${facts.itemClasses}`,
    `ifcfast_version: ${facts.ifcfastVersion}`,
    `ifcopenshell_version: ${facts.ifcopenshellVersion}`,
    `ifcfast_vertices: 0`,
    `ifcopenshell_vertices: ${range(facts.vertices)}`,
    `ifcopenshell_faces: ${range(facts.faces)}`,
    `elements_with_signature: ${facts.inFile}`,
    `ifcopenshell_geometry: ${facts.geometry}`,
    `ifcopenshell_none: ${facts.none}`,
    `ifcopenshell_error: ${facts.errors}`,
  ];
  return "```text\n" + lines.join("\n") + "\n```\n";
}

/** The prefilled new-issue link. A public browser app holds no token, so the
 *  user opens it and files it. */
export function newIssueUrl(facts: IssueFacts): string {
  const title = encodeURIComponent(issueTitle(facts));
  const body = encodeURIComponent(issueBody(facts));
  return `https://github.com/${IFCFAST_REPO}/issues/new?title=${title}&body=${body}`;
}

/** The unauthenticated search for an open issue carrying the signature in
 *  its title. A hit counts only when its title contains the signature
 *  verbatim (`matchingIssue`); the search API tokenises the phrase. */
export function issueSearchUrl(signature: string): string {
  const q = `repo:${IFCFAST_REPO} is:issue is:open in:title "${signature}"`;
  return `https://api.github.com/search/issues?q=${encodeURIComponent(q)}&per_page=20`;
}

export function matchingIssue(
  signature: string,
  items: readonly { title?: string; html_url?: string; number?: number }[],
): { url: string; number: number } | null {
  const hit = items.find((i) => typeof i.title === "string" && i.title.includes(signature));
  return hit && hit.html_url && typeof hit.number === "number" ? { url: hit.html_url, number: hit.number } : null;
}
