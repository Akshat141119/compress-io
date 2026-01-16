import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open, save, message, ask } from "@tauri-apps/plugin-dialog";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { motion, AnimatePresence } from "framer-motion";
import { listen } from "@tauri-apps/api/event"; 
import "./App.css";

export default function App() {
  const [filePath, setFilePath] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [logs, setLogs] = useState("");
  
  // GPU Toggle State
  const [useGpu, setUseGpu] = useState(false);

  // Progress State
  const [progress, setProgress] = useState(0);
  const [timeLeft, setTimeLeft] = useState(null);
  
  // Ref for Duration calculation
  const totalDurationRef = useRef(0);

  const [dimSettings, setDimSettings] = useState({ width: "", height: "" });

  // File Type Detection
  // Updated Regex to include new formats
  const isImage = filePath.match(/\.(jpg|jpeg|png|webp|bmp|tiff)$/i);
  const isPdf   = filePath.match(/\.(pdf)$/i);              
  const isDoc   = filePath.match(/\.(doc|docx|txt|rtf)$/i); 
  const isVideo = !isImage && !isPdf && !isDoc && filePath;
  
  let fileTypeLabel = "VID";
  if (isImage) fileTypeLabel = "IMG";
  else if (isPdf) fileTypeLabel = "PDF";
  else if (isDoc) fileTypeLabel = "DOC";

  useEffect(() => {
    checkForAppUpdates();

    // LISTEN FOR FFMPEG PROGRESS
    const unlisten = listen("ffmpeg-progress", (event) => {
      const line = event.payload;
      
      // 1. Capture Duration
      const durationMatch = line.match(/Duration:\s+(\d{2}):(\d{2}):(\d{2})/);
      if (durationMatch) {
        const h = parseInt(durationMatch[1]);
        const m = parseInt(durationMatch[2]);
        const s = parseInt(durationMatch[3]);
        totalDurationRef.current = (h * 3600) + (m * 60) + s;
      }

      // 2. Capture Current Time
      const timeMatch = line.match(/time=(\d{2}):(\d{2}):(\d{2})/);
      if (timeMatch && totalDurationRef.current > 0) {
        const h = parseInt(timeMatch[1]);
        const m = parseInt(timeMatch[2]);
        const s = parseInt(timeMatch[3]);
        const currentSeconds = (h * 3600) + (m * 60) + s;

        const percent = Math.round((currentSeconds / totalDurationRef.current) * 100);
        setProgress(percent);

        const remaining = totalDurationRef.current - currentSeconds;
        setTimeLeft(formatTime(remaining));
      }

      setLogs(line);
    });

    return () => {
      unlisten.then(f => f());
    };
  }, []);

  function formatTime(seconds) {
    if (seconds < 0) return "Calculating...";
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}m ${s}s`;
  }

  async function checkForAppUpdates() {
    try {
      const update = await check();
      if (update?.available) {
        const yes = await ask(`Update v${update.version} available!`, {
          title: 'Update Available', kind: 'info', okLabel: 'Update', cancelLabel: 'Later'
        });
        if (yes) {
          await update.downloadAndInstall();
          await relaunch();
        }
      }
    } catch (error) { console.log("Updater check skipped"); }
  }

  async function handleFileSelect() {
    try {
      const selected = await open({
        multiple: false,
        filters: [{
          name: 'Media',
          // ✅ THE COMPLETE LIST OF SUPPORTED EXTENSIONS
          extensions: [
            // Video
            'mp4', 'mkv', 'avi', 'mov', 'webm', 'flv', 'wmv', 'm4v', 'ts', 'ogv', 'gif',
            // Image
            'png', 'jpg', 'jpeg', 'webp', 'bmp', 'tiff'
          ] 
        }]
      });
      if (selected) {
        setFilePath(selected);
        setLogs(""); 
        setProgress(0);
        setTimeLeft(null);
        totalDurationRef.current = 0;
        setDimSettings({ width: "", height: "" });
        setUseGpu(false); // Reset GPU toggle on new file
      }
    } catch (err) { console.error(err); }
  }

  // --- COMPRESSION LOGIC ---
  async function startCompression() {
    if (!filePath) return;
    
    if (isPdf || isDoc) {
      await message("Documents not supported yet.", { title: "Warning", kind: "warning" });
      return;
    }

    const originalExt = filePath.split('.').pop(); 
    const filterName = isImage ? "Compressed Image" : "Compressed Media";

    // We strictly use original extension because backend handles codec switching (e.g. WebM -> VP9)
    const outputPath = await save({
      filters: [{
        name: filterName,
        extensions: [originalExt] 
      }],
      defaultPath: `compressed_${Date.now()}.${originalExt}`
    });

    if (!outputPath) return;

    setIsProcessing(true);
    setProgress(0);
    setTimeLeft("Starting...");
    
    try {
      if (isImage) {
        await invoke("compress_image", { 
          input: filePath,
          output: outputPath,
          width: dimSettings.width || "0", 
          height: dimSettings.height || "0"
        });
        setProgress(100); 
      } else {
        // --- SMART AUTO DETECT CALL ---
        await invoke("compress_video", { 
          input: filePath,
          output: outputPath,
          autoGpu: useGpu 
        });
        setProgress(100);
      }

      await message(`Saved to:\n${outputPath}`, { title: "Success", kind: "info" });
      
    } catch (e) { 
      console.error(e); 
      setLogs("Error: " + e); 
      await message(`Failed: ${e}`, { title: "Error", kind: "error" });
    } finally { 
      setIsProcessing(false); 
      setTimeLeft(null);
    }
  }

  function removeFile() {
    setFilePath("");
    setLogs("");
    setProgress(0);
    setDimSettings({ width: "", height: "" });
    setUseGpu(false);
  }

  return (
    <div className="pastel-wrapper">
      <div className="gradient-blob blob-1"></div>
      <div className="gradient-blob blob-2"></div>
      <div className="gradient-blob blob-3"></div>

      <motion.div layout className="glass-panel">
        <header className="header-soft">
          <div className="logo-area"><span className="logo-icon">⚡</span><h1>Compress I/O</h1></div>
          <div className="status-bubble">
            <span className={`status-dot ${isProcessing ? 'pulsing' : ''}`}></span>
            {isProcessing ? "Processing..." : "Idle"}
          </div>
        </header>

        <motion.div layout className="content-area">
          <AnimatePresence mode="wait">
            {!filePath ? (
              <motion.div 
                key="empty"
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                whileHover={{ scale: 1.02, backgroundColor: "rgba(255,255,255,0.6)" }}
                whileTap={{ scale: 0.98 }}
                className="upload-soft"
                onClick={handleFileSelect}
              >
                <div className="icon-soft">+</div>
                <p>Click to Select Media</p>
              </motion.div>
            ) : (
              <motion.div 
                key="file"
                initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
                className="file-card-soft"
              >
                <div className={`file-icon-soft`}>{fileTypeLabel}</div>
                <div className="file-info">
                  <span className="file-name" title={filePath}>{filePath.split(/[\\/]/).pop()}</span>
                  
                  {isProcessing && !isImage && (
                    <div className="progress-container">
                      <div className="progress-bar-bg">
                        <motion.div 
                          className="progress-bar-fill" 
                          initial={{ width: 0 }}
                          animate={{ width: `${progress}%` }}
                          transition={{ type: "spring", stiffness: 50 }}
                        />
                      </div>
                      <div className="progress-stats">
                        <span>{progress}%</span>
                        <span>{timeLeft ? `~${timeLeft} left` : "Calculating..."}</span>
                      </div>
                    </div>
                  )}

                </div>
                <button className="btn-remove-soft" onClick={removeFile} disabled={isProcessing}>✕</button>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>

        {/* --- SETTINGS AREA --- */}
        <AnimatePresence>
          {(isImage || isVideo) && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="settings-soft">
              
              {/* IMAGE SETTINGS */}
              {isImage && (
                <div className="input-block">
                  <label>Rescale (Optional)</label>
                  <div className="row">
                    <input type="number" placeholder="Width" value={dimSettings.width} onChange={(e) => setDimSettings({...dimSettings, width: e.target.value})} />
                    <input type="number" placeholder="Height" value={dimSettings.height} onChange={(e) => setDimSettings({...dimSettings, height: e.target.value})} />
                  </div>
                </div>
              )}

              {/* VIDEO SETTINGS (AUTO GPU WITH TOGGLE STYLE) */}
              {isVideo && (
                <div className="input-block" style={{ marginTop: '10px' }}>
                   <label className="gpu-toggle-container">
                     
                     {/* The Slider Switch */}
                     <div className="switch">
                       <input 
                         type="checkbox" 
                         checked={useGpu} 
                         onChange={(e) => setUseGpu(e.target.checked)} 
                       />
                       <span className="slider"></span>
                     </div>

                     {/* The Text Label */}
                     <span>Enable Hardware Acceleration (Auto)</span>
                   </label>
                </div>
              )}

            </motion.div>
          )}
        </AnimatePresence>

        <motion.div layout className="footer-area">
          <div className="logs-container" style={{ fontSize: '0.7rem', color: '#999', marginBottom: '8px', height: '18px', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
            {logs}
          </div>

          {!isProcessing ? (
            <motion.button whileHover={{ scale: 1.02 }} className="btn-gradient start" onClick={startCompression} disabled={!filePath}>
              Start Optimization {useGpu ? "(Turbo)" : ""}
            </motion.button>
          ) : (
            // --- UPDATED STOP BUTTON (Calls kill_ffmpeg) ---
            <motion.button 
              className="btn-gradient stop" 
              onClick={async () => {
                await invoke("kill_ffmpeg");
                window.location.reload(); 
              }}
            >
              Stop (Restart App)
            </motion.button>
          )}
        </motion.div>
      </motion.div>
    </div>
  );
}