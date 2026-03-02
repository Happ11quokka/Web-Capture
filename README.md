# Web Capture MCP Server

A general-purpose [MCP (Model Context Protocol)](https://modelcontextprotocol.io) server that screenshots and extracts text from any website — including dynamic JS-rendered SPAs. Built with [Playwright](https://playwright.dev) and the [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk).

## Tools

| Tool | Description |
|------|-------------|
| `web_screenshot` | Full-page screenshot + structured text extraction. Returns base64 image + JSON metadata. |
| `web_extract` | Text-only extraction (no screenshot). Faster when you only need content. |
| `web_pdf` | Save a page as PDF. |

### `web_screenshot`

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `url` | string | (required) | URL to capture |
| `viewport_width` | number | `1280` | Viewport width in px |
| `viewport_height` | number | `720` | Viewport height in px |
| `device` | string | — | Device preset: `iphone-14`, `iphone-15`, `ipad`, `pixel-7` |
| `full_page` | boolean | `true` | Capture full scrollable page |
| `wait_for` | number | `3000` | Extra ms to wait after load (for JS rendering) |
| `selector` | string | — | CSS selector to screenshot instead of full page |
| `javascript` | string | — | JS to run before capture (e.g. dismiss cookie banners) |

**Returns:** screenshot image (base64 PNG) + JSON with title, description, headings, links, visible text, and file path.

### `web_extract`

Same parameters as `web_screenshot` except no `full_page` or `selector`. Returns JSON only, no image.

### `web_pdf`

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `url` | string | (required) | URL to save |
| `viewport_width` | number | `1280` | Viewport width |
| `viewport_height` | number | `720` | Viewport height |
| `format` | string | `A4` | Page format: `A4`, `Letter`, `Legal`, `Tabloid`, `A3` |
| `wait_for` | number | `3000` | Extra ms to wait |
| `javascript` | string | — | JS to run before PDF generation |

**Returns:** file path of the saved PDF.

## Setup

### 1. Clone and install

```bash
git clone https://github.com/Happ11quokka/Web-Capture.git ~/.claude/tools/web-capture
cd ~/.claude/tools/web-capture
npm install
npx playwright install chromium
```

### 2. Build

```bash
npm run build
```

### 3. Register with Claude Code

```bash
claude mcp add -s user web-capture -- node ~/.claude/tools/web-capture/dist/index.js
```

This registers the server globally (user scope) so it's available in every project.

### 4. Verify

Restart Claude Code, then run `/mcp` to confirm `web_screenshot`, `web_extract`, and `web_pdf` tools are available.

## Usage Examples

Once registered, ask Claude:

- "Screenshot https://example.com"
- "Screenshot https://example.com on iphone-14"
- "Extract text from https://news.ycombinator.com"
- "Save https://example.com as PDF"
- "Screenshot https://example.com but first dismiss the cookie banner with `document.querySelector('.cookie-banner')?.remove()`"

## How It Works

- **Playwright** launches a headless Chromium instance on first tool call and reuses it
- Pages are loaded with `waitUntil: "networkidle"` + a configurable extra wait for client-side rendering
- Content extraction runs a browser-side script that pulls `document.title`, meta tags, `<h1>`-`<h3>` headings, `<a>` links, and `document.body.innerText`
- Screenshots are saved to `/tmp/web-capture/` at full resolution; if the base64 exceeds ~800KB (MCP's practical limit), a downscaled version is sent to Claude while the full-size file remains on disk
- Device presets use Playwright's built-in device registry for accurate viewport + user agent emulation

## Tech Stack

- **TypeScript** + **Node.js** (ES2022)
- **@modelcontextprotocol/sdk** — MCP server framework (stdio transport)
- **Playwright** — browser automation
- **Zod** — input schema validation
