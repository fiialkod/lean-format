// LEAN encoder/decoder
// LLM-Efficient Adaptive Notation
// Keys must match [\w][\w-]* — no dots, spaces, slashes, colons

export type LeanValue =
  | string
  | number
  | boolean
  | null
  | LeanValue[]
  | { [key: string]: LeanValue };

const KEY_REGEX = /^[\w][\w-]*$/;
const NUMBER_REGEX = /^-?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

function validateKey(key: string): void {
  if (!KEY_REGEX.test(key)) {
    throw new Error(
      `Unsupported key "${key}". Keys must match /^[\\w][\\w-]*$/ (word chars and hyphens). ` +
      `No dots (reserved for path flattening), spaces, slashes, or colons.`
    );
  }
}

function isScalar(value: LeanValue): value is string | number | boolean | null {
  return value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

function isTabularArray(arr: LeanValue[]): boolean {
  if (arr.length === 0) return false;
  if (arr.some(item => typeof item !== "object" || item === null || Array.isArray(item))) return false;
  const firstKeys = Object.keys(arr[0] as Record<string, LeanValue>).sort();
  return arr.every(item => {
    const obj = item as Record<string, LeanValue>;
    const keys = Object.keys(obj).sort();
    return (
      keys.length === firstKeys.length &&
      keys.every((key, i) => key === firstKeys[i]) &&
      keys.every(key => isScalar(obj[key]))
    );
  });
}

// --- Scalar encoding ---

function needsQuoting(value: string): boolean {
  if (value === "") return true;
  if (value === "T" || value === "F" || value === "_") return true;
  if (value.trim() !== value) return true;
  if (NUMBER_REGEX.test(value)) return true;
  if (value.includes("\t") || value.includes("\n") || value.includes("\\") || value.includes('"')) return true;
  return false;
}

function escapeScalar(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/"/g, '\\"');
}

function encodeScalar(value: string, forceQuote: boolean): string {
  if (forceQuote || needsQuoting(value)) {
    return `"${escapeScalar(value)}"`;
  }
  return value;
}

function encodePrimitive(value: LeanValue): string {
  if (value === null) return "_";
  if (value === true) return "T";
  if (value === false) return "F";
  if (typeof value === "number") {
    if (!isFinite(value)) throw new Error(`Unsupported number: ${value}. NaN and Infinity not representable.`);
    return String(value);
  }
  if (typeof value === "string") return encodeScalar(value, false);
  throw new Error("Not a primitive");
}

// --- Cell encoding (tabular context) ---

function escapeCell(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/"/g, '""');
}

function cellEncode(value: LeanValue): string {
  if (value === null) return "_";
  if (value === true) return "T";
  if (value === false) return "F";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") {
    if (needsQuoting(value)) return `"${escapeCell(value)}"`;
    return value;
  }
  throw new Error("Not a scalar cell value");
}

// --- Encoder ---

export function encode(data: LeanValue): string {
  if (data === null) return "_";
  if (typeof data === "boolean") return data ? "T" : "F";
  if (typeof data === "number") {
    if (!isFinite(data)) throw new Error(`Unsupported number: ${data}.`);
    return String(data);
  }
  if (typeof data === "string") return encodeScalar(data, true); // root strings always quoted

  if (Array.isArray(data)) {
    return encodeRootArray(data);
  }

  const entries = Object.entries(data as Record<string, LeanValue>);
  if (entries.length === 0) return "{}";

  const lines: string[] = [];
  for (const [key, value] of entries) {
    validateKey(key);
    encodeProperty(key, value, lines, 0);
  }
  return lines.join("\n");
}

function encodeRootArray(arr: LeanValue[]): string {
  const lines: string[] = [];
  encodeArrayValue("", arr, lines, 0);
  return lines.join("\n");
}

