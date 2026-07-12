use std::{
  collections::HashMap,
  io::Read as _,
  path::{Path, PathBuf},
  process::Stdio,
  sync::Mutex,
  thread,
  time::{Duration, Instant},
};

use tauri::Emitter;
use tauri::{LogicalPosition, Manager, TitleBarStyle, WebviewUrl, WebviewWindowBuilder};

use notify::{
  event::EventKind as NotifyEventKind, Event, RecommendedWatcher, RecursiveMode, Watcher,
};

struct OpenedPaths(Mutex<Vec<String>>);

const HTML_ANYTHING_URL: &str = "http://localhost:3000";
const HTML_ANYTHING_IMPORT_KEY: &str = "folia-import-markdown";

/// Agent 抽取规格 v1（bundled）。修改请同步升级规格版本号常量。
const EXTRACTION_SPEC_V1: &str = include_str!("../extraction/spec-v1.md");
#[allow(dead_code)] // 保留以备将来 build-info / 自描述 UI 使用
const EXTRACTION_SPEC_VERSION: &str = "1";
/// claude CLI 抽取运行总超时（5 分钟）。该上限和 html-anything 默认保持一致。
const AGENT_EXTRACTION_TIMEOUT: Duration = Duration::from_secs(5 * 60);
/// 抽取完成后 .foliaviz 落盘轮询间隔（agent 子进程退出 → 文件可能尚未 sync）。
const AGENT_OUTPUT_POLL_INTERVAL: Duration = Duration::from_millis(200);

/// 全局监听状态：路径 → (watcher, 最近一次事件时间戳)
///
/// 设计要点（ISS-162）：
/// - watcher 必须常驻，否则一释放就停止监听。放 `tauri::State` 而不是局部。
/// - 单文件轮询补 atomic-replace 时用 `last_event` 去重，避免和 notify 自身事件重复触发。
struct AppState {
  watchers: Mutex<HashMap<PathBuf, WatchEntry>>,
  /// ISS-164：tear-off tab 窗口追踪。label → 该窗口持有的 tabId 列表。
  /// 窗口被关闭时通过 `window:closed` 事件告知主窗口回收 tab（DEC-102）。
  tab_windows: Mutex<HashMap<String, TabWindowEntry>>,
}

/// ISS-164：单条 tab 窗口追踪记录。
struct TabWindowEntry {
  /// 创建时初始放入窗口的 tab id 列表；后续可由前端通过 `update_tab_window_tabs`
  /// 增量追加（同一窗口可容纳多 tab）。用于关闭窗口时把仍未移交的 tab 退回主窗口。
  tab_ids: Vec<String>,
}

struct WatchEntry {
  /// 持有 watcher 即维持监听句柄；Drop 时 watcher 停止监听。
  _watcher: RecommendedWatcher,
  /// 最近一次 notify 事件时间；轮询补 emit 时跳过时间窗内的相同路径。
  last_event: Mutex<Instant>,
}

#[tauri::command]
fn pending_opened_paths(app: tauri::AppHandle) -> Vec<String> {
  let state = app.state::<OpenedPaths>();
  let mut paths = state.0.lock().unwrap();
  std::mem::take(&mut *paths)
}

/// 单个受支持文档允许打开的最大字节数（ISS-159）。
///
/// 10MB Markdown 已远超常规长文档；超长文件此前会把 `Vec<u8>` 经 Tauri 序列化成
/// JSON 数字数组，造成数倍内存峰值并卡死 WebView。这里在读取前用 metadata 拦截，
/// 避免超大文件直接 OOM。如需放宽，调整该常量即可。
const MAX_OPENED_DOCUMENT_BYTES: u64 = 10 * 1024 * 1024;

/// 校验、限额并读取受支持文档的全部字节。返回 `Vec<u8>` 以便单测断言内容；
/// `read_opened_document` 命令再将其包成原始字节 [`tauri::ipc::Response`]，
/// 避免 `Vec<u8>` 被序列化成 JSON 数字数组导致的 IPC 内存膨胀。
fn read_opened_document_bytes(path: &Path) -> Result<Vec<u8>, String> {
  if !is_openable_document_path(path) {
    return Err("unsupported document type".into());
  }
  // ISS-172：与 watch_path / resolveLocalResourcePath 共享同一份路径黑名单，
  // 防止前端 / XSS 注入代码用扩展名合法的 `.md` / `.html` 旁路读取 /etc/passwd
  // 之类敏感文件。命中黑名单直接拒绝，不读 metadata（避免提前暴露文件是否存在）。
  if is_denied_root(path) {
    return Err(format!(
      "path is on the denied roots list: {}",
      path.display()
    ));
  }

  // 先用 metadata 拦截超大文件，避免读入后才发现 OOM。
  let metadata = std::fs::metadata(path)
    .map_err(|error| format!("failed to read document: {error}"))?;
  if metadata.len() > MAX_OPENED_DOCUMENT_BYTES {
    // 该文案被前端 fileService 的 OVERSIZED_FILE_PATTERN 匹配以决定是否弹原生提示；
    // 改文案时需同步 src/services/fileService.test.ts 的 BACKEND_OVERSIZED_FILE_ERROR（ISS-159）。
    return Err(format!(
      "file too large: {} bytes exceeds the {} byte limit",
      metadata.len(),
      MAX_OPENED_DOCUMENT_BYTES
    ));
  }

  std::fs::read(path).map_err(|error| format!("failed to read document: {error}"))
}

#[tauri::command]
fn read_opened_document(path: String) -> Result<tauri::ipc::Response, String> {
  let path = PathBuf::from(path);
  // 用 tauri::ipc::Response 返回原始字节，前端 invoke 直接拿到 ArrayBuffer，
  // 跳过 JSON 数字数组序列化，内存峰值从原始文件的数倍降到约一倍（ISS-159）。
  Ok(tauri::ipc::Response::new(read_opened_document_bytes(&path)?))
}

#[tauri::command]
fn write_opened_document(path: String, content: String) -> Result<(), String> {
  let path = PathBuf::from(path);
  if !is_writable_document_path(&path) {
    return Err("unsupported document type".into());
  }
  // ISS-172：写入同样走路径黑名单，避免任何代码（含 XSS 注入）用合法后缀的写入
  // 覆盖 /etc / .ssh / C:\Windows 等敏感文件。与 read / watch 共享单一来源。
  if is_denied_root(&path) {
    return Err(format!(
      "path is on the denied roots list: {}",
      path.display()
    ));
  }

  std::fs::write(&path, content).map_err(|error| format!("failed to write document: {error}"))
}

/// 监听系统根或敏感目录黑名单前缀（ISS-162，借鉴 horseMD chokidar 防御）。
///
/// 大小写不敏感比较：macOS HFS+/APFS 默认大小写不敏感（区分大小写是可选），Windows NTFS
/// 默认不敏感；这里统一按不敏感处理，避免 `C:\Windows` / `c:\windows` 绕过。
const DENY_PATH_PREFIXES: &[&str] = &[
  "/dev",
  "/etc",
  "/system",
  "/system/volumes",
  // Windows 路径，统一小写比较。
  "c:\\windows",
  "c:\\$recycle.bin",
];

