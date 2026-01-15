use tauri::{AppHandle, Emitter};
use tauri_plugin_shell::ShellExt;
use tauri_plugin_shell::process::CommandEvent;
use std::path::Path;

// ==========================================
// 1. COMMAND: COMPRESS VIDEO (Explicit Toggle)
// ==========================================
#[tauri::command]
async fn compress_video(app: AppHandle, input: String, output: String, use_gpu: bool) -> Result<(), String> {
    let input_path = Path::new(&input);
    if !input_path.exists() {
        return Err("Input file not found".to_string());
    }

    println!("🎥 Starting Video Compression...");

    // 1. Basic Setup
    let mut args = vec![
        "-i".to_string(),
        input.clone(),
    ];

    // 2. THE TOGGLE LOGIC
    if use_gpu {
        // --- GPU MODE (User Checked the Box) ---
        println!("🚀 GPU Mode Activated (NVIDIA)");
        
        // Use NVIDIA Encoder
        args.push("-c:v".to_string());
        args.push("h264_nvenc".to_string()); 
        
        // Fast/Medium Preset for GPU
        args.push("-preset".to_string());
        args.push("p4".to_string());         
    } else {
        // --- CPU MODE (Default) ---
        println!("🐢 CPU Mode Activated");
        
        // Use Standard CPU Encoder
        args.push("-c:v".to_string());
        args.push("libx264".to_string());    
        
        // Balanced Preset
        args.push("-preset".to_string());
        args.push("medium".to_string());
    }

    // 3. Finalize Arguments
    args.push("-c:a".to_string());
    args.push("aac".to_string());    // Keep audio as AAC
    args.push("-y".to_string());     // Overwrite output
    args.push(output.clone());

    // 4. Run FFmpeg Sidecar with Streaming
    let sidecar_command = app.shell().sidecar("ffmpeg")
        .map_err(|e| e.to_string())?
        .args(args);

    let (mut rx, mut _child) = sidecar_command
        .spawn()
        .map_err(|e| e.to_string())?;

    // 5. Stream Logs to Frontend (Progress Bar)
    while let Some(event) = rx.recv().await {
        if let CommandEvent::Stderr(line_bytes) = event {
            let line = String::from_utf8_lossy(&line_bytes);
            let _ = app.emit("ffmpeg-progress", line.to_string());
        }
    }

    Ok(())
}

// ==========================================
// 2. COMMAND: COMPRESS IMAGE
// ==========================================
#[tauri::command]
async fn compress_image(app: AppHandle, input: String, output: String, width: String, height: String) -> Result<(), String> {
    let input_path = Path::new(&input);
    if !input_path.exists() {
        return Err("Input file not found".to_string());
    }

    let mut args = vec![
        "-i".to_string(),
        input.clone(),
    ];

    // Optional Rescaling
    if width != "0" && !width.is_empty() {
        let h = if height.is_empty() || height == "0" { "-1" } else { &height };
        args.push("-vf".to_string());
        args.push(format!("scale={}:{}", width, h));
    }

    args.push("-y".to_string());
    args.push(output.clone());

    let sidecar_command = app.shell().sidecar("ffmpeg")
        .map_err(|e| e.to_string())?
        .args(args);

    let (mut rx, mut _child) = sidecar_command
        .spawn()
        .map_err(|e| e.to_string())?;

    while let Some(event) = rx.recv().await {
        if let CommandEvent::Stderr(line_bytes) = event {
            let line = String::from_utf8_lossy(&line_bytes);
            let _ = app.emit("ffmpeg-progress", line.to_string());
        }
    }

    Ok(())
}

// ==========================================
// 3. MAIN BUILDER
// ==========================================
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build()) // Kept for future updates
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![compress_video, compress_image])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}