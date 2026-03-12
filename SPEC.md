# LEAN Format Design

**LEAN** (LLM-Efficient Adaptive Notation) — a token-optimized serialization format for structured data in LLM context windows.

## Goals

- Maximum token efficiency for LLM context injection
- Lossless round-trip: `decode(encode(data))` deep-equals original
- Full JSON type coverage (objects, arrays, strings, numbers, booleans, null)
- LLM-scannable (optimized for LLM comprehension, not human readability)

## Primitives

| Type | JSON | LEAN | Rule |
|---|---|---|---|
| true | `true` | `T` | Single char keyword |
| false | `false` | `F` | Single char keyword |
| null | `null` | `_` | Single char keyword |
| number | `42`, `3.14` | `42`, `3.14` | Unchanged |
| string | `"hello"` | `hello` | Unquoted when unambiguous |

### String quoting

Strings are bare by default. Quote (double quotes) only when:
- Value looks like a number: `"42"`, `"3.14"`
- Value matches a reserved keyword: `"T"`, `"F"`, `"_"`
- Value contains: tab, newline, backslash, double quote
- Value has leading/trailing whitespace
- Value is empty: `""`

Everything else is bare. This eliminates most quoting overhead.

### Escaping

- **Scalar context** (key:value lines): backslash escaping — `\\`, `\"`, `\n`
- **Cell context** (tabular rows): RFC 4180 doubling for quotes (`""`) plus `\n` for newlines, `\\` for backslash

### Reserved keywords

`T`, `F`, `_` — always parsed as boolean true, boolean false, null respectively unless quoted.

## Tabular Arrays

Arrays of uniform objects (all objects share identical keys, all values scalar). This is the highest-value optimization.

### Syntax

```
key[count]:field1	field2	field3
  value1	value2	value3
  value1	value2	value3
```

- Tab delimiter (most token-efficient separator per benchmark data)
- Count in header for validation
- Field names declared once
- Data rows indented 2 spaces from header (enables unambiguous parsing vs flat arrays)
- `T`/`F`/`_` in cells for booleans/null
- Values in tabular rows follow cell quoting rules

### Example

JSON:
```json
{"users":[{"id":1,"name":"Alice","active":true},{"id":2,"name":"Bob","active":false}]}
```

LEAN:
```
users[2]:id	name	active
  1	Alice	T
  2	Bob	F
```

### Cell quoting

Same rules as string primitives. Only quote when value contains tab, newline, quote, backslash, or is ambiguous (looks like number/keyword but is a string). Uses RFC 4180 doubling for quotes and `\n`/`\\` for newlines/backslashes.

## Nested Objects

### Dot-flattening

When a nested path leads to a scalar, flatten with dots:
```
config.database.host:db.internal.prod
config.database.port:5432
config.cache.ttl:300
```

When a nested path leads to a tabular array, flatten the prefix:
```
data.users[2]:id	name
  1	Alice
  2	Bob
```

**Dot-flattening and key names:** Keys must NOT contain dots (see Key Constraints). This eliminates ambiguity — every dot in a key path is guaranteed to be a nesting separator. A key like `"a.b"` in the source JSON is rejected by the encoder (throws error), same as TOON rejects keys with spaces or colons.

### Indented blocks

When a nested value is a non-scalar, non-tabular structure that cannot be dot-flattened, use two-space indented blocks:
```
company:
  name:Acme Corp
  departments[2]:name	headcount
    Engineering	50
    Sales	30
```

### Key-value syntax

