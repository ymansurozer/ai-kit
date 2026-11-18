// Many suites run `install` against the repo's real MCPs in a subprocess, which
// inherits this env. Skipping MCP setup keeps them from downloading packages and
// browsers; mcp-setup.test.ts covers the setup step with an injected runner.
process.env.AI_KIT_SKIP_MCP_SETUP = "1";
