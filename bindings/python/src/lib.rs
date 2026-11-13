use pyo3::{
    create_exception,
    exceptions::PyValueError,
    prelude::*,
    types::{PyDict, PyList, PyModule, PyString, PyTuple},
};
use serde_json::Value;

create_exception!(_lean_format, LeanParseError, PyValueError);

fn py_json(py: Python<'_>, value: &Bound<'_, PyAny>) -> PyResult<Value> {
    validate_keys(value)?;
    let json = py.import("json")?;
    let encoded: String = json.call_method1("dumps", (value,))?.extract()?;
    serde_json::from_str(&encoded)
        .map_err(|e| PyValueError::new_err(format!("Expected JSON-compatible data: {e}")))
}

fn validate_keys(value: &Bound<'_, PyAny>) -> PyResult<()> {
    if let Ok(dict) = value.cast::<PyDict>() {
        for (key, item) in dict.iter() {
            if !key.is_instance_of::<PyString>() {
                return Err(PyValueError::new_err("LEAN object keys must be strings"));
            }
            validate_keys(&item)?;
        }
    } else if let Ok(items) = value.cast::<PyList>() {
        for item in items.iter() {
            validate_keys(&item)?;
        }
    } else if let Ok(items) = value.cast::<PyTuple>() {
        for item in items.iter() {
            validate_keys(&item)?;
        }
    }
    Ok(())
}

fn json_py(py: Python<'_>, value: &Value) -> PyResult<Py<PyAny>> {
    let encoded = serde_json::to_string(value).map_err(|e| PyValueError::new_err(e.to_string()))?;
    Ok(py
        .import("json")?
        .call_method1("loads", (encoded,))?
        .unbind())
}

#[pyfunction]
fn encode(py: Python<'_>, value: &Bound<'_, PyAny>) -> PyResult<String> {
    let value = py_json(py, value)?;
    lean_format::encode(&value).map_err(|e| PyValueError::new_err(e.to_string()))
}

#[pyfunction]
fn decode(py: Python<'_>, input: &str) -> PyResult<Py<PyAny>> {
    let value = lean_format::decode(input).map_err(|e| {
        let error = PyErr::new::<LeanParseError, _>(e.to_string());
        let instance = error.value(py);
        let _ = instance.setattr("line", e.line);
        let _ = instance.setattr("content", e.content);
        error
    })?;
    json_py(py, &value)
}

#[pyfunction]
fn dumps(py: Python<'_>, value: &Bound<'_, PyAny>) -> PyResult<String> {
    encode(py, value)
}

#[pyfunction]
fn loads(py: Python<'_>, input: &str) -> PyResult<Py<PyAny>> {
    decode(py, input)
}

#[pymodule]
fn _lean_format(module: &Bound<'_, PyModule>) -> PyResult<()> {
    module.add("LeanParseError", module.py().get_type::<LeanParseError>())?;
    module.add_function(wrap_pyfunction!(encode, module)?)?;
    module.add_function(wrap_pyfunction!(decode, module)?)?;
    module.add_function(wrap_pyfunction!(dumps, module)?)?;
    module.add_function(wrap_pyfunction!(loads, module)?)?;
    module.add_function(wrap_pyfunction!(encode, module)?)?;
    module.add_function(wrap_pyfunction!(decode, module)?)?;
    Ok(())
}
