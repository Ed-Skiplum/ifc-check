#!/usr/bin/env node
/**
 * ifcfast-miss relay: files an ifcfast issue when ifc-check's second check
 * (ifcopenshell, in the browser) built geometry for an element ifcfast
 * streamed no mesh for. Node, no dependencies, one file.
 *
 *   POST /ifcfast-miss   the sanitized report (`IssueFacts` in
 *                        src/engine/body-mesh.ts), JSON, at most 4 KB
 *   GET  /health         200 "ok"
 *
 * The browser app holds no token. This service does (`IFCFAST_ISSUES_TOKEN`,
 * a fine-grained token scoped to EdvardGK/ifcfast issues) and never logs it.
 *
 * What it accepts is validated here, on the server, field by field against
 * fixed shapes and schema enums (`validate`): the element class must be an
 * IfcProduct subtype, every item in the chain an IfcRepresentationItem
 * subtype, the representation types IFC's own values, the versions version
 * strings, the rest integers. There is no field that can hold a file name,
 * a GUID, a name, a coordinate or free text, and an unknown key is refused.
 * The title and body are built here from the validated fields, never taken
 * from the client.
 *
 * Dedupe by signature (element class + item chain + ifcfast version): an
 * open issue whose title carries the signature verbatim gets a comment with
 * the report count incremented, or nothing when its last activity is under
 * 24 h old; otherwise a new issue. Rate limits: 10 an hour per client IP,
 * 50 a day overall. CORS: only the ifc-check origins.
 *
 * Env: IFCFAST_ISSUES_TOKEN (required), PORT (8791), RELAY_ALLOWED_ORIGINS
 * (comma separated, replaces the default list), TRUST_PROXY=1 (take the
 * client IP from X-Forwarded-For, set behind Caddy), GITHUB_API (tests only:
 * a mock GitHub).
 */

import http from "node:http";
import { pathToFileURL } from "node:url";

export const REPO = "EdvardGK/ifcfast";
export const DEFAULT_ORIGINS = ["https://ifc-check.skiplum.com", "https://skiplum.com", "https://www.skiplum.com"];
export const MAX_BODY = 4096;
const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

/* ── the schema enums (IFC2X3, IFC4, IFC4X3_ADD2; generated with ifcopenshell 0.8.5) ── */

