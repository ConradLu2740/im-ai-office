use once_cell::sync::Lazy;
use std::fs::OpenOptions;
use std::path::PathBuf;
use std::process::Stdio;
use std::time::Duration;
use tokio::process::{Child, Command};
use tokio::sync::Mutex;
use tokio::time::sleep;

static BACKEND: Lazy<Mutex<Option<Child>>> = Lazy::new(|| Mutex::const_new(None));

#[derive(serde::Serialize)]
struct BackendStatus {
    running: bool,
    message: String,
}

fn workspace_root() -> anyhow::Result<PathBuf> {
    // 返回「包含 backend-ts/ 的目录」（即 im-ai-office 根）。
    // 生产包路径：IMAI办公助手.app/Contents/MacOS/imai-office
    // resource 目录：.../Contents/Resources/backend（内含 backend-ts/）
    let exe = std::env::current_exe()?;
    let candidate = exe
        .parent() // MacOS
        .and_then(|p| p.parent()) // Contents
        .map(|p| p.join("Resources").join("backend"));
    if candidate.as_ref().map(|p| p.join("backend-ts").join("src").join("index.ts").exists()).unwrap_or(false) {
        return Ok(candidate.unwrap());
    }
    // 源码布局：im-ai-office/desktop/src-tauri/../../
    let src_tauri = std::env::current_dir()?;
    let fallback = src_tauri
        .parent()
        .and_then(|p| p.parent())
        .map(|p| p.to_path_buf())
        .unwrap_or_else(|| src_tauri.clone());
    if fallback.join("backend-ts").join("src").join("index.ts").exists() {
        Ok(fallback)
    } else {
        Err(anyhow::anyhow!("找不到 backend-ts/src/index.ts，请确认后端源码位置"))
    }
}

fn node_executable() -> PathBuf {
    if let Ok(n) = std::env::var("NODE_PATH") {
        return PathBuf::from(n);
    }
    // Finder/Dock 启动的 app PATH 极简（/usr/bin:/bin:...），shell 里的安装位探测不到 → 先探测常见绝对路径
    let home = std::env::var("HOME").unwrap_or_default();
    for p in [
        "/usr/local/bin/node".to_string(),
        "/opt/homebrew/bin/node".to_string(),
        format!("{home}/.local/node/bin/node"),
    ] {
        if PathBuf::from(&p).exists() {
            return PathBuf::from(p);
        }
    }
    for name in ["node", "nodejs"] {
        if let Ok(path) = which::which(name) {
            return path;
        }
    }
    PathBuf::from("node")
}

async fn is_backend_alive() -> bool {
    match reqwest::get("http://127.0.0.1:8000/api/roles").await {
        Ok(r) => r.status().is_success(),
        Err(_) => false,
    }
}

#[derive(serde::Serialize)]
struct Diagnosis {
    node: String,
    workspace: String,
    index_ts_exists: bool,
    node_modules_exists: bool,
    backend_alive: bool,
    cwd: String,
    exe: String,
}

#[tauri::command]
async fn diagnose() -> Result<Diagnosis, String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let cwd = std::env::current_dir().map_err(|e| e.to_string())?;
    let root = workspace_root().ok();
    let node = node_executable();
    Ok(Diagnosis {
        node: node.to_string_lossy().to_string(),
        workspace: root.as_ref().map(|p| p.to_string_lossy().to_string()).unwrap_or_default(),
        index_ts_exists: root.as_ref().map(|p| p.join("backend-ts").join("src").join("index.ts").exists()).unwrap_or(false),
        node_modules_exists: root.as_ref().map(|p| p.join("backend-ts").join("node_modules").exists()).unwrap_or(false),
        backend_alive: is_backend_alive().await,
        cwd: cwd.to_string_lossy().to_string(),
        exe: exe.to_string_lossy().to_string(),
    })
}

#[tauri::command]
async fn api_call(
    method: String,
    path: String,
    body: Option<serde_json::Value>,
) -> Result<serde_json::Value, String> {
    // /gw 反代已随网关收敛删除（2026-09-02）：所有请求统一走 8000 后端
    let url = format!("http://127.0.0.1:8000{}", path);
    let client = reqwest::Client::new();
    let mut req = match method.to_uppercase().as_str() {
        "GET" => client.get(&url),
        "POST" => client.post(&url),
        "PUT" => client.put(&url),
        "DELETE" => client.delete(&url),
        "PATCH" => client.patch(&url),
        m => return Err(format!("不支持的 method: {}", m)),
    };
    if let Some(body) = body {
        req = req.json(&body);
    }
    let res = req.send().await.map_err(|e| format!("请求失败: {}", e))?;
    let status = res.status();
    let text = res.text().await.map_err(|e| format!("读取响应失败: {}", e))?;
    if !status.is_success() {
        return Err(format!("HTTP {}: {}", status, text));
    }
    serde_json::from_str(&text).map_err(|e| format!("JSON 解析失败: {} (body: {})", e, text))
}

#[tauri::command]
async fn start_backend() -> Result<BackendStatus, String> {
    let root = workspace_root().map_err(|e| e.to_string())?;
    if is_backend_alive().await {
        return Ok(BackendStatus {
            running: true,
            message: "后端已在运行".into(),
        });
    }

    let node = node_executable();
    let backend_dir = root.join("backend-ts");

    let log_file = OpenOptions::new()
        .create(true)
        .append(true)
        .open("/tmp/imai-backend.log")
        .map_err(|e| e.to_string())?;
    // tsx 以 devDependency 装在 backend-ts/node_modules（打包需随资源携带）
    let mut child = Command::new(&node)
        .args(["--import", "tsx", "src/index.ts"])
        .current_dir(&backend_dir)
        .stdout(Stdio::from(log_file.try_clone().map_err(|e| e.to_string())?))
        .stderr(Stdio::from(log_file))
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| format!("启动后端失败: {} (node={:?}, cwd={:?})", e, node, backend_dir))?;

    for _ in 0..60 {
        sleep(Duration::from_millis(500)).await;
        if is_backend_alive().await {
            let mut guard = BACKEND.lock().await;
            *guard = Some(child);
            return Ok(BackendStatus {
                running: true,
                message: "后端启动成功".into(),
            });
        }
    }

    let _ = child.kill().await;
    Err("后端启动超时，请确认 backend-ts/node_modules 已安装（npm install）".into())
}

#[tauri::command]
async fn stop_backend() -> Result<BackendStatus, String> {
    let mut guard = BACKEND.lock().await;
    if let Some(mut child) = guard.take() {
        let _ = child.kill().await;
    }
    Ok(BackendStatus {
        running: false,
        message: "后端已停止".into(),
    })
}

#[tauri::command]
async fn backend_health() -> Result<BackendStatus, String> {
    let running = is_backend_alive().await;
    Ok(BackendStatus {
        running,
        message: if running { "后端健康" } else { "后端未响应" }.into(),
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![start_backend, stop_backend, backend_health, diagnose, api_call])
        .setup(|_app| {
            tauri::async_runtime::spawn(async move {
                sleep(Duration::from_secs(2)).await;
                let _ = start_backend().await;
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
