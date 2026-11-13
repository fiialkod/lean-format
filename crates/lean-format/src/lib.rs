use serde_json::{Map, Number, Value};
use std::fmt;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LeanParseError {
    pub line: usize,
    pub content: String,
    pub message: String,
}

impl fmt::Display for LeanParseError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "Line {}: {} → \"{}\"",
            self.line, self.message, self.content
        )
    }
}

impl std::error::Error for LeanParseError {}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EncodeError(pub String);

impl fmt::Display for EncodeError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}
impl std::error::Error for EncodeError {}

fn err(line: usize, content: impl Into<String>, message: impl Into<String>) -> LeanParseError {
    LeanParseError {
        line: line + 1,
        content: content.into(),
        message: message.into(),
    }
}

fn valid_key(key: &str) -> bool {
    let mut chars = key.chars();
    chars
        .next()
        .is_some_and(|c| c.is_ascii_alphanumeric() || c == '_')
        && chars.all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

fn validate_key(key: &str) -> Result<(), EncodeError> {
    if valid_key(key) {
        Ok(())
    } else {
        Err(EncodeError(format!("Unsupported key \"{key}\". Keys must match /^[\\w][\\w-]*$/ (word chars and hyphens). No dots (reserved for path flattening), spaces, slashes, or colons.")))
    }
}

fn is_scalar(v: &Value) -> bool {
    !v.is_array() && !v.is_object()
}

fn needs_quoting(s: &str) -> bool {
    s.is_empty()
        || matches!(s, "T" | "F" | "_")
        || s.trim() != s
        || number_like(s)
        || s.contains(['\t', '\n', '\\', '"'])
}

fn number_like(s: &str) -> bool {
    if s.is_empty() {
        return false;
    }
    let b = s.as_bytes();
    let mut i = usize::from(b[0] == b'-');
    if i == b.len() {
        return false;
    }
    let mut digits = 0;
    while i < b.len() && b[i].is_ascii_digit() {
        i += 1;
        digits += 1;
    }
    if i < b.len() && b[i] == b'.' {
        i += 1;
        while i < b.len() && b[i].is_ascii_digit() {
            i += 1;
            digits += 1;
        }
    }
    if digits == 0 {
        return false;
    }
    if i < b.len() && matches!(b[i], b'e' | b'E') {
        i += 1;
        if i < b.len() && matches!(b[i], b'+' | b'-') {
            i += 1;
        }
        let start = i;
        while i < b.len() && b[i].is_ascii_digit() {
            i += 1;
        }
        if i == start {
            return false;
        }
    }
    i == b.len()
}

fn escape_scalar(s: &str) -> String {
    s.replace('\\', "\\\\")
        .replace('\n', "\\n")
        .replace('"', "\\\"")
}

fn encode_scalar(s: &str, force: bool) -> String {
    if force || needs_quoting(s) {
        format!("\"{}\"", escape_scalar(s))
    } else {
        s.to_owned()
    }
}

fn number_text(n: &Number) -> String {
    let raw = n.to_string();
    if !raw.contains(['.', 'e', 'E']) {
        return raw;
    }
    let Some(value) = n.as_f64() else { return raw };
    let mut buffer = ryu_js::Buffer::new();
    buffer.format(value).to_owned()
}

fn primitive(v: &Value) -> Result<String, EncodeError> {
    Ok(match v {
        Value::Null => "_".into(),
        Value::Bool(true) => "T".into(),
        Value::Bool(false) => "F".into(),
        Value::Number(n) => number_text(n),
        Value::String(s) => encode_scalar(s, false),
        _ => return Err(EncodeError("Not a primitive".into())),
    })
}

fn cell(v: &Value) -> Result<String, EncodeError> {
    Ok(match v {
        Value::Null => "_".into(),
        Value::Bool(true) => "T".into(),
        Value::Bool(false) => "F".into(),
        Value::Number(n) => number_text(n),
        Value::String(s) if needs_quoting(s) => format!(
            "\"{}\"",
            s.replace('\\', "\\\\")
                .replace('\n', "\\n")
                .replace('"', "\"\"")
        ),
        Value::String(s) => s.clone(),
        _ => return Err(EncodeError("Not a scalar cell value".into())),
    })
}

pub fn encode(data: &Value) -> Result<String, EncodeError> {
    match data {
        Value::Null | Value::Bool(_) | Value::Number(_) => primitive(data),
        Value::String(s) => Ok(encode_scalar(s, true)),
        Value::Array(arr) => {
            let mut out = Vec::new();
            encode_array("", arr, &mut out, 0)?;
            Ok(out.join("\n"))
        }
        Value::Object(obj) if obj.is_empty() => Ok("{}".into()),
        Value::Object(obj) => {
            let mut out = Vec::new();
            for (k, v) in obj {
                validate_key(k)?;
                encode_property(k, v, &mut out, 0)?;
            }
            Ok(out.join("\n"))
        }
    }
}

fn cost(lines: &[String]) -> usize {
    lines.iter().map(|s| s.len() + 1).sum()
}

fn encode_property(
    path: &str,
    value: &Value,
    out: &mut Vec<String>,
    indent: usize,
) -> Result<(), EncodeError> {
    let pad = "  ".repeat(indent);
    if is_scalar(value) {
        out.push(format!("{pad}{path}:{}", primitive(value)?));
        return Ok(());
    }
    if let Value::Array(arr) = value {
        return encode_array(path, arr, out, indent);
    }
    let obj = value.as_object().unwrap();
    if obj.is_empty() {
        out.push(format!("{pad}{path}:{{}}"));
        return Ok(());
    }
    if indent == 0 {
        let mut dot = Vec::new();
        for (k, v) in obj {
            validate_key(k)?;
            encode_property(&format!("{path}.{k}"), v, &mut dot, 0)?;
        }
        let mut block = vec![format!("{path}:")];
        for (k, v) in obj {
            validate_key(k)?;
            encode_property(k, v, &mut block, 1)?;
        }
        out.extend(if cost(&dot) <= cost(&block) {
            dot
        } else {
            block
        });
    } else {
        out.push(format!("{pad}{path}:"));
        for (k, v) in obj {
            validate_key(k)?;
            encode_property(k, v, out, indent + 1)?;
        }
    }
    Ok(())
}

fn encode_array(
    path: &str,
    arr: &[Value],
    out: &mut Vec<String>,
    indent: usize,
) -> Result<(), EncodeError> {
    let pad = "  ".repeat(indent);
    if arr.is_empty() {
        out.push(format!("{pad}{path}[0]:"));
        return Ok(());
    }
    if arr.iter().all(is_scalar) {
        out.push(format!(
            "{pad}{path}[{}]:{}",
            arr.len(),
            arr.iter()
                .map(cell)
                .collect::<Result<Vec<_>, _>>()?
                .join("\t")
        ));
        return Ok(());
    }
    if tabular(arr) {
        let obj = arr[0].as_object().unwrap();
        let fields: Vec<_> = obj.keys().collect();
        for k in &fields {
            validate_key(k)?;
        }
        out.push(format!(
            "{pad}{path}[{}]:{}",
            arr.len(),
            fields
                .iter()
                .map(|s| s.as_str())
                .collect::<Vec<_>>()
                .join("\t")
        ));
        for row in arr {
            let map = row.as_object().unwrap();
            out.push(format!(
                "{pad}  {}",
                fields
                    .iter()
                    .map(|k| cell(&map[*k]))
                    .collect::<Result<Vec<_>, _>>()?
                    .join("\t")
            ));
        }
        return Ok(());
    }
    if arr.iter().all(Value::is_object) {
        let objects: Vec<_> = arr.iter().map(|v| v.as_object().unwrap()).collect();
        if objects.iter().all(|o| o.values().all(is_scalar)) && objects.len() >= 2 {
            let shared: Vec<_> = objects[0]
                .keys()
                .filter(|k| objects.iter().all(|o| o.contains_key(*k)))
                .collect();
            if !shared.is_empty() {
                for k in &shared {
                    validate_key(k)?;
                }
                let mut semi = vec![format!(
                    "{pad}{path}[{}]:{}\t~",
                    arr.len(),
                    shared
                        .iter()
                        .map(|s| s.as_str())
                        .collect::<Vec<_>>()
                        .join("\t")
                )];
                for obj in &objects {
                    let mut cells = shared
                        .iter()
                        .map(|k| cell(&obj[*k]))
                        .collect::<Result<Vec<_>, _>>()?;
                    for (k, v) in obj.iter() {
                        if !shared.iter().any(|s| *s == k) {
                            validate_key(k)?;
                            cells.push(format!("{k}:{}", cell(v)?));
                        }
                    }
                    semi.push(format!("{pad}  {}", cells.join("\t")));
                }
                let mut dashed = vec![format!("{pad}{path}[{}]:", arr.len())];
                for item in arr {
                    encode_list_item(item, &mut dashed, indent + 1)?;
                }
                out.extend(if cost(&semi) < cost(&dashed) {
                    semi
                } else {
                    dashed
                });
                return Ok(());
            }
        }
    }
    out.push(format!("{pad}{path}[{}]:", arr.len()));
    for item in arr {
        encode_list_item(item, out, indent + 1)?;
    }
    Ok(())
}

fn tabular(arr: &[Value]) -> bool {
    let Some(first) = arr.first().and_then(Value::as_object) else {
        return false;
    };
    arr.iter().all(|v| {
        v.as_object().is_some_and(|o| {
            o.len() == first.len()
                && first.keys().all(|key| o.contains_key(key))
                && o.values().all(is_scalar)
        })
    })
}

fn encode_list_item(item: &Value, out: &mut Vec<String>, indent: usize) -> Result<(), EncodeError> {
    let pad = "  ".repeat(indent);
    if let Value::String(s) = item {
        out.push(format!("{pad}- {}", encode_scalar(s, false)));
        return Ok(());
    }
    if is_scalar(item) {
        out.push(format!("{pad}- {}", primitive(item)?));
        return Ok(());
    }
    if let Value::Array(arr) = item {
        let mut sub = Vec::new();
        encode_array("", arr, &mut sub, 0)?;
        out.push(format!("{pad}- {}", sub[0]));
        out.extend(sub.into_iter().skip(1).map(|s| format!("{pad}  {s}")));
        return Ok(());
    }
    let obj = item.as_object().unwrap();
    if obj.is_empty() {
        out.push(format!("{pad}- {{}}"));
        return Ok(());
    }
    let (first, val) = obj.iter().next().unwrap();
    validate_key(first)?;
    match val {
        Value::Array(arr) => {
            let mut sub = Vec::new();
            encode_array(first, arr, &mut sub, 0)?;
            out.push(format!("{pad}- {}", sub[0]));
            out.extend(sub.into_iter().skip(1).map(|s| format!("{pad}  {s}")));
        }
        Value::Object(nested) if !nested.is_empty() => {
            out.push(format!("{pad}- {first}:"));
            for (k, v) in nested {
                validate_key(k)?;
                encode_property(k, v, out, indent + 2)?;
            }
        }
        Value::Object(_) => out.push(format!("{pad}- {first}:{{}}")),
        _ => out.push(format!("{pad}- {first}:{}", primitive(val)?)),
    }
    let mut iter = obj.iter();
    iter.next();
    for (k, v) in iter {
        validate_key(k)?;
        encode_property(k, v, out, indent + 1)?;
    }
    Ok(())
}

fn unescape_scalar(s: &str) -> String {
    let mut out = String::new();
    let mut it = s.chars().peekable();
    while let Some(c) = it.next() {
        if c == '\\' {
            match it.peek() {
                Some('n') => {
                    it.next();
                    out.push('\n');
                }
                Some('\\') => {
                    it.next();
                    out.push('\\');
                }
                Some('"') => {
                    it.next();
                    out.push('"');
                }
                _ => out.push('\\'),
            }
        } else {
            out.push(c);
        }
    }
    out
}

fn unescape_cell(s: &str) -> String {
    let mut out = String::new();
    let mut it = s.chars().peekable();
    while let Some(c) = it.next() {
        if c == '"' && it.peek() == Some(&'"') {
            it.next();
            out.push('"');
        } else if c == '\\' {
            match it.peek() {
                Some('n') => {
                    it.next();
                    out.push('\n');
                }
                Some('\\') => {
                    it.next();
                    out.push('\\');
                }
                _ => out.push('\\'),
            }
        } else {
            out.push(c);
        }
    }
    out
}

fn parse_value(s: &str, cell: bool) -> Value {
    let s = s.trim();
    if s == "T" {
        return Value::Bool(true);
    }
    if s == "F" {
        return Value::Bool(false);
    }
    if s == "_" {
        return Value::Null;
    }
    if s.is_empty() {
        return Value::String(String::new());
    }
    if s.starts_with('"') && s.ends_with('"') && s.len() >= 2 {
        return Value::String(if cell {
            unescape_cell(&s[1..s.len() - 1])
        } else {
            unescape_scalar(&s[1..s.len() - 1])
        });
    }
    if number_like(s) {
        if let Ok(n) = serde_json::from_str::<Number>(s) {
            return Value::Number(n);
        }
    }
    Value::String(s.to_owned())
}

#[derive(Clone)]
struct State<'a> {
    lines: Vec<&'a str>,
    i: usize,
}
impl State<'_> {
    fn current(&self) -> &str {
        self.lines.get(self.i).copied().unwrap_or("")
    }
    fn indent(&self) -> usize {
        self.current()
            .chars()
            .take_while(|c| c.is_whitespace())
            .count()
    }
}