function encodeProperty(path: string, value: LeanValue, lines: string[], indent: number): void {
  // Scalar → dot-flatten
  if (isScalar(value)) {
    const pad = "  ".repeat(indent);
    lines.push(`${pad}${path}:${encodePrimitive(value)}`);
    return;
  }

  // Array
  if (Array.isArray(value)) {
    encodeArrayValue(path, value, lines, indent);
    return;
  }

  // Object — try dot-flattening, fall back to indented block
  const obj = value as Record<string, LeanValue>;
  const entries = Object.entries(obj);

  if (entries.length === 0) {
    const pad = "  ".repeat(indent);
    lines.push(`${pad}${path}:{}`);
    return;
  }

  // At indent 0: compare dot-flattening vs indented block, pick shorter.
  // Dot-flattening repeats the full parent path on every leaf line — this costs
  // more than JSON's braces when paths are long and siblings are few.
  // Formula: dot-flatten wins when parent_path_length < ~3 + 2/K (K = children).
  // Rather than estimate, we just try both and measure.
  if (indent === 0) {
    // Strategy 1: dot-flatten (extend path with dots)
    const dotLines: string[] = [];
    for (const [key, val] of entries) {
      validateKey(key);
      encodeProperty(`${path}.${key}`, val, dotLines, 0);
    }

    // Strategy 2: indented block
    const blockLines: string[] = [];
    blockLines.push(`${path}:`);
    for (const [key, val] of entries) {
      validateKey(key);
      encodeProperty(key, val, blockLines, 1);
    }

    // Pick shorter (character count including newlines)
    const dotCost = dotLines.reduce((sum, l) => sum + l.length + 1, 0);
    const blockCost = blockLines.reduce((sum, l) => sum + l.length + 1, 0);
    lines.push(...(dotCost <= blockCost ? dotLines : blockLines));
  } else {
    const pad = "  ".repeat(indent);
    lines.push(`${pad}${path}:`);
    for (const [key, val] of entries) {
      validateKey(key);
      encodeProperty(key, val, lines, indent + 1);
    }
  }
}

function encodeArrayValue(path: string, arr: LeanValue[], lines: string[], indent: number): void {
  const pad = "  ".repeat(indent);
  const prefix = path;

  if (arr.length === 0) {
    lines.push(`${pad}${prefix}[0]:`);
    return;
  }

  // Flat scalar array
  const allScalar = arr.every(v => isScalar(v));
  if (allScalar) {
    const cells = arr.map(v => cellEncode(v)).join("\t");
    lines.push(`${pad}${prefix}[${arr.length}]:${cells}`);
    return;
  }

  // Tabular array
  if (isTabularArray(arr)) {
    const fields = Object.keys(arr[0] as Record<string, LeanValue>);
    fields.forEach(validateKey);
    lines.push(`${pad}${prefix}[${arr.length}]:${fields.join("\t")}`);
    for (const row of arr) {
      const obj = row as Record<string, LeanValue>;
      const cells = fields.map(f => cellEncode(obj[f]));
      lines.push(`${pad}  ${cells.join("\t")}`);
    }
    return;
  }

  // Semi-tabular: all items are objects with all-scalar values but different keys
  const allObjects = arr.every(item => typeof item === "object" && item !== null && !Array.isArray(item));
  if (allObjects) {
    const objects = arr as Record<string, LeanValue>[];
    const allScalarValues = objects.every(obj => Object.values(obj).every(v => isScalar(v)));
    if (allScalarValues && objects.length >= 2) {
      // Find keys present in 100% of items
      const sharedKeys = Object.keys(objects[0]).filter(k =>
        objects.every(obj => Object.prototype.hasOwnProperty.call(obj, k))
      );

      if (sharedKeys.length > 0) {
        sharedKeys.forEach(validateKey);
        const sharedSet = new Set(sharedKeys);

        // Build semi-tabular encoding
        const semiLines: string[] = [];
        semiLines.push(`${pad}${prefix}[${arr.length}]:${sharedKeys.join("\t")}\t~`);
        for (const obj of objects) {
          const factored = sharedKeys.map(k => cellEncode(obj[k]));
          const remaining = Object.entries(obj)
            .filter(([k]) => !sharedSet.has(k))
            .map(([k, v]) => { validateKey(k); return `${k}:${cellEncode(v)}`; });
          const cells = [...factored, ...remaining];
          semiLines.push(`${pad}  ${cells.join("\t")}`);
        }

        // Build dashed-list encoding for comparison
        const dashedLines: string[] = [];
        dashedLines.push(`${pad}${prefix}[${arr.length}]:`);
        for (const item of arr) {
          encodeListItem(item, dashedLines, indent + 1);
        }

        // Pick shorter
        const semiCost = semiLines.reduce((s, l) => s + l.length + 1, 0);
        const dashedCost = dashedLines.reduce((s, l) => s + l.length + 1, 0);
        lines.push(...(semiCost < dashedCost ? semiLines : dashedLines));
        return;
      }
    }
  }

  // Non-uniform / mixed array
  lines.push(`${pad}${prefix}[${arr.length}]:`);
  for (const item of arr) {
    encodeListItem(item, lines, indent + 1);
  }
}

