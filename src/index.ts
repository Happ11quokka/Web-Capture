import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { chromium, devices, type Browser, type BrowserContext } from "playwright";
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TMP_DIR = join(tmpdir(), "web-capture");
const MAX_BASE64_BYTES = 800_000; // ~800 KB limit for MCP image content

const DEVICE_MAP: Record<string, (typeof devices)[string]> = {
  "iphone-14": devices["iPhone 14"],
  "iphone-15": devices["iPhone 15 Pro Max"],
  "ipad": devices["iPad Pro 11"],
  "pixel-7": devices["Pixel 7"],
};

const DEVICE_NAMES = Object.keys(DEVICE_MAP);

// ---------------------------------------------------------------------------
// Browser singleton (lazy-launched)
// ---------------------------------------------------------------------------

let browser: Browser | null = null;

async function getBrowser(): Promise<Browser> {
  if (!browser || !browser.isConnected()) {
    browser = await chromium.launch({ headless: true });
  }
  return browser;
}

async function createContext(
  viewportWidth: number,
  viewportHeight: number,
  deviceName?: string
): Promise<BrowserContext> {
  const b = await getBrowser();

  if (deviceName && DEVICE_MAP[deviceName]) {
    return b.newContext({ ...DEVICE_MAP[deviceName] });
  }

  return b.newContext({
    viewport: { width: viewportWidth, height: viewportHeight },
  });
}

// Cleanup on exit
process.on("exit", () => {
  browser?.close().catch(() => {});
});
process.on("SIGINT", () => process.exit(0));
process.on("SIGTERM", () => process.exit(0));

// ---------------------------------------------------------------------------
// Content extraction script (runs in browser context)
// ---------------------------------------------------------------------------

const EXTRACT_SCRIPT = `(() => {
  const meta = (name) => {
    const el = document.querySelector('meta[name="' + name + '"], meta[property="' + name + '"]');
    return el ? el.getAttribute("content") : null;
  };

  const headings = [];
  document.querySelectorAll("h1, h2, h3").forEach((h) => {
    const t = h.textContent ? h.textContent.trim() : "";
    if (t) headings.push(t);
  });

  const links = [];
  const anchors = document.querySelectorAll("a[href]");
  for (let i = 0; i < Math.min(anchors.length, 50); i++) {
    const a = anchors[i];
    links.push({ text: (a.textContent || "").trim(), href: a.href });
  }

  return {
    title: document.title || null,
    description: meta("description") || meta("og:description") || null,
    ogImage: meta("og:image") || null,
    headings: headings,
    links: links,
    text: document.body ? document.body.innerText.substring(0, 5000) : "",
  };
})()`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sanitizeFilename(url: string): string {
  try {
    const u = new URL(url);
    const parts = (u.hostname + u.pathname).replace(/[^a-zA-Z0-9-]/g, "-").replace(/-+/g, "-");
    return parts.substring(0, 80);
  } catch {
    return "page";
  }
}

function ensureTmpDir(): void {
  if (!existsSync(TMP_DIR)) {
    mkdirSync(TMP_DIR, { recursive: true });
  }
}

// ---------------------------------------------------------------------------
// MCP Server
// ---------------------------------------------------------------------------

const server = new McpServer({
  name: "web-capture",
  version: "1.0.0",
});

// ---- Tool: web_screenshot ----