fn parse_error(state: &State<'_>, msg: impl Into<String>) -> LeanParseError {
    err(state.i, state.current().trim(), msg)
}

fn split_cells(s: &str) -> Result<Vec<String>, String> {
    let mut cells = Vec::new();
    let mut current = String::new();
    let mut quote = false;
    let mut it = s.chars().peekable();
    while let Some(c) = it.next() {
        if quote {
            if c == '"' {
                if it.peek() == Some(&'"') {
                    it.next();
                    current.push_str("\"\"");
                } else {
                    quote = false;
                    current.push(c);
                }
            } else {
                current.push(c);
            }
        } else if c == '"' {
            quote = true;
            current.push(c);
        } else if c == '\t' {
            cells.push(std::mem::take(&mut current));
        } else {
            current.push(c);
        }
    }
    cells.push(current);
    if quote {
        Err(format!("Unterminated quote in row: \"{s}\""))
    } else {
        Ok(cells)
    }
}

fn parse_cells(s: &str) -> Result<Vec<Value>, String> {
    split_cells(s).map(|c| c.iter().map(|s| parse_value(s, true)).collect())
}

fn header<'a>(s: &'a str) -> Option<(&'a str, usize, &'a str)> {
    let open = s.find('[')?;
    let close = s[open + 1..].find("]:")? + open + 1;
    let key = &s[..open];
    let count = s[open + 1..close].parse().ok()?;
    Some((key, count, &s[close + 2..]))
}
fn kv(s: &str) -> Option<(&str, &str)> {
    let (k, v) = s.split_once(':')?;
    if k.is_empty()
        || !k
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-' || c == '.')
        || !k.chars().next()?.is_ascii_alphanumeric() && !k.starts_with('_')
    {
        None
    } else {
        Some((k, v))
    }
}
fn nested_set(
    target: &mut Map<String, Value>,
    path: &str,
    value: Value,
    state: &State<'_>,
) -> Result<(), LeanParseError> {
    let parts: Vec<_> = path.split('.').collect();
    let mut at = target;
    for part in &parts[..parts.len() - 1] {
        if !at.contains_key(*part) {
            at.insert((*part).into(), Value::Object(Map::new()));
        }
        at = at
            .get_mut(*part)
            .and_then(Value::as_object_mut)
            .ok_or_else(|| {
                parse_error(state, format!("Cannot nest into non-object at \"{part}\""))
            })?;
    }
    let last = parts[parts.len() - 1];
    if at.contains_key(last) {
        return Err(parse_error(state, format!("Duplicate key \"{last}\"")));
    }
    at.insert(last.into(), value);
    Ok(())
}