function encodeListItem(item: LeanValue, lines: string[], indent: number): void {
  const pad = "  ".repeat(indent);

  // Scalar
  if (isScalar(item)) {
    if (typeof item === "string") {
      lines.push(`${pad}- ${encodeScalar(item, false)}`);
    } else {
      lines.push(`${pad}- ${encodePrimitive(item)}`);
    }
    return;
  }

  // Sub-array
  if (Array.isArray(item)) {
    const subLines: string[] = [];
    encodeArrayValue("", item, subLines, 0);
    lines.push(`${pad}- ${subLines[0]}`);
    for (let i = 1; i < subLines.length; i++) {
      lines.push(`${pad}  ${subLines[i]}`);
    }
    return;
  }

  // Object
  const obj = item as Record<string, LeanValue>;
  const entries = Object.entries(obj);

  if (entries.length === 0) {
    lines.push(`${pad}- {}`);
    return;
  }

  const [firstKey, firstVal] = entries[0];
  validateKey(firstKey);

  if (isScalar(firstVal)) {
    const sv = encodePrimitive(firstVal);
    lines.push(`${pad}- ${firstKey}:${sv}`);
  } else if (Array.isArray(firstVal)) {
    const subLines: string[] = [];
    encodeArrayValue(firstKey, firstVal, subLines, 0);
    lines.push(`${pad}- ${subLines[0]}`);
    for (let i = 1; i < subLines.length; i++) {
      lines.push(`${pad}  ${subLines[i]}`);
    }
  } else {
    // Non-scalar object value as first key
    const subObj = firstVal as Record<string, LeanValue>;
    if (Object.keys(subObj).length === 0) {
      lines.push(`${pad}- ${firstKey}:{}`);
    } else {
      lines.push(`${pad}- ${firstKey}:`);
      for (const [k, v] of Object.entries(subObj)) {
        validateKey(k);
        encodeProperty(k, v, lines, indent + 2);
      }
    }
  }

  // Remaining keys
  for (let i = 1; i < entries.length; i++) {
    const [key, val] = entries[i];
    validateKey(key);
    encodeProperty(key, val, lines, indent + 1);
  }
}

// --- Decoder ---

export class LeanParseError extends Error {
  public readonly line: number;
  public readonly content: string;
  constructor(lineIndex: number, content: string, message: string) {
    super(`Line ${lineIndex + 1}: ${message} → "${content}"`);
    this.name = "LeanParseError";
    this.line = lineIndex + 1;
    this.content = content;
  }
}

function unescapeScalar(s: string): string {
  let result = "";
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "\\" && i + 1 < s.length) {
      const next = s[i + 1];
      if (next === "n") { result += "\n"; i++; }
      else if (next === "\\") { result += "\\"; i++; }
      else if (next === '"') { result += '"'; i++; }
      else { result += "\\"; }
    } else {
      result += s[i];
    }
  }
  return result;
}

function unescapeCell(s: string): string {
  let result = "";
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '"' && s[i + 1] === '"') { result += '"'; i++; continue; }
    if (s[i] === "\\" && i + 1 < s.length) {
      if (s[i + 1] === "n") { result += "\n"; i++; continue; }
      if (s[i + 1] === "\\") { result += "\\"; i++; continue; }
    }
    result += s[i];
  }
  return result;
}

