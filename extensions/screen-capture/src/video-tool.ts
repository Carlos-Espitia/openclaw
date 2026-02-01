import { execSync, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import os from "node:os";
import path from "node:path";

import { Type } from "@sinclair/typebox";

import type { OpenClawPluginApi } from "../../../src/plugins/types.js";
import type { ScreenCaptureConfig } from "./config.js";

type MonitorBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

// PowerShell script to get monitor bounds
function createGetMonitorBoundsScript(): string {
  return `
Add-Type -AssemblyName System.Windows.Forms

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class DpiHelper {
    [DllImport("user32.dll")]
    public static extern bool SetProcessDPIAware();
}
"@
[DpiHelper]::SetProcessDPIAware()

$screens = [System.Windows.Forms.Screen]::AllScreens
$index = 0
foreach ($screen in $screens) {
    Write-Output "$index|$($screen.Bounds.X)|$($screen.Bounds.Y)|$($screen.Bounds.Width)|$($screen.Bounds.Height)"
    $index++
}
`;
}

function getMonitorBounds(monitorIndex: number): MonitorBounds | null {
  const tmpDir = os.tmpdir();
  const scriptPath = path.join(tmpDir, `get-monitor-bounds-${crypto.randomUUID()}.ps1`);

  try {
    const script = createGetMonitorBoundsScript();
    fsSync.writeFileSync(scriptPath, script, "utf-8");

    const output = execSync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${scriptPath}"`, {
      timeout: 10000,
      windowsHide: true,
      encoding: "utf-8",
    });

    fsSync.unlinkSync(scriptPath);

    const lines = output.trim().split("\n").filter(Boolean);
    for (const line of lines) {
      const [idx, x, y, width, height] = line.trim().split("|");
      if (parseInt(idx, 10) === monitorIndex) {
        return {
          x: parseInt(x, 10),
          y: parseInt(y, 10),
          width: parseInt(width, 10),
          height: parseInt(height, 10),
        };
      }
    }

    // If monitor not found, return first monitor
    if (lines.length > 0) {
      const [, x, y, width, height] = lines[0].trim().split("|");
      return {
        x: parseInt(x, 10),
        y: parseInt(y, 10),
        width: parseInt(width, 10),
        height: parseInt(height, 10),
      };
    }

    return null;
  } catch {
    try {
      fsSync.unlinkSync(scriptPath);
    } catch {
      // ignore
    }
    return null;
  }
}

function jsonResult(payload: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
    details: payload,
  };
}

async function saveMediaBuffer(
  buffer: Buffer,
  contentType?: string,
  subdir?: string,
  maxBytes?: number,
  originalFilename?: string,
) {
  // Dynamic import to handle source vs dist paths
  let saveFn: typeof import("../../../src/media/store.js").saveMediaBuffer;
  try {
    const mod = await import("../../../src/media/store.js");
    saveFn = mod.saveMediaBuffer;
  } catch {
    const mod = await import("../../../media/store.js");
    saveFn = (mod as any).saveMediaBuffer;
  }
  return saveFn(buffer, contentType, subdir, maxBytes, originalFilename);
}

function findFfmpeg(configPath?: string): string | null {
  // Check config path first
  if (configPath) {
    try {
      const result = spawnSync(configPath, ["-version"], { timeout: 5000, windowsHide: true });
      if (result.status === 0) {
        return configPath;
      }
    } catch {
      // ignore
    }
  }

  // Check if ffmpeg is in PATH
  try {
    const result = spawnSync("ffmpeg", ["-version"], {
      timeout: 5000,
      windowsHide: true,
      shell: true,
    });
    if (result.status === 0) {
      return "ffmpeg";
    }
  } catch {
    // ignore
  }

  // Common Windows install locations
  const commonPaths = [
    "C:\\ffmpeg\\bin\\ffmpeg.exe",
    "C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe",
    "C:\\Program Files (x86)\\ffmpeg\\bin\\ffmpeg.exe",
    path.join(os.homedir(), "ffmpeg", "bin", "ffmpeg.exe"),
    path.join(os.homedir(), "scoop", "shims", "ffmpeg.exe"),
  ];

  for (const p of commonPaths) {
    try {
      const result = spawnSync(p, ["-version"], { timeout: 5000, windowsHide: true });
      if (result.status === 0) {
        return p;
      }
    } catch {
      // ignore
    }
  }

  return null;
}