fn parse_rows(
    st: &mut State<'_>,
    count: usize,
    fields: &[String],
    min_indent: usize,
    semi: bool,
    header_text: &str,
) -> Result<Value, LeanParseError> {
    let mut rows = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for f in fields {
        if !seen.insert(f) {
            return Err(parse_error(st, format!("Duplicate field \"{f}\"")));
        }
    }
    while rows.len() < count && st.i < st.lines.len() {
        if st.current().trim().is_empty() {
            st.i += 1;
            continue;
        }
        if st.indent() < min_indent {
            break;
        }
        let line = st.current().trim();
        let cells = split_cells(line).map_err(|m| parse_error(st, m))?;
        if cells.len() < fields.len() || (!semi && cells.len() != fields.len()) {
            return Err(parse_error(
                st,
                if semi {
                    format!(
                        "Row field count mismatch (expected at least {}, got {})",
                        fields.len(),
                        cells.len()
                    )
                } else {
                    format!(
                        "Row field count mismatch (expected {}, got {})",
                        fields.len(),
                        cells.len()
                    )
                },
            ));
        }
        let mut obj = Map::new();
        for (f, c) in fields.iter().zip(cells.iter()) {
            obj.insert(f.clone(), parse_value(c, true));
        }
        for c in cells.iter().skip(fields.len()) {
            let Some((k, v)) = c.split_once(':') else {
                return Err(parse_error(
                    st,
                    format!("Semi-tabular extra cell missing key:value format: \"{c}\""),
                ));
            };
            if obj.contains_key(k) {
                return Err(parse_error(st, format!("Duplicate key \"{k}\"")));
            }
            obj.insert(k.to_owned(), parse_value(v, true));
        }
        rows.push(Value::Object(obj));
        st.i += 1;
    }
    if rows.len() != count {
        return Err(err(
            st.i.saturating_sub(1),
            header_text,
            format!("Row count mismatch (declared {count}, got {})", rows.len()),
        ));
    }
    Ok(Value::Array(rows))
}