function parseScalarValue(s: string): LeanValue {
  s = s.trim();
  if (s === "T") return true;
  if (s === "F") return false;
  if (s === "_") return null;
  if (s === "") return "";
  if (s.startsWith('"') && s.endsWith('"') && s.length >= 2) {
    return unescapeScalar(s.slice(1, -1));
  }
  if (NUMBER_REGEX.test(s)) return Number(s);
  return s; // bare string
}

function parseCellValue(s: string): LeanValue {
  s = s.trim();
  if (s.startsWith('"') && s.endsWith('"') && s.length >= 2) {
    return unescapeCell(s.slice(1, -1));
  }
  if (s === "T") return true;
  if (s === "F") return false;
  if (s === "_") return null;
  if (s === "") return "";
  if (NUMBER_REGEX.test(s)) return Number(s);
  return s;
}

function splitTabCells(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;
  let pos = 0;
  while (pos < line.length) {
    const ch = line[pos];
    if (inQuotes) {
      if (ch === '"') {
        if (pos + 1 < line.length && line[pos + 1] === '"') {
          current += '""';
          pos += 2;
        } else {
          inQuotes = false;
          current += '"';
          pos++;
        }
      } else {
        current += ch;
        pos++;
      }
    } else {
      if (ch === '"') { inQuotes = true; current += '"'; pos++; }
      else if (ch === "\t") { cells.push(current); current = ""; pos++; }
      else { current += ch; pos++; }
    }
  }
  cells.push(current);
  if (inQuotes) throw new Error(`Unterminated quote in row: "${line}"`);
  return cells;
}

function parseTabRow(line: string): LeanValue[] {
  return splitTabCells(line).map(parseCellValue);
}

function getIndent(line: string): number {
  const m = line.match(/^(\s*)/);
  return m ? m[1].length : 0;
}

interface ParseState {
  i: number;
  lines: string[];
}

function setKeyOrThrow(
  target: Record<string, LeanValue>, key: string, value: LeanValue,
  lineIndex: number, content: string
): void {
  if (Object.prototype.hasOwnProperty.call(target, key)) {
    throw new LeanParseError(lineIndex, content, `Duplicate key "${key}"`);
  }
  target[key] = value;
}

function setNestedValue(
  target: Record<string, LeanValue>, path: string, value: LeanValue,
  lineIndex: number, content: string
): void {
  const parts = path.split(".");
  let current = target;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (!Object.prototype.hasOwnProperty.call(current, part)) {
      current[part] = {};
    }
    const next = current[part];
    if (typeof next !== "object" || next === null || Array.isArray(next)) {
      throw new LeanParseError(lineIndex, content, `Cannot nest into non-object at "${part}"`);
    }
    current = next as Record<string, LeanValue>;
  }
  const lastKey = parts[parts.length - 1];
  setKeyOrThrow(current, lastKey, value, lineIndex, content);
}

// Regex patterns
const kvRegex = /^([\w][\w.-]*):(.*)/; // key:value — dots allowed in KEY for dot-flattened paths
const emptyObjRegex = /^([\w][\w.-]*):\{\}\s*$/;
const blockRegex = /^([\w][\w.-]*):\s*$/;
const tabularRegex = /^([\w][\w.-]*)\[(\d+)\]:([\w][\w-]*(?:\t[\w][\w-]*)*(?:\t~)?)\s*$/;
const flatArrayRegex = /^([\w][\w.-]*)\[(\d+)\]:(.+)$/;
const emptyArrayRegex = /^([\w][\w.-]*)\[0\]:\s*$/;
const nonUniformRegex = /^([\w][\w.-]*)\[([1-9]\d*)\]:\s*$/;

// Root array patterns (no key prefix)
const rootTabularRegex = /^\[(\d+)\]:([\w][\w-]*(?:\t[\w][\w-]*)*(?:\t~)?)\s*$/;
const rootFlatRegex = /^\[(\d+)\]:(.+)$/;
const rootEmptyRegex = /^\[0\]:\s*$/;
const rootNonUniformRegex = /^\[([1-9]\d*)\]:\s*$/;

