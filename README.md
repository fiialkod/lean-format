# LEAN

**LLM-Efficient Adaptive Notation** — a token-optimized serialization format for structured data in LLM context windows.

## Why

Feeding structured data to LLMs wastes tokens on JSON syntax: repeated keys, quotes, braces, commas. LEAN eliminates this overhead while maintaining lossless round-trip fidelity.

**Benchmark results** (avg token savings vs JSON compact, 12 datasets):

| Format | Avg Savings | Round-trip |
|--------|------------|------------|
| **LEAN** | **-48.7%** | ALL PASS |
| ZON | -47.8% | ALL PASS |
| TOON | -40.1% | ALL PASS |
| ASON | -39.3% | SOME FAIL |

## Install

```bash
npm install lean-format
```

## Usage

```typescript
import { encode, decode } from 'lean-format';

const data = {
  users: [
    { id: 1, name: "Alice", active: true },
    { id: 2, name: "Bob", active: false }
  ],
  meta: { version: "2.1.0", debug: false }
};

const lean = encode(data);
const back = decode(lean);
// back deep-equals data
```

**JSON** (109 tokens):
```json
{"users":[{"id":1,"name":"Alice","active":true},{"id":2,"name":"Bob","active":false}],"meta":{"version":"2.1.0","debug":false}}
```

**LEAN** (46 tokens):
```
users[2]:id	name	active
  1	Alice	T
  2	Bob	F
meta.version:2.1.0
meta.debug:F
```

## Key optimizations

- **T/F/_** for true/false/null (single char vs 4-5)
- **No space after colon** in key:value pairs
- **Tab delimiter** (most token-efficient separator)
- **Tabular arrays** — column headers declared once, data in rows
- **Semi-tabular** — non-uniform object arrays factor shared keys into columns, extra keys inline as `key:value`
- **Hybrid dot-flatten/block** — tries both, picks shorter
- **Bare strings** — no quotes unless ambiguous

## API

### `encode(data: LeanValue): string`

Encodes a JSON-compatible value to LEAN format. Throws on invalid keys (dots, spaces, colons), NaN, or Infinity.

### `decode(lean: string): LeanValue`

Decodes LEAN text back to a JSON-compatible value. Throws `LeanParseError` on invalid input.

### `LeanParseError`

Error class with `line` and `content` properties for debugging parse failures.

## Spec

See [SPEC.md](./SPEC.md) for the full format specification.

## License

MIT