server.tool(
  "web_screenshot",
  "Take a full-page screenshot of a URL and extract page content (title, headings, links, text). Returns the screenshot image and structured metadata. Works with dynamic JS-rendered sites.",
  {
    url: z.string().url().describe("The URL to capture"),
    viewport_width: z.number().optional().default(1280).describe("Viewport width in pixels"),
    viewport_height: z.number().optional().default(720).describe("Viewport height in pixels"),
    device: z
      .enum(DEVICE_NAMES as [string, ...string[]])
      .optional()
      .describe("Device preset (overrides viewport). Options: iphone-14, iphone-15, ipad, pixel-7"),
    full_page: z.boolean().optional().default(true).describe("Capture the full scrollable page"),
    wait_for: z.number().optional().default(3000).describe("Extra ms to wait after page load for JS rendering"),
    selector: z.string().optional().describe("CSS selector to screenshot instead of the full page"),
    javascript: z.string().optional().describe("JS to execute before capture (e.g. dismiss cookie banners)"),
  },
  async ({ url, viewport_width, viewport_height, device, full_page, wait_for, selector, javascript }) => {
    const ctx = await createContext(viewport_width, viewport_height, device);
    try {
      const page = await ctx.newPage();
      await page.goto(url, { waitUntil: "networkidle", timeout: 30_000 });
      await page.waitForTimeout(wait_for);

      if (javascript) {
        await page.evaluate(javascript);
        await page.waitForTimeout(500);
      }

      // Extract content
      const extracted = await page.evaluate(EXTRACT_SCRIPT);

      // Take screenshot
      const screenshotOpts: { fullPage?: boolean; type: "png" } = {
        fullPage: full_page,
        type: "png",
      };

      let screenshotBuffer: Buffer;
      if (selector) {
        const el = page.locator(selector).first();
        screenshotBuffer = await el.screenshot({ type: "png" });
      } else {
        screenshotBuffer = await page.screenshot(screenshotOpts);
      }

      // Save full-size to disk
      ensureTmpDir();
      const filename = `${sanitizeFilename(url)}-${Date.now()}.png`;
      const filepath = join(TMP_DIR, filename);
      writeFileSync(filepath, screenshotBuffer);

      // If too large for MCP, re-take at smaller scale
      let base64 = screenshotBuffer.toString("base64");
      if (base64.length > MAX_BASE64_BYTES) {
        await page.setViewportSize({
          width: Math.round(viewport_width * 0.5),
          height: Math.round(viewport_height * 0.5),
        });
        await page.waitForTimeout(500);
        const smallBuffer = selector
          ? await page.locator(selector).first().screenshot({ type: "png" })
          : await page.screenshot({ fullPage: full_page, type: "png" });
        base64 = smallBuffer.toString("base64");
      }

      const metadata = {
        url: page.url(),
        ...(extracted as Record<string, unknown>),
        screenshotPath: filepath,
      };

      return {
        content: [
          { type: "image" as const, data: base64, mimeType: "image/png" },
          { type: "text" as const, text: JSON.stringify(metadata, null, 2) },
        ],
      };
    } finally {
      await ctx.close();
    }
  }
);

// ---- Tool: web_extract ----

server.tool(
  "web_extract",
  "Extract structured text content from a URL without taking a screenshot. Returns title, description, headings, links, and visible text. Faster and lighter than web_screenshot when you only need text data.",
  {
    url: z.string().url().describe("The URL to extract content from"),
    viewport_width: z.number().optional().default(1280).describe("Viewport width in pixels"),
    viewport_height: z.number().optional().default(720).describe("Viewport height in pixels"),
    device: z
      .enum(DEVICE_NAMES as [string, ...string[]])
      .optional()
      .describe("Device preset (overrides viewport)"),
    wait_for: z.number().optional().default(3000).describe("Extra ms to wait after page load for JS rendering"),
    javascript: z.string().optional().describe("JS to execute before extraction"),
  },
  async ({ url, viewport_width, viewport_height, device, wait_for, javascript }) => {
    const ctx = await createContext(viewport_width, viewport_height, device);
    try {
      const page = await ctx.newPage();
      await page.goto(url, { waitUntil: "networkidle", timeout: 30_000 });
      await page.waitForTimeout(wait_for);

      if (javascript) {
        await page.evaluate(javascript);
        await page.waitForTimeout(500);
      }

      const extracted = await page.evaluate(EXTRACT_SCRIPT);

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ url: page.url(), ...extracted as Record<string, unknown> }, null, 2),
          },
        ],
      };
    } finally {
      await ctx.close();
    }
  }
);

// ---- Tool: web_pdf ----

server.tool(
  "web_pdf",
  "Save a web page as a PDF file. Useful for archiving pages or generating printable documents from dynamic websites.",
  {
    url: z.string().url().describe("The URL to save as PDF"),
    viewport_width: z.number().optional().default(1280).describe("Viewport width in pixels"),
    viewport_height: z.number().optional().default(720).describe("Viewport height in pixels"),
    format: z
      .enum(["A4", "Letter", "Legal", "Tabloid", "A3"])
      .optional()
      .default("A4")
      .describe("PDF page format"),
    wait_for: z.number().optional().default(3000).describe("Extra ms to wait after page load"),
    javascript: z.string().optional().describe("JS to execute before generating PDF"),
  },
  async ({ url, viewport_width, viewport_height, format, wait_for, javascript }) => {
    const ctx = await createContext(viewport_width, viewport_height);
    try {
      const page = await ctx.newPage();
      await page.goto(url, { waitUntil: "networkidle", timeout: 30_000 });
      await page.waitForTimeout(wait_for);

      if (javascript) {
        await page.evaluate(javascript);
        await page.waitForTimeout(500);
      }

      ensureTmpDir();
      const filename = `${sanitizeFilename(url)}-${Date.now()}.pdf`;
      const filepath = join(TMP_DIR, filename);

      await page.pdf({ path: filepath, format });

      return {
        content: [
          {
            type: "text" as const,
            text: `PDF saved to: ${filepath}\nURL: ${page.url()}\nFormat: ${format}`,
          },
        ],
      };
    } finally {
      await ctx.close();
    }
  }
);

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("web-capture MCP server running on stdio");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