// List item patterns
const listItemScalarRegex = /^-\s+(.+)$/;
const listItemEmptyObjRegex = /^-\s+\{\}\s*$/;
const listItemKvRegex = /^-\s+([\w][\w-]*):(.*)/;
const listItemBlockRegex = /^-\s+([\w][\w-]*):\s*$/;
const listItemEmptyArrayRegex = /^-\s+([\w][\w-]*)\[0\]:\s*$/;
const listItemNonUniformRegex = /^-\s+([\w][\w-]*)\[([1-9]\d*)\]:\s*$/;
const listItemTabularRegex = /^-\s+([\w][\w-]*)\[(\d+)\]:([\w][\w-]*(?:\t[\w][\w-]*)*(?:\t~)?)\s*$/;
const listItemRootArrayRegex = /^-\s+\[(\d+)\]:(.*)/;
const listItemRootEmptyRegex = /^-\s+\[0\]:\s*$/;
const listItemRootNonUniformRegex = /^-\s+\[([1-9]\d*)\]:\s*$/;
const listItemRootTabularRegex = /^-\s+\[(\d+)\]:([\w][\w-]*(?:\t[\w][\w-]*)*(?:\t~)?)\s*$/;
const listItemEmptyObjKeyRegex = /^-\s+([\w][\w-]*):\{\}\s*$/;

export function decode(lean: string): LeanValue {
  const lines = lean.split("\n");
  let firstIdx = 0;
  while (firstIdx < lines.length && lines[firstIdx].trim() === "") firstIdx++;
  if (firstIdx >= lines.length) {
    throw new LeanParseError(0, "", "Empty LEAN document");
  }

  const first = lines[firstIdx].trim();
  const state: ParseState = { i: firstIdx, lines };

  // Root empty object
  if (first === "{}") {
    state.i++;
    skipTrailing(state);
    return {};
  }

  // Root scalar
  if (first === "T") { state.i++; skipTrailing(state); return true; }
  if (first === "F") { state.i++; skipTrailing(state); return false; }
  if (first === "_") { state.i++; skipTrailing(state); return null; }

  // Root quoted string
  if (first.startsWith('"') && first.endsWith('"') && first.length >= 2) {
    state.i++;
    skipTrailing(state);
    return unescapeScalar(first.slice(1, -1));
  }

  // Root number
  const num = Number(first);
  if (Number.isFinite(num) && first !== "" && !first.includes(":") && !first.includes("[")) {
    state.i++;
    skipTrailing(state);
    return num;
  }

  // Root array
  if (first.startsWith("[")) {
    const result = parseRootArray(state);
    skipTrailing(state);
    return result;
  }

  // Root object (key:value or key[N]:... lines)
  const result: Record<string, LeanValue> = {};
  parseBlock(state, 0, result);
  skipTrailing(state);
  return result;
}

function skipTrailing(state: ParseState): void {
  while (state.i < state.lines.length) {
    if (state.lines[state.i].trim() !== "") {
      throw new LeanParseError(state.i, state.lines[state.i].trim(), "Unexpected trailing content");
    }
    state.i++;
  }
}

function parseRootArray(state: ParseState): LeanValue[] {
  const line = state.lines[state.i].trim();

  if (rootEmptyRegex.test(line)) { state.i++; return []; }

  const tabM = line.match(rootTabularRegex);
  if (tabM) {
    const count = parseInt(tabM[1], 10);
    const fields = tabM[2].split("\t");
    const semiTabular = fields.length > 0 && fields[fields.length - 1] === "~";
    if (semiTabular) fields.pop();

    // Peek: tabular arrays have indented data rows; flat arrays do not
    let peekIdx = state.i + 1;
    while (peekIdx < state.lines.length && state.lines[peekIdx].trim() === "") peekIdx++;
    const nextIsDataRow = count > 0 && peekIdx < state.lines.length && getIndent(state.lines[peekIdx]) >= 2;

    if (nextIsDataRow) {
      state.i++;
      return parseTabularRows(state, count, fields, 2, line, semiTabular);
    }
    // Fall through to flat array parsing below
  }

  const nuM = line.match(rootNonUniformRegex);
  if (nuM) {
    const count = parseInt(nuM[1], 10);
    state.i++;
    return parseListItems(state, 0, count);
  }

  const flatM = line.match(rootFlatRegex);
  if (flatM) {
    const count = parseInt(flatM[1], 10);
    const values = parseTabRow(flatM[2]);
    if (values.length !== count) {
      throw new LeanParseError(state.i, line, `Array count mismatch (declared ${count}, got ${values.length})`);
    }
    state.i++;
    return values;
  }

  throw new LeanParseError(state.i, line, "Unrecognized root array syntax");
}

