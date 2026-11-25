//! Pictures of AI Pet's own windows: for the user from the pet menu, and for coding agents
//! (Claude Code, Codex) through `ai-pet --capture <window> <file.png>`.
//!
//! The running app takes the picture. An app may always read its own windows, so this needs no
//! Screen Recording permission (checked on macOS 15.7 with an ad hoc signed app that had none), and
//! the hover state, bubbles and panels are taken as they are, wherever the cursor is.
//! `CGWindowListCreateImageFromArray` is marked unavailable in the macOS 15 SDK but is still in
//! CoreGraphics; it is declared here by hand.
//!
//! The command line is a client of a socket the app listens on. The app sends the picture back and
//! the client writes the file, so the app never writes where a caller asks. Agents may take pictures
//! only while the user has it on (设置 › 小工具 › 编码助手).

use std::{
    fs,
    io::{BufRead, BufReader, Read, Write},
    os::unix::net::{UnixListener, UnixStream},
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc,
    },
    thread,
    time::Duration,
};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::agent_hooks;

/// The argument that asks for a picture instead of starting the app.
const CAPTURE_FLAG: &str = "--capture";
const USAGE: &str = "usage: ai-pet --capture <pet|all|chat|today|notes|coding|links|translation|settings|dubbing> <file.png>";
/// Beside the hooks' socket, in a folder only the user can enter.
const SOCKET_FOLDER: &str = "capture";
const SOCKET_NAME: &str = "capture.sock";
/// What a target is called on the command line, and the window it names. "all" is every one of them that is open.
const TARGETS: [(&str, &str); 9] = [
    ("pet", "main"),
    ("chat", "chat"),
    ("today", "today"),
    ("notes", "notes"),
    ("coding", "coding"),
    ("links", "links"),
    ("translation", "translation"),
    ("settings", "settings"),
    ("dubbing", "dubbing"),
];
const ALL_TARGET: &str = "all";
const PET_TARGET: &str = "pet";
/// Tells the pet window how a picture from the menu went. Must match `src/platform/capture.ts`.
const CAPTURED_EVENT: &str = "pet://captured";
const MAIN_WINDOW: &str = "main";
/// Time to put the cursor on the pet, so its buttons show, after choosing the menu item.
const MENU_DELAY: Duration = Duration::from_secs(3);
const SOCKET_TIMEOUT: Duration = Duration::from_secs(10);
const MAIN_THREAD_WAIT: Duration = Duration::from_secs(3);
const MAX_REQUEST_BYTES: u64 = 256;
/// Far above any window at 2×; a reply that claims more is not believed.
const MAX_PNG_BYTES: usize = 64 * 1024 * 1024;
const DISABLED: &str = "Screenshots for coding agents are off. Turn on 设置 › 小工具 › 编码助手 › 让编码助手截图 in AI Pet.";

/// Whether coding agents may take pictures. The pet window sets it from the user's switch.
#[derive(Default)]
pub struct CaptureState {
    enabled: AtomicBool,
}

#[tauri::command]
pub fn set_capture_enabled(state: State<'_, CaptureState>, enabled: bool) {
    state.enabled.store(enabled, Ordering::Relaxed);
}

#[derive(Serialize, Deserialize)]
struct Request {
    window: String,
}

/// Straight (not premultiplied) RGBA, top row first.
#[derive(Debug, PartialEq)]
struct Picture {
    width: usize,
    height: usize,
    rgba: Vec<u8>,
}

/// A PNG and its size in pixels.
struct Png {
    bytes: Vec<u8>,
    width: usize,
    height: usize,
}

fn socket_path() -> Option<PathBuf> {
    let home = std::env::var_os("HOME")?;
    Some(PathBuf::from(home).join("Library/Application Support").join(agent_hooks::IDENTIFIER).join(SOCKET_FOLDER).join(SOCKET_NAME))
}

/// The windows a target names, by their labels.
fn labels(target: &str) -> Option<Vec<&'static str>> {
    if target == ALL_TARGET {
        return Some(TARGETS.iter().map(|(_, label)| *label).collect());
    }
    TARGETS.iter().find(|(name, _)| *name == target).map(|(_, label)| vec![*label])
}

// ---- The command line ----