/** Instantiable IfcProduct subtypes. */
const PRODUCTS = new Set("IfcActuator IfcAirTerminal IfcAirTerminalBox IfcAirToAirHeatRecovery IfcAlarm IfcAlignment IfcAlignmentCant IfcAlignmentHorizontal IfcAlignmentSegment IfcAlignmentVertical IfcAnnotation IfcAudioVisualAppliance IfcBeam IfcBeamStandardCase IfcBearing IfcBoiler IfcBorehole IfcBridge IfcBridgePart IfcBuilding IfcBuildingElementPart IfcBuildingElementProxy IfcBuildingStorey IfcBuiltElement IfcBurner IfcCableCarrierFitting IfcCableCarrierSegment IfcCableFitting IfcCableSegment IfcCaissonFoundation IfcChamferEdgeFeature IfcChiller IfcChimney IfcCivilElement IfcCoil IfcColumn IfcColumnStandardCase IfcCommunicationsAppliance IfcCompressor IfcCondenser IfcController IfcConveyorSegment IfcCooledBeam IfcCoolingTower IfcCourse IfcCovering IfcCurtainWall IfcDamper IfcDeepFoundation IfcDiscreteAccessory IfcDistributionBoard IfcDistributionChamberElement IfcDistributionControlElement IfcDistributionElement IfcDistributionFlowElement IfcDistributionPort IfcDoor IfcDoorStandardCase IfcDuctFitting IfcDuctSegment IfcDuctSilencer IfcEarthworksCut IfcEarthworksElement IfcEarthworksFill IfcElectricAppliance IfcElectricDistributionBoard IfcElectricDistributionPoint IfcElectricFlowStorageDevice IfcElectricFlowTreatmentDevice IfcElectricGenerator IfcElectricMotor IfcElectricTimeControl IfcElectricalElement IfcElementAssembly IfcEnergyConversionDevice IfcEngine IfcEquipmentElement IfcEvaporativeCooler IfcEvaporator IfcExternalSpatialElement IfcFacility IfcFacilityPartCommon IfcFan IfcFastener IfcFilter IfcFireSuppressionTerminal IfcFlowController IfcFlowFitting IfcFlowInstrument IfcFlowMeter IfcFlowMovingDevice IfcFlowSegment IfcFlowStorageDevice IfcFlowTerminal IfcFlowTreatmentDevice IfcFooting IfcFurnishingElement IfcFurniture IfcGeographicElement IfcGeomodel IfcGeoslice IfcGeotechnicalStratum IfcGrid IfcHeatExchanger IfcHumidifier IfcImpactProtectionDevice IfcInterceptor IfcJunctionBox IfcKerb IfcLamp IfcLightFixture IfcLinearElement IfcLinearPositioningElement IfcLiquidTerminal IfcMarineFacility IfcMarinePart IfcMechanicalFastener IfcMedicalDevice IfcMember IfcMemberStandardCase IfcMobileTelecommunicationsAppliance IfcMooringDevice IfcMotorConnection IfcNavigationElement IfcOpeningElement IfcOpeningStandardCase IfcOutlet IfcPavement IfcPile IfcPipeFitting IfcPipeSegment IfcPlate IfcPlateStandardCase IfcProjectionElement IfcProtectiveDevice IfcProtectiveDeviceTrippingUnit IfcProxy IfcPump IfcRail IfcRailing IfcRailway IfcRailwayPart IfcRamp IfcRampFlight IfcReferent IfcReinforcedSoil IfcReinforcingBar IfcReinforcingMesh IfcRoad IfcRoadPart IfcRoof IfcRoundedEdgeFeature IfcSanitaryTerminal IfcSensor IfcShadingDevice IfcSign IfcSignal IfcSite IfcSlab IfcSlabElementedCase IfcSlabStandardCase IfcSolarDevice IfcSpace IfcSpaceHeater IfcSpatialZone IfcStackTerminal IfcStair IfcStairFlight IfcStructuralCurveAction IfcStructuralCurveConnection IfcStructuralCurveMember IfcStructuralCurveMemberVarying IfcStructuralCurveReaction IfcStructuralLinearAction IfcStructuralLinearActionVarying IfcStructuralPlanarAction IfcStructuralPlanarActionVarying IfcStructuralPointAction IfcStructuralPointConnection IfcStructuralPointReaction IfcStructuralSurfaceAction IfcStructuralSurfaceConnection IfcStructuralSurfaceMember IfcStructuralSurfaceMemberVarying IfcStructuralSurfaceReaction IfcSurfaceFeature IfcSwitchingDevice IfcSystemFurnitureElement IfcTank IfcTendon IfcTendonAnchor IfcTendonConduit IfcTrackElement IfcTransformer IfcTransportElement IfcTubeBundle IfcUnitaryControlElement IfcUnitaryEquipment IfcValve IfcVehicle IfcVibrationDamper IfcVibrationIsolator IfcVirtualElement IfcVoidingFeature IfcWall IfcWallElementedCase IfcWallStandardCase IfcWasteTerminal IfcWindow IfcWindowStandardCase".split(" ").map((c) => c.toUpperCase()));
/** Instantiable IfcRepresentationItem subtypes. */
const ITEMS = new Set("Ifc2DCompositeCurve IfcAdvancedBrep IfcAdvancedBrepWithVoids IfcAdvancedFace IfcAngularDimension IfcAnnotationCurveOccurrence IfcAnnotationFillArea IfcAnnotationFillAreaOccurrence IfcAnnotationSurface IfcAnnotationSurfaceOccurrence IfcAnnotationSymbolOccurrence IfcAnnotationTextOccurrence IfcAxis1Placement IfcAxis2Placement2D IfcAxis2Placement3D IfcAxis2PlacementLinear IfcBSplineCurveWithKnots IfcBSplineSurfaceWithKnots IfcBezierCurve IfcBlock IfcBooleanClippingResult IfcBooleanResult IfcBoundaryCurve IfcBoundedSurface IfcBoundingBox IfcBoxedHalfSpace IfcCartesianPoint IfcCartesianPointList2D IfcCartesianPointList3D IfcCartesianTransformationOperator2D IfcCartesianTransformationOperator2DnonUniform IfcCartesianTransformationOperator3D IfcCartesianTransformationOperator3DnonUniform IfcCircle IfcClosedShell IfcClothoid IfcCompositeCurve IfcCompositeCurveOnSurface IfcCompositeCurveSegment IfcConnectedFaceSet IfcCosineSpiral IfcCsgSolid IfcCurveBoundedPlane IfcCurveBoundedSurface IfcCurveSegment IfcCylindricalSurface IfcDefinedSymbol IfcDiameterDimension IfcDimensionCurve IfcDimensionCurveDirectedCallout IfcDimensionCurveTerminator IfcDirection IfcDirectrixDerivedReferenceSweptAreaSolid IfcDraughtingCallout IfcEdge IfcEdgeCurve IfcEdgeLoop IfcEllipse IfcExtrudedAreaSolid IfcExtrudedAreaSolidTapered IfcFace IfcFaceBasedSurfaceModel IfcFaceBound IfcFaceOuterBound IfcFaceSurface IfcFacetedBrep IfcFacetedBrepWithVoids IfcFillAreaStyleHatching IfcFillAreaStyleTileSymbolWithStyle IfcFillAreaStyleTiles IfcFixedReferenceSweptAreaSolid IfcGeometricCurveSet IfcGeometricSet IfcGradientCurve IfcHalfSpaceSolid IfcIndexedPolyCurve IfcIndexedPolygonalFace IfcIndexedPolygonalFaceWithVoids IfcIntersectionCurve IfcLightSourceAmbient IfcLightSourceDirectional IfcLightSourceGoniometric IfcLightSourcePositional IfcLightSourceSpot IfcLine IfcLinearDimension IfcLoop IfcMappedItem IfcOffsetCurve2D IfcOffsetCurve3D IfcOffsetCurveByDistances IfcOneDirectionRepeatFactor IfcOpenShell IfcOrientedEdge IfcOuterBoundaryCurve IfcPath IfcPcurve IfcPlanarBox IfcPlanarExtent IfcPlane IfcPointByDistanceExpression IfcPointOnCurve IfcPointOnSurface IfcPolyLoop IfcPolygonalBoundedHalfSpace IfcPolygonalFaceSet IfcPolyline IfcPolynomialCurve IfcProjectionCurve IfcRadiusDimension IfcRationalBSplineCurveWithKnots IfcRationalBSplineSurfaceWithKnots IfcRationalBezierCurve IfcRectangularPyramid IfcRectangularTrimmedSurface IfcReparametrisedCompositeCurveSegment IfcRevolvedAreaSolid IfcRevolvedAreaSolidTapered IfcRightCircularCone IfcRightCircularCylinder IfcSeamCurve IfcSecondOrderPolynomialSpiral IfcSectionedSolidHorizontal IfcSectionedSpine IfcSectionedSurface IfcSegmentedReferenceCurve IfcSeventhOrderPolynomialSpiral IfcShellBasedSurfaceModel IfcSineSpiral IfcSphere IfcSphericalSurface IfcStructuredDimensionCallout IfcStyledItem IfcSubedge IfcSurfaceCurve IfcSurfaceCurveSweptAreaSolid IfcSurfaceOfLinearExtrusion IfcSurfaceOfRevolution IfcSweptDiskSolid IfcSweptDiskSolidPolygonal IfcTerminatorSymbol IfcTextLiteral IfcTextLiteralWithExtent IfcThirdOrderPolynomialSpiral IfcToroidalSurface IfcTriangulatedFaceSet IfcTriangulatedIrregularNetwork IfcTrimmedCurve IfcTwoDirectionRepeatFactor IfcVector IfcVertex IfcVertexLoop IfcVertexPoint".split(" ").map((c) => c.toUpperCase()));
/** IfcShapeRepresentation.RepresentationType values (IFC4 informal propositions). */
const REPRESENTATION_TYPES = new Set(
  (
    "Point PointCloud Curve Curve2D Curve3D Segment Surface Surface2D Surface3D FillArea Text " +
    "AdvancedSurface GeometricSet GeometricCurveSet Annotation2D SurfaceModel Tessellation " +
    "SolidModel SweptSolid AdvancedSweptSolid Brep AdvancedBrep CSG Clipping BoundingBox " +
    "SectionedSpine LightSource MappedRepresentation"
  )
    .split(" ")
    .map((t) => t.toUpperCase()),
);

