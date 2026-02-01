import { execSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import os from "node:os";
import path from "node:path";

import { Type } from "@sinclair/typebox";

import type { OpenClawPluginApi } from "../../../src/plugins/types.js";
import type { ScreenCaptureConfig } from "./config.js";

// PowerShell script to capture screen using .NET with DPI awareness
function createScreenshotScript(outputPath: string, monitorIndex: number, imageFormat: string): string {
  return `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

# Enable DPI awareness for accurate screen capture
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class DpiHelper {
    [DllImport("user32.dll")]
    public static extern bool SetProcessDPIAware();
}
"@
[DpiHelper]::SetProcessDPIAware()

$monitorIndex = ${monitorIndex}
$screens = [System.Windows.Forms.Screen]::AllScreens

if ($monitorIndex -ge $screens.Length) {
    $monitorIndex = 0
}

$screen = $screens[$monitorIndex].Bounds
$bitmap = New-Object System.Drawing.Bitmap($screen.Width, $screen.Height)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.CopyFromScreen($screen.Location, [System.Drawing.Point]::Empty, $screen.Size)

$format = [System.Drawing.Imaging.ImageFormat]::${imageFormat === "jpeg" ? "Jpeg" : "Png"}
$bitmap.Save("${outputPath.replace(/\\/g, "\\\\")}", $format)

$graphics.Dispose()
$bitmap.Dispose()

Write-Output "OK"
`;
}

// PowerShell script to list monitors
function createListMonitorsScript(): string {
  return `
Add-Type -AssemblyName System.Windows.Forms

# Enable DPI awareness
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
    $primary = if ($screen.Primary) { "PRIMARY" } else { "" }
    Write-Output "$index|$($screen.DeviceName)|$($screen.Bounds.Width)|$($screen.Bounds.Height)|$($screen.Bounds.X)|$($screen.Bounds.Y)|$primary"
    $index++
}
`;
}

async function saveMediaBuffer(
  buffer: Buffer,
  contentType?: string,
  subdir?: string,
  maxBytes?: number,
  originalFilename?: string,
) {
  // Dynamic import to handle source vs dist paths
  try {
    const mod = await import("../../../src/media/store.js");
    return mod.saveMediaBuffer(buffer, contentType, subdir, maxBytes, originalFilename);
  } catch {
    const mod = await import("../../../media/store.js");
    return (mod as any).saveMediaBuffer(buffer, contentType, subdir, maxBytes, originalFilename);
  }
}

async function imageResultFromFile(params: {
  label: string;
  path: string;
  extraText?: string;
  details?: Record<string, unknown>;
}) {
  // Dynamic import to handle source vs dist paths
  try {
    const mod = await import("../../../src/agents/tools/common.js");
    return mod.imageResultFromFile(params);
  } catch {
    const mod = await import("../../../agents/tools/common.js");
    return (mod as any).imageResultFromFile(params);
  }
}

function jsonResult(payload: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
    details: payload,
  };
}

export function createListMonitorsTool(_api: OpenClawPluginApi) {
  return {
    name: "list_monitors",
    label: "List Monitors",
    description:
      "List all available monitors/displays on the system. Returns monitor index, name, resolution, and position. Use this to see which monitors are available before taking a screenshot.",
    parameters: Type.Object({}),

    async execute(_id: string, _params: Record<string, unknown>) {
      const tmpDir = os.tmpdir();
      const scriptPath = path.join(tmpDir, `list-monitors-${crypto.randomUUID()}.ps1`);

      try {
        const script = createListMonitorsScript();
        fsSync.writeFileSync(scriptPath, script, "utf-8");

        const output = execSync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${scriptPath}"`, {
          timeout: 10000,
          windowsHide: true,
          encoding: "utf-8",
        });

        fs.unlink(scriptPath).catch(() => {});

        const monitors = output
          .trim()
          .split("\n")
          .filter(Boolean)
          .map((line) => {
            const [index, name, width, height, x, y, primary] = line.trim().split("|");
            return {
              index: parseInt(index, 10),
              name: name?.trim(),
              width: parseInt(width, 10),
              height: parseInt(height, 10),
              x: parseInt(x, 10),
              y: parseInt(y, 10),
              primary: primary === "PRIMARY",
            };
          });

        return jsonResult({
          monitors,
          count: monitors.length,
          hint: "Use the 'monitor' parameter in take_screenshot or record_screen to capture a specific monitor by index.",
        });
      } catch (error) {
        fs.unlink(scriptPath).catch(() => {});
        const message = error instanceof Error ? error.message : String(error);
        return jsonResult({
          error: "Failed to list monitors",
          details: message,
        });
      }
    },
  };
}

export function createScreenshotTool(api: OpenClawPluginApi) {
  const pluginConfig = (api.pluginConfig ?? {}) as ScreenCaptureConfig;

  return {
    name: "take_screenshot",
    label: "Take Screenshot",
    description:
      "Take a screenshot of the desktop screen. Returns the captured image. Use this when you need to see what's on the user's screen or capture visual information.",
    parameters: Type.Object({
      delay: Type.Optional(
        Type.Number({
          description: "Seconds to wait before capturing (0-10). Default: 0",
          minimum: 0,
          maximum: 10,
        }),
      ),
      monitor: Type.Optional(
        Type.Number({
          description: "Monitor index to capture (0 = primary). Default: 0",
          minimum: 0,
        }),
      ),
    }),

    async execute(_id: string, params: Record<string, unknown>) {
      const delay = typeof params.delay === "number" ? Math.min(Math.max(params.delay, 0), 10) : 0;
      const monitor =
        typeof params.monitor === "number" ? params.monitor : (pluginConfig.defaultMonitor ?? 0);
      const format = pluginConfig.screenshotFormat ?? "png";

      // Wait if delay specified
      if (delay > 0) {
        await new Promise((resolve) => setTimeout(resolve, delay * 1000));
      }

      // Create temp file for screenshot
      const tmpDir = os.tmpdir();
      const filename = `screenshot-${crypto.randomUUID()}.${format}`;
      const outputPath = path.join(tmpDir, filename);

      // Create temp script file
      const scriptPath = path.join(tmpDir, `screenshot-${crypto.randomUUID()}.ps1`);

      try {
        // Write PowerShell script to temp file
        const script = createScreenshotScript(outputPath, monitor, format);
        fsSync.writeFileSync(scriptPath, script, "utf-8");

        // Run PowerShell script file
        execSync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${scriptPath}"`, {
          timeout: 30000,
          windowsHide: true,
        });

        // Read the screenshot file
        const buffer = await fs.readFile(outputPath);
        const mimeType = format === "jpeg" ? "image/jpeg" : "image/png";

        // Save to media store (persists for agent to access)
        const saved = await saveMediaBuffer(
          buffer,
          mimeType,
          "screenshots",
          10 * 1024 * 1024, // 10MB max
          `screenshot.${format}`,
        );

        // Clean up temp files
        fs.unlink(outputPath).catch(() => {});
        fs.unlink(scriptPath).catch(() => {});

        // Return image result from the saved media path
        return await imageResultFromFile({
          label: "Screenshot",
          path: saved.path,
          extraText: `Screenshot captured (monitor ${monitor}, ${format}). Saved to: ${saved.path}`,
          details: { monitor, format, delay, savedPath: saved.path },
        });
      } catch (error) {
        // Clean up on error
        fs.unlink(outputPath).catch(() => {});
        fs.unlink(scriptPath).catch(() => {});

        const message = error instanceof Error ? error.message : String(error);
        return jsonResult({
          error: "Screenshot capture failed",
          details: message,
          platform: process.platform,
        });
      }
    },
  };
}
