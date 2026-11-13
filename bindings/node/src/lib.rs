use napi::{Error, Status};
use napi_derive::napi;
use serde_json::Value;

#[napi]
pub fn encode(value: Value) -> napi::Result<String> {
    lean_format::encode(&value).map_err(|e| Error::new(Status::InvalidArg, e.to_string()))
}

#[napi]
pub fn decode(input: String) -> napi::Result<Value> {
    lean_format::decode(&input).map_err(|e| {
        Error::new(
            Status::GenericFailure,
            format!(
                "LEAN_PARSE_ERROR\t{}",
                serde_json::json!([e.line, e.content, e.message])
            ),
        )
    })
}