const KEYS = [
  "signature",
  "elementClass",
  "identifier",
  "types",
  "itemClasses",
  "ifcfastVersion",
  "ifcopenshellVersion",
  "vertices",
  "faces",
  "inFile",
  "geometry",
  "none",
  "errors",
];

const isPlain = (v) => typeof v === "object" && v !== null && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
const isCount = (v, max) => Number.isInteger(v) && v >= 0 && v <= max;
const isRange = (v) =>
  isPlain(v) &&
  Object.keys(v).length === 2 &&
  isCount(v.min, 1e9) &&
  isCount(v.max, 1e9) &&
  v.min <= v.max;

const CLASS = /^Ifc[A-Za-z0-9]{1,80}$/i;
const CHAIN = /^[A-Za-z0-9]{1,80}(?:(?:, |>|\+)[A-Za-z0-9]{1,80})*$/;
const IFCFAST_VERSION = /^\d{1,3}\.\d{1,3}\.\d{1,3}(?:\+[0-9a-f]{7,40})?$/;
const IFCOS_VERSION = /^\d{1,3}\.\d{1,3}\.\d{1,3}(?:[.+-][A-Za-z0-9.]{1,20})?$/;

/** The report, or why it is refused. Strict: every key present, no other. */
export function validate(body) {
  const no = (error) => ({ ok: false, error });
  if (!isPlain(body)) return no("not an object");
  const keys = Object.keys(body);
  if (keys.length !== KEYS.length || !KEYS.every((k) => keys.includes(k))) return no("keys");
  const f = body;
  if (typeof f.elementClass !== "string" || !CLASS.test(f.elementClass) || !PRODUCTS.has(f.elementClass.toUpperCase())) {
    return no("elementClass");
  }
  if (typeof f.identifier !== "string" || !(f.identifier === "-" || /^body$/i.test(f.identifier))) return no("identifier");
  if (
    !Array.isArray(f.types) ||
    f.types.length < 1 ||
    f.types.length > 8 ||
    new Set(f.types).size !== f.types.length ||
    !f.types.every(
      (t) => typeof t === "string" && (t === "-" || t === "(other)" || (/^[A-Za-z0-9]{1,40}$/.test(t) && REPRESENTATION_TYPES.has(t.toUpperCase()))),
    )
  ) {
    return no("types");
  }
  if (typeof f.itemClasses !== "string" || f.itemClasses.length > 400) return no("itemClasses");
  if (f.itemClasses !== "(no items)" && f.itemClasses !== "(no Body)") {
    if (!CHAIN.test(f.itemClasses)) return no("itemClasses");
    const tokens = f.itemClasses.split(/, |>|\+/);
    if (!tokens.every((t) => CLASS.test(t) && ITEMS.has(t.toUpperCase()))) return no("itemClasses");
  }
  if (typeof f.ifcfastVersion !== "string" || !IFCFAST_VERSION.test(f.ifcfastVersion)) return no("ifcfastVersion");
  if (typeof f.ifcopenshellVersion !== "string" || !IFCOS_VERSION.test(f.ifcopenshellVersion)) return no("ifcopenshellVersion");
  if (f.signature !== `${f.elementClass} / ${f.itemClasses} / ifcfast ${f.ifcfastVersion}`) return no("signature");
  if (!isRange(f.vertices) || !isRange(f.faces)) return no("counts");
  for (const k of ["inFile", "geometry", "none", "errors"]) if (!isCount(f[k], 1e7)) return no("counts");
  if (f.geometry < 1 || f.geometry + f.none + f.errors > f.inFile) return no("counts");
  // Rebuilt from the checked fields, so nothing unchecked rides along.
  return {
    ok: true,
    facts: {
      signature: f.signature,
      elementClass: f.elementClass,
      identifier: f.identifier,
      types: [...f.types],
      itemClasses: f.itemClasses,
      ifcfastVersion: f.ifcfastVersion,
      ifcopenshellVersion: f.ifcopenshellVersion,
      vertices: { min: f.vertices.min, max: f.vertices.max },
      faces: { min: f.faces.min, max: f.faces.max },
      inFile: f.inFile,
      geometry: f.geometry,
      none: f.none,
      errors: f.errors,
    },
  };
}

