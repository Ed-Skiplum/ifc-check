/** Minimal XML reader, the other half of `xml.ts`. No dependency, no DOM, so
 *  the IDS importer runs in Node (`scripts/ids-cli.ts`) exactly as it runs in
 *  the browser.
 *
 * Enough of XML 1.0 for a standards document: elements, attributes in either
 * quote, text, CDATA, comments, processing instructions, the five predefined
 * entities and numeric character references. A DOCTYPE is refused rather than
 * skipped (an IDS carries none, and an internal subset can redefine entities),
 * and so is anything not well-formed, with the offset where it broke.
 *
 * Namespaces are resolved to the extent the importer needs them: `localName`
 * is the name after the prefix. Prefix-to-URI binding is not checked; the IDS
 * XSD validation is where a wrong namespace is caught.
 */

export interface XmlElement {
  /** The qualified name as written, e.g. `xs:restriction`. */
  name: string;
  /** The name after the prefix, e.g. `restriction`. */
  localName: string;
  attrs: Record<string, string>;
  children: XmlElement[];
  /** Every text and CDATA run directly inside this element, concatenated. */
  text: string;
}

export class XmlSyntaxError extends Error {}

const ENTITIES: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };

function decode(raw: string, at: number): string {
  return raw.replace(/&([^;&\s]*);/g, (whole, ref: string) => {
    if (ref.startsWith("#x") || ref.startsWith("#X")) {
      const code = Number.parseInt(ref.slice(2), 16);
      if (Number.isFinite(code)) return String.fromCodePoint(code);
    } else if (ref.startsWith("#")) {
      const code = Number.parseInt(ref.slice(1), 10);
      if (Number.isFinite(code)) return String.fromCodePoint(code);
    } else if (ref in ENTITIES) {
      return ENTITIES[ref];
    }
    throw new XmlSyntaxError(`unknown entity ${whole} near offset ${at}`);
  });
}

function localOf(name: string): string {
  const colon = name.indexOf(":");
  return colon < 0 ? name : name.slice(colon + 1);
}

const NAME = /[A-Za-z_:][-A-Za-z0-9_:.]*/y;
const ATTR = /\s+([A-Za-z_:][-A-Za-z0-9_:.]*)\s*=\s*("([^"]*)"|'([^']*)')/y;

/** Parse a document and return its root element. */
export function parseXml(source: string): XmlElement {
  let i = source.charCodeAt(0) === 0xfeff ? 1 : 0;
  const stack: XmlElement[] = [];
  let root: XmlElement | null = null;

  const fail = (what: string): never => {
    throw new XmlSyntaxError(`${what} at offset ${i}`);
  };

  while (i < source.length) {
    const lt = source.indexOf("<", i);
    const textEnd = lt < 0 ? source.length : lt;
    if (textEnd > i) {
      const text = source.slice(i, textEnd);
      if (stack.length > 0) stack[stack.length - 1].text += decode(text, i);
      else if (text.trim() !== "") fail("text outside the root element");
      i = textEnd;
      continue;
    }

    if (source.startsWith("<!--", i)) {
      const end = source.indexOf("-->", i + 4);
      if (end < 0) fail("unterminated comment");
      i = end + 3;
    } else if (source.startsWith("<![CDATA[", i)) {
      const end = source.indexOf("]]>", i + 9);
      if (end < 0) fail("unterminated CDATA section");
      if (stack.length === 0) fail("CDATA outside the root element");
      stack[stack.length - 1].text += source.slice(i + 9, end);
      i = end + 3;
    } else if (source.startsWith("<?", i)) {
      const end = source.indexOf("?>", i + 2);
      if (end < 0) fail("unterminated processing instruction");
      i = end + 2;
    } else if (source.startsWith("<!", i)) {
      fail("a DOCTYPE or other declaration is not accepted");
    } else if (source.startsWith("</", i)) {
      NAME.lastIndex = i + 2;
      const match = NAME.exec(source);
      if (!match) fail("malformed end tag");
      const name = match![0];
      const close = source.indexOf(">", NAME.lastIndex);
      if (close < 0 || source.slice(NAME.lastIndex, close).trim() !== "") fail("malformed end tag");
      const open = stack.pop();
      if (!open || open.name !== name) fail(`</${name}> does not close <${open?.name ?? "nothing"}>`);
      i = close + 1;
    } else {
      NAME.lastIndex = i + 1;
      const match = NAME.exec(source);
      if (!match) fail("malformed start tag");
      const name = match![0];
      const element: XmlElement = { name, localName: localOf(name), attrs: {}, children: [], text: "" };
      let at = NAME.lastIndex;
      for (;;) {
        ATTR.lastIndex = at;
        const attr = ATTR.exec(source);
        if (!attr) break;
        if (attr[1] in element.attrs) fail(`duplicate attribute ${attr[1]}`);
        element.attrs[attr[1]] = decode(attr[3] ?? attr[4] ?? "", at);
        at = ATTR.lastIndex;
      }
      while (at < source.length && /\s/.test(source[at])) at += 1;
      let selfClosing = false;
      if (source.startsWith("/>", at)) {
        selfClosing = true;
        at += 2;
      } else if (source[at] === ">") {
        at += 1;
      } else {
        i = at;
        fail(`malformed start tag <${name}`);
      }
      if (stack.length > 0) stack[stack.length - 1].children.push(element);
      else if (root === null) root = element;
      else fail("a second root element");
      if (!selfClosing) stack.push(element);
      i = at;
    }
  }
  if (stack.length > 0) throw new XmlSyntaxError(`<${stack[stack.length - 1].name}> is not closed`);
  if (root === null) throw new XmlSyntaxError("no root element");
  return root;
}
