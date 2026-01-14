use tauri_plugin_shell::ShellExt;
use tauri_plugin_shell::process::CommandEvent; 
use tauri::{AppHandle, Emitter}; 

// ==========================================
// 1. HELPER: DETECT GPU HARDWARE
// ==========================================
// 👇 FIX: Suppress warning when building CPU version
#[allow(dead_code)] 
async fn is_encoder_available(app: &AppHandle, encoder_name: &str) -> bool {
    let probe_args = vec![
        "-f", "lavfi", "-i", "color=s=64x64:d=0.1", 
        "-c:v", encoder_name,                       
        "-f", "null", "-"                           
    ];

    let output = app.shell()
        .sidecar("ffmpeg")
        .expect("Failed to create sidecar")
        .args(&probe_args)
        .output()
        .await; 

    match output {
        Ok(result) => result.status.success(),
        Err(_) => false,
    }
}

// ==========================================
// 2. COMMAND: COMPRESS IMAGE (CPU)
// ==========================================
#[tauri::command]
async fn compress_image(app: AppHandle, input: String, output: String, width: String, height: String) -> Result<String, String> {
    println!("🖼️ Processing Image...");

    let mut args = vec![
        "-i", &input,
        "-q:v", "15", 
        "-y"          
    ];

    let scale_filter; 
    if width != "0" && height != "0" {
        scale_filter = format!("scale={}:{}", width, height);
        args.push("-vf");
        args.push(&scale_filter);
    }

    args.push(&output);

    let output_cmd = app.shell()
        .sidecar("ffmpeg")
        .expect("Failed to create sidecar")
        .args(&args)
        .output()
        .await
        .map_err(|e| e.to_string())?;

    if output_cmd.status.success() {
        Ok("Image Compressed Successfully".into())
    } else {
        let err = String::from_utf8_lossy(&output_cmd.stderr);
        Err(format!("Image Error: {}", err))
    }
}

// ==========================================
// 3. COMMAND: COMPRESS VIDEO (DUAL MODE + STREAMING)
// ==========================================
#[tauri::command]
async fn compress_video(app: AppHandle, input: String, output: String) -> Result<String, String> {
    
    // 👇 FIX: Suppress "unused mut" warning in CPU mode
    #[allow(unused_mut)] 
    let mut selected_encoder = "libx264"; 
    
    #[allow(unused_mut)]
    let mut selected_args = vec!["-preset", "ultrafast"]; 

    // 2. GPU LOGIC (Only compiles if you run with --features gpu)
    #[cfg(feature = "gpu")] 
    {
        println!("🚀 GPU Feature Active: Checking Hardware...");

        if is_encoder_available(&app, "h264_videotoolbox").await {
            println!("🍎 Apple Hardware Acceleration found!");
            selected_encoder = "h264_videotoolbox";
            selected_args = vec!["-q:v", "55"]; 
        } 
        else if is_encoder_available(&app, "h264_nvenc").await {
            println!("🟢 NVIDIA GPU found!");
            selected_encoder = "h264_nvenc";
            selected_args = vec!["-preset", "p4"]; 
        } 
        else if is_encoder_available(&app, "h264_amf").await {
            println!("🔴 AMD GPU found!");
            selected_encoder = "h264_amf";
            selected_args = vec!["-usage", "transcoding"]; 
        } 
        else if is_encoder_available(&app, "h264_qsv").await {
            println!("🔵 Intel QuickSync found!");
            selected_encoder = "h264_qsv";
            selected_args = vec!["-preset", "medium"]; 
        }
    }

    // 3. CPU LOGIC (Only compiles if GPU feature is OFF)
    #[cfg(not(feature = "gpu"))]
    {
        println!("💻 CPU Safe Mode Active. Skipping hardware checks.");
    }

    println!("⚡ Encoder Selected: {}", selected_encoder);

    let mut ffmpeg_args = vec![
        "-i", &input,
        "-c:v", selected_encoder,
    ];
    ffmpeg_args.extend(selected_args);
    ffmpeg_args.extend(vec![
        "-b:v", "4M",
        "-c:a", "copy",
        "-y", 
        &output
    ]);

    // 👇 STREAMING LOGIC START 👇
    let command = app.shell()
        .sidecar("ffmpeg")
        .expect("Failed to create sidecar")
        .args(&ffmpeg_args);

    let (mut rx, mut _child) = command.spawn().expect("Failed to spawn sidecar");

    // Loop through every message FFmpeg sends
    while let Some(event) = rx.recv().await {
        if let CommandEvent::Stderr(line_bytes) = event {
            let line = String::from_utf8_lossy(&line_bytes);
            // Stream logs to Frontend for Progress Bar
            app.emit("ffmpeg-progress", line.to_string()).unwrap(); 
        }
    }

    Ok("Compression Finished".into())
}

// ==========================================
// 4. MAIN BUILDER
// ==========================================
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init()) 
        .plugin(tauri_plugin_dialog::init()) 
        .invoke_handler(tauri::generate_handler![compress_video, compress_image])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}