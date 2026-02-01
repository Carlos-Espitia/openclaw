import type { OpenClawPluginApi } from "../../src/plugins/types.js";

import { configSchema } from "./src/config.js";
import { createScreenshotTool, createListMonitorsTool } from "./src/screenshot-tool.js";
import { createVideoTool } from "./src/video-tool.js";

const screenCapturePlugin = {
  id: "screen-capture",
  name: "Screen Capture",
  description: "Take screenshots and record videos of your desktop screen (Windows)",
  configSchema,

  register(api: OpenClawPluginApi) {
    // Only register on Windows
    if (process.platform !== "win32") {
      api.logger?.warn?.("Screen Capture plugin is currently Windows-only");
      return;
    }

    api.registerTool(createListMonitorsTool(api));
    api.registerTool(createScreenshotTool(api));
    api.registerTool(createVideoTool(api));

    api.logger?.info?.("Screen Capture plugin registered (list_monitors + screenshot + video tools)");
  },
};

export default screenCapturePlugin;
