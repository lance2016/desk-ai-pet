#[cfg(target_os = "macos")]
mod keychain {
    use std::ffi::c_void;
    use std::ptr;

    const ACCOUNT: &[u8] = b"api-key";
    const NOT_FOUND: i32 = -25300;
    const DUPLICATE: i32 = -25299;
    type Item = *mut c_void;

    #[link(name = "Security", kind = "framework")]
    unsafe extern "C" {
        fn SecKeychainFindGenericPassword(
            keychain: *const c_void,
            service_len: u32,
            service: *const c_void,
            account_len: u32,
            account: *const c_void,
            length: *mut u32,
            data: *mut *mut c_void,
            item: *mut Item,
        ) -> i32;
        fn SecKeychainAddGenericPassword(
            keychain: *const c_void,
            service_len: u32,
            service: *const c_void,
            account_len: u32,
            account: *const c_void,
            length: u32,
            data: *const c_void,
            item: *mut Item,
        ) -> i32;
        fn SecKeychainItemModifyAttributesAndData(
            item: Item,
            attributes: *const c_void,
            length: u32,
            data: *const c_void,
        ) -> i32;
        fn SecKeychainItemDelete(item: Item) -> i32;
        fn SecKeychainItemFreeContent(attributes: *mut c_void, data: *mut c_void) -> i32;
    }
    #[link(name = "CoreFoundation", kind = "framework")]
    unsafe extern "C" {
        fn CFRelease(value: *const c_void);
    }

    /// What the user is told when the keychain says no. -128 is a dismissed
    /// prompt, -25293 a refused password, -25308 no way to ask: all mean the
    /// app was not allowed in, which the user fixes by clicking "Allow".
    fn keychain_error(action: &str, status: i32) -> String {
        log::warn!("Keychain {action} failed ({status})");
        if matches!(status, -128 | -25293 | -25308) {
            "没有钥匙串访问权限，请在系统弹窗里点「允许」后再试。".into()
        } else {
            format!("钥匙串出错了（{status}），请再试一次。")
        }
    }

    fn find(service: &str) -> Result<Option<(Vec<u8>, Item)>, String> {
        let mut length = 0;
        let mut data = ptr::null_mut();
        let mut item = ptr::null_mut();
        let status = unsafe {
            SecKeychainFindGenericPassword(
                ptr::null(),
                service.len() as u32,
                service.as_ptr().cast(),
                ACCOUNT.len() as u32,
                ACCOUNT.as_ptr().cast(),
                &mut length,
                &mut data,
                &mut item,
            )
        };
        if status == NOT_FOUND {
            return Ok(None);
        }
        if status != 0 {
            return Err(keychain_error("lookup", status));
        }
        let bytes = if length == 0 {
            Vec::new()
        } else {
            unsafe { std::slice::from_raw_parts(data.cast::<u8>(), length as usize) }.to_vec()
        };
        unsafe {
            SecKeychainItemFreeContent(ptr::null_mut(), data);
        }
        Ok(Some((bytes, item)))
    }
    pub fn load(service: &str) -> Result<Option<String>, String> {
        match find(service)? {
            None => Ok(None),
            Some((bytes, item)) => {
                unsafe {
                    CFRelease(item.cast());
                }
                String::from_utf8(bytes)
                    .map(Some)
                    .map_err(|_| "Invalid Keychain data".into())
            }
        }
    }
    pub fn save(service: &str, value: &str) -> Result<(), String> {
        let status = unsafe {
            SecKeychainAddGenericPassword(
                ptr::null(),
                service.len() as u32,
                service.as_ptr().cast(),
                ACCOUNT.len() as u32,
                ACCOUNT.as_ptr().cast(),
                value.len() as u32,
                value.as_ptr().cast(),
                ptr::null_mut(),
            )
        };
        if status == 0 {
            return Ok(());
        }
        if status != DUPLICATE {
            return Err(keychain_error("save", status));
        }
        let Some((_, item)) = find(service)? else {
            return Err("Keychain item disappeared".into());
        };
        let result = unsafe {
            SecKeychainItemModifyAttributesAndData(
                item,
                ptr::null(),
                value.len() as u32,
                value.as_ptr().cast(),
            )
        };
        unsafe {
            CFRelease(item.cast());
        }
        if result == 0 {
            Ok(())
        } else {
            Err(keychain_error("update", result))
        }
    }
    pub fn clear(service: &str) -> Result<(), String> {
        let Some((_, item)) = find(service)? else {
            return Ok(());
        };
        let result = unsafe { SecKeychainItemDelete(item) };
        unsafe {
            CFRelease(item.cast());
        }
        if result == 0 {
            Ok(())
        } else {
            Err(keychain_error("delete", result))
        }
    }
}

#[cfg(target_os = "macos")]
pub use keychain::{clear, load, save};
#[cfg(not(target_os = "macos"))]
pub fn load(_: &str) -> Result<Option<String>, String> {
    Err("Secure storage is currently available on macOS only".into())
}
#[cfg(not(target_os = "macos"))]
pub fn save(_: &str, _: &str) -> Result<(), String> {
    Err("Secure storage is currently available on macOS only".into())
}
#[cfg(not(target_os = "macos"))]
pub fn clear(_: &str) -> Result<(), String> {
    Err("Secure storage is currently available on macOS only".into())
}

/// A pasted API key without what usually comes along with it: spaces and line
/// breaks around it, quotes, and a `Bearer ` prefix copied from a request.
pub fn clean_pasted_key(raw: &str) -> String {
    const QUOTES: &[char] = &['"', '\'', '`', '“', '”', '‘', '’'];
    let mut key = raw.trim().trim_matches(QUOTES).trim();
    if key.len() > 7 && key.get(..7).is_some_and(|head| head.eq_ignore_ascii_case("bearer ")) {
        key = key.get(7..).unwrap_or_default().trim().trim_matches(QUOTES).trim();
    }
    key.to_owned()
}

#[cfg(test)]
mod tests {
    use super::clean_pasted_key;

    #[test]
    fn cleans_what_comes_along_with_a_pasted_key() {
        assert_eq!(clean_pasted_key("  sk-abc123\n"), "sk-abc123");
        assert_eq!(clean_pasted_key("\"sk-abc123\""), "sk-abc123");
        assert_eq!(clean_pasted_key("“sk-abc123”"), "sk-abc123");
        assert_eq!(clean_pasted_key("Bearer sk-abc123"), "sk-abc123");
        assert_eq!(clean_pasted_key("bearer 'sk-abc123'"), "sk-abc123");
    }

    #[test]
    fn keeps_text_that_starts_with_chinese() {
        assert_eq!(clean_pasted_key("授权码abcdefgh"), "授权码abcdefgh");
        assert_eq!(clean_pasted_key("  我的 Key：sk-abc123 "), "我的 Key：sk-abc123");
        assert_eq!(clean_pasted_key("Bearer 授权码"), "授权码");
    }
}