/// 跨平台绝对路径判定。
///
/// `Path::is_absolute()` 在 macOS / Linux 上对 `C:\Windows\System32` 这种 Windows
/// 路径返回 false（因为 Path 在编译期绑定到目标平台），而 Tauri 的 Windows 构建
/// 同样可能在 macOS 开发者机器上做跨平台单测。这里额外接受 `^[A-Za-z]:[\\/]`
/// 形式的盘符路径，模拟 Windows 视角的"绝对"，避免黑名单前缀绕过。
fn is_absolute_path(path: &Path) -> bool {
  if path.is_absolute() {
    return true;
  }
  let raw = path.to_string_lossy();
  if raw.len() < 3 {
    return false;
  }
  let bytes = raw.as_bytes();
  bytes[0].is_ascii_alphabetic()
    && bytes[1] == b':'
    && (bytes[2] == b'\\' || bytes[2] == b'/')
}

/// 路径命中系统级黑名单前缀（大小写不敏感，跨平台分隔符）。
fn is_denied_root(path: &Path) -> bool {
  // 先把整体 lower 处理，再去掉尾部分隔符影响。
  let raw = path.to_string_lossy();
  let normalized = raw.trim_end_matches(['/', '\\']).to_ascii_lowercase();
  // Linux/macOS 根目录 `/` 单独处理：trim 后为空串。
  if normalized.is_empty() {
    return true;
  }
  for prefix in DENY_PATH_PREFIXES {
    if normalized == *prefix {
      return true;
    }
    // Windows 路径用 `\`；macOS/Linux 路径用 `/`；同时接受两种分隔符，
    // 让 `C:\Windows\foo` 也能匹配前缀 `c:\windows`（去掉末尾 `\` 后
    // `c:\windows` + `\foo` 视为 `c:\windows\foo` 的子路径）。
    if normalized.starts_with(prefix)
      && normalized.len() > prefix.len()
      && matches!(normalized.as_bytes()[prefix.len()], b'\\' | b'/')
    {
      return true;
    }
  }
  false
}

/// 监听前路径校验：
/// 1. 必须是绝对路径；
/// 2. 不命中黑名单前缀（即使路径在跨平台测试机上不存在也要先拒，阻止
///    攻击者用 `C:\Windows\Whatever` 之类不存在的盘符路径绕过前缀校验）；
/// 3. 文件 / 目录必须存在（避免 watcher 在不存在的路径上立刻报错）。
///
/// 返回规范化（去尾部分隔符）后的 `PathBuf`，方便后续作 HashMap key。
fn validate_watch_path(raw: &str) -> Result<PathBuf, String> {
  let path = PathBuf::from(raw);
  if !is_absolute_path(&path) {
    return Err(format!("path must be absolute: {raw}"));
  }
  if is_denied_root(&path) {
    return Err(format!("path is on the denied roots list: {raw}"));
  }
  if !path.exists() {
    return Err(format!("path does not exist: {raw}"));
  }
  // 去掉尾部分隔符以保证重复监听同路径只占一个槽位。
  let trimmed = path.to_string_lossy().trim_end_matches(['/', '\\']).to_string();
  Ok(PathBuf::from(trimmed))
}

/// 注册一个文件 / 目录监听，事件通过 `watch:changed` emit 到前端（ISS-162）。
///
/// 错误通过 `watch:error` emit 而非 panic，确保 watcher 后台任务异常不拖垮应用。
#[tauri::command]
fn watch_path(path: String, app: tauri::AppHandle) -> Result<(), String> {
  let canonical = validate_watch_path(&path)?;

  let app_for_handler = app.clone();
  let canonical_for_handler = canonical.clone();
  let last_event = Instant::now();

  let mut watcher = notify::recommended_watcher(move |res: notify::Result<Event>| {
    match res {
      Ok(event) => {
        // 仅向该 watcher 注册的根路径及其子项事件感兴趣。
        let is_relevant = event.paths.iter().any(|p| {
          p == &canonical_for_handler
            || p.starts_with(&canonical_for_handler)
        });
        if !is_relevant {
          return;
        }

        // 更新时间戳，给 atomic-replace 轮询去重。
        if let Some(state) = app_for_handler.try_state::<AppState>() {
          if let Some(entry) = state.watchers.lock().unwrap().get(&canonical_for_handler) {
            if let Ok(mut stamp) = entry.last_event.lock() {
              *stamp = Instant::now();
            }
          }
        }

        let kind = map_event_kind(&event.kind);
        for event_path in &event.paths {
          let _ = app_for_handler.emit(
            "watch:changed",
            serde_json::json!({
              "path": event_path.to_string_lossy(),
              "kind": kind,
            }),
          );
        }
      }
      Err(error) => {
        // 关键：不 panic，统一 emit 错误事件，让前端决定如何降级（ISS-162）。
        let _ = app_for_handler.emit(
          "watch:error",
          serde_json::json!({
            "path": canonical_for_handler.to_string_lossy(),
            "message": error.to_string(),
          }),
        );
      }
    }
  })
  .map_err(|error| format!("failed to create watcher: {error}"))?;

  let mode = if canonical.is_dir() {
    RecursiveMode::Recursive
  } else {
    RecursiveMode::NonRecursive
  };
  watcher
    .watch(&canonical, mode)
    .map_err(|error| format!("failed to start watch: {error}"))?;

  let entry = WatchEntry {
    _watcher: watcher,
    last_event: Mutex::new(last_event),
  };

  let state = app.state::<AppState>();
  let mut watchers = state.watchers.lock().unwrap();
  // 同一路径重复 watch：直接覆盖，不留泄漏句柄。
  watchers.insert(canonical.clone(), entry);

  Ok(())
}

/// 取消监听指定路径；路径未注册时返回 Ok(()) 而非 Err（幂等）。
#[tauri::command]
fn unwatch_path(path: String, app: tauri::AppHandle) -> Result<(), String> {
  let canonical = match validate_watch_path(&path) {
    Ok(canonical) => canonical,
    // 取消监听时对路径做容错：黑名单 / 相对路径 / 不存在都直接视为未注册。
    Err(_) => return Ok(()),
  };

  let state = app.state::<AppState>();
  let mut watchers = state.watchers.lock().unwrap();
  watchers.remove(&canonical);
  Ok(())
}

fn map_event_kind(kind: &NotifyEventKind) -> &'static str {
  match kind {
    NotifyEventKind::Create(_) => "create",
    NotifyEventKind::Remove(_) => "remove",
    NotifyEventKind::Modify(_) => "modify",
    _ => "modify",
  }
}

// ──────── ISS-164 tear-off tab 多窗口支持（DEC-102） ────────

