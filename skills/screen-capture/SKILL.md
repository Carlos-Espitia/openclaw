---
name: screen-capture
description: Capture screenshots and record videos of the desktop screen.
metadata:
  {
    "openclaw":
      {
        "emoji": "🖥️",
        "skillKey": "screen-capture",
        "requires": { "config": ["plugins.entries.screen-capture.enabled"] },
      },
  }
---

# Screen Capture

Use the screen-capture plugin to take screenshots or record videos of the desktop.

## Tools

### list_monitors

List all available monitors/displays on the system. Use this first to see which monitors are available and their resolutions.

Parameters: None

Returns: JSON with array of monitors, each containing:
- `index`: Monitor number (use this in take_screenshot/record_screen)
- `name`: Display device name
- `width`, `height`: Resolution in pixels
- `x`, `y`: Position
- `primary`: Whether this is the primary monitor

Example: "List my monitors" or "What displays do I have?"

### take_screenshot

Capture a screenshot of the desktop screen. The image is returned directly in the tool result as base64 - you will see the image immediately after calling this tool. No need to read a file path.

Parameters:
- `delay` (optional): Seconds to wait before capturing (0-10)
- `monitor` (optional): Monitor index (0 = primary)

Returns: The screenshot image is embedded directly in the response. You can view it and send it to the user.

Examples:
- "Take a screenshot of my screen"
- "Screenshot after 3 seconds"
- "Capture my second monitor"

### record_screen

Record a video of the desktop. Requires FFmpeg installed.

Parameters:
- `duration` (required): Seconds to record (1-60)
- `monitor` (optional): Monitor index to capture a specific monitor. If not specified, records ALL monitors combined. Use `list_monitors` first to see available monitors.
- `fps` (optional): Frames per second (10-60). Default: 30. Lower fps = smaller file.

Returns: JSON with `path` to the saved video file in `~/.openclaw/media/recordings/`.

After recording completes, send the video file to the user:
1. The tool returns a `path` field with the full file path
2. Use the `send_file` tool or channel-specific method to send the video
3. Example: After getting path `C:\Users\...\recordings\video.mp4`, send it to the user

Examples:
- "Record my screen for 10 seconds" (records all monitors)
- "Record monitor 0 for 5 seconds" (records only primary monitor)
- "Record my second monitor for 10 seconds at 15fps" (specific monitor, lower fps)

## Requirements

- **Screenshots**: Windows only (uses PowerShell/.NET)
- **Video**: FFmpeg must be installed (`winget install ffmpeg`)

## Configuration

Plugin config lives under `plugins.entries.screen-capture.config`:

```json
{
  "ffmpegPath": "C:\\ffmpeg\\bin\\ffmpeg.exe",
  "defaultMonitor": 0,
  "screenshotFormat": "png",
  "maxVideoDuration": 60
}
```