No space after colon (saves tokens vs TOON's `key: value`):
```
host:db.internal.prod
port:5432
ssl:T
```

### Decode rule for `key:` with no value

A line matching `key:` with nothing after the colon is ALWAYS an indented block header, never an empty string. Empty strings are always explicitly encoded as `key:""`.

## Flat Arrays (Scalar Values)

Tab-delimited inline with count. Values follow cell quoting rules:
```
scores[5]:95	87	42	100	73
labels[3]:alpha	beta	gamma
```

## Empty Containers

- Empty array: `items[0]:`
- Empty object: `{}`
- Nested empty object: `meta:{}` (inline, since `meta:` alone would be parsed as an indented block header)

## Non-Uniform Arrays

Arrays where objects have differing keys, or arrays containing a mix of scalars, objects, and sub-arrays. Uses dashed list items:
```
events[3]:
  - type:click
    target:button-submit
  - type:pageview
    url:/dashboard
    referrer:google.com
  - type:error
    message:NullPointerException
    severity:high
```

First key-value on the `- ` line, remaining keys indented below.

**Non-scalar first value:** If the first key's value is non-scalar (array or object), the `- ` line contains only the key header, and the value follows indented:
```
items[2]:
  - config:
      host:localhost
      port:8080
  - config:
      host:remote
      port:9090
```

**Mixed-type arrays** (scalars, objects, and sub-arrays together) use dashed list items with per-item encoding:
```
mixed[4]:
  - 42
  - hello
  - name:Alice
    age:30
  - [2]:x	y
```

Scalar items use `- value`, object items use `- firstKey:value` with remaining keys indented, sub-array items use `- [count]:...` syntax.

## Root Values

- **Root object**: key-value pairs at indent 0
- **Root array**: header at indent 0 (`[3]:id	name` with data rows indented by 2)
- **Root scalars**: numbers/booleans/null directly (`42`, `T`, `_`). Root strings always quoted (`"hello"`) to disambiguate.
- **Root bare tokens on decode**: A bare root token that is not a keyword, not a number, and not a structural syntax is a parse error (since the encoder always quotes root strings, bare root strings only appear in hand-written LEAN and are rejected).

### Disambiguation table

| Value | Scalar context | Cell context | Root |
|---|---|---|---|
| string `hello` | `hello` | `hello` | `"hello"` |
| string `42` | `"42"` | `"42"` | `"42"` |
| string `T` | `"T"` | `"T"` | `"T"` |
| string `_` | `"_"` | `"_"` | `"_"` |
| string (empty) | `""` | `""` | `""` |
| number `42` | `42` | `42` | `42` |
| boolean true | `T` | `T` | `T` |
| null | `_` | `_` | `_` |

Parse rule: bare value → keyword (`T`/`F`/`_`) > number > string. Quoting forces string.

## Key Constraints

- Keys must match `[\w][\w-]*` (word chars and hyphens only). **No dots** (reserved for path flattening), no spaces, no slashes, no colons.
- Colons are excluded because `key:value` syntax uses colon as the separator — a colon in a key name would be unparseable.
- Dots are excluded because dot-flattening uses dots as nesting separators — a dot in a key name would be ambiguous.
- Encoder throws on invalid keys.
- Duplicate keys rejected on decode.

## Format Rules

- **Delimiter**: tab only. Not configurable. Tab is most token-efficient and rarely appears in data.
- **Line endings**: `\n`
- **Indentation**: two spaces per level
- **NaN/Infinity**: not supported, encoder throws
- **Trailing whitespace/blank lines**: ignored by decoder (skipped during parsing)

## Encoding Priority

For arrays:
1. All elements are objects with identical keys AND all values scalar → tabular
2. Otherwise → non-uniform (dashed list items with per-item encoding)

For nested objects:
1. Value is scalar → dot-flatten (`a.b.c:value`)
2. Value is tabular array → dot-flatten prefix (`a.b.items[3]:x	y`)
3. Value is non-scalar, non-tabular → indented block

## Complete Example

JSON:
```json
{"meta":{"version":"2.1.0","debug":false},"users":[{"id":1,"name":"Alice","email":"alice@ex.com","active":true},{"id":2,"name":"Bob","email":"bob@ex.com","active":false}],"tags":[],"notes":[1,"hello",{"key":"val"}]}
```

LEAN:
```
meta.version:2.1.0
meta.debug:F
users[2]:id	name	email	active
  1	Alice	alice@ex.com	T
  2	Bob	bob@ex.com	F
tags[0]:
notes[3]:
  - 1
  - hello
  - key:val
```

## Implementation

- Encoder/decoder in TypeScript: `lean.ts`
- Add to benchmark.mjs as 5th format
- Add to toon_stats MCP tool comparison
- Run benchmark to compare against JSON, TOON, ASON, ZON