/* ── title and body: the same as src/engine/body-mesh.ts (the selftest holds them equal) ── */

export function buildTitle(facts) {
  return facts.itemClasses === "(no Body)"
    ? `No Body, no mesh: ${facts.signature}`
    : `Body declared, no mesh: ${facts.signature}`;
}

const range = (r) => (r.min === r.max ? `${r.min}` : `${r.min}..${r.max}`);

export function buildBody(facts) {
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

/** A repeat report on an open issue: the count, and this report's numbers. */
export function buildComment(facts, reports) {
  const lines = [
    `reports: ${reports}`,
    `ifcopenshell_version: ${facts.ifcopenshellVersion}`,
    `ifcopenshell_vertices: ${range(facts.vertices)}`,
    `elements_with_signature: ${facts.inFile}`,
    `ifcopenshell_geometry: ${facts.geometry}`,
    `ifcopenshell_none: ${facts.none}`,
    `ifcopenshell_error: ${facts.errors}`,
  ];
  return "```text\n" + lines.join("\n") + "\n```\n";
}

const REPORTS = /^reports: (\d+)$/m;

/* ── the relay ──────────────────────────────────────────────────────────── */

/**
 * The request handler, transport-free so the selftest drives it with a mock
 * GitHub. `fetch` is the GitHub transport, `now` the clock, `log` gets one
 * line per request and never the token.
 */
export function createRelay({
  token,
  fetch: fetchImpl = globalThis.fetch,
  api = "https://api.github.com",
  origins = DEFAULT_ORIGINS,
  now = () => Date.now(),
  log = (line) => console.log(line),
  perIpHour = 10,
  perDay = 50,
}) {
  if (!token) throw new Error("IFCFAST_ISSUES_TOKEN is not set");
  const hits = new Map();
  let day = [];
  /** Issues this process created or found, for the search index's lag. */
  const known = new Map();

  async function gh(method, path, body) {
    const response = await fetchImpl(`${api}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "ifc-check-relay",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = await response.json().catch(() => null);
    if (!response.ok) {
      const error = new Error(`github ${method} ${path.split("?")[0]} ${response.status}`);
      error.status = response.status;
      throw error;
    }
    return json;
  }

  async function findOpen(signature) {
    const held = known.get(signature);
    if (held && now() - held.at < 10 * 60 * 1000) return held.issue;
    const q = `repo:${REPO} is:issue is:open in:title "${signature}"`;
    const found = await gh("GET", `/search/issues?q=${encodeURIComponent(q)}&per_page=20`);
    const hit = (found?.items ?? []).find(
      (i) => typeof i.title === "string" && i.title.includes(signature) && i.state !== "closed" && !i.pull_request,
    );
    return hit ? { number: hit.number, url: hit.html_url } : null;
  }

  async function file(facts) {
    const issue = await findOpen(facts.signature);
    if (!issue) {
      const created = await gh("POST", `/repos/${REPO}/issues`, { title: buildTitle(facts), body: buildBody(facts) });
      const out = { number: created.number, url: created.html_url };
      known.set(facts.signature, { issue: out, at: now() });
      return { action: "created", ...out };
    }
    const full = await gh("GET", `/repos/${REPO}/issues/${issue.number}`);
    let lastAt = Date.parse(full.created_at);
    let reports = 1;
    if (full.comments > 0) {
      const page = Math.ceil(full.comments / 100);
      const comments = await gh("GET", `/repos/${REPO}/issues/${issue.number}/comments?per_page=100&page=${page}`);
      if (Array.isArray(comments) && comments.length) {
        lastAt = Date.parse(comments[comments.length - 1].created_at);
        for (let i = comments.length - 1; i >= 0; i -= 1) {
          const m = REPORTS.exec(String(comments[i].body ?? ""));
          if (m) {
            reports = Number(m[1]);
            break;
          }
        }
      }
    }
    known.set(facts.signature, { issue, at: now() });
    if (Number.isFinite(lastAt) && now() - lastAt < DAY) return { action: "skipped", ...issue };
    await gh("POST", `/repos/${REPO}/issues/${issue.number}/comments`, { body: buildComment(facts, reports + 1) });
    return { action: "commented", ...issue };
  }

  function limited(ip) {
    const t = now();
    const mine = (hits.get(ip) ?? []).filter((at) => t - at < HOUR);
    if (mine.length >= perIpHour) {
      hits.set(ip, mine);
      return true;
    }
    mine.push(t);
    hits.set(ip, mine);
    if (hits.size > 10000) for (const [k, v] of hits) if (!v.some((at) => t - at < HOUR)) hits.delete(k);
    return false;
  }

  /** `request`: { method, path, headers (lower-case keys), ip, body (string) }. */
  return async function handle(request) {
    const origin = request.headers.origin;
    const allowed = typeof origin === "string" && origins.includes(origin);
    const cors = allowed ? { "Access-Control-Allow-Origin": origin, Vary: "Origin" } : { Vary: "Origin" };
    const reply = (status, json, extra = {}) => {
      log(`${request.method} ${request.path} ${status}${json?.action ? ` ${json.action}` : ""}${json?.error ? ` ${json.error}` : ""}`);
      return { status, headers: { ...cors, ...extra, "Content-Type": "application/json" }, json };
    };
    const path = request.path.split("?")[0].replace(/^\/relay/, "");

    if (request.method === "GET" && path === "/health") return reply(200, { ok: true });
    if (path !== "/ifcfast-miss") return reply(404, { error: "not found" });
    if (request.method === "OPTIONS") {
      if (!allowed) return reply(403, { error: "origin" });
      return reply(204, null, {
        "Access-Control-Allow-Methods": "POST",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Max-Age": "600",
      });
    }
    if (request.method !== "POST") return reply(405, { error: "method" });
    if (!allowed) return reply(403, { error: "origin" });
    if (limited(request.ip)) return reply(429, { error: "rate limit: per address" });
    if (!/^application\/json(;|$)/i.test(String(request.headers["content-type"] ?? ""))) return reply(415, { error: "content-type" });
    if (typeof request.body !== "string" || Buffer.byteLength(request.body) > MAX_BODY) return reply(413, { error: "size" });
    let parsed;
    try {
      parsed = JSON.parse(request.body);
    } catch {
      return reply(400, { error: "json" });
    }
    const checked = validate(parsed);
    if (!checked.ok) return reply(422, { error: `invalid: ${checked.error}` });
    const t = now();
    day = day.filter((at) => t - at < DAY);
    if (day.length >= perDay) return reply(429, { error: "rate limit: daily" });
    day.push(t);
    try {
      return reply(200, await file(checked.facts));
    } catch (err) {
      // The status only: a GitHub error body is not echoed.
      return reply(502, { error: err?.status ? `github ${err.status}` : "github unreachable" });
    }
  };
}

/* ── the server ─────────────────────────────────────────────────────────── */

export function serve(handle, { port = 8791, trustProxy = false } = {}) {
  const server = http.createServer((req, res) => {
    const chunks = [];
    let size = 0;
    let over = false;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) over = true;
      else chunks.push(chunk);
    });
    req.on("end", async () => {
      const forwarded = String(req.headers["x-forwarded-for"] ?? "").split(",")[0].trim();
      const ip = trustProxy && forwarded ? forwarded : (req.socket.remoteAddress ?? "?");
      const out = await handle({
        method: req.method ?? "GET",
        path: req.url ?? "/",
        headers: req.headers,
        ip,
        body: over ? "x".repeat(MAX_BODY + 1) : Buffer.concat(chunks).toString("utf8"),
      });
      res.writeHead(out.status, out.headers);
      res.end(out.json === null ? undefined : JSON.stringify(out.json));
    });
  });
  server.listen(port);
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const token = process.env.IFCFAST_ISSUES_TOKEN;
  if (!token) {
    console.error("IFCFAST_ISSUES_TOKEN is not set");
    process.exit(1);
  }
  const origins = process.env.RELAY_ALLOWED_ORIGINS
    ? process.env.RELAY_ALLOWED_ORIGINS.split(",").map((o) => o.trim()).filter(Boolean)
    : DEFAULT_ORIGINS;
  const port = Number(process.env.PORT ?? 8791);
  const handle = createRelay({ token, origins, api: process.env.GITHUB_API ?? "https://api.github.com" });
  serve(handle, { port, trustProxy: process.env.TRUST_PROXY === "1" });
  console.log(`ifcfast relay on :${port}, origins ${origins.join(" ")}`);
}
