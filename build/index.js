#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ErrorCode, ListToolsRequestSchema, McpError, } from "@modelcontextprotocol/sdk/types.js";
import puppeteer from "puppeteer";
// Banner to show on startup
const BANNER = `
╔═════════════════════════════════════════════╗
║                                             ║
║            Panda3D MCP Server               ║
║                                             ║
╚═════════════════════════════════════════════╝
`;
const USAGE_MESSAGE = `
This is an MCP tool server for Panda3D documentation.
It should be used as a tool in an MCP client configuration.

Usage in Claude Opus:
{
  "panda3d-docs": {
    "command": "npx",
    "args": [
      "-y",
      "git+https://github.com/th3w1zard1/mcp-panda3d.git"
    ],
    "env": {},
    "timeout": 60,
    "transportType": "stdio"
  }
}

If you're seeing this message, the server is running correctly but isn't
connected to an MCP client. The server will wait for MCP protocol messages.

Press Ctrl+C to exit.
`;
const BASE_URL = "https://docs.panda3d.org";
const SERVER_VERSION = "0.1.2";
// Determine if this is being run directly (not as a child process)
const isRunningStandalone = process.stdin.isTTY && process.stdout.isTTY;
/**
 * Type guard for Panda3DDocsArgs
 */
const isValidDocsArgs = (args) => typeof args === "object" && args !== null && typeof args.query === "string";
class Panda3DDocsServer {
    server;
    browser = null;
    debugLog = [];
    startTime = Date.now();
    constructor() {
        this.logInfo(BANNER);
        this.logInfo(`Initializing Panda3D MCP Server v${SERVER_VERSION}...`);
        this.server = new Server({
            name: "panda3d-docs-server",
            version: SERVER_VERSION,
        }, {
            capabilities: {
                tools: {},
            },
        });
        this.logInfo("Registering tool handlers...");
        this.setupToolHandlers();
        this.logInfo("Setting up signal handlers...");
        process.on("SIGINT", async () => {
            this.logInfo("Received SIGINT signal, shutting down...");
            await this.cleanup();
            process.exit(0);
        });
        process.on("SIGTERM", async () => {
            this.logInfo("Received SIGTERM signal, shutting down...");
            await this.cleanup();
            process.exit(0);
        });
    }
    /**
     * Clean up resources before exiting
     */
    async cleanup() {
        this.logInfo("Cleaning up resources...");
        if (this.browser) {
            this.logInfo("Closing browser...");
            await this.browser.close();
            this.logInfo("Browser closed successfully.");
        }
        this.logInfo("Closing MCP server...");
        await this.server.close();
        this.logInfo("Server closed successfully.");
    }
    /**
     * Log an info message to stdout
     */
    logInfo(message) {
        const timestamp = new Date().toISOString();
        // eslint-disable-next-line no-console
        console.log(`[${timestamp}] [INFO] ${message}`);
    }
    /**
     * Log a warning message to stderr
     */
    logWarn(message) {
        const timestamp = new Date().toISOString();
        // eslint-disable-next-line no-console
        console.warn(`[${timestamp}] [WARN] ${message}`);
    }
    /**
     * Log an error message to stderr
     */
    logError(message) {
        const timestamp = new Date().toISOString();
        // eslint-disable-next-line no-console
        console.error(`[${timestamp}] [ERROR] ${message}`);
    }
    /**
     * Log a debug message to stderr and the debug log
     */
    log(message) {
        const timestamp = new Date().toISOString();
        // eslint-disable-next-line no-console
        console.error(`[${timestamp}] [DEBUG] ${message}`);
        this.debugLog.push(`[${timestamp}] ${message}`);
    }
    /**
     * Initialize or return the existing browser instance
     */
    async initBrowser() {
        if (!this.browser) {
            this.logInfo("Initializing Puppeteer browser...");
            this.browser = await puppeteer.launch({
                headless: true,
            });
            this.logInfo("Browser initialized successfully.");
        }
        return this.browser;
    }
    /**
     * Search Panda3D documentation and return formatted results
     */
    async searchDocs(query, options) {
        this.logInfo(`Searching Panda3D docs for: "${query}"`);
        this.debugLog = []; // Clear debug log
        const browser = await this.initBrowser();
        const page = await browser.newPage();
        try {
            // Search page
            const searchUrl = `${BASE_URL}/1.10/python/search?` +
                new URLSearchParams({
                    q: query,
                    check_keywords: options.check_keywords !== false ? "yes" : "no",
                    area: options.search_contents ? "project" : "default",
                });
            this.log(`Searching URL: ${searchUrl}`);
            this.log(`Options: check_keywords=${options.check_keywords !== false}, search_contents=${!!options.search_contents}`);
            await page.goto(searchUrl, { waitUntil: "networkidle0" });
            // Get search results
            this.log("Extracting search results...");
            const results = await page.evaluate(() => {
                const items = Array.from(document.querySelectorAll(".search li")).slice(0, 10);
                return items.map((item) => {
                    const link = item.querySelector("a");
                    return {
                        title: link?.textContent?.trim() || "",
                        url: link?.getAttribute("href") || "",
                        description: item.textContent?.trim() || "",
                    };
                });
            });
            if (results.length === 0) {
                this.log("No results found");
                return `No documentation found for "${query}"`;
            }
            this.log(`Found ${results.length} results`);
            // Format results list
            let content = `Found ${results.length} results for "${query}":\n\n`;
            results.forEach((result, i) => {
                const fullUrl = this.getFullUrl(result.url);
                content += `${i + 1}. ${result.title}\n   ${fullUrl}\n`;
                if (result.description) {
                    content += `   ${result.description}\n`;
                }
                content += "\n";
            });
            // Find the most relevant result (ShowBase class if searching for ShowBase)
            let bestResultIndex = 0;
            if (query.toLowerCase() === "showbase") {
                const classIndex = results.findIndex((r) => r.title.toLowerCase().includes("showbase.showbase.showbase"));
                if (classIndex !== -1) {
                    bestResultIndex = classIndex;
                    this.log(`Found ShowBase class at index ${classIndex}`);
                }
            }
            // Get best result page content
            const bestResultUrl = this.getFullUrl(results[bestResultIndex].url);
            this.log(`Getting detailed content from: ${bestResultUrl}`);
            await page.goto(bestResultUrl, { waitUntil: "networkidle0" });
            // Extract page content with minimal formatting
            this.log("Extracting page content...");
            const pageContent = await page.evaluate(() => {
                const log = [];
                // Log page URL and title
                log.push(`Page URL: ${window.location.href}`);
                log.push(`Page title: ${document.title}`);
                // Get the main content
                const mainContent = document.querySelector(".document");
                if (!mainContent) {
                    log.push("No .document element found");
                    return { content: "", log };
                }
                // Remove navigation elements that we don't want in the output
                const toRemove = mainContent.querySelectorAll(".headerlink");
                toRemove.forEach((el) => el.remove());
                // Get text content with basic structure preserved
                const content = mainContent.textContent || "";
                // Basic cleanup of whitespace and normalize line endings
                const cleanContent = content
                    .replace(/\r\n/g, "\n") // Normalize line endings
                    .split("\n")
                    .map((line) => line.trim())
                    .filter((line) => line.length > 0)
                    .join("\n")
                    .replace(/\n{3,}/g, "\n\n"); // Replace multiple blank lines with just one
                return { content: cleanContent, log };
            });
            // Add debug info about content extraction
            pageContent.log.forEach((msg) => this.log(msg));
            if (!pageContent.content) {
                this.log("No content found on result page");
            }
            else {
                this.log(`Got ${pageContent.content.length} characters of content`);
                content += "\nDetailed documentation:\n";
                content += "=".repeat(40) + "\n\n";
                content += pageContent.content;
            }
            // Add debug log to output
            content += "\n\nDebug Log:\n";
            content += "=".repeat(40) + "\n";
            content += this.debugLog.join("\n");
            this.logInfo(`Successfully completed search for "${query}"`);
            return content;
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.logError(`Search failed: ${message}`);
            this.log(`Error: ${message}`);
            throw new McpError(ErrorCode.InternalError, `Failed to fetch Panda3D documentation: ${message}\n\nDebug Log:\n${this.debugLog.join("\n")}`);
        }
        finally {
            await page.close();
        }
    }
    /**
     * Convert a relative URL to a full URL
     */
    getFullUrl(url) {
        if (url.startsWith("http")) {
            return url;
        }
        if (url.startsWith("/")) {
            return `${BASE_URL}${url}`;
        }
        return `${BASE_URL}/1.10/python/${url}`;
    }
    /**
     * Set up the tool request handlers
     */
    setupToolHandlers() {
        this.server.setRequestHandler(ListToolsRequestSchema, async () => {
            this.logInfo("Received ListTools request");
            return {
                tools: [
                    {
                        name: "get_docs",
                        description: "Get Panda3D documentation for a class, function, or module",
                        inputSchema: {
                            type: "object",
                            properties: {
                                query: {
                                    type: "string",
                                    description: 'Search query (e.g. "NodePath", "ShowBase", "editor")',
                                },
                                check_keywords: {
                                    type: "boolean",
                                    description: "Search in module names and titles (default: true)",
                                },
                                search_contents: {
                                    type: "boolean",
                                    description: "Search in docstrings and code (default: false)",
                                },
                            },
                            required: ["query"],
                        },
                    },
                ],
            };
        });
        this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
            this.logInfo(`Received CallTool request for tool: ${request.params.name}`);
            if (request.params.name !== "get_docs") {
                this.logError(`Unknown tool requested: ${request.params.name}`);
                throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${request.params.name}`);
            }
            if (!isValidDocsArgs(request.params.arguments)) {
                this.logError("Invalid arguments provided");
                throw new McpError(ErrorCode.InvalidParams, "Invalid documentation arguments");
            }
            this.logInfo(`Processing get_docs request with query: "${request.params.arguments.query}"`);
            const docs = await this.searchDocs(request.params.arguments.query, request.params.arguments);
            this.logInfo("Returning search results");
            return {
                content: [
                    {
                        type: "text",
                        text: docs,
                    },
                ],
            };
        });
    }
    /**
     * Start the server
     */
    async run() {
        this.logInfo("Starting MCP server...");
        const transport = new StdioServerTransport();
        this.logInfo("Connecting to transport...");
        await this.server.connect(transport);
        const uptime = ((Date.now() - this.startTime) / 1000).toFixed(2);
        this.logInfo(`Server ready! Started in ${uptime}s`);
        if (isRunningStandalone) {
            // If running in a TTY, this is likely an interactive session where the user
            // is running the server directly and not through an MCP client
            this.logInfo("Detected standalone mode (running in terminal)");
            console.log(USAGE_MESSAGE);
        }
        this.logInfo("Waiting for MCP requests...");
    }
}
/**
 * Main function to handle command line arguments and run the server
 */
const main = async () => {
    try {
        const server = new Panda3DDocsServer();
        await server.run();
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        // eslint-disable-next-line no-console
        console.error(`[${new Date().toISOString()}] [FATAL] Server failed to start: ${errorMessage}`);
        process.exit(1);
    }
};
// Run the server
main();
