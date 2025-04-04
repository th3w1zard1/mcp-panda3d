#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import puppeteer from "puppeteer";

const BASE_URL = "https://docs.panda3d.org";

interface Panda3DDocsArgs {
  query: string;
  check_keywords?: boolean;
  search_contents?: boolean;
}

const isValidDocsArgs = (args: any): args is Panda3DDocsArgs =>
  typeof args === "object" && args !== null && typeof args.query === "string";

class Panda3DDocsServer {
  private server: Server;
  private browser: puppeteer.Browser | null = null;
  private debugLog: string[] = [];

  constructor() {
    this.server = new Server(
      {
        name: "panda3d-docs-server",
        version: "0.1.0",
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupToolHandlers();

    process.on("SIGINT", async () => {
      if (this.browser) {
        await this.browser.close();
      }
      await this.server.close();
      process.exit(0);
    });
  }

  private log(message: string) {
    console.error(`[DEBUG] ${message}`);
    this.debugLog.push(message);
  }

  private async initBrowser() {
    if (!this.browser) {
      this.browser = await puppeteer.launch({
        headless: true,
      });
    }
    return this.browser;
  }

  private async searchDocs(
    query: string,
    options: Panda3DDocsArgs
  ): Promise<string> {
    this.debugLog = []; // Clear debug log
    const browser = await this.initBrowser();
    const page = await browser.newPage();

    try {
      // Search page
      const searchUrl =
        `${BASE_URL}/1.10/python/search?` +
        new URLSearchParams({
          q: query,
          check_keywords: options.check_keywords !== false ? "yes" : "no",
          area: options.search_contents ? "project" : "default",
        });

      this.log(`Searching: ${searchUrl}`);
      await page.goto(searchUrl, { waitUntil: "networkidle0" });

      // Get search results
      const results = await page.evaluate(() => {
        const items = Array.from(document.querySelectorAll(".search li")).slice(
          0,
          10
        );
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
        const fullUrl = result.url.startsWith("http")
          ? result.url
          : result.url.startsWith("/")
          ? `${BASE_URL}${result.url}`
          : `${BASE_URL}/1.10/python/${result.url}`;
        content += `${i + 1}. ${result.title}\n   ${fullUrl}\n`;
        if (result.description) {
          content += `   ${result.description}\n`;
        }
        content += "\n";
      });

      // Find the most relevant result (ShowBase class if searching for ShowBase)
      let bestResultIndex = 0;
      if (query.toLowerCase() === "showbase") {
        const classIndex = results.findIndex((r) =>
          r.title.toLowerCase().includes("showbase.showbase.showbase")
        );
        if (classIndex !== -1) {
          bestResultIndex = classIndex;
          this.log(`Found ShowBase class at index ${classIndex}`);
        }
      }

      // Get best result page content
      const bestResultUrl = results[bestResultIndex].url.startsWith("http")
        ? results[bestResultIndex].url
        : results[bestResultIndex].url.startsWith("/")
        ? `${BASE_URL}${results[bestResultIndex].url}`
        : `${BASE_URL}/1.10/python/${results[bestResultIndex].url}`;

      this.log(`Getting content from: ${bestResultUrl}`);
      await page.goto(bestResultUrl, { waitUntil: "networkidle0" });

      // Extract page content with minimal formatting
      const pageContent = await page.evaluate(() => {
        const log: string[] = [];

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
          .replace(/\r\n/g, "\n")  // Normalize line endings
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
      } else {
        this.log(`Got ${pageContent.content.length} characters of content`);
        content += "\nDetailed documentation:\n";
        content += "=".repeat(40) + "\n\n";
        content += pageContent.content;
      }

      // Add debug log to output
      content += "\n\nDebug Log:\n";
      content += "=".repeat(40) + "\n";
      content += this.debugLog.join("\n");

      return content;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.log(`Error: ${message}`);
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to fetch Panda3D documentation: ${message}\n\nDebug Log:\n${this.debugLog.join(
          "\n"
        )}`
      );
    } finally {
      await page.close();
    }
  }

  private setupToolHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: "get_docs",
          description:
            "Get Panda3D documentation for a class, function, or module",
          inputSchema: {
            type: "object",
            properties: {
              query: {
                type: "string",
                description:
                  'Search query (e.g. "NodePath", "ShowBase", "editor")',
              },
              check_keywords: {
                type: "boolean",
                description:
                  "Search in module names and titles (default: true)",
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
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      if (request.params.name !== "get_docs") {
        throw new McpError(
          ErrorCode.MethodNotFound,
          `Unknown tool: ${request.params.name}`
        );
      }

      if (!isValidDocsArgs(request.params.arguments)) {
        throw new McpError(
          ErrorCode.InvalidParams,
          "Invalid documentation arguments"
        );
      }

      const docs = await this.searchDocs(
        request.params.arguments.query,
        request.params.arguments
      );

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

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
  }
}

const server = new Panda3DDocsServer();
server
  .run()
  .catch((error: Error) => console.error("[Server Error]", error.message));
