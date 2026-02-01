export type ScreenCaptureConfig = {
  ffmpegPath?: string;
  defaultMonitor?: number;
  screenshotFormat?: "png" | "jpeg";
  maxVideoDuration?: number;
};

export const configSchema = {
  parse(value: unknown): ScreenCaptureConfig {
    if (!value || typeof value !== "object") {
      return {};
    }
    const raw = value as Record<string, unknown>;
    return {
      ffmpegPath: typeof raw.ffmpegPath === "string" ? raw.ffmpegPath : undefined,
      defaultMonitor: typeof raw.defaultMonitor === "number" ? raw.defaultMonitor : undefined,
      screenshotFormat:
        raw.screenshotFormat === "png" || raw.screenshotFormat === "jpeg"
          ? raw.screenshotFormat
          : "png",
      maxVideoDuration:
        typeof raw.maxVideoDuration === "number" ? Math.min(raw.maxVideoDuration, 60) : 60,
    };
  },
  uiHints: {
    ffmpegPath: {
      label: "FFmpeg Path",
      help: "Path to FFmpeg executable (if not in PATH)",
      placeholder: "C:\\ffmpeg\\bin\\ffmpeg.exe",
    },
    defaultMonitor: {
      label: "Default Monitor",
      help: "Monitor index to capture (0 = primary)",
    },
    screenshotFormat: {
      label: "Screenshot Format",
      help: "Image format for screenshots (png or jpeg)",
    },
    maxVideoDuration: {
      label: "Max Video Duration",
      help: "Maximum video recording duration in seconds (max 60)",
    },
  },
};
