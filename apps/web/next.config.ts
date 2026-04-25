import type { NextConfig } from "next";

const config: NextConfig = {
  transpilePackages: ["@crux/core"],
  serverExternalPackages: ["@libsql/client"],
  webpack: (config) => {
    // `@crux/core` is authored as NodeNext-style ESM TypeScript and uses
    // explicit `.js` import suffixes that resolve to its `.ts` source files.
    // Webpack needs an alias to do the same.
    config.resolve = config.resolve ?? {};
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      ".js": [".ts", ".tsx", ".js"],
    };
    return config;
  },
};

export default config;
