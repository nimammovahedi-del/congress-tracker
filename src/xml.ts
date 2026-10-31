import { XMLParser } from "fast-xml-parser";

// Values stay as strings (bill numbers like '0100' or codes like '8000' must not
// become numbers); callers convert what they need. Attributes are read as '@_name'.
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
});

// Parsed XML is loosely shaped, so it is typed loosely and read through list() and text().
export type Node = any;

export function parseXml(xml: string): Node {
  return parser.parse(xml);
}

// XML lists come back as a single object when they have one item; always get an array.
export function list(value: Node): Node[] {
  if (value === undefined || value === null || value === "") return [];
  return Array.isArray(value) ? value : [value];
}

// Text of an element, whether it parsed as a plain string or as an object with attributes.
export function text(value: Node): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value === "object") return value["#text"] !== undefined ? String(value["#text"]) : null;
  const s = String(value);
  return s === "" ? null : s;
}
