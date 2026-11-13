use std::{
    fs,
    path::PathBuf,
    process::Command,
    sync::atomic::{AtomicU64, Ordering},
};

static NEXT_DIR_ID: AtomicU64 = AtomicU64::new(0);

fn scratch() -> PathBuf {
    let id = NEXT_DIR_ID.fetch_add(1, Ordering::Relaxed);
    let path = std::env::temp_dir().join(format!("lean-cli-{}-{id}", std::process::id()));
    fs::create_dir_all(&path).unwrap();
    path
}

#[test]
fn encode_decode_sibling_and_explicit_output_paths() {
    let dir = scratch();
    let input = dir.join("data.json");
    fs::write(&input, r#"{"a":1}"#).unwrap();
    assert!(Command::new(env!("CARGO_BIN_EXE_lean"))
        .args(["encode", input.to_str().unwrap()])
        .status()
        .unwrap()
        .success());
    let lean = dir.join("data.lean");
    assert_eq!(fs::read_to_string(&lean).unwrap(), "a:1");
    let output = dir.join("decoded.json");
    assert!(Command::new(env!("CARGO_BIN_EXE_lean"))
        .args([
            "decode",
            lean.to_str().unwrap(),
            "--output",
            output.to_str().unwrap()
        ])
        .status()
        .unwrap()
        .success());
    assert_eq!(
        serde_json::from_str::<serde_json::Value>(&fs::read_to_string(output).unwrap()).unwrap(),
        serde_json::json!({"a":1})
    );
    fs::remove_dir_all(dir).unwrap();
}

#[test]
fn output_is_overwritten() {
    let dir = scratch();
    let input = dir.join("data.json");
    let output = dir.join("data.lean");
    fs::write(&input, r#"{"a":1}"#).unwrap();
    fs::write(&output, "old contents").unwrap();
    assert!(Command::new(env!("CARGO_BIN_EXE_lean"))
        .args(["encode", input.to_str().unwrap()])
        .status()
        .unwrap()
        .success());
    assert_eq!(fs::read_to_string(output).unwrap(), "a:1");
    fs::remove_dir_all(dir).unwrap();
}

#[test]
fn short_output_option_and_invalid_input_fail_cleanly() {
    let dir = scratch();
    let input = dir.join("data.json");
    let output = dir.join("custom.lean");
    fs::write(&input, r#"{"a":1}"#).unwrap();
    let result = Command::new(env!("CARGO_BIN_EXE_lean"))
        .args([
            "encode",
            input.to_str().unwrap(),
            "-o",
            output.to_str().unwrap(),
        ])
        .output()
        .unwrap();
    assert!(result.status.success());
    assert_eq!(fs::read_to_string(&output).unwrap(), "a:1");

    fs::write(&input, "not json").unwrap();
    let result = Command::new(env!("CARGO_BIN_EXE_lean"))
        .args(["encode", input.to_str().unwrap()])
        .output()
        .unwrap();
    assert!(!result.status.success());
    assert!(!dir.join("data.lean").exists());
    fs::remove_dir_all(dir).unwrap();
}
