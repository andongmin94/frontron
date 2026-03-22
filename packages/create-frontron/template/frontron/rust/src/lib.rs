use std::ffi::CStr;
use std::os::raw::c_char;

#[no_mangle]
pub extern "C" fn frontron_native_ready() -> i32 {
    1
}

#[no_mangle]
pub extern "C" fn frontron_native_add(left: i32, right: i32) -> i32 {
    left + right
}

#[no_mangle]
pub extern "C" fn frontron_native_is_ready() -> bool {
    true
}

#[no_mangle]
pub extern "C" fn frontron_native_average(left: f64, right: f64) -> f64 {
    (left + right) / 2.0
}

#[no_mangle]
pub extern "C" fn frontron_system_cpu_count() -> i32 {
    std::thread::available_parallelism()
        .map(|value| value.get() as i32)
        .unwrap_or(1)
}

#[no_mangle]
pub extern "C" fn frontron_file_has_txt_extension(path: *const c_char) -> bool {
    if path.is_null() {
        return false;
    }

    let Ok(path) = unsafe { CStr::from_ptr(path) }.to_str() else {
        return false;
    };

    path.to_ascii_lowercase().ends_with(".txt")
}