/// ISS-164：合法的 tear-off 窗口 label。
///
/// Tauri 2 要求窗口 label 非空且符合 `[a-zA-Z0-9-_/]+` 字符集，且不能与已存在
/// 窗口 label 冲突。本函数做基础字符校验，把长度 / 字符越界等错误提前抛给前端，
/// 让 toast 直接展示「窗口标签不合法」而非依赖 Tauri 内部 panic。
pub fn is_valid_tab_window_label(label: &str) -> bool {
  !label.is_empty()
    && label.len() <= 64
    && label
      .chars()
      .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

/// ISS-164：创建（或复用）独立 tab 窗口。
///
/// - `label`：目标窗口 label，必须合法字符；冲突时返回 Err 让前端 toast 提示。
/// - `initial_tab_ids`：创建时塞入窗口的 tab id 列表（前端后续会通过
///   `tab:tear-off` / `tab:merge-back` 事件继续追加 / 移除）。
///
/// 该命令**不**持有 session 状态：tab 列表由前端 useSession + event bus 维护，
/// Rust 只记录 label ↔ tabIds 映射，用于关闭时回收未移交的 tab（DEC-102 方案 1）。
#[tauri::command]
fn create_tab_window(
  label: String,
  initial_tab_ids: Vec<String>,
  app: tauri::AppHandle,
) -> Result<(), String> {
  if !is_valid_tab_window_label(&label) {
    return Err(format!(
      "invalid tab window label '{label}': must match [a-zA-Z0-9_-]{{1,64}}"
    ));
  }

  // label 冲突：复用既有窗口（focus + 跳过创建），避免拖出第二个同名窗口。
  if let Some(existing) = app.get_webview_window(&label) {
    let _ = existing.unminimize();
    let _ = existing.show();
    let _ = existing.set_focus();
    return Ok(());
  }

  let url = tab_window_url(&label, &initial_tab_ids);

  // ISS-174：与主窗口一致的窗口装饰（macOS overlay title bar + traffic light
  // overlay 在工具栏左侧），避免撕出窗口顶部出现 NSWindow 标题栏分隔白线。
  // Windows / Linux 用 decorations(true) 显式声明带原生装饰，与主窗口行为一致。
  let mut builder = WebviewWindowBuilder::new(&app, &label, WebviewUrl::App(url.into()))
    .title(format!("Folia · {label}"))
    .inner_size(960.0, 680.0)
    .resizable(true)
    .min_inner_size(640.0, 420.0)
    .decorations(true);
  #[cfg(target_os = "macos")]
  {
    builder = builder
      .title_bar_style(TitleBarStyle::Overlay)
      .hidden_title(true)
      .traffic_light_position(LogicalPosition::new(16.0, 16.0));
  }
  builder
    .build()
    .map_err(|error| format!("failed to create tab window '{label}': {error}"))?;

  let entry = TabWindowEntry {
    tab_ids: initial_tab_ids,
  };
  let state = app.state::<AppState>();
  state
    .tab_windows
    .lock()
    .unwrap()
    .insert(label.clone(), entry);

  Ok(())
}

/// ISS-164：前端在窗口内追加 / 移除 tab 时同步 Rust 状态，使关闭窗口时能
/// 准确知道还有哪些 tabId 没被移交回主窗口。
#[tauri::command]
fn update_tab_window_tabs(
  label: String,
  tab_ids: Vec<String>,
  app: tauri::AppHandle,
) -> Result<(), String> {
  if !is_valid_tab_window_label(&label) {
    return Err(format!("invalid tab window label '{label}'"));
  }
  let state = app.state::<AppState>();
  let mut guard = state.tab_windows.lock().unwrap();
  if let Some(entry) = guard.get_mut(&label) {
    entry.tab_ids = tab_ids;
    Ok(())
  } else {
    // 关闭顺序竞争：窗口已关但前端还在追写，直接忽略。
    Ok(())
  }
}

/// ISS-164：把 Rust 状态里的 tab_ids 取出来，窗口关闭后由 `window:closed`
/// 事件携带发给主窗口回收。
fn take_tab_ids_for_window(app: &tauri::AppHandle, label: &str) -> Vec<String> {
  let state = app.state::<AppState>();
  let mut guard = state.tab_windows.lock().unwrap();
  guard
    .remove(label)
    .map(|entry| entry.tab_ids)
    .unwrap_or_default()
}

/// ISS-164：主动关闭某 label 的 tab 窗口（merge-back 时源窗口用）。
/// 前端无法直接 `invoke` 关闭别的窗口，需走这条 command。
///
/// 注意：本函数只触发 `window.close()`，**不**预取 tab_ids。CloseRequested
/// handler（`handle_window_close`）是回收 tab 列表 + emit `window:closed` 的
/// 唯一权威——若本函数提前 `take_tab_ids_for_window`，CloseRequested handler
/// 拿到的就是空 Vec，会 emit `window:closed { remainingTabIds: [] }`，主窗口
/// 误以为没 tab 要回收，导致用户丢 tab。这是 ISS-174 review 时发现的竞态，
/// 修复方案：把回收职责彻底收敛到 CloseRequested 一处。
#[tauri::command]
fn close_tab_window(label: String, app: tauri::AppHandle) -> Result<(), String> {
  if !is_valid_tab_window_label(&label) {
    return Err(format!("invalid tab window label '{label}'"));
  }
  if let Some(window) = app.get_webview_window(&label) {
    window
      .close()
      .map_err(|error| format!("failed to close tab window '{label}': {error}"))?;
  }
  Ok(())
}

/// 简易 percent-encoding（只覆盖我们用到的字符集），避免为这一点拉进 url crate。
fn urlencode(raw: &str) -> String {
  let mut out = String::with_capacity(raw.len());
  for byte in raw.bytes() {
    if byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_' || byte == b'.' {
      out.push(byte as char);
    } else {
      out.push_str(&format!("%{:02X}", byte));
    }
  }
  out
}

fn tab_window_url(label: &str, tab_ids: &[String]) -> String {
  let encoded_tab_ids = tab_ids
    .iter()
    .map(|id| urlencode(id))
    .collect::<Vec<_>>()
    .join(",");
  format!(
    "index.html?mode=tab-window&label={}&tabIds={}",
    urlencode(label),
    encoded_tab_ids
  )
}

#[tauri::command]
fn open_html_anything(
  app: tauri::AppHandle,
  content: Option<String>,
  file_name: Option<String>,
) -> Result<(), String> {
  let label = "html-anything";
  let import_script = html_anything_import_script(content, file_name)?;

  // 如果窗口已存在，直接聚焦
  if let Some(window) = app.get_webview_window(label) {
    if let Some(script) = import_script {
      window
        .eval(script)
        .map_err(|e| format!("failed to import markdown into html-anything: {e}"))?;
    }
    let _ = window.show();
    let _ = window.set_focus();
    return Ok(());
  }

  // 创建新窗口加载 localhost:3000
  let mut builder = WebviewWindowBuilder::new(
    &app,
    label,
    WebviewUrl::External(HTML_ANYTHING_URL.parse().unwrap()),
  )
  .title("Anything HTML")
  .inner_size(1200.0, 800.0);

  if let Some(script) = import_script {
    builder = builder.initialization_script(script);
  }

  builder
    .build()
    .map_err(|e| format!("failed to open html-anything: {e}"))?;

  Ok(())
}