fn parse_array(st: &mut State<'_>, indent: usize, count: usize) -> Result<Value, LeanParseError> {
    let mut arr = Vec::new();
    let item_indent = indent + 2;
    while arr.len() < count && st.i < st.lines.len() {
        if st.current().trim().is_empty() {
            st.i += 1;
            continue;
        }
        let ind = st.indent();
        if ind < item_indent {
            break;
        }
        let c = st.current()[ind..].trim_end().to_owned();
        if c == "{}" {
            arr.push(Value::Object(Map::new()));
            st.i += 1;
            continue;
        }
        if let Some(rest) = c.strip_prefix("- ") {
            if rest == "{}" {
                arr.push(Value::Object(Map::new()));
                st.i += 1;
                continue;
            }
            if rest.starts_with('[') {
                if let Some((_, n, tail)) = header(rest) {
                    if tail.is_empty() {
                        st.i += 1;
                        arr.push(parse_array(st, ind, n)?);
                        continue;
                    }
                    if tail.starts_with('[') { /* malformed below */
                    } else {
                        let vals = parse_cells(tail).map_err(|m| parse_error(st, m))?;
                        if vals.len() != n {
                            return Err(parse_error(st, "Array count mismatch"));
                        }
                        arr.push(Value::Array(vals));
                        st.i += 1;
                        continue;
                    }
                }
            }
            if let Some((key, v)) = kv(rest) {
                let mut obj = Map::new();
                if v.is_empty() {
                    obj.insert(key.into(), Value::Object(Map::new()));
                } else {
                    obj.insert(key.into(), parse_value(v, false));
                }
                st.i += 1;
                let mut v = Value::Object(obj);
                if v.as_object().unwrap().values().any(Value::is_object)
                    && st.i < st.lines.len()
                    && st.indent() >= ind + 4
                {
                    let nested = parse_block(st, ind + 4)?;
                    v.as_object_mut()
                        .unwrap()
                        .insert(key.into(), Value::Object(nested));
                }
                if st.i < st.lines.len()
                    && st.indent() >= ind + 2
                    && !(st.current()[st.indent()..].starts_with("- "))
                {
                    let restobj = parse_block(st, ind + 2)?;
                    for (k, x) in restobj {
                        if v.as_object().unwrap().contains_key(&k) {
                            return Err(parse_error(st, format!("Duplicate key \"{k}\"")));
                        }
                        v.as_object_mut().unwrap().insert(k, x);
                    }
                }
                arr.push(v);
                continue;
            }
            arr.push(parse_value(rest, false));
            st.i += 1;
            continue;
        }
        // Root array item forms without a dash, used for subarrays.
        if let Some((_, n, tail)) = header(&c) {
            if tail.is_empty() {
                st.i += 1;
                arr.push(parse_array(st, ind, n)?);
            } else {
                let vals = parse_cells(tail).map_err(|m| parse_error(st, m))?;
                if vals.len() != n {
                    return Err(parse_error(st, "Array count mismatch"));
                }
                arr.push(Value::Array(vals));
                st.i += 1;
            }
            continue;
        }
        return Err(parse_error(st, "Unrecognized list item"));
    }
    if arr.len() != count {
        return Err(parse_error(
            st,
            format!("List count mismatch (declared {count}, got {})", arr.len()),
        ));
    }
    Ok(Value::Array(arr))
}

