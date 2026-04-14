# LEAN

**LLM-Efficient Adaptive Notation** — a token-optimized serialization format for structured data in LLM context windows.

LEAN saves **44% of tokens** compared to JSON while achieving **higher LLM accuracy** (87.9% vs 86.2%) across 1,170 evaluated LLM calls.

## Benchmark Results

195 data retrieval questions · 11 datasets · 2 models (GPT-4o-mini, Claude Haiku) · 1,170 LLM calls

### Efficiency Ranking

Accuracy per 1K tokens — how much comprehension you get per token spent:

```
LEAN           ████████████████████   22.3 acc%/1K tok  │  87.9% acc  │  3,939 avg tokens
YAML           ██████████████░░░░░░   15.5 acc%/1K tok  │  87.4% acc  │  5,647 avg tokens
JSON           ██████████░░░░░░░░░░   11.6 acc%/1K tok  │  86.2% acc  │  7,401 avg tokens
```

LEAN is **92% more efficient** than JSON — nearly double the accuracy per token.

### Token Savings

Token counts measured with the GPT-5 `o200k_base` tokenizer. Savings calculated against JSON (2-space indentation).

**Flat data** (uniform tabular structures — where LEAN shines):

```
👥 Employee records (100 rows)
   JSON                ████████████████████    6,150 tokens  (baseline)
   LEAN                ████████░░░░░░░░░░░░    2,361 tokens  (−61.6%)
   YAML                ████████████████░░░░    4,777 tokens  (−22.3%)

📈 Time-series analytics (60 days)
   JSON                ████████████████████    3,609 tokens  (baseline)
   LEAN                ████████░░░░░░░░░░░░    1,461 tokens  (−59.5%)
   YAML                ████████████████░░░░    2,882 tokens  (−20.1%)

⭐ GitHub repositories (100 repos)
   JSON                ████████████████████   13,810 tokens  (baseline)
   LEAN                ███████████░░░░░░░░░    7,434 tokens  (−46.2%)
   YAML                █████████████████░░░   11,667 tokens  (−15.5%)

── Flat Track Total ───────────────────────────────────────────────────────────
   JSON                ████████████████████   29,652 tokens  (baseline)
   LEAN                ██████████░░░░░░░░░░   14,512 tokens  (−51.1%)
   YAML                ████████████████░░░░   24,021 tokens  (−19.0%)
```

**Mixed structures** (nested objects, semi-uniform data):

```
🛒 E-commerce orders (50 orders, nested)
   JSON                ████████████████████   10,731 tokens  (baseline)
   LEAN                ████████████░░░░░░░░    6,521 tokens  (−39.2%)
   YAML                ██████████████░░░░░░    7,765 tokens  (−27.6%)

🧾 Event logs (75 logs, semi-uniform)
   JSON                ████████████████████    6,252 tokens  (baseline)
   LEAN                ████████████████░░░░    5,028 tokens  (−19.6%)
   YAML                ████████████████░░░░    5,078 tokens  (−18.8%)

🧩 Deeply nested config
   JSON                ████████████████████      710 tokens  (baseline)
   LEAN                █████████████░░░░░░░      460 tokens  (−35.2%)
   YAML                ██████████████░░░░░░      505 tokens  (−28.9%)

── Mixed Track Total ──────────────────────────────────────────────────────────
   JSON                ████████████████████   17,693 tokens  (baseline)
   LEAN                ██████████████░░░░░░   12,009 tokens  (−32.1%)
   YAML                ███████████████░░░░░   13,348 tokens  (−24.6%)
```

**Grand total across all datasets:**

```
   JSON                ████████████████████   47,345 tokens  (baseline)
   LEAN                ███████████░░░░░░░░░   26,521 tokens  (−44.0%)
   YAML                ████████████████░░░░   37,369 tokens  (−21.1%)
```

### LLM Accuracy

LEAN matches or beats JSON on every single dataset while using 20–62% fewer tokens.

| Dataset | JSON | LEAN | YAML |
|---------|------|------|------|
| Employee records (100, flat) | 82.5% / 6,150 tok | 83.8% / 2,361 tok | 82.5% / 4,777 tok |
| E-commerce orders (50, nested) | 97.4% / 10,731 tok | 98.7% / 6,521 tok | 98.7% / 7,765 tok |
| Time-series (60, flat) | 73.2% / 3,609 tok | 76.8% / 1,461 tok | 75.0% / 2,882 tok |
| GitHub repos (100, flat) | 67.9% / 13,810 tok | 69.6% / 7,434 tok | 69.6% / 11,667 tok |
| Event logs (75, semi-uniform) | 94.4% / 6,252 tok | 98.1% / 5,028 tok | 98.1% / 5,078 tok |
| Nested config (deep) | 100% / 710 tok | 100% / 460 tok | 100% / 505 tok |

**Per-model accuracy:**

```
gpt-4o-mini
  YAML           ██████████████████░░    88.7% (173/195)
  LEAN           ██████████████████░░    88.2% (172/195)
  JSON           █████████████████░░░    87.2% (170/195)

claude-haiku-4-5-20251001
  LEAN           ██████████████████░░    87.7% (171/195)
  YAML           █████████████████░░░    86.2% (168/195)
  JSON           █████████████████░░░    85.1% (166/195)
```

On Claude Haiku, LEAN outperforms JSON by **+2.6 percentage points** while using half the tokens.

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
| **Formats** | JSON (2-space indent), LEAN, YAML |
| **Total calls** | 1,170 (195 × 3 × 2) |
| **Tokenizer** | `gpt-tokenizer` with `o200k_base` (GPT-5) |
| **Evaluation** | Deterministic, type-aware string/number matching (no LLM judge) |
| **Temperature** | Default (not set) |
| **Reproducibility** | All data generated with a seeded PRNG |

Each LLM receives the full dataset in one of three formats plus a question, and must extract the answer. This tests reading comprehension, not generation.

**Question types:** field retrieval (34%), aggregation (28%), filtering (20%), structure awareness (15%), structural validation (3%).

## Spec

See [SPEC.md](./SPEC.md) for the full format specification.

## License

MIT