/// Runs `--capture` when the app was started with it. Returns the exit code, or None to start the app.
/// Its output is for whoever ran the command, so it goes to stdout and stderr, not to the log.
pub fn run_if_asked() -> Option<i32> {
    let mut args = std::env::args().skip(1);
    if args.next().as_deref() != Some(CAPTURE_FLAG) {
        return None;
    }
    let (Some(target), Some(file)) = (args.next(), args.next()) else {
        eprintln!("{USAGE}");
        return Some(2);
    };
    if labels(&target).is_none() {
        eprintln!("Unknown window \"{target}\".\n{USAGE}");
        return Some(2);
    }
    let code = match ask(&target).and_then(|png| fs::write(&file, &png.bytes).map(|()| png).map_err(|error| format!("Could not write {file}: {error}"))) {
        Ok(png) => {
            println!("Saved {target} ({}x{} px) to {file}", png.width, png.height);
            0
        }
        Err(message) => {
            eprintln!("{message}");
            1
        }
    };
    Some(code)
}

fn ask(target: &str) -> Result<Png, String> {
    let path = socket_path().ok_or("No home folder")?;
    let stream = UnixStream::connect(path).map_err(|_| "AI Pet is not running, or is a version without screenshots".to_string())?;
    stream.set_read_timeout(Some(SOCKET_TIMEOUT)).map_err(|error| error.to_string())?;
    stream.set_write_timeout(Some(SOCKET_TIMEOUT)).map_err(|error| error.to_string())?;
    let mut line = serde_json::to_string(&Request { window: target.into() }).map_err(|error| error.to_string())?;
    line.push('\n');
    (&stream).write_all(line.as_bytes()).map_err(|error| format!("Could not reach AI Pet: {error}"))?;
    let mut reader = BufReader::new(stream);
    let mut header = String::new();
    reader.read_line(&mut header).map_err(|error| format!("AI Pet did not answer: {error}"))?;
    let (len, width, height) = parse_header(&header)?;
    let mut bytes = vec![0; len];
    reader.read_exact(&mut bytes).map_err(|error| format!("The picture came in cut short: {error}"))?;
    Ok(Png { bytes, width, height })
}

/// "ok <bytes> <width> <height>" or "error <message>".
fn parse_header(header: &str) -> Result<(usize, usize, usize), String> {
    let header = header.trim_end();
    if let Some(message) = header.strip_prefix("error ") {
        return Err(message.to_string());
    }
    let numbers: Vec<usize> = header.strip_prefix("ok ").ok_or("AI Pet gave an answer this command does not know")?.split(' ').map(str::parse).collect::<Result<_, _>>().map_err(|_| "AI Pet gave an answer this command does not know")?;
    match numbers[..] {
        [len, width, height] if len <= MAX_PNG_BYTES => Ok((len, width, height)),
        _ => Err("AI Pet gave an answer this command does not know".into()),
    }
}

// ---- The app ----

/// Starts listening for `--capture`. Another running copy of the app (a dev build) keeps the socket.
pub fn listen(app: &AppHandle) {
    let Some(path) = socket_path() else {
        log::warn!("No home folder; screenshots for coding agents are off");
        return;
    };
    if UnixStream::connect(&path).is_ok() {
        log::warn!("Another copy of AI Pet is taking screenshot requests");
        return;
    }
    let listener = match agent_hooks::bind(&path) {
        Ok(listener) => listener,
        Err(error) => {
            log::error!("Could not listen for screenshot requests: {error}");
            return;
        }
    };
    let app = app.clone();
    thread::spawn(move || serve(&app, listener));
}

fn serve(app: &AppHandle, listener: UnixListener) {
    for stream in listener.incoming().flatten() {
        if let Err(error) = answer(app, stream) {
            log::warn!("Could not answer a screenshot request: {error}");
        }
    }
}

fn answer(app: &AppHandle, stream: UnixStream) -> std::io::Result<()> {
    stream.set_read_timeout(Some(SOCKET_TIMEOUT))?;
    stream.set_write_timeout(Some(SOCKET_TIMEOUT))?;
    let mut line = String::new();
    BufReader::new((&stream).take(MAX_REQUEST_BYTES)).read_line(&mut line)?;
    let reply = serde_json::from_str::<Request>(line.trim())
        .map_err(|_| "A request this version of AI Pet does not know".to_string())
        .and_then(|request| {
            if !app.state::<CaptureState>().enabled.load(Ordering::Relaxed) {
                return Err(DISABLED.to_string());
            }
            take(app, &request.window)
        });
    let mut stream = stream;
    match reply {
        Ok(png) => {
            stream.write_all(format!("ok {} {} {}\n", png.bytes.len(), png.width, png.height).as_bytes())?;
            stream.write_all(&png.bytes)
        }
        Err(message) => stream.write_all(format!("error {}\n", message.replace('\n', " ")).as_bytes()),
    }
}

/// One picture of the target's open windows, as they stand on screen, cut to what is drawn.
fn take(app: &AppHandle, target: &str) -> Result<Png, String> {
    let labels = labels(target).ok_or_else(|| format!("Unknown window \"{target}\""))?;
    let numbers = window_numbers(app, labels)?;
    if numbers.is_empty() {
        return Err(if target == ALL_TARGET { "No AI Pet window is open".into() } else { format!("The {target} window is not open") });
    }
    let picture = native::snapshot(&numbers)?;
    let picture = trim(&picture).ok_or("The window has nothing drawn in it")?;
    let bytes = encode(&picture)?;
    Ok(Png { bytes, width: picture.width, height: picture.height })
}

/// The window numbers of those windows that are open, read on the main thread as AppKit requires.
fn window_numbers(app: &AppHandle, labels: Vec<&'static str>) -> Result<Vec<u32>, String> {
    let (sender, receiver) = mpsc::channel();
    let handle = app.clone();
    app.run_on_main_thread(move || {
        let numbers: Vec<u32> = labels.iter().filter_map(|label| handle.get_webview_window(label)).filter_map(|window| native::window_number(&window)).collect();
        let _ = sender.send(numbers);
    })
    .map_err(|error| error.to_string())?;
    receiver.recv_timeout(MAIN_THREAD_WAIT).map_err(|_| "AI Pet is busy; try again".to_string())
}

/// The part of `picture` with anything drawn, straightened from premultiplied alpha. None when it is all clear.
fn trim(picture: &Picture) -> Option<Picture> {
    let Picture { width, height, rgba } = picture;
    let alpha = |x: usize, y: usize| rgba[(y * width + x) * 4 + 3];
    let rows: Vec<usize> = (0..*height).filter(|&y| (0..*width).any(|x| alpha(x, y) > 0)).collect();
    let (&top, &bottom) = (rows.first()?, rows.last()?);
    let left = (0..*width).find(|&x| (top..=bottom).any(|y| alpha(x, y) > 0))?;
    let right = (left..*width).rev().find(|&x| (top..=bottom).any(|y| alpha(x, y) > 0))?;
    let rgba = (top..=bottom)
        .flat_map(|y| rgba[(y * width + left) * 4..(y * width + right + 1) * 4].chunks_exact(4))
        .flat_map(|pixel| straight(pixel))
        .collect();
    Some(Picture { width: right - left + 1, height: bottom - top + 1, rgba })
}

/// One premultiplied RGBA pixel as straight RGBA.
fn straight(pixel: &[u8]) -> [u8; 4] {
    let alpha = u32::from(pixel[3]);
    if alpha == 0 {
        return [0; 4];
    }
    let channel = |value: u8| ((u32::from(value) * 255 + alpha / 2) / alpha).min(255) as u8;
    [channel(pixel[0]), channel(pixel[1]), channel(pixel[2]), pixel[3]]
}

fn encode(picture: &Picture) -> Result<Vec<u8>, String> {
    let mut bytes = Vec::new();
    let mut encoder = png::Encoder::new(&mut bytes, picture.width as u32, picture.height as u32);
    encoder.set_color(png::ColorType::Rgba);
    encoder.set_depth(png::BitDepth::Eight);
    let mut writer = encoder.write_header().map_err(|error| format!("Could not make the PNG: {error}"))?;
    writer.write_image_data(&picture.rgba).map_err(|error| format!("Could not make the PNG: {error}"))?;
    writer.finish().map_err(|error| format!("Could not make the PNG: {error}"))?;
    Ok(bytes)
}

// ---- The pet menu ----

/// "3 秒后截图": waits for the cursor to reach the pet, then copies the pet window to the clipboard.
pub fn capture_later(app: &AppHandle) {
    let app = app.clone();
    thread::spawn(move || {
        thread::sleep(MENU_DELAY);
        let copied = take(&app, PET_TARGET).and_then(|png| copy_on_main_thread(&app, png.bytes));
        if let Err(error) = &copied {
            log::warn!("Could not copy a picture of the pet: {error}");
        }
        if let Err(error) = app.emit_to(MAIN_WINDOW, CAPTURED_EVENT, copied.is_ok()) {
            log::warn!("Could not tell the pet about its picture: {error}");
        }
    });
}

fn copy_on_main_thread(app: &AppHandle, png: Vec<u8>) -> Result<(), String> {
    let (sender, receiver) = mpsc::channel();
    app.run_on_main_thread(move || {
        let _ = sender.send(native::copy_png(&png));
    })
    .map_err(|error| error.to_string())?;
    match receiver.recv_timeout(MAIN_THREAD_WAIT) {
        Ok(true) => Ok(()),
        Ok(false) => Err("The clipboard did not take the picture".into()),
        Err(_) => Err("AI Pet is busy".into()),
    }
}

#[cfg(target_os = "macos")]
mod native {
    use std::ffi::c_void;
    use std::ptr;

    use objc2_app_kit::{NSPasteboard, NSPasteboardTypePNG, NSWindow};
    use objc2_foundation::NSData;
    use tauri::WebviewWindow;

    use super::Picture;

    type CF = *const c_void;

    #[repr(C)]
    #[derive(Clone, Copy)]
    struct CGRect {
        x: f64,
        y: f64,
        width: f64,
        height: f64,
    }

    #[link(name = "CoreGraphics", kind = "framework")]
    unsafe extern "C" {
        static CGRectNull: CGRect;
        static kCGColorSpaceSRGB: CF;
        fn CGWindowListCreateImageFromArray(bounds: CGRect, windows: CF, options: u32) -> CF;
        fn CGImageGetWidth(image: CF) -> usize;
        fn CGImageGetHeight(image: CF) -> usize;
        fn CGImageRelease(image: CF);
        fn CGColorSpaceCreateWithName(name: CF) -> CF;
        fn CGColorSpaceRelease(space: CF);
        fn CGBitmapContextCreate(data: *mut c_void, width: usize, height: usize, bits: usize, row: usize, space: CF, info: u32) -> CF;
        fn CGContextDrawImage(context: CF, rect: CGRect, image: CF);
        fn CGContextRelease(context: CF);
    }
    #[link(name = "CoreFoundation", kind = "framework")]
    unsafe extern "C" {
        fn CFArrayCreate(allocator: CF, values: *const CF, count: isize, callbacks: CF) -> CF;
        fn CFRelease(value: CF);
    }
    /// The window's own pixels, without its shadow, at the screen's full resolution.
    const IGNORE_FRAMING: u32 = 1 << 0;
    const BEST_RESOLUTION: u32 = 1 << 3;
    /// Four bytes a pixel, red first, alpha last and premultiplied.
    const PREMULTIPLIED_LAST: u32 = 1;

    /// The window's number for the window server, if it is on screen. Must be called on the main thread.
    pub(super) fn window_number(window: &WebviewWindow) -> Option<u32> {
        let ns_window = window.ns_window().ok()?.cast::<NSWindow>();
        // SAFETY: Tauri hands out a valid NSWindow pointer that outlives this call, read on the main thread.
        let window = unsafe { &*ns_window };
        window.isVisible().then(|| u32::try_from(window.windowNumber()).ok()).flatten()
    }

    /// The windows as they stand on screen, in one picture the size of their combined bounds.
    pub(super) fn snapshot(numbers: &[u32]) -> Result<Picture, String> {
        // The array holds the numbers themselves, not objects: no callbacks.
        let values: Vec<CF> = numbers.iter().map(|&number| number as usize as CF).collect();
        // SAFETY: every object created here is released once, after its last use.
        unsafe {
            let windows = CFArrayCreate(ptr::null(), values.as_ptr(), values.len() as isize, ptr::null());
            if windows.is_null() {
                return Err("Out of memory".into());
            }
            let image = CGWindowListCreateImageFromArray(CGRectNull, windows, IGNORE_FRAMING | BEST_RESOLUTION);
            CFRelease(windows);
            if image.is_null() {
                return Err("macOS gave no picture of the window".into());
            }
            let (width, height) = (CGImageGetWidth(image), CGImageGetHeight(image));
            let mut rgba = vec![0u8; width * height * 4];
            let space = CGColorSpaceCreateWithName(kCGColorSpaceSRGB);
            let context = CGBitmapContextCreate(rgba.as_mut_ptr().cast(), width, height, 8, width * 4, space, PREMULTIPLIED_LAST);
            CGColorSpaceRelease(space);
            if context.is_null() {
                CGImageRelease(image);
                return Err("Could not read the picture".into());
            }
            CGContextDrawImage(context, CGRect { x: 0.0, y: 0.0, width: width as f64, height: height as f64 }, image);
            CGContextRelease(context);
            CGImageRelease(image);
            Ok(Picture { width, height, rgba })
        }
    }

    /// Puts a PNG on the clipboard in place of what was there. Must be called on the main thread.
    pub(super) fn copy_png(png: &[u8]) -> bool {
        let board = NSPasteboard::generalPasteboard();
        board.clearContents();
        // SAFETY: a constant exported by AppKit.
        board.setData_forType(Some(&NSData::with_bytes(png)), unsafe { NSPasteboardTypePNG })
    }
}

#[cfg(not(target_os = "macos"))]
mod native {
    use super::Picture;
    use tauri::WebviewWindow;

    pub(super) fn window_number(_: &WebviewWindow) -> Option<u32> {
        None
    }

    pub(super) fn snapshot(_: &[u32]) -> Result<Picture, String> {
        Err("Screenshots need macOS".into())
    }

    pub(super) fn copy_png(_: &[u8]) -> bool {
        false
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn picture(width: usize, height: usize, pixels: &[(usize, usize, [u8; 4])]) -> Picture {
        let mut rgba = vec![0; width * height * 4];
        for &(x, y, pixel) in pixels {
            rgba[(y * width + x) * 4..(y * width + x + 1) * 4].copy_from_slice(&pixel);
        }
        Picture { width, height, rgba }
    }

    #[test]
    fn trims_to_what_is_drawn() {
        let trimmed = trim(&picture(6, 5, &[(1, 1, [10, 20, 30, 255]), (3, 2, [0, 0, 0, 255])])).unwrap();
        assert_eq!((trimmed.width, trimmed.height), (3, 2));
        assert_eq!(&trimmed.rgba[..4], &[10, 20, 30, 255]);
        assert_eq!(&trimmed.rgba[trimmed.rgba.len() - 4..], &[0, 0, 0, 255]);
    }

    #[test]
    fn an_empty_window_has_nothing_to_keep() {
        assert_eq!(trim(&picture(4, 4, &[])), None);
    }

    #[test]
    fn straightens_premultiplied_pixels() {
        assert_eq!(straight(&[64, 32, 0, 128]), [128, 64, 0, 128]);
        assert_eq!(straight(&[255, 255, 255, 255]), [255, 255, 255, 255]);
        assert_eq!(straight(&[3, 3, 3, 0]), [0, 0, 0, 0]);
        assert_eq!(straight(&[200, 0, 0, 100]), [255, 0, 0, 100]);
    }

    #[test]
    fn encodes_a_png_that_reads_back() {
        let picture = picture(2, 1, &[(0, 0, [255, 0, 0, 255]), (1, 0, [0, 0, 255, 128])]);
        let bytes = encode(&picture).unwrap();
        let mut reader = png::Decoder::new(std::io::Cursor::new(bytes)).read_info().unwrap();
        let mut out = vec![0; reader.output_buffer_size().unwrap()];
        reader.next_frame(&mut out).unwrap();
        assert_eq!(out, picture.rgba);
    }

    #[test]
    fn names_targets_by_window_label() {
        assert_eq!(labels("pet"), Some(vec!["main"]));
        assert_eq!(labels("coding"), Some(vec!["coding"]));
        assert_eq!(labels("all").map(|labels| labels.len()), Some(TARGETS.len()));
        assert_eq!(labels("main"), None);
        assert_eq!(labels("../x"), None);
    }

    #[test]
    fn reads_the_reply_header() {
        assert_eq!(parse_header("ok 10 3 4\n"), Ok((10, 3, 4)));
        assert_eq!(parse_header("error The pet window is not open\n"), Err("The pet window is not open".into()));
        assert!(parse_header("ok 10 3\n").is_err());
        assert!(parse_header(&format!("ok {} 1 1\n", MAX_PNG_BYTES + 1)).is_err());
        assert!(parse_header("hello\n").is_err());
    }
}