fn html_anything_import_script(
  content: Option<String>,
  file_name: Option<String>,
) -> Result<Option<String>, String> {
  let Some(content) = content else {
    return Ok(None);
  };

  if content.is_empty() {
    return Ok(None);
  }

  let payload = serde_json::json!({
    "source": "folia",
    "content": content,
    "fileName": file_name.filter(|name| !name.trim().is_empty()).unwrap_or_else(|| "Folia Markdown".into()),
  });
  let payload_json = serde_json::to_string(&payload)
    .map_err(|e| format!("failed to encode html-anything import payload: {e}"))?;
  let key_json = serde_json::to_string(HTML_ANYTHING_IMPORT_KEY)
    .map_err(|e| format!("failed to encode html-anything import key: {e}"))?;

  Ok(Some(format!(
    r#"(function () {{
  if (window.location.origin !== {origin}) return;
  var payload = {payload};
  payload.importedAt = new Date().toISOString();
  localStorage.setItem({key}, JSON.stringify(payload));
  window.dispatchEvent(new CustomEvent({key}, {{ detail: payload }}));
}})();"#,
    origin = serde_json::to_string(HTML_ANYTHING_URL)
      .map_err(|e| format!("failed to encode html-anything origin: {e}"))?,
    key = key_json,
    payload = payload_json,
  )))
}

/// 查找系统已装的 Chromium 内核浏览器可执行文件（Chrome > Edge > Chromium > Brave）。
fn find_chromium() -> Option<String> {
  let candidates = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
  ];
  candidates.iter().find(|p| std::path::Path::new(p).exists()).map(|s| s.to_string())
}

/// 用 headless Chromium 把 HTML 渲染成 PDF（无页眉页脚、矢量、文字可选、不卡 UI）。
/// 写临时 HTML → spawn chromium --headless --print-to-pdf → 清理临时文件。
#[tauri::command]
async fn export_pdf_via_chrome(html: String, save_path: String) -> Result<(), String> {
  use std::io::Write as _;
  let chrome = find_chromium()
    .ok_or_else(|| "未找到 Chrome/Edge/Chromium，请先安装 Chrome".to_string())?;
  let tmp = std::env::temp_dir().join(format!("folia-pdf-{}.html", std::process::id()));
  {
    let mut f = std::fs::File::create(&tmp).map_err(|e| format!("创建临时文件失败: {e}"))?;
    f.write_all(html.as_bytes()).map_err(|e| format!("写入临时文件失败: {e}"))?;
  }
  let file_url = format!("file://{}", tmp.to_string_lossy());
  // --virtual-time-budget 等 JS/图片/字体加载完；--no-pdf-header-footer 确保无页眉页脚。
  let output = std::process::Command::new(&chrome)
    .args([
      "--headless=new",
      "--disable-gpu",
      "--no-pdf-header-footer",
      "--run-all-compositor-stages-before-draw",
      "--virtual-time-budget=10000",
      &format!("--print-to-pdf={}", save_path),
      &file_url,
    ])
    .output()
    .map_err(|e| format!("启动浏览器失败: {e}"))?;
  let _ = std::fs::remove_file(&tmp);
  if !output.status.success() {
    return Err(format!("生成 PDF 失败: {}", String::from_utf8_lossy(&output.stderr)));
  }
  Ok(())
}

/// Agent 抽取通道的运行结果。前端用 kind 路由不同提示文案。
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentExtractionResult {
  /// 成功时为 `<source>.foliaviz` 的绝对路径；失败/取消时为 null。
  pub output_path: Option<String>,
  /// 实际运行耗时（毫秒），含落盘等待。
  pub duration_ms: u64,
  /// 错误分类。前端按分类映射本地化文案。
  /// ok | cli_not_found | spawn_failed | timeout | agent_failed | cancelled
  pub kind: String,
  /// 错误时的辅助诊断文本（stderr 摘要或解释）。
  pub message: String,
}

/// 计算给定源 Markdown 路径对应的 `.foliaviz` 输出路径。
/// 规则：`<源文件>.foliaviz`，与源文件同目录。Folia 端 `WatchPath` 也会据此订阅。
fn derive_output_path(source: &Path) -> PathBuf {
  let mut name = source
    .file_name()
    .map(|n| n.to_os_string())
    .unwrap_or_default();
  name.push(".foliaviz");
  source
    .parent()
    .map(|p| p.join(&name))
    .unwrap_or_else(|| PathBuf::from(&name))
}

/// 在 $PATH 里查找 `claude` 可执行文件。返回完整路径，未找到则 None。
///
/// 不直接调用 `which` crate——spawn 阶段的 PATH 解析依赖 std::process::Command，
/// 这里只是给前端一个"先提示用户去装"的友好错误。
fn locate_claude_cli() -> Option<PathBuf> {
  let path_var = std::env::var_os("PATH")?;
  for dir in std::env::split_paths(&path_var) {
    for name in ["claude", "claude.exe"] {
      let candidate = dir.join(name);
      if candidate.is_file() {
        return Some(candidate);
      }
    }
  }
  None
}

/// 拼出本次任务的 claude CLI prompt：把规格 + 源文路径 + 输出路径注入。
fn build_agent_prompt(source: &Path, output: &Path) -> String {
  format!(
    "{spec}\n\n---\n\n# 本次任务参数\n\n- 源 Markdown 绝对路径：`{src}`\n- 输出 `.foliaviz` 绝对路径：`{out}`\n\n请读取源 Markdown，按上述规格把抽取结果写入输出路径。完成后不需要返回总结，直接退出即可。",
    spec = EXTRACTION_SPEC_V1,
    src = source.display(),
    out = output.display(),
  )
}

/// 在 `timeout` 范围内轮询 `path` 是否出现且非空。返回是否在超时前看到。
fn wait_for_output(path: &Path, timeout: Duration) -> bool {
  let deadline = Instant::now() + timeout;
  loop {
    if let Ok(meta) = std::fs::metadata(path) {
      if meta.len() > 0 {
        return true;
      }
    }
    if Instant::now() >= deadline {
      return false;
    }
    thread::sleep(AGENT_OUTPUT_POLL_INTERVAL);
  }
}

