use std::{
    env, fs,
    path::{Path, PathBuf},
    process::ExitCode,
};

fn run() -> Result<(), String> {
    let mut args = env::args().skip(1);
    let mode = args
        .next()
        .ok_or("usage: lean <encode|decode> <input> [-o output]")?;
    if mode != "encode" && mode != "decode" {
        return Err("expected `encode` or `decode`".into());
    }
    let input = PathBuf::from(args.next().ok_or("missing input file")?);
    let mut output = None;
    while let Some(arg) = args.next() {
        if arg == "-o" || arg == "--output" {
            output = Some(PathBuf::from(args.next().ok_or("missing output path")?));
        } else {
            return Err(format!("unexpected argument: {arg}"));
        }
    }
    let source = fs::read_to_string(&input).map_err(|e| format!("{}: {e}", input.display()))?;
    let result = if mode == "encode" {
        let value = serde_json::from_str(&source).map_err(|e| format!("invalid JSON: {e}"))?;
        lean_format::encode(&value).map_err(|e| e.to_string())?
    } else {
        let value = lean_format::decode(&source).map_err(|e| e.to_string())?;
        serde_json::to_string_pretty(&value).map_err(|e| e.to_string())?
    };
    let destination = output
        .unwrap_or_else(|| sibling_path(&input, if mode == "encode" { "lean" } else { "json" }));
    fs::write(&destination, result).map_err(|e| format!("{}: {e}", destination.display()))?;
    Ok(())
}

fn sibling_path(input: &Path, extension: &str) -> PathBuf {
    let mut output = input.to_path_buf();
    output.set_extension(extension);
    output
}

fn main() -> ExitCode {
    match run() {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("lean: {e}");
            ExitCode::FAILURE
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn sibling_extensions_swap() {
        assert_eq!(
            sibling_path(Path::new("data.json"), "lean"),
            PathBuf::from("data.lean")
        );
        assert_eq!(
            sibling_path(Path::new("data.lean"), "json"),
            PathBuf::from("data.json")
        );
    }
}