fn parse_block(st: &mut State<'_>, base: usize) -> Result<Map<String, Value>, LeanParseError> {
    let mut out = Map::new();
    while st.i < st.lines.len() {
        if st.current().trim().is_empty() {
            st.i += 1;
            continue;
        }
        let ind = st.indent();
        if ind < base {
            break;
        }
        let text = st.current()[ind..].trim_end().to_owned();
        if text == "{}" {
            st.i += 1;
            continue;
        }
        if let Some((path, n, tail)) = header(&text) {
            if path.is_empty() {
                return Err(parse_error(st, "Invalid array header"));
            }
            if n == 0 && tail.trim().is_empty() {
                nested_set(&mut out, path, Value::Array(vec![]), st)?;
                st.i += 1;
                continue;
            }
            if tail.is_empty() {
                st.i += 1;
                nested_set(&mut out, path, parse_array(st, ind, n)?, st)?;
                continue;
            }
            let fields: Vec<String> = tail.split('\t').map(str::to_owned).collect();
            let mut peek = st.i + 1;
            while peek < st.lines.len() && st.lines[peek].trim().is_empty() {
                peek += 1
            }
            let row = n > 0
                && peek < st.lines.len()
                && st.lines[peek]
                    .chars()
                    .take_while(|c| c.is_whitespace())
                    .count()
                    >= ind + 2;
            if row {
                let semi = fields.last().is_some_and(|s| s == "~");
                let mut fs = fields;
                if semi {
                    fs.pop();
                }
                st.i += 1;
                let v = parse_rows(st, n, &fs, ind + 2, semi, &text)?;
                nested_set(&mut out, path, v, st)?;
                continue;
            }
            let vals = parse_cells(tail).map_err(|m| parse_error(st, m))?;
            if vals.len() != n {
                return Err(parse_error(
                    st,
                    format!("Array count mismatch (declared {n}, got {})", vals.len()),
                ));
            }
            nested_set(&mut out, path, Value::Array(vals), st)?;
            st.i += 1;
            continue;
        }
        if let Some((k, v)) = kv(&text) {
            if v == "{}" {
                nested_set(&mut out, k, Value::Object(Map::new()), st)?;
                st.i += 1;
                continue;
            }
            if v.is_empty() {
                st.i += 1;
                let nested = parse_block(st, ind + 2)?;
                nested_set(&mut out, k, Value::Object(nested), st)?;
                continue;
            }
            if v.starts_with('[') {
                if let Some((_, n, tail)) = header(v) {
                    let vals = parse_cells(tail).map_err(|m| parse_error(st, m))?;
                    if vals.len() != n {
                        return Err(parse_error(st, "Array count mismatch"));
                    }
                    nested_set(&mut out, k, Value::Array(vals), st)?;
                    st.i += 1;
                    continue;
                }
            }
            nested_set(&mut out, k, parse_value(v, false), st)?;
            st.i += 1;
            continue;
        }
        return Err(parse_error(st, "Unrecognized LEAN syntax"));
    }
    Ok(out)
}

