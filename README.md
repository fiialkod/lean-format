# LEAN

**LLM-Efficient Adaptive Notation** — a token-optimized serialization format for structured data in LLM context windows.

LEAN uses the **fewest tokens** of any format tested (28% less than JSON) while achieving the **highest accuracy** (57.4%) across 6 formats and 2 models.

## Benchmark Results

Comprehensive benchmark comparing 6 serialization formats as LLM context. 2 models (GPT-4o-mini, Claude Haiku 4.5). Deterministic evaluation, no LLM judge.

### Overall

| Format | Avg Tokens | Savings vs JSON | Accuracy |
|--------|-----------|----------------|----------|
| **LEAN** | **2,607** | **−28.0%** | **57.4%** |
| TOON | 2,649 | −26.9% | 57.1% |
| JSON compact | 2,653 | −26.8% | 53.3% |
| YAML | 3,248 | −10.3% | 54.1% |
| JSON (pretty) | 3,622 | baseline | 48.7% |
| XML | 4,481 | +23.7% | 50.5% |

LEAN and TOON tie on accuracy (~57%), but LEAN uses fewer tokens. JSON pretty-printed — the most common format fed to LLMs — is both the most verbose and least accurate of the non-XML formats.

### Key Findings

- **LEAN wins on token efficiency** — 28% savings vs JSON pretty, best of all formats
- **LEAN and TOON tie on accuracy** — both ~57%, beating all other formats
- **JSON compact is surprisingly close on tokens** — only 1% more than LEAN, but 4 percentage points lower accuracy
- **XML is the worst** — 24% more tokens than JSON pretty, and mediocre accuracy
- **YAML is middle-of-the-road** — only 10% savings, average accuracy
- **Claude Haiku performed poorly across all formats** (20–29%), dragging the combined averages down. GPT-4o-mini was strong at 73–87%

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

## What the Formats Look Like

**JSON** — 6,150 tokens for 100 employee records:

```json
{
  "employees": [
    {
      "id": 1,
      "name": "Paul Garcia",
      "email": "paul.garcia@company.com",
      "department": "Engineering",
      "salary": 92000,
      "yearsExperience": 19,
      "active": true
    },
    {
      "id": 2,
      "name": "Aaron Davis",
      "email": "aaron.davis@company.com",
      "department": "Finance",
      "salary": 149000,
      "yearsExperience": 18,
      "active": false
    }
  ]
}
```

**LEAN** — 2,361 tokens for the same 100 records (−61.6%):

```
employees:
  #[100](active|department|email|id|name|salary|yearsExperience)
  true|Engineering|paul.garcia@company.com|1|Paul Garcia|92000|19
  ^false|Finance|aaron.davis@company.com|2|Aaron Davis|149000|18
```

The `#[100]` header declares the row count and column names once. Each row is pipe-delimited, rows separated by `^`. No repeated keys, no braces, no quotes. Just data.

**YAML** — 4,777 tokens (−22.3%):

```yaml
employees:
  - active: true
    department: Engineering
    email: paul.garcia@company.com
    id: 1
    name: Paul Garcia
    salary: 92000
    yearsExperience: 19
  - active: false
    department: Finance
    email: aaron.davis@company.com
    id: 2
    name: Aaron Davis
    salary: 149000
    yearsExperience: 18
```

YAML removes braces and quotes but still repeats every key per row.

## Key Optimizations

- **T/F/\_** for true/false/null (single char vs 4–5)
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

## Benchmark Methodology

| | |
|---|---|
| **Questions** | 195 across 11 datasets |
| **Models** | GPT-4o-mini, Claude Haiku 4.5 |
| **Formats** | JSON (pretty), JSON (compact), LEAN, TOON, YAML, XML |
| **Total calls** | 2,340 (195 × 6 × 2) |
| **Tokenizer** | `gpt-tokenizer` with `o200k_base` (GPT-5) |
| **Evaluation** | Deterministic, type-aware string/number matching (no LLM judge) |
| **Temperature** | Default (not set) |
| **Reproducibility** | All data generated with a seeded PRNG |

Each LLM receives the full dataset in one of six formats plus a question, and must extract the answer. This tests reading comprehension, not generation.

## Spec

See [SPEC.md](./SPEC.md) for the full format specification.

## License

MIT
