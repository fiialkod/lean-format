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

### JavaScript and TypeScript (Node.js)

```bash
npm install github:ahmadhatahet/lean-format#main
```

Prebuilt Node.js binaries are provided for macOS (x64 and arm64), Windows (x64 and arm64), and Linux (x64 with glibc or musl; arm64 with glibc).
Installing from GitHub builds the native addon locally and requires Rust and Node.js.

### Python

```bash
uv add git+https://github.com/ahmadhatahet/lean-format.git
```

The Python extension supports macOS, Linux, and Windows. If a matching wheel is unavailable, installation builds from source and requires a Rust toolchain.

### Rust library and CLI

```bash
cargo add lean-format --git https://github.com/ahmadhatahet/lean-format.git
cargo install --git https://github.com/ahmadhatahet/lean-format.git --package lean-format-cli
```

## Usage: JavaScript and TypeScript

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

## Usage: Python

```python
from lean_format import dumps, loads, encode, decode

text = dumps({"users": [{"id": 1, "name": "Alice"}]})
value = loads(text)
assert decode(encode(value)) == value
```

Python exports both `encode`/`decode` and the JSON-style aliases `dumps`/`loads`.
LEAN normalizes equivalent numeric spellings (`1.0` encodes as `1`), so decoding an integral float may return an integer in Python.

## Usage: CLI

```bash
lean encode data.json       # writes data.lean beside the input
lean decode data.lean       # writes data.json beside the input
lean encode data.json -o out.lean
```

The CLI overwrites its destination file. It reports failures to stderr and exits nonzero.

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

**LEAN** — the same data in LEAN's tab-delimited syntax:

```
employees[2]:id	name	department	active
  1	Paul Garcia	Engineering	T
  2	Aaron Davis	Finance	F
```

The header declares the row count and column names once; rows are tab-delimited.

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

The Rust API returns `Result` values. Python raises `LeanParseError` with `line` and `content` attributes; the Node.js API exports the same error class.

## CLI and release development

The Rust core lives in `crates/lean-format`; bindings are in `bindings/python` and `bindings/node`.

### Run tests locally

From the repository root:

```bash
cargo test --workspace
npm ci
npm test
python3 -m venv .venv
# Windows PowerShell: py -3 -m venv .venv
# Or create it with uv: uv venv .venv
```

Activate the virtual environment, then build and test the Python package:

```bash
# macOS/Linux
source .venv/bin/activate
# Windows PowerShell: .venv\Scripts\Activate.ps1
uv pip install maturin
maturin develop --manifest-path bindings/python/Cargo.toml
python -m unittest discover -s python/tests -v
```

`cargo test --workspace` covers the Rust core and CLI; `npm test` builds the native Node.js addon and runs its API tests; the Python commands build the local extension and test the Python API against the shared fixtures.

### Install and uninstall locally

Build and pack the local Node package, then install its tarball in a consuming project:

```bash
npm ci
npm test
npm pack
# in the consuming project's directory; adjust the relative path as needed
npm install ../lean-format/lean-format-1.1.0.tgz
npm uninstall lean-format
```

In the activated Python virtual environment above, `maturin develop --manifest-path bindings/python/Cargo.toml` installs this checkout; remove it with `uv pip uninstall lean-format`.

Install and remove the CLI from this checkout with:

```bash
cargo install --path crates/lean-cli
cargo uninstall lean-format-cli
```

For a Rust library consumer, point Cargo at this checkout and remove the dependency when done:

```bash
cargo add lean-format --path ../lean-format/crates/lean-format
cargo remove lean-format
```

### Install and uninstall from the GitHub fork

In consuming projects, install and remove this fork with:

```bash
# Node.js
npm install github:ahmadhatahet/lean-format#main
npm uninstall lean-format

# Python (inside a uv project)
uv add git+https://github.com/ahmadhatahet/lean-format.git
uv remove lean-format

# Rust library dependency
cargo add lean-format --git https://github.com/ahmadhatahet/lean-format.git
cargo remove lean-format

# Rust CLI
cargo install --git https://github.com/ahmadhatahet/lean-format.git --package lean-format-cli
cargo uninstall lean-format-cli
```

For the local Python test environment, leave it with `deactivate` and remove `.venv` (`rm -rf .venv` on macOS/Linux or `Remove-Item -Recurse -Force .venv` in PowerShell).

The npm addon uses N-API platform packages. After the native artifact workflow passes, run `npx napi pre-publish -t npm` to publish the platform packages and prepare the root package, then publish the root npm package. Python wheels are built with maturin; publish the Cargo core crate before the CLI crate.

The release configuration builds and checks Node.js and Python on macOS, Linux, and Windows across x64 and arm64. Node.js targets Linux x64 glibc and musl, plus arm64 glibc. Publishing requires the corresponding registry accounts and credentials.

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
