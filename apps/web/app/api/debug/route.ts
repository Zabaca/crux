import { userConfig } from "@crux/core";

export async function GET() {
  return Response.json({
    CRUX_HOME_env: process.env.CRUX_HOME,
    CRUX_HOME_resolved: userConfig.resolveCruxHome(),
    cwd: process.cwd(),
  });
}