function parseTabularRows(
  state: ParseState, count: number, fields: string[],
  minIndent: number, headerContent: string, semiTabular: boolean = false
): LeanValue[] {
  // Check for duplicate fields
  const seen = new Set<string>();
  for (const f of fields) {
    if (seen.has(f)) throw new LeanParseError(state.i - 1, headerContent, `Duplicate field "${f}"`);
    seen.add(f);
  }

  const rows: LeanValue[] = [];
  while (rows.length < count && state.i < state.lines.length) {
    const rowLine = state.lines[state.i];
    if (rowLine.trim() === "") { state.i++; continue; }
    if (getIndent(rowLine) < minIndent) break;

    if (semiTabular) {
      const cells = splitTabCells(rowLine.trim());
      if (cells.length < fields.length) {
        throw new LeanParseError(state.i, rowLine.trim(), `Row field count mismatch (expected at least ${fields.length}, got ${cells.length})`);
      }
      const obj: Record<string, LeanValue> = {};
      fields.forEach((f, idx) => { obj[f] = parseCellValue(cells[idx]); });
      // Extra cells are key:value pairs
      for (let c = fields.length; c < cells.length; c++) {
        const cell = cells[c];
        const colonIdx = cell.indexOf(":");
        if (colonIdx === -1) {
          throw new LeanParseError(state.i, rowLine.trim(), `Semi-tabular extra cell missing key:value format: "${cell}"`);
        }
        const key = cell.slice(0, colonIdx);
        const rawVal = cell.slice(colonIdx + 1);
        setKeyOrThrow(obj, key, parseCellValue(rawVal), state.i, rowLine.trim());
      }
      rows.push(obj);
    } else {
      const values = parseTabRow(rowLine.trim());
      if (values.length !== fields.length) {
        throw new LeanParseError(state.i, rowLine.trim(), `Row field count mismatch (expected ${fields.length}, got ${values.length})`);
      }
      const obj: Record<string, LeanValue> = {};
      fields.forEach((f, idx) => { obj[f] = values[idx]; });
      rows.push(obj);
    }
    state.i++;
  }

  if (rows.length !== count) {
    throw new LeanParseError(state.i - 1, headerContent, `Row count mismatch (declared ${count}, got ${rows.length})`);
  }
  return rows;
}