/// ADR-0004 落地：spawn claude CLI 离线抽取源 Markdown，写出 .foliaviz。
///
/// 流程：探测 CLI → 校验源路径（已打开的 Markdown 文件）→ 算输出路径 →
/// 把规格+源文路径拼成 prompt 喂给 `claude -p` → 等子进程退出 → 轮询 .foliaviz 落盘 → 返回。
///
/// v1 故意把 prompt 一次性塞给 `-p` 而非流式喂入 markdown：抽取是单次离线任务、
/// 不需要交互、不需要中间进度；前端只关心"开始 / 完成 / 失败"三个状态。
#[tauri::command]
fn spawn_agent_extraction(source_path: String) -> Result<AgentExtractionResult, String> {
  let started = Instant::now();
  let source = PathBuf::from(&source_path);

  // 路径白名单与现有 read_opened_document 保持一致，扩展名之外还要过黑名单，
  // 避免前端在「AI 可视化」按钮里塞 /etc/passwd 类路径让 claude 误读。
  if !is_openable_document_path(&source) {
    return Err("只能对 Markdown / Folia 受支持文档调用 AI 抽取".into());
  }
  if is_denied_root(&source) {
    return Err(format!(
      "源路径命中黑名单，拒绝抽取：{}",
      source.display()
    ));
  }
  let source_meta = std::fs::metadata(&source)
    .map_err(|error| format!("源文件不存在或不可读：{error}"))?;
  if !source_meta.is_file() {
    return Err(format!("源路径不是文件：{}", source.display()));
  }

  let output = derive_output_path(&source);
  // 重新抽取前清理旧产物，避免前端的 WatchPath 误以为是"未变化"。
  let _ = std::fs::remove_file(&output);

  let cli = match locate_claude_cli() {
    Some(p) => p,
    None => {
      return Ok(AgentExtractionResult {
        output_path: None,
        duration_ms: started.elapsed().as_millis() as u64,
        kind: "cli_not_found".into(),
        message: "未在 PATH 中找到 claude CLI。请先安装 Claude Code 并登录后重试。".into(),
      });
    }
  };

  let prompt = build_agent_prompt(&source, &output);
  let mut child = match std::process::Command::new(&cli)
    .arg("--permission-mode")
    .arg("bypassPermissions")
    .arg("--output-format")
    .arg("text")
    .arg("-p")
    .arg(&prompt)
    .stdin(Stdio::null())
    .stdout(Stdio::null())
    .stderr(Stdio::piped())
    .current_dir(source.parent().unwrap_or_else(|| Path::new(".")))
    .spawn()
  {
    Ok(child) => child,
    Err(error) => {
      return Ok(AgentExtractionResult {
        output_path: None,
        duration_ms: started.elapsed().as_millis() as u64,
        kind: "spawn_failed".into(),
        message: format!("启动 claude CLI 失败：{error}"),
      });
    }
  };

  // 阻塞轮询 try_wait 直到子进程退出或超时。stdout 不在前端呈现，直接丢弃。
  let exit_status = loop {
    match child.try_wait() {
      Ok(Some(status)) => break Ok(status),
      Ok(None) => {
        if started.elapsed() >= AGENT_EXTRACTION_TIMEOUT {
          let _ = child.kill();
          let _ = child.wait();
          break Err(AgentExtractionResult {
            output_path: None,
            duration_ms: started.elapsed().as_millis() as u64,
            kind: "timeout".into(),
            message: format!(
              "AI 抽取超过 {} 秒未返回，已取消。",
              AGENT_EXTRACTION_TIMEOUT.as_secs()
            ),
          });
        }
        thread::sleep(Duration::from_millis(200));
      }
      Err(error) => {
        break Err(AgentExtractionResult {
          output_path: None,
          duration_ms: started.elapsed().as_millis() as u64,
          kind: "spawn_failed".into(),
          message: format!("等待 claude CLI 退出失败：{error}"),
        });
      }
    }
  };

  let exit_status = match exit_status {
    Ok(s) => s,
    Err(early) => return Ok(early),
  };
  let stderr_text = match child.stderr.take() {
    Some(mut pipe) => {
      let mut buf = String::new();
      let _ = pipe.read_to_string(&mut buf);
      buf
    }
    None => String::new(),
  };
  let exit_ok = exit_status.success();

  if !exit_ok {
    return Ok(AgentExtractionResult {
      output_path: None,
      duration_ms: started.elapsed().as_millis() as u64,
      kind: "agent_failed".into(),
      message: if stderr_text.trim().is_empty() {
        "claude CLI 退出码非零，无 stderr 输出".into()
      } else {
        format!("claude CLI 失败：{}", stderr_text.trim())
      },
    });
  }

  // 退出成功 → 等待 .foliaviz 落盘（最多 2 秒，覆盖 editor atomic-save 的小延迟）。
  if !wait_for_output(&output, Duration::from_secs(2)) {
    return Ok(AgentExtractionResult {
      output_path: None,
      duration_ms: started.elapsed().as_millis() as u64,
      kind: "agent_failed".into(),
      message: "claude CLI 已退出但未在源目录写入 .foliaviz。请查看终端输出。".into(),
    });
  }

  Ok(AgentExtractionResult {
    output_path: Some(output.to_string_lossy().into_owned()),
    duration_ms: started.elapsed().as_millis() as u64,
    kind: "ok".into(),
    message: String::new(),
  })
}

/// 占位命令：后续可扩展成「轮询当前正在跑的抽取任务进度」。
/// v1 用 spawn_agent_extraction 同步返回足够，前端无需再 ping。
#[tauri::command]
fn agent_extraction_status() -> AgentExtractionResult {
  AgentExtractionResult {
    output_path: None,
    duration_ms: 0,
    kind: "idle".into(),
    message: "空闲".into(),
  }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  let app_state = AppState {
    watchers: Mutex::new(HashMap::new()),
    tab_windows: Mutex::new(HashMap::new()),
  };

  tauri::Builder::default()
    .manage(OpenedPaths(Mutex::new(collect_initial_open_paths())))
    .manage(app_state)
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_fs::init())
    .plugin(tauri_plugin_opener::init())
    .plugin(tauri_plugin_process::init())
    .plugin(tauri_plugin_updater::Builder::new().build())
    .invoke_handler(tauri::generate_handler![
      pending_opened_paths,
      read_opened_document,
      write_opened_document,
      watch_path,
      unwatch_path,
      create_tab_window,
      update_tab_window_tabs,
      close_tab_window,
      open_html_anything,
      export_pdf_via_chrome,
      spawn_agent_extraction,
      agent_extraction_status
    ])
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .on_window_event(|window, event| {
      // ISS-164：新窗口（包括 tear-off 出的独立窗口）创建时也挂上关闭监听。
      if let tauri::WindowEvent::CloseRequested { api, .. } = event {
        let label = window.label();
        if label == "main" {
          // macOS 标准：主窗口点 × = 隐藏（prevent_close + hide），不销毁窗口、不退出 app。
          // 这样点 Dock 图标（RunEvent::Reopen）能重新 show 恢复；否则窗口销毁后
          // Dock 图标无法再打开窗口，用户会感到“关不掉 / 恢复不了”。
          api.prevent_close();
          let _ = window.hide();
        } else {
          // 独立窗口（tear-off）：emit window:closed 回收 tab，并主动销毁窗口。
          // macOS 动态创建窗口的 CloseRequested 默认关闭偶发不生效（× 点了不关），
          // destroy() 强制销毁且不再触发 CloseRequested（无递归）。
          handle_window_close(window);
          let _ = window.destroy();
        }
      }
    })
    .build(tauri::generate_context!())
    .expect("error while building tauri application")
    .run(|_app, _event| {
      // macOS：点 Dock 图标（窗口已 hide 或 minimize 后）触发 Reopen，恢复主窗口。
      #[cfg(target_os = "macos")]
      if let tauri::RunEvent::Reopen { .. } = _event {
        if let Some(window) = _app.get_webview_window("main") {
          let _ = window.unminimize();
          let _ = window.show();
          let _ = window.set_focus();
        }
      }
      #[cfg(any(target_os = "macos", target_os = "ios", target_os = "android"))]
      if let tauri::RunEvent::Opened { urls } = _event {
        let paths = opened_paths_from_urls(urls);
        if paths.is_empty() {
          return;
        }

        _app
          .state::<OpenedPaths>()
          .0
          .lock()
          .unwrap()
          .extend(paths.clone());

        if let Some(window) = _app.get_webview_window("main") {
          let _ = window.unminimize();
          let _ = window.show();
          let _ = window.set_focus();
        }

        let _ = _app.emit("opened-paths", paths);
      }
    });
}

