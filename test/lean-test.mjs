import { encode, decode, LeanParseError } from '../dist/lean.js';

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✅ ${name}`); pass++; }
  catch (e) { console.log(`  ❌ ${name}\n     ${e.message}`); fail++; }
}
function assertEqual(a, b, l = '') {
  const as = JSON.stringify(a), bs = JSON.stringify(b);
  if (as !== bs) throw new Error(`${l}\n       expected: ${bs}\n       actual:   ${as}`);
}
function assertRoundTrip(data) {
  const enc = encode(data);
  const dec = decode(enc);
  assertEqual(dec, data, `round-trip\n       encoded:\n${enc.split('\n').map(l => '         ' + l).join('\n')}`);
}
function assertThrows(fn, check) {
  let threw = false;
  try { fn(); } catch (e) { threw = true; if (check && !check(e)) throw new Error(`Wrong error: ${e.message}`); }
  if (!threw) throw new Error('Expected to throw');
}

console.log('\n-- primitives --');
test('T/F/_ keywords', () => {
  assertRoundTrip(true);
  assertRoundTrip(false);
  assertRoundTrip(null);
});
test('numbers', () => {
  assertRoundTrip(0);
  assertRoundTrip(-3.14);
  assertRoundTrip(1e10);
});
test('root strings (always quoted)', () => {
  assertRoundTrip("hello");
  assertRoundTrip("");
  assertRoundTrip("42");
  assertRoundTrip("T");
  assertRoundTrip("F");
  assertRoundTrip("_");
  assertRoundTrip("hello world");
  assertRoundTrip("line1\nline2");
});

console.log('\n-- root empty object --');
test('root {} round-trips', () => assertRoundTrip({}));
test('encode({}) === "{}"', () => assertEqual(encode({}), "{}"));

console.log('\n-- root object --');
test('simple kv', () => assertRoundTrip({ a: 1, b: "hello", c: true }));
test('nested', () => assertRoundTrip({ config: { db: { host: "localhost", port: 5432 }, debug: false } }));
test('with tabular', () => assertRoundTrip({ users: [{ id: 1, name: "Alice" }, { id: 2, name: "Bob" }] }));
test('with empty array', () => assertRoundTrip({ items: [] }));
test('nested empty object', () => assertRoundTrip({ meta: {} }));

console.log('\n-- dot-flattening --');
test('shallow dot-flatten', () => {
  const data = { meta: { version: "2.1.0", debug: false } };
  const enc = encode(data);
  if (!enc.includes('meta.version:')) throw new Error('Expected dot-flattened key for short path');
  assertRoundTrip(data);
});
test('deep nesting prefers blocks', () => {
  const data = { config: { database: { host: "localhost", port: 5432 }, cache: { ttl: 300 } } };
  assertRoundTrip(data);
});

console.log('\n-- tabular arrays --');
test('basic tabular', () => assertRoundTrip({ users: [{ id: 1, name: "Alice" }, { id: 2, name: "Bob" }] }));
test('T/F/_ in cells', () => assertRoundTrip({ rows: [{ ok: true, v: null }, { ok: false, v: null }] }));
test('quoted cells', () => assertRoundTrip({ rows: [{ code: "0012", ok: true }, { code: "0034", ok: false }] }));
test('cell with tab', () => assertRoundTrip({ rows: [{ msg: "a\tb", id: 1 }, { msg: "c", id: 2 }] }));
test('cell with newline', () => assertRoundTrip({ rows: [{ msg: "hi\nthere", id: 1 }, { msg: "ok", id: 2 }] }));
test('cell with double-quote', () => assertRoundTrip({ rows: [{ msg: 'she said "hi"', id: 1 }, { msg: "ok", id: 2 }] }));

console.log('\n-- flat scalar arrays --');
test('[1,2,3]', () => assertRoundTrip([1, 2, 3]));
test('["a","b"]', () => assertRoundTrip({ x: ["a", "b"] }));
test('with nulls', () => assertRoundTrip({ x: [1, null, 3] }));
test('keyword-looking strings', () => assertRoundTrip({ x: ["T", "F", "_", "42"] }));
test('empty strings', () => assertRoundTrip({ x: ["", "a", ""] }));

console.log('\n-- root arrays --');
test('flat scalar', () => assertRoundTrip([1, 2, 3]));
test('tabular', () => assertRoundTrip([{ id: 1, name: "Alice" }, { id: 2, name: "Bob" }]));
test('empty', () => assertRoundTrip([]));
test('non-uniform', () => assertRoundTrip([{ type: "a", val: 1 }, { type: "b", val: 2, extra: true }]));

console.log('\n-- non-uniform arrays --');
test('different keys', () => assertRoundTrip({ t: [{ k: "a", v: 1 }, { k: "b", v: 2, x: true }] }));
test('mixed types', () => assertRoundTrip({ m: [1, "hello", { key: "val" }] }));
test('mixed with sub-array', () => assertRoundTrip({ m: [42, "hi", { a: 1 }, ["x", "y"]] }));
test('non-scalar first value', () => assertRoundTrip({
  items: [{ config: { host: "localhost", port: 8080 } }, { config: { host: "remote", port: 9090 } }]
}));

console.log('\n-- semi-tabular arrays --');
test('basic semi-tabular round-trips', () => {
  assertRoundTrip({ t: [{ k: "a", v: 1 }, { k: "b", v: 2, x: true }] });
});
test('semi-tabular uses ~ marker', () => {
  const data = { events: [
    { type: "click", target: "btn" },
    { type: "pageview", url: "/home" },
    { type: "error", message: "oops", severity: "high" }
  ]};
  const enc = encode(data);
  if (!enc.includes('\t~')) throw new Error('Expected ~ marker in semi-tabular header');
  assertRoundTrip(data);
});
test('semi-tabular with special values', () => {
  assertRoundTrip({ items: [
    { id: 1, status: true, note: "ok" },
    { id: 2, status: false, extra: null },
    { id: 3, status: true, code: "0x1A" }
  ]});
});
test('semi-tabular with quoted kv values', () => {
  assertRoundTrip({ rows: [
    { type: "a", msg: "hello\tworld" },
    { type: "b", msg: "line1\nline2", extra: 42 }
  ]});
});
test('semi-tabular root array', () => {
  assertRoundTrip([{ type: "a", val: 1 }, { type: "b", val: 2, extra: true }]);
});
test('semi-tabular with empty string kv', () => {
  assertRoundTrip({ items: [
    { id: 1, name: "Alice" },
    { id: 2, name: "", tag: "new" }
  ]});
});
test('semi-tabular prefers dashed-list when cheaper', () => {
  // Single shared key with long extra keys — may prefer dashed list
  const data = { items: [{ x: 1, longExtraKeyName: "val1" }, { x: 2, anotherLongKey: "val2" }] };
  assertRoundTrip(data);
});

console.log('\n-- deep nesting --');
test('nested array value', () => assertRoundTrip({ g: [{ n: "A", m: [{ id: 1 }, { id: 2 }] }] }));
test('deeply nested', () => assertRoundTrip({
  teams: [{ name: "A", projects: [{ title: "P1", tasks: [{ done: true }] }] }]
}));

console.log('\n-- empty containers --');
test('nested empty containers', () => assertRoundTrip({ empty: {}, arr: [[], {}, [""]] }));

console.log('\n-- string edge cases --');
test('backslash', () => assertRoundTrip({ path: "C:\\Users\\test" }));
test('quotes in string', () => assertRoundTrip({ x: 'she said "hi"' }));
test('double backslash', () => assertRoundTrip({ p: "\\\\" }));
test('backslash-n vs newline', () => {
  const data = { a: "real\nnewline", b: "literal\\nnot" };
  assertRoundTrip(data);
});
test('hex/octal/binary strings preserved', () => {
  assertRoundTrip({ a: "0x1A", b: "0o77", c: "0b101" });
});

console.log('\n-- key validation --');
test('key with dot throws', () => assertThrows(() => encode({ "a.b": 1 })));
test('key with space throws', () => assertThrows(() => encode({ "first name": 1 })));
test('key with colon throws', () => assertThrows(() => encode({ "a:b": 1 })));
test('valid keys', () => assertRoundTrip({ foo: 1, bar_baz: 2, x1: 3, "c-d": 4 }));

console.log('\n-- empty string vs block header --');
test('empty string value round-trips', () => assertRoundTrip({ name: "" }));
test('empty string encoded as key:""', () => {
  const enc = encode({ name: "" });
  if (!enc.includes('name:""')) throw new Error('Expected name:""');
});

console.log('\n-- "true"/"false"/"null" are not reserved --');
test('bare "true" string', () => assertRoundTrip({ x: "true" }));
test('bare "false" string', () => assertRoundTrip({ x: "false" }));
test('bare "null" string', () => assertRoundTrip({ x: "null" }));
test('"true" in tabular cell', () => assertRoundTrip({ r: [{ v: "true" }, { v: "false" }] }));

console.log('\n-- flat array vs tabular disambiguation --');
test('flat numeric array not parsed as tabular', () => assertRoundTrip({ scores: [95, 87, 42] }));
test('flat string array with word values', () => assertRoundTrip({ tags: ["alpha", "beta", "gamma"] }));
test('root flat numeric array', () => assertRoundTrip([1, 2, 3]));

console.log('\n-- error handling --');
test('NaN throws', () => assertThrows(() => encode(NaN)));
test('Infinity throws', () => assertThrows(() => encode(Infinity)));
test('empty doc throws', () => assertThrows(() => decode(""), e => e instanceof LeanParseError));
test('trailing garbage', () => assertThrows(() => decode("42\ngarbage")));
test('root bare string rejected', () => assertThrows(() => decode("hello")));
test('duplicate keys rejected', () => assertThrows(() => decode("a:1\na:2"), e => e instanceof LeanParseError));

console.log('\n-- LEAN-specific optimizations --');
test('T/F encoded as single chars', () => {
  const enc = encode({ active: true, deleted: false });
  if (enc.includes('true') || enc.includes('false')) throw new Error('Should use T/F');
});
test('_ encoded for null', () => {
  const enc = encode({ value: null });
  if (enc.includes('null')) throw new Error('Should use _');
});
test('no space after colon', () => {
  const enc = encode({ host: "localhost" });
  if (enc.includes(': ')) throw new Error('Should not have space after colon');
});

console.log('\n-- integration: spec complete example --');
test('spec example round-trips', () => {
  const data = {
    meta: { version: "2.1.0", debug: false },
    users: [
      { id: 1, name: "Alice", email: "alice@ex.com", active: true },
      { id: 2, name: "Bob", email: "bob@ex.com", active: false }
    ],
    tags: [],
    notes: [1, "hello", { key: "val" }]
  };
  assertRoundTrip(data);
});

console.log(`\n${'─'.repeat(40)}`);
console.log(`${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