function parseListItems(state: ParseState, baseIndent: number, count: number): LeanValue[] {
  const arr: LeanValue[] = [];
  const itemIndent = baseIndent + 2;

  while (arr.length < count && state.i < state.lines.length) {
    const line = state.lines[state.i];
    if (line.trim() === "") { state.i++; continue; }
    const ind = getIndent(line);
    if (ind < itemIndent) break;
    const content = line.slice(ind);

    // Empty object item
    if (listItemEmptyObjRegex.test(content)) { arr.push({}); state.i++; continue; }

    // Sub-array items (- [N]:...)
    if (content.match(listItemRootEmptyRegex)) { arr.push([]); state.i++; continue; }

    const liRootTabM = content.match(listItemRootTabularRegex);
    if (liRootTabM) {
      const cnt = parseInt(liRootTabM[1], 10);
      const fields = liRootTabM[2].split("\t");
      const semiTab = fields.length > 0 && fields[fields.length - 1] === "~";
      if (semiTab) fields.pop();
      // Peek-ahead: tabular has indented data rows, flat does not
      let peekIdx = state.i + 1;
      while (peekIdx < state.lines.length && state.lines[peekIdx].trim() === "") peekIdx++;
      const nextIsData = cnt > 0 && peekIdx < state.lines.length && getIndent(state.lines[peekIdx]) >= ind + 2;
      if (nextIsData) {
        state.i++;
        arr.push(parseTabularRows(state, cnt, fields, ind + 2, content, semiTab));
        continue;
      }
      // Fall through to flat array below
    }

    const liRootNuM = content.match(listItemRootNonUniformRegex);
    if (liRootNuM) {
      const cnt = parseInt(liRootNuM[1], 10);
      state.i++;
      arr.push(parseListItems(state, ind, cnt));
      continue;
    }

    const liRootArrM = content.match(listItemRootArrayRegex);
    if (liRootArrM) {
      const cnt = parseInt(liRootArrM[1], 10);
      const values = parseTabRow(liRootArrM[2]);
      if (values.length !== cnt) {
        throw new LeanParseError(state.i, content, `Array count mismatch`);
      }
      arr.push(values);
      state.i++;
      continue;
    }

    // Object items (- key:value)
    if (
      content.match(listItemEmptyObjKeyRegex) ||
      content.match(listItemTabularRegex) ||
      content.match(listItemEmptyArrayRegex) ||
      content.match(listItemNonUniformRegex) ||
      content.match(listItemKvRegex) ||
      content.match(listItemBlockRegex)
    ) {
      arr.push(parseListItemObject(state, ind, itemIndent));
      continue;
    }

    // Scalar item
    const scalarM = content.match(listItemScalarRegex);
    if (scalarM) {
      arr.push(parseScalarValue(scalarM[1]));
      state.i++;
      continue;
    }

    throw new LeanParseError(state.i, content, "Unrecognized list item");
  }

  if (arr.length !== count) {
    throw new LeanParseError(state.i - 1, "", `List count mismatch (declared ${count}, got ${arr.length})`);
  }
  return arr;
}

function parseListItemObject(
  state: ParseState, lineInd: number, parentItemIndent: number
): Record<string, LeanValue> {
  const obj: Record<string, LeanValue> = {};
  const content = state.lines[state.i].slice(lineInd);
  const firstLineIdx = state.i;

  // - key:{}
  const emptyObjKeyM = content.match(listItemEmptyObjKeyRegex);
  if (emptyObjKeyM) { setKeyOrThrow(obj, emptyObjKeyM[1], {}, firstLineIdx, content); state.i++; }
  // - key[N]:fields (tabular) — peek-ahead to disambiguate from flat arrays
  else {
    const tabM = content.match(listItemTabularRegex);
    let isTabularItem = false;
    if (tabM) {
      const count = parseInt(tabM[2], 10);
      let peekIdx = state.i + 1;
      while (peekIdx < state.lines.length && state.lines[peekIdx].trim() === "") peekIdx++;
      isTabularItem = count > 0 && peekIdx < state.lines.length && getIndent(state.lines[peekIdx]) >= lineInd + 2;
    }
    if (tabM && isTabularItem) {
      const [, key, countStr, fieldsStr] = tabM;
      const fields = fieldsStr.split("\t");
      const semiTab = fields.length > 0 && fields[fields.length - 1] === "~";
      if (semiTab) fields.pop();
      state.i++;
      setKeyOrThrow(obj, key, parseTabularRows(state, parseInt(countStr, 10), fields, lineInd + 2, content, semiTab), firstLineIdx, content);
    }
    // - key[0]:
    else {
      const emptyArrM = content.match(listItemEmptyArrayRegex);
      if (emptyArrM) { setKeyOrThrow(obj, emptyArrM[1], [], firstLineIdx, content); state.i++; }
      // - key[N]:
      else {
        const nuM = content.match(listItemNonUniformRegex);
        if (nuM) {
          state.i++;
          setKeyOrThrow(obj, nuM[1], parseListItems(state, lineInd, parseInt(nuM[2], 10)), firstLineIdx, content);
        }
        // - key:value or - key: (block)
        else {
          const blockM = content.match(listItemBlockRegex);
          if (blockM) {
            const nested: Record<string, LeanValue> = {};
            state.i++;
            parseBlock(state, lineInd + 4, nested);
            setKeyOrThrow(obj, blockM[1], nested, firstLineIdx, content);
          } else {
            const kvM = content.match(listItemKvRegex);
            if (kvM) {
              setKeyOrThrow(obj, kvM[1], parseScalarValue(kvM[2]), firstLineIdx, content);
              state.i++;
            } else {
              throw new LeanParseError(state.i, content, "Invalid list item object");
            }
          }
        }
      }
    }
  }

  // Remaining keys
  const bodyIndent = lineInd + 2;
  while (state.i < state.lines.length) {
    const line = state.lines[state.i];
    if (line.trim() === "") { state.i++; continue; }
    const ind = getIndent(line);
    if (ind < bodyIndent) break;
    const lc = line.slice(ind);
    if (ind === parentItemIndent && lc.startsWith("- ")) break;
    parseLine(state, ind, obj, lc);
  }

  return obj;
}