/// ISS-164：tear-off 窗口关闭时回收 tab 列表并 emit `window:closed` 给主窗口。
///
/// `on_window_event` 回调给的是 `&Window`（tao 抽象层），通过 `window.label()`
/// 拿到 label，再用 `app.get_webview_window` 取 `WebviewWindow` 走状态查找。
fn handle_window_close(window: &tauri::Window) {
  let label = window.label().to_string();
  // 主窗口关闭 = 应用退出，无需回收 tab（AppState 跟着进程销毁）。
  if label == "main" {
    return;
  }
  let app = window.app_handle();
  let remaining = take_tab_ids_for_window(app, &label);
  let _ = app.emit(
    "window:closed",
    serde_json::json!({
      "label": label,
      "remainingTabIds": remaining,
    }),
  );
}

fn collect_initial_open_paths() -> Vec<String> {
  std::env::args_os()
    .skip(1)
    .filter_map(|arg| openable_path_to_string(PathBuf::from(arg)))
    .collect()
}

#[cfg(any(target_os = "macos", target_os = "ios", target_os = "android"))]
fn opened_paths_from_urls(urls: Vec<tauri::Url>) -> Vec<String> {
  urls
    .into_iter()
    .filter_map(|url| {
      if url.scheme() != "file" {
        return None;
      }

      url.to_file_path().ok().and_then(openable_path_to_string)
    })
    .collect()
}

fn openable_path_to_string(path: PathBuf) -> Option<String> {
  if !is_openable_document_path(&path) {
    return None;
  }

  path.into_os_string().into_string().ok()
}

fn is_openable_document_path(path: &Path) -> bool {
  matches!(
    path
      .extension()
      .and_then(|extension| extension.to_str())
      .map(|extension| extension.to_ascii_lowercase())
      .as_deref(),
    Some("md" | "markdown" | "html" | "htm" | "docx" | "foliaviz")
  )
}

fn is_writable_document_path(path: &Path) -> bool {
  matches!(
    path
      .extension()
      .and_then(|extension| extension.to_str())
      .map(|extension| extension.to_ascii_lowercase())
      .as_deref(),
    Some("md" | "markdown" | "html" | "htm" | "foliaviz")
  )
}

#[cfg(test)]
mod tests {
  use super::*;
  use std::time::Duration;

  fn temp_path(name: &str) -> PathBuf {
    std::env::temp_dir().join(format!("folia-{}-{}", std::process::id(), name))
  }

  /// 不依赖 tauri AppHandle 的轻量路径校验入口：把 `validate_watch_path`
  /// 抽出来作为 `&str -> Result<PathBuf, String>` 单测。
  #[test]
  fn read_opened_document_reads_supported_document_bytes() {
    let path = temp_path("opened.md");
    std::fs::write(&path, b"# opened").unwrap();

    let bytes = read_opened_document_bytes(&path).unwrap();

    assert_eq!(bytes, b"# opened");
    let _ = std::fs::remove_file(path);
  }

  #[test]
  fn read_opened_document_rejects_unsupported_extensions() {
    let path = temp_path("secret.txt");
    std::fs::write(&path, b"secret").unwrap();

    let error = read_opened_document_bytes(&path).unwrap_err();

    assert!(error.contains("unsupported document type"));
    let _ = std::fs::remove_file(path);
  }

  #[test]
  fn read_opened_document_rejects_oversized_files() {
    // 超过 MAX_OPENED_DOCUMENT_BYTES 的文件在读取前就应被拦截（ISS-159）。
    let path = temp_path("oversized.md");
    std::fs::write(&path, vec![0u8; MAX_OPENED_DOCUMENT_BYTES as usize + 1]).unwrap();

    let error = read_opened_document_bytes(&path).unwrap_err();

    assert!(
      error.contains("file too large"),
      "expected size-limit error, got: {error}"
    );
    let _ = std::fs::remove_file(path);
  }

  #[test]
  fn read_and_write_opened_document_support_foliaviz() {
    let path = temp_path("workbook.foliaviz");
    std::fs::write(&path, b"{\"kind\":\"folia.visual.workbook\"}").unwrap();

    let bytes = read_opened_document_bytes(&path).unwrap();
    assert_eq!(bytes, b"{\"kind\":\"folia.visual.workbook\"}");

    write_opened_document(
      path.to_string_lossy().to_string(),
      "{\"kind\":\"folia.visual.workbook\",\"updated\":true}".into(),
    )
    .unwrap();
    assert_eq!(
      std::fs::read_to_string(&path).unwrap(),
      "{\"kind\":\"folia.visual.workbook\",\"updated\":true}"
    );
    let _ = std::fs::remove_file(path);
  }

  #[test]
  fn read_opened_document_accepts_file_at_size_limit() {
    // 恰好等于上限的文件应可正常读取（边界：> 才拒绝）。
    let path = temp_path("at-limit.md");
    std::fs::write(&path, vec![0u8; MAX_OPENED_DOCUMENT_BYTES as usize]).unwrap();

    let bytes = read_opened_document_bytes(&path).unwrap();

    assert_eq!(bytes.len(), MAX_OPENED_DOCUMENT_BYTES as usize);
    let _ = std::fs::remove_file(path);
  }

  #[test]
  fn write_opened_document_writes_supported_text_documents() {
    let path = temp_path("saved.html");
    std::fs::write(&path, b"before").unwrap();

    write_opened_document(path.to_string_lossy().to_string(), "<h1>after</h1>".into()).unwrap();

    assert_eq!(std::fs::read_to_string(&path).unwrap(), "<h1>after</h1>");
    let _ = std::fs::remove_file(path);
  }

  #[test]
  fn write_opened_document_rejects_docx() {
    let path = temp_path("saved.docx");
    std::fs::write(&path, b"before").unwrap();

    let error = write_opened_document(path.to_string_lossy().to_string(), "after".into()).unwrap_err();

    assert!(error.contains("unsupported document type"));
    let _ = std::fs::remove_file(path);
  }

  // ──────── ISS-172 read/write 路径黑名单 ────────

  /// 命中黑名单前缀时 read 应直接拒绝（不读 metadata，避免暴露存在性）。
  /// 即使文件实际存在（如测试用临时文件），扩展名合法也仍然拒绝。
  #[test]
  fn read_opened_document_rejects_denied_root_paths() {
    // 路径必须带合法扩展名（.md / .html），否则会被前置 extension check 先拦下，
    // 无法验证黑名单逻辑。所有路径均使用"跨平台可读"的 raw 字符串，模拟目标平台
    // 的绝对路径形态，绕过 Path::is_absolute 的平台绑定。
    let denied_cases = [
      // Unix 系黑名单
      "/etc/folia-test.md",
      "/etc/folia-test.html",
      "/dev/notes.md",
      "/System/Volumes/Preboot/notes.html",
      // Windows 黑名单（跨平台单测：用 raw 字符串模拟盘符路径）
      "C:\\Windows\\System32\\drivers\\etc\\hosts.md",
      "c:\\windows\\system32\\foo.html",
      "C:\\$Recycle.Bin\\notes.md",
      // 子目录命中
      "/etc/foo/bar/baz.md",
    ];

    for raw in denied_cases {
      let path = PathBuf::from(raw);
      let error = read_opened_document_bytes(&path)
        .err()
        .unwrap_or_else(|| panic!("expected denial for {raw}"));
      assert!(
        error.contains("denied roots list"),
        "expected denied-roots error for {raw}, got: {error}"
      );
    }
  }

