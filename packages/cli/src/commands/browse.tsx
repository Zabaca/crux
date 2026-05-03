import React from "react";
import { defineCommand } from "citty";
import { render } from "ink";
import { App } from "../browse/App.js";

export const browseCommand = defineCommand({
  meta: {
    name: "browse",
    description: "Interactive TUI for inspecting a Crux workstream.",
  },
  async run() {
    const instance = render(<App />, {
      alternateScreen: true,
    });
    await instance.waitUntilExit();
  },
});
