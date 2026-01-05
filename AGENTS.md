# AGENTS.md

This file provides guidance to AI coding assistants when working with this repository.

## Overview

**Summarize** is an Obsidian plugin for fast URL and note summarization powered by OpenRouter AI. It provides commands for summarizing URLs, text selections, and notes, plus a public API for other plugins to use.

## Build Commands

```bash
# Install dependencies
npm install

# Development build (watch mode)
npm run dev

# Production build
npm run build

# Test content extraction
npm run test:extract

# Test summarization
npm run test:summarize
```

## Architecture

```
src/
├── main.ts              # Plugin entry point, commands, public API
├── types.ts             # TypeScript interfaces, DEFAULT_SETTINGS
├── settings.ts          # Settings tab UI (General, Models, Free Rank tabs)
├── services/
│   ├── llm-service.ts       # OpenRouter API client (streaming, auto-free fallback)
│   └── content-extractor.ts # URL content extraction (Turndown, Jina Reader)
└── actions/
    └── summarize.ts         # Summarization actions and modals
```

### Key Components

**main.ts** - Plugin entry point
- Registers commands: `summarize-url`, `summarize-selection`, `summarize-note`
- Registers right-click context menu for links
- Exposes `this.api` for other plugins (SummarizeAPI interface)

**types.ts** - Type definitions
- `SummarizeSettings` - Plugin settings interface
- `SummarizeAPI` - Public API interface for other plugins
- `OpenRouterModel`, `OpenRouterCache` - Model caching types
- `DEFAULT_SETTINGS` - Default configuration
- `DEFAULT_PROMPT` - Default summarization prompt template

**settings.ts** - Settings UI
- Three tabs: General, Models, Free Rank
- Model browser with filtering, sorting, and benchmark display
- Free model fallback ranking with drag-and-drop
- Benchmark fetching from Chatbot Arena and Open LLM Leaderboard

**llm-service.ts** - OpenRouter integration
- `summarize()` - Generate summaries with streaming support and AbortController
- `completionWithAutoFree()` - Automatic fallback on rate limits
- `fetchModels()` - Fetch available models from OpenRouter
- Prompt template system with `{{content}}`, `{{wordCount}}`, `{{language}}` placeholders
- Supports `abortSignal` for cancellation

**content-extractor.ts** - Content extraction
- `extractFromUrl()` - Extract and convert webpage content to markdown
- Uses Turndown for HTML-to-markdown conversion
- Supports URL shorteners (t.co, bit.ly, etc.)
- Converts GitHub blob URLs to raw URLs
- Uses Jina Reader (`r.jina.ai`) for JS-heavy sites (Twitter/X)

**summarize.ts** - User actions
- `summarizeUrlCommand()` - Prompt for URL and summarize
- `summarizeSelectionCommand()` - Summarize selected text
- `summarizeNoteCommand()` - Summarize current note
- Smart URL detection in selections
- Insert behavior: below cursor, replace selection, or clipboard
- **Streaming insertion**: Summary streams word-by-word directly into document
  - Press Escape to cancel mid-stream
  - `stream` parameter (default: true) to toggle streaming
  - Proper indentation relative to parent line

## Public API

Other plugins can access the Summarize API:

```typescript
// Get the plugin instance
const summarize = app.plugins.plugins["summarize"];

// Check if configured
if (summarize?.api?.isConfigured()) {
  // Summarize text
  const summary = await summarize.api.summarize(content, {
    length: "medium",     // brief, short, medium, long
    language: "en",       // output language
    model: "auto-free",   // specific model or auto-free
    onStream: (chunk) => console.log(chunk), // streaming callback
  });

  // Summarize URL
  const urlSummary = await summarize.api.summarizeUrl("https://example.com");
}
```

## Development Patterns

- Services update via `updateSettings()` method when settings change
- Actions receive services via constructor injection
- Use `registerEvent()` for Obsidian event handlers (proper cleanup)
- OpenRouter API requires `HTTP-Referer` and `X-Title` headers

## Configuration

- **API Key**: OpenRouter API key from openrouter.ai
- **Default Model**: Model ID or "auto-free" for automatic fallback
- **Free Model Rank**: Priority order for free model fallback on rate limits
- **Custom Prompt**: Template with `{{content}}`, `{{wordCount}}`, `{{language}}`

## Testing in Obsidian

After building, copy the plugin to the wuehr vault:

```bash
cp main.js manifest.json ~/Workspace/wuehr/.obsidian/plugins/summarize/
```

Then reload Obsidian or use the "Reload app without saving" command.

## External Services

- **OpenRouter** (openrouter.ai) - LLM API gateway
- **Jina Reader** (r.jina.ai) - JS-rendered page extraction for Twitter/X
- **Hugging Face Datasets API** - Benchmark data (Arena, Open LLM Leaderboard)
