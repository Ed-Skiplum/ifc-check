/** The BCF 2.1 documents: bcf.version, markup.bcf, viewpoint.bcfv.
 *
 * Element order follows the buildingSMART BCF 2.1 XSDs (vendor/bcf-schema),
 * which are `xs:sequence`s: an element out of order is a schema error, and the
 * validator is what proves this file matches them.
 */

import { el, textEl, toXmlDocument, type XmlNode } from "../ids/xml.ts";
import type { IfcCamera, Triple } from "./camera.ts";
import type { TopicPlan } from "./plan.ts";

export const TOPIC_TYPE = "Issue";
export const TOPIC_STATUS = "Open";

export function versionXml(): string {
  return toXmlDocument(
    el("Version", { VersionId: "2.1" }, [textEl("DetailedVersion", "2.1")]),
  );
}

export interface MarkupOptions {
  author: string;
  /** ISO 8601 date-time. */
  date: string;
  hasViewpoint: boolean;
  hasSnapshot: boolean;
}

export function markupXml(topic: TopicPlan, options: MarkupOptions): string {
  const topicChildren: XmlNode[] = [
    textEl("Title", topic.title),
    textEl("Index", String(topic.index)),
    ...topic.labels.map((label) => textEl("Labels", label)),
    textEl("CreationDate", options.date),
    textEl("CreationAuthor", options.author),
  ];
  if (topic.description) topicChildren.push(textEl("Description", topic.description));

  const children: XmlNode[] = [
    el("Header", undefined, [
      el("File", { isExternal: "true" }, [textEl("Filename", topic.fileName)]),
    ]),
    el(
      "Topic",
      { Guid: topic.guid, TopicType: TOPIC_TYPE, TopicStatus: TOPIC_STATUS },
      topicChildren,
    ),
  ];
  if (options.hasViewpoint) {
    const viewpoint: XmlNode[] = [textEl("Viewpoint", "viewpoint.bcfv")];
    if (options.hasSnapshot) viewpoint.push(textEl("Snapshot", "snapshot.png"));
    viewpoint.push(textEl("Index", "0"));
    children.push(el("Viewpoints", { Guid: topic.viewpointGuid }, viewpoint));
  }
  return toXmlDocument(el("Markup", undefined, children));
}

function triple(tag: string, value: Triple): XmlNode {
  return el(tag, undefined, [
    textEl("X", String(value[0])),
    textEl("Y", String(value[1])),
    textEl("Z", String(value[2])),
  ]);
}

export function viewpointXml(topic: TopicPlan, camera: IfcCamera | null): string {
  const components: XmlNode[] = [
    el("ViewSetupHints", {
      SpacesVisible: "false",
      SpaceBoundariesVisible: "false",
      OpeningsVisible: "false",
    }),
  ];
  if (topic.guids.length > 0) {
    components.push(
      el(
        "Selection",
        undefined,
        topic.guids.map((guid) => el("Component", { IfcGuid: guid })),
      ),
    );
  }
  components.push(el("Visibility", { DefaultVisibility: "true" }));

  const children: XmlNode[] = [el("Components", undefined, components)];
  if (camera) {
    children.push(
      el("PerspectiveCamera", undefined, [
        triple("CameraViewPoint", camera.viewPoint),
        triple("CameraDirection", camera.direction),
        triple("CameraUpVector", camera.up),
        textEl("FieldOfView", String(camera.fov)),
      ]),
    );
  }
  return toXmlDocument(el("VisualizationInfo", { Guid: topic.viewpointGuid }, children));
}
