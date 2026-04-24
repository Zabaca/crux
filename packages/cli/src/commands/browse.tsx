import React from "react";
import { defineCommand } from "citty";
import { render } from "ink";
import { App } from "../browse/App.js";

export const browseCommand = defineCommand({
  meta: {
    name: "browse",
    description: "Interactive TUI for inspecting a Crux workstream.",
  },
  args: {
    workstream: {
      type: "string",
      alias: "w",
      description: "Open directly into the given workstream slug.",
    },
  },
  async run({ args }) {
    const slug = typeof args.workstream === "string" ? args.workstream : undefined;
    const instance = render(<App initialSlug={slug} />);
    await instance.waitUntilExit();
  },
});