function parseLine(
  state: ParseState, ind: number, target: Record<string, LeanValue>, content: string
): void {
  const lineIdx = state.i;

  // key:{}
  const emptyObjM = content.match(emptyObjRegex);
  if (emptyObjM) {
    setNestedValue(target, emptyObjM[1], {}, lineIdx, content);
    state.i++;
    return;
  }

  // key[N]:fields (tabular) — disambiguate from flat arrays by peeking ahead
  const tabM = content.match(tabularRegex);
  if (tabM) {
    const [, path, countStr, fieldsStr] = tabM;
    const count = parseInt(countStr, 10);
    const fields = fieldsStr.split("\t");
    const semiTab = fields.length > 0 && fields[fields.length - 1] === "~";
    if (semiTab) fields.pop();

    // Peek: tabular arrays have indented data rows; flat arrays do not
    let peekIdx = state.i + 1;
    while (peekIdx < state.lines.length && state.lines[peekIdx].trim() === "") peekIdx++;
    const nextIsDataRow = count > 0 && peekIdx < state.lines.length && getIndent(state.lines[peekIdx]) >= ind + 2;

    if (nextIsDataRow) {
      state.i++;
      setNestedValue(target, path, parseTabularRows(state, count, fields, ind + 2, content, semiTab), lineIdx, content);
      return;
    }
    // Fall through to flat array parsing below
  }

  // key[0]:
  const emptyArrM = content.match(emptyArrayRegex);
  if (emptyArrM) {
    setNestedValue(target, emptyArrM[1], [], lineIdx, content);
    state.i++;
    return;
  }

  // key[N]: (non-uniform)
  const nuM = content.match(nonUniformRegex);
  if (nuM) {
    state.i++;
    setNestedValue(target, nuM[1], parseListItems(state, ind, parseInt(nuM[2], 10)), lineIdx, content);
    return;
  }

  // key[N]:values (flat)
  const flatM = content.match(flatArrayRegex);
  if (flatM) {
    const count = parseInt(flatM[2], 10);
    const values = parseTabRow(flatM[3]);
    if (values.length !== count) {
      throw new LeanParseError(lineIdx, content, `Array count mismatch (declared ${count}, got ${values.length})`);
    }
    setNestedValue(target, flatM[1], values, lineIdx, content);
    state.i++;
    return;
  }

  // key: (block header)
  const blockM = content.match(blockRegex);
  if (blockM) {
    const nested: Record<string, LeanValue> = {};
    state.i++;
    parseBlock(state, ind + 2, nested);
    setNestedValue(target, blockM[1], nested, lineIdx, content);
    return;
  }

  // key:value
  const kvM = content.match(kvRegex);
  if (kvM) {
    setNestedValue(target, kvM[1], parseScalarValue(kvM[2]), lineIdx, content);
    state.i++;
    return;
  }

  throw new LeanParseError(state.i, content, "Unrecognized LEAN syntax");
}

function parseBlock(
  state: ParseState, baseIndent: number, target: Record<string, LeanValue>
): void {
  while (state.i < state.lines.length) {
    const line = state.lines[state.i];
    if (line.trim() === "") { state.i++; continue; }
    const ind = getIndent(line);
    if (ind < baseIndent) break;
    const content = line.slice(ind);
    parseLine(state, ind, target, content);
  }
}