pub fn decode(input: &str) -> Result<Value, LeanParseError> {
    let lines: Vec<_> = input.split('\n').collect();
    let mut st = State { lines, i: 0 };
    while st.i < st.lines.len() && st.current().trim().is_empty() {
        st.i += 1
    }
    if st.i >= st.lines.len() {
        return Err(err(0, "", "Empty LEAN document"));
    }
    let first = st.current().trim().to_owned();
    let value = match first.as_str() {
        "{}" => {
            st.i += 1;
            Value::Object(Map::new())
        }
        "T" => {
            st.i += 1;
            Value::Bool(true)
        }
        "F" => {
            st.i += 1;
            Value::Bool(false)
        }
        "_" => {
            st.i += 1;
            Value::Null
        }
        _ if first.starts_with('"') && first.ends_with('"') && first.len() >= 2 => {
            st.i += 1;
            Value::String(unescape_scalar(&first[1..first.len() - 1]))
        }
        _ if number_like(&first) => {
            st.i += 1;
            serde_json::from_str::<Value>(&first).map_err(|_| parse_error(&st, "Invalid number"))?
        }
        _ => {
            if first.starts_with('[') {
                if let Some((_, n, tail)) = header(&first) {
                    if n == 0 && tail.is_empty() {
                        st.i += 1;
                        Value::Array(vec![])
                    } else if tail.is_empty() {
                        st.i += 1;
                        parse_array(&mut st, 0, n)?
                    } else {
                        let fs: Vec<String> = tail.split('\t').map(str::to_owned).collect();
                        let mut peek = st.i + 1;
                        while peek < st.lines.len() && st.lines[peek].trim().is_empty() {
                            peek += 1
                        }
                        if n > 0
                            && peek < st.lines.len()
                            && st.lines[peek]
                                .chars()
                                .take_while(|c| c.is_whitespace())
                                .count()
                                >= 2
                        {
                            let semi = fs.last().is_some_and(|s| s == "~");
                            let mut fs = fs;
                            if semi {
                                fs.pop();
                            }
                            st.i += 1;
                            parse_rows(&mut st, n, &fs, 2, semi, &first)?
                        } else {
                            let vals = parse_cells(tail).map_err(|m| parse_error(&st, m))?;
                            if vals.len() != n {
                                return Err(parse_error(&st, "Array count mismatch"));
                            }
                            st.i += 1;
                            Value::Array(vals)
                        }
                    }
                } else {
                    return Err(parse_error(&st, "Unrecognized root array syntax"));
                }
            } else {
                Value::Object(parse_block(&mut st, 0)?)
            }
        }
    };
    while st.i < st.lines.len() {
        if !st.current().trim().is_empty() {
            return Err(parse_error(&st, "Unexpected trailing content"));
        }
        st.i += 1
    }
    Ok(value)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn v(s: &str) -> Value {
        serde_json::from_str(s).unwrap()
    }
    fn round(value: Value) {
        let text = encode(&value).unwrap();
        assert!(same_json(&decode(&text).unwrap(), &value), "{text}");
    }
    fn same_json(a: &Value, b: &Value) -> bool {
        match (a, b) {
            (Value::Number(a), Value::Number(b)) => a == b || a.as_f64() == b.as_f64(),
            (Value::Array(a), Value::Array(b)) => {
                a.len() == b.len() && a.iter().zip(b).all(|(a, b)| same_json(a, b))
            }
            (Value::Object(a), Value::Object(b)) => {
                a.len() == b.len()
                    && a.iter()
                        .all(|(k, v)| b.get(k).is_some_and(|other| same_json(v, other)))
            }
            _ => a == b,
        }
    }
    #[test]
    fn primitives_and_root_values() {
        for s in [
            "true",
            "false",
            "null",
            "0",
            "-3.14",
            "1e10",
            "\"hello\"",
            "\"\"",
            "\"42\"",
            "\"T\"",
            "\"hello world\"",
            "{}",
            "[]",
        ] {
            round(v(s));
        }
    }
    #[test]
    fn nested_and_arrays() {
        for s in [
            r#"{"a":1,"b":"hello","c":true}"#,
            r#"{"config":{"db":{"host":"localhost","port":5432},"debug":false}}"#,
            r#"{"users":[{"id":1,"name":"Alice"},{"id":2,"name":"Bob"}]}"#,
            r#"{"m":[1,"hello",{"key":"val"}]}"#,
            r#"{"items":[{"config":{"host":"localhost","port":8080}},{"config":{"host":"remote","port":9090}}]}"#,
            r#"{"empty":{},"arr":[[],{},[""]]}"#,
        ] {
            round(v(s));
        }
    }
    #[test]
    fn escaping_and_cells() {
        for s in [
            r#"{"path":"C:\\Users\\test"}"#,
            r#"{"x":"she said \"hi\""}"#,
            r#"{"a":"real\nnewline","b":"literal\\nnot"}"#,
            r#"{"rows":[{"msg":"a\\tb","id":1},{"msg":"line1\nline2","id":2}]}"#,
        ] {
            round(v(s));
        }
    }
    #[test]
    fn semi_tabular_and_root_arrays() {
        for s in [
            r#"[{"type":"a","val":1},{"type":"b","val":2,"extra":true}]"#,
            r#"{"events":[{"type":"click","target":"btn"},{"type":"pageview","url":"/home"},{"type":"error","message":"oops","severity":"high"}]}"#,
            r#"{"items":[{"id":1,"name":"Alice"},{"id":2,"name":"","tag":"new"}]}"#,
        ] {
            round(v(s));
        }
    }
    #[test]
    fn invalid_keys_and_parse_errors() {
        for bad in [r#"{"a.b":1}"#, r#"{"first name":1}"#, r#"{"a:b":1}"#] {
            assert!(encode(&v(bad)).is_err());
        }
        assert!(encode(&v(r#"{"foo":1,"bar_baz":2,"x1":3,"c-d":4}"#)).is_ok());
        assert!(decode("").is_err());
        assert!(decode("hello").is_err());
        assert!(decode("a:1\na:2").is_err());
        assert!(decode("42\ngarbage").is_err());
        assert!(decode("[2]:1").is_err());
        assert!(decode("[2]:id\tid\n  1\t2\n  3\t4").is_err());
    }

    #[test]
    fn compact_boolean_null_and_empty_string_encodings() {
        assert_eq!(
            encode(&v(r#"{"active":true,"deleted":false,"value":null}"#)).unwrap(),
            "active:T\ndeleted:F\nvalue:_"
        );
        assert_eq!(encode(&v(r#"{"name":""}"#)).unwrap(), "name:\"\"");
        assert_eq!(
            encode(&v(r#"{"host":"localhost"}"#)).unwrap(),
            "host:localhost"
        );
    }
    #[test]
    fn examples() {
        assert_eq!(
            encode(&v(
                r#"{"users":[{"id":1,"name":"Alice"},{"id":2,"name":"Bob"}]}"#
            ))
            .unwrap(),
            "users[2]:id\tname\n  1\tAlice\n  2\tBob"
        );
    }

    #[test]
    fn shared_fixtures_round_trip_and_match_golden_text() {
        let cases: Vec<Value> =
            serde_json::from_str(include_str!("../../../fixtures/roundtrip.json")).unwrap();
        for (index, value) in cases.iter().enumerate() {
            let encoded = encode(value).unwrap_or_else(|e| panic!("fixture {index}: {e}"));
            assert_eq!(
                decode(&encoded).unwrap(),
                *value,
                "fixture {index}: {encoded}"
            );
        }
        let golden: Vec<serde_json::Value> =
            serde_json::from_str(include_str!("../../../fixtures/golden.json")).unwrap();
        for case in golden {
            let value = &case["value"];
            let expected = case["lean"].as_str().unwrap();
            assert_eq!(encode(value).unwrap(), expected);
            assert!(same_json(&decode(expected).unwrap(), value));
        }
    }

    #[test]
    fn errors_report_duplicate_keys_and_count_mismatches() {
        let duplicate = decode("a:1\na:2").unwrap_err();
        assert_eq!(duplicate.line, 2);
        assert_eq!(duplicate.content, "a:2");
        let mismatch = decode("a[2]:1").unwrap_err();
        assert_eq!(mismatch.line, 1);
    }

    #[test]
    fn insertion_order_is_preserved_in_objects_and_table_headers() {
        let value = v(r#"{"z":1,"a":2,"rows":[{"z":3,"a":4},{"z":5,"a":6}]}"#);
        let encoded = encode(&value).unwrap();
        assert!(encoded.starts_with("z:1\na:2\nrows[2]:z\ta"));
        assert_eq!(decode(&encoded).unwrap(), value);
    }

    #[test]
    fn tabular_detection_ignores_row_key_order_but_keeps_first_row_header_order() {
        let value = v(r#"[{"z":1,"a":2},{"a":4,"z":3}]"#);
        let encoded = encode(&value).unwrap();
        assert_eq!(encoded, "[2]:z\ta\n  1\t2\n  3\t4");
        assert_eq!(decode(&encoded).unwrap(), value);
    }

    #[test]
    fn exact_encodings_for_core_shapes() {
        assert_eq!(
            encode(&v(r#"{"meta":{"version":"2.1.0","debug":false}}"#)).unwrap(),
            "meta.version:2.1.0\nmeta.debug:F"
        );
        assert_eq!(
            encode(&v(r#"{"items":[1,2,3]}"#)).unwrap(),
            "items[3]:1\t2\t3"
        );
        assert_eq!(encode(&v(r#"{"name":""}"#)).unwrap(), "name:\"\"");
        assert_eq!(encode(&v(r#"{"events":[{"type":"click","target":"btn"},{"type":"pageview","url":"/home"},{"type":"error","message":"oops","severity":"high"}]}"#)).unwrap(), "events[3]:type\t~\n  click\ttarget:btn\n  pageview\turl:/home\n  error\tmessage:oops\tseverity:high");
    }
}