  /// 命中黑名单前缀时 write 应直接拒绝，覆盖前不应动磁盘。
  #[test]
  fn write_opened_document_rejects_denied_root_paths() {
    let denied_cases = [
      "/etc/folia-write.md",
      "/dev/notes.html",
      "C:\\Windows\\evil.md",
      "c:\\$recycle.bin\\evil.html",
    ];

    for raw in denied_cases {
      let error = write_opened_document(raw.into(), "x".into())
        .err()
        .unwrap_or_else(|| panic!("expected denial for {raw}"));
      assert!(
        error.contains("denied roots list"),
        "expected denied-roots error for {raw}, got: {error}"
      );
    }
  }

  /// 路径未被黑名单命中时 read/write 不受新检查影响（普通文档路径仍可读写）。
  /// 用 `temp_path` 提供的临时目录确保不误命中黑名单前缀。
  #[test]
  fn read_write_opened_document_unaffected_for_normal_paths() {
    let path = temp_path("normal.md");
    std::fs::write(&path, b"# normal").unwrap();

    let bytes = read_opened_document_bytes(&path).unwrap();
    assert_eq!(bytes, b"# normal");

    write_opened_document(path.to_string_lossy().to_string(), "# updated".into()).unwrap();
    assert_eq!(std::fs::read_to_string(&path).unwrap(), "# updated");

    let _ = std::fs::remove_file(path);
  }

  // ──────── ISS-162 文件监听安全模式单测 ────────

  /// 创建一个独立的 AppState 用以模拟多次 watch/unwatch 不留泄漏。
  fn fresh_state() -> AppState {
    AppState {
      watchers: Mutex::new(HashMap::new()),
      tab_windows: Mutex::new(HashMap::new()),
    }
  }

  /// 把 RecommendedWatcher 直接塞进 AppState（绕开 tauri::AppHandle），
  /// 用以单测资源回收行为。Notify 事件回调直接丢弃——这里只关心句柄管理。
  fn push_watcher_for_test(state: &AppState, key: PathBuf) {
    let watcher: RecommendedWatcher = notify::recommended_watcher(|_| {}).unwrap();
    let entry = WatchEntry {
      _watcher: watcher,
      last_event: Mutex::new(Instant::now()),
    };
    state.watchers.lock().unwrap().insert(key, entry);
  }

  #[test]
  fn validate_rejects_relative_path() {
    let error = validate_watch_path("relative/path").unwrap_err();
    assert!(error.contains("must be absolute"), "got: {error}");
  }

  #[test]
  fn validate_rejects_dot_relative_path() {
    let error = validate_watch_path("./local").unwrap_err();
    assert!(error.contains("must be absolute"), "got: {error}");
  }

  #[test]
  fn validate_rejects_unix_root() {
    let error = validate_watch_path("/").unwrap_err();
    assert!(error.contains("denied roots"), "got: {error}");
  }

  #[test]
  fn validate_rejects_dev_prefix() {
    let error = validate_watch_path("/dev/null").unwrap_err();
    assert!(error.contains("denied roots"), "got: {error}");

    let error = validate_watch_path("/dev").unwrap_err();
    assert!(error.contains("denied roots"), "got: {error}");
  }

  #[test]
  fn validate_rejects_system_volumes_prefix() {
    let error = validate_watch_path("/System/Volumes").unwrap_err();
    assert!(error.contains("denied roots"), "got: {error}");

    // 区分大小写不敏感：lowercase / 大小写混用都要拒。
    let error = validate_watch_path("/system/Volumes/Preboot").unwrap_err();
    assert!(error.contains("denied roots"), "got: {error}");
  }

  #[test]
  fn validate_rejects_etc_prefix_unix() {
    let error = validate_watch_path("/etc/passwd").unwrap_err();
    assert!(error.contains("denied roots"), "got: {error}");

    // 大小写不敏感（macOS HFS+/APFS、Windows NTFS）：/ETC 等同 /etc。
    let error = validate_watch_path("/ETC/passwd").unwrap_err();
    assert!(error.contains("denied roots"), "got: {error}");
  }

  #[test]
  fn validate_rejects_windows_root_case_insensitive() {
    let error = validate_watch_path("C:\\Windows\\System32").unwrap_err();
    assert!(error.contains("denied roots"), "got: {error}");

    let error = validate_watch_path("c:\\windows\\System32").unwrap_err();
    assert!(error.contains("denied roots"), "got: {error}");

    let error = validate_watch_path("C:\\$Recycle.Bin\\file").unwrap_err();
    assert!(error.contains("denied roots"), "got: {error}");
  }

  #[test]
  fn validate_rejects_nonexistent_path() {
    let error = validate_watch_path("/nonexistent/abc123-xyz").unwrap_err();
    assert!(error.contains("does not exist"), "got: {error}");
  }

  #[test]
  fn validate_accepts_existing_tmp_file() {
    let path = temp_path("watch-target.md");
    std::fs::write(&path, b"hi").unwrap();

    let result = validate_watch_path(&path.to_string_lossy());
    assert!(result.is_ok(), "expected ok, got: {:?}", result.err());

    let _ = std::fs::remove_file(path);
  }

  #[test]
  fn watch_state_releases_handles_after_unwatch_cycle() {
    // 关键不变量：100 次 watch + 100 次 unwatch 后 HashMap 必须回到基线，
    // 否则每次 watch 都泄漏一个 RecommendedWatcher 句柄（ISS-162）。
    let state = fresh_state();
    let baseline = state.watchers.lock().unwrap().len();
    assert_eq!(baseline, 0);

    for i in 0..100 {
      let key = temp_path(&format!("cycle-{i}"));
      push_watcher_for_test(&state, key.clone());
      assert_eq!(state.watchers.lock().unwrap().len(), baseline + 1);

      // 模拟 unwatch_path：直接 remove。
      state.watchers.lock().unwrap().remove(&key);
      assert_eq!(state.watchers.lock().unwrap().len(), baseline);
    }
  }

  #[test]
  fn watch_state_dedupes_duplicate_path() {
    // 同一路径重复注册：后注册的 watcher 覆盖前一个，不应泄漏。
    let state = fresh_state();
    let key = temp_path("dedup.md");
    std::fs::write(&key, b"x").unwrap();

    push_watcher_for_test(&state, key.clone());
    push_watcher_for_test(&state, key.clone());

    assert_eq!(state.watchers.lock().unwrap().len(), 1);
    let _ = std::fs::remove_file(key);
  }