export function createVideoTool(api: OpenClawPluginApi) {
  const pluginConfig = (api.pluginConfig ?? {}) as ScreenCaptureConfig;
  const maxDuration = pluginConfig.maxVideoDuration ?? 60;

  return {
    name: "record_screen",
    label: "Record Screen",
    description:
      "Record a video of the desktop screen. Requires FFmpeg to be installed. Use this to capture a video showing actions on the screen, demonstrations, or to document a process. Returns a path to the recorded video file.",
    parameters: Type.Object({
      duration: Type.Number({
        description: `Duration in seconds to record (1-${maxDuration}). Required.`,
        minimum: 1,
        maximum: maxDuration,
      }),
      monitor: Type.Optional(
        Type.Number({
          description:
            "Monitor index to capture. Use list_monitors to see available monitors. If not specified, captures all monitors combined.",
          minimum: 0,
        }),
      ),
      fps: Type.Optional(
        Type.Number({
          description: "Frames per second (10-60). Default: 30. Lower fps = smaller file size.",
          minimum: 10,
          maximum: 60,
        }),
      ),
    }),

    async execute(_id: string, params: Record<string, unknown>) {
      // Validate duration
      const duration =
        typeof params.duration === "number"
          ? Math.min(Math.max(Math.round(params.duration), 1), maxDuration)
          : null;

      if (duration === null) {
        return jsonResult({
          error: "duration is required",
          hint: `Specify duration in seconds (1-${maxDuration})`,
        });
      }

      const monitorIndex =
        typeof params.monitor === "number" ? params.monitor : undefined;
      const fps =
        typeof params.fps === "number" ? Math.min(Math.max(Math.round(params.fps), 10), 60) : 30;

      // Find FFmpeg
      const ffmpeg = findFfmpeg(pluginConfig.ffmpegPath);
      if (!ffmpeg) {
        return jsonResult({
          error: "FFmpeg not found",
          hint: "Install FFmpeg: winget install ffmpeg, or download from ffmpeg.org and add to PATH, or set ffmpegPath in plugin config",
        });
      }

      // Get monitor bounds if specific monitor requested
      let monitorBounds: MonitorBounds | null = null;
      if (monitorIndex !== undefined) {
        monitorBounds = getMonitorBounds(monitorIndex);
        if (!monitorBounds) {
          return jsonResult({
            error: "Failed to get monitor bounds",
            hint: "Use list_monitors to see available monitors",
          });
        }
      }

      // Create temp file for video
      const tmpDir = os.tmpdir();
      const filename = `recording-${crypto.randomUUID()}.mp4`;
      const outputPath = path.join(tmpDir, filename);

      try {
        // Build FFmpeg command for Windows GDI capture
        const args: string[] = ["-f", "gdigrab", "-framerate", String(fps)];

        // If specific monitor, add offset and video_size
        if (monitorBounds) {
          args.push(
            "-offset_x",
            String(monitorBounds.x),
            "-offset_y",
            String(monitorBounds.y),
            "-video_size",
            `${monitorBounds.width}x${monitorBounds.height}`,
          );
        }

        args.push(
          "-i",
          "desktop",
          "-t",
          String(duration),
          "-vf",
          "pad=ceil(iw/2)*2:ceil(ih/2)*2", // Pad to even dimensions for H.264
          "-c:v",
          "libx264",
          "-pix_fmt",
          "yuv420p",
          "-preset",
          "ultrafast",
          "-y", // overwrite output
          outputPath,
        );

        api.logger?.info?.(`Recording screen for ${duration}s...`);

        // Run FFmpeg (this blocks for the duration)
        // Note: FFmpeg outputs to stderr even on success, so we can't rely on exit code
        spawnSync(ffmpeg, args, {
          timeout: (duration + 30) * 1000, // extra 30s for encoding
          windowsHide: true,
          stdio: "ignore", // Ignore stderr since FFmpeg uses it for progress
        });

        // Check file exists and has content (this is the real success indicator)
        let stat;
        try {
          stat = await fs.stat(outputPath);
        } catch {
          throw new Error("Recording failed - no output file created");
        }

        if (stat.size === 0) {
          throw new Error("Recording produced empty file");
        }

        // Read video and save to media store
        const videoBuffer = await fs.readFile(outputPath);
        const saved = await saveMediaBuffer(
          videoBuffer,
          "video/mp4",
          "recordings",
          100 * 1024 * 1024, // 100MB max for videos
          `screen-recording-${duration}s.mp4`,
        );

        // Clean up temp file
        fs.unlink(outputPath).catch(() => {});

        const monitorDesc = monitorIndex !== undefined ? `monitor ${monitorIndex}` : "all monitors";
        return jsonResult({
          success: true,
          message: `Recorded ${duration}s of ${monitorDesc} at ${fps}fps`,
          path: saved.path,
          size: saved.size,
          contentType: saved.contentType,
          duration,
          fps,
          monitor: monitorIndex,
          monitorBounds,
        });
      } catch (error) {
        // Clean up on error
        fs.unlink(outputPath).catch(() => {});

        const message = error instanceof Error ? error.message : String(error);
        return jsonResult({
          error: "Screen recording failed",
          details: message,
          hint: "Ensure FFmpeg is installed and accessible. Try: winget install ffmpeg",
        });
      }
    },
  };
}