  #[test]
  fn unwatch_path_is_idempotent() {
    // unwatch_path 接受任意已 normalize 的字符串；
    // 对未注册 / 黑名单 / 相对路径都返回 Ok(())，便于前端在关闭 tab 时无脑调用。
    let state = fresh_state();
    let key = temp_path("idempotent.md");
    std::fs::write(&key, b"x").unwrap();
    push_watcher_for_test(&state, key.clone());

    state.watchers.lock().unwrap().remove(&key);
    // 二次 remove 仍返回空。
    state.watchers.lock().unwrap().remove(&key);
    assert_eq!(state.watchers.lock().unwrap().len(), 0);
    let _ = std::fs::remove_file(key);
  }

  #[test]
  fn last_event_timestamp_is_mutable() {
    // 保证 WatchEntry::last_event 可被 notify 回调写入，用于去重轮询。
    let state = fresh_state();
    let key = temp_path("stamp.md");
    push_watcher_for_test(&state, key.clone());

    let binding = state.watchers.lock().unwrap();
    let entry = binding.get(&key).expect("watcher should be present");
    let before = *entry.last_event.lock().unwrap();
    std::thread::sleep(Duration::from_millis(5));
    *entry.last_event.lock().unwrap() = Instant::now();
    let after = *entry.last_event.lock().unwrap();
    drop(binding);
    assert!(after > before, "expected timestamp to advance");
  }

  // ──────── ISS-164 tear-off tab 多窗口单测（DEC-102） ────────

  fn fresh_tab_state() -> AppState {
    AppState {
      watchers: Mutex::new(HashMap::new()),
      tab_windows: Mutex::new(HashMap::new()),
    }
  }

  #[test]
  fn label_validation_accepts_safe_ascii() {
    assert!(is_valid_tab_window_label("main"));
    assert!(is_valid_tab_window_label("tab-window-1"));
    assert!(is_valid_tab_window_label("TabWindow_42"));
    assert!(is_valid_tab_window_label("a"));
  }

  #[test]
  fn label_validation_rejects_empty_and_invalid() {
    assert!(!is_valid_tab_window_label(""));
    assert!(!is_valid_tab_window_label("has space"));
    assert!(!is_valid_tab_window_label("has/slash"));
    assert!(!is_valid_tab_window_label("中文"));
    assert!(!is_valid_tab_window_label("with.dot"));
    // 64 字符上限：boundary 测试。
    let long_64 = "a".repeat(64);
    let long_65 = "a".repeat(65);
    assert!(is_valid_tab_window_label(&long_64));
    assert!(!is_valid_tab_window_label(&long_65));
  }

  #[test]
  fn tab_window_state_inserts_and_takes() {
    // create_tab_window 插入 + take_tab_ids_for_window 弹出。
    let state = fresh_tab_state();
    state.tab_windows.lock().unwrap().insert(
      "tab-window-1".to_string(),
      TabWindowEntry {
        tab_ids: vec!["tab-a".to_string(), "tab-b".to_string()],
      },
    );

    // 模拟 handle_window_close 调用 take。
    let taken = state
      .tab_windows
      .lock()
      .unwrap()
      .remove("tab-window-1")
      .map(|e| e.tab_ids)
      .unwrap_or_default();
    assert_eq!(taken, vec!["tab-a".to_string(), "tab-b".to_string()]);

    // 二次 take 应返回空。
    let taken_again = state
      .tab_windows
      .lock()
      .unwrap()
      .remove("tab-window-1")
      .map(|e| e.tab_ids)
      .unwrap_or_default();
    assert!(taken_again.is_empty());
  }

  #[test]
  fn tab_window_state_dedupes_label_insert() {
    // 同一 label 重复 insert：后插入覆盖前一条，不留垃圾 entry。
    let state = fresh_tab_state();
    state.tab_windows.lock().unwrap().insert(
      "tab-window-1".to_string(),
      TabWindowEntry {
        tab_ids: vec!["old".to_string()],
      },
    );
    state.tab_windows.lock().unwrap().insert(
      "tab-window-1".to_string(),
      TabWindowEntry {
        tab_ids: vec!["new".to_string()],
      },
    );

    let entry = state
      .tab_windows
      .lock()
      .unwrap()
      .get("tab-window-1")
      .expect("entry should remain")
      .tab_ids
      .clone();
    assert_eq!(entry, vec!["new".to_string()]);
  }

  #[test]
  fn tab_window_state_supports_multiple_labels() {
    // 多个独立窗口并存：互不干扰。
    let state = fresh_tab_state();
    state.tab_windows.lock().unwrap().insert(
      "tab-window-1".to_string(),
      TabWindowEntry { tab_ids: vec!["a".into()] },
    );
    state.tab_windows.lock().unwrap().insert(
      "tab-window-2".to_string(),
      TabWindowEntry { tab_ids: vec!["b".into(), "c".into()] },
    );

    let guard = state.tab_windows.lock().unwrap();
    assert_eq!(guard.len(), 2);
    assert_eq!(guard.get("tab-window-1").unwrap().tab_ids, vec!["a".to_string()]);
    assert_eq!(
      guard.get("tab-window-2").unwrap().tab_ids,
      vec!["b".to_string(), "c".to_string()]
    );
  }

  #[test]
  fn urlencode_encodes_special_chars() {
    // tear-off 窗口 URL 用 urlencode 编码 label，避免空格 / 中文等破坏 URL。
    assert_eq!(urlencode("safe-label_1.0"), "safe-label_1.0");
    assert_eq!(urlencode("has space"), "has%20space");
    assert_eq!(urlencode("中文"), "%E4%B8%AD%E6%96%87");
    assert_eq!(urlencode("a&b=c"), "a%26b%3Dc");
  }

  #[test]
  fn tab_window_url_includes_initial_tab_ids() {
    let url = tab_window_url(
      "tab-window-1",
      &["tab-a".to_string(), "tab-b".to_string()],
    );

    assert_eq!(
      url,
      "index.html?mode=tab-window&label=tab-window-1&tabIds=tab-a,tab-b"
    );
  }

  // ===== Agent 抽取通道：路径与命令输出形状测试 =====

  #[test]
  fn derive_output_path_appends_foliaviz_suffix() {
    let source = PathBuf::from("/tmp/案件.md");
    assert_eq!(
      derive_output_path(&source),
      PathBuf::from("/tmp/案件.md.foliaviz")
    );
  }

  #[test]
  fn derive_output_path_works_for_relative_source() {
    let source = PathBuf::from("notes.md");
    assert_eq!(
      derive_output_path(&source),
      PathBuf::from("notes.md.foliaviz")
    );
  }

  #[test]
  fn build_agent_prompt_includes_spec_and_paths() {
    let prompt = build_agent_prompt(
      Path::new("/abs/case.md"),
      Path::new("/abs/case.md.foliaviz"),
    );
    assert!(prompt.contains("Folia 可视化抽取规格"));
    assert!(prompt.contains("源 Markdown 绝对路径：`/abs/case.md`"));
    assert!(prompt.contains("输出 `.foliaviz` 绝对路径：`/abs/case.md.foliaviz`"));
  }
}
