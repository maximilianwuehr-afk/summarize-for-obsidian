# Summarize for Obsidian

Fast URL and note summarization powered by AI. Uses OpenRouter to access 200+ language models with automatic free model fallback.

## Features

### Summarization Commands

- **Summarize URL** - Enter any URL to extract and summarize its content
- **Summarize Selection** - Summarize selected text or a selected URL
- **Summarize Current Note** - Generate a summary of the entire note
- **Right-click Context Menu** - Right-click any link to summarize it directly

### Smart Content Extraction

- Automatic URL shortener resolution (t.co, bit.ly, etc.)
- GitHub blob URLs converted to raw content for direct access
- JavaScript-heavy sites (Twitter/X) handled via Jina Reader
- HTML converted to clean Markdown using Turndown

### Model Management

- **Model Browser** - Search, filter, and sort 200+ OpenRouter models
- **Benchmarks** - View Arena and OpenLLM benchmark scores
- **Value Score** - Compare models by quality-per-dollar
- **Free Model Ranking** - Prioritize free models with drag-and-drop ordering
- **Auto-Free Mode** - Automatically fallback through ranked free models when rate limited

### Customization

- **Summary Length** - Brief (~50 words), Short (~100), Medium (~250), or Long (~500)
- **Output Language** - Auto-detect from source or specify a language
- **Insert Behavior** - Insert below cursor, replace selection, or copy to clipboard
- **Custom Prompts** - Use template placeholders: `{{content}}`, `{{wordCount}}`, `{{language}}`

## Installation

1. Open Obsidian Settings → Community Plugins
2. Search for "Summarize"
3. Install and enable the plugin
4. Add your [OpenRouter API key](https://openrouter.ai/keys) in plugin settings

## Usage

### Commands

Open the command palette (`Ctrl/Cmd + P`) and search for:

| Command | Description |
|---------|-------------|
| `Summarize URL` | Opens a dialog to enter a URL |
| `Summarize selection` | Summarizes selected text or URL |
| `Summarize current note` | Summarizes the entire note |

### Right-Click Menu

Right-click on any markdown link or bare URL in your note to see "Summarize this link" in the context menu.

### Free Model Fallback

To use free models with automatic fallback:

1. Go to Settings → Models tab
2. Filter by "Free only" and select models you want to use
3. Go to Settings → Free Rank tab
4. Arrange models in priority order (drag to reorder)
5. Set your default model to `auto-free` in the General tab

When a model is rate-limited, the plugin automatically tries the next model in your ranking.

## Settings

### General Tab

| Setting | Description |
|---------|-------------|
| OpenRouter API Key | Your API key from openrouter.ai |
| Default Model | Model ID or `auto-free` for automatic fallback |
| Default Summary Length | Brief, Short, Medium, or Long |
| Output Language | Leave empty for auto-detection |
| Insert Behavior | Where to put the summary |
| Custom Prompt | Template with placeholders |

### Models Tab

Browse and manage OpenRouter models:

- **Search** - Filter by name or ID
- **Provider Filter** - Show models from specific providers
- **Free Only** - Show only free models
- **Selected Only** - Show only your selected models
- **Sort** - By name, provider, context, cost, arena score, OpenLLM score, or value
- **Benchmarks** - Fetch Arena and OpenLLM scores for comparison

### Free Rank Tab

Configure the priority order for free model fallback:

- Drag models to reorder priority
- Click "Seed from selected free models" to auto-populate
- Use "Set default to auto-free" to enable automatic fallback

## API for Other Plugins

The Summarize plugin exposes a public API that other plugins can use:

```typescript
// Get the API
const summarizePlugin = this.app.plugins.getPlugin('summarize');
const api = summarizePlugin?.api;

if (api?.isConfigured()) {
  // Summarize text
  const summary = await api.summarize('Your content here', {
    length: 'short',      // 'brief' | 'short' | 'medium' | 'long'
    language: 'en',       // Output language (optional)
    model: 'auto-free',   // Model ID (optional)
  });

  // Summarize a URL
  const urlSummary = await api.summarizeUrl('https://example.com/article', {
    length: 'medium',
    onStream: (chunk) => console.log(chunk), // Streaming callback (optional)
  });
}
```

### API Methods

| Method | Description |
|--------|-------------|
| `summarize(content, options?)` | Summarize text content |
| `summarizeUrl(url, options?)` | Extract and summarize content from a URL |
| `isConfigured()` | Check if the plugin has an API key configured |

### Options

| Option | Type | Description |
|--------|------|-------------|
| `length` | `'brief' \| 'short' \| 'medium' \| 'long'` | Summary length |
| `language` | `string` | Output language (e.g., 'en', 'de') |
| `model` | `string` | Override default model |
| `prompt` | `string` | Custom prompt template |
| `onStream` | `(chunk: string) => void` | Streaming callback |

## Architecture

```
src/
├── main.ts                      # Plugin entry, commands, public API
├── settings.ts                  # Settings UI (General, Models, Free Rank tabs)
├── types.ts                     # Type definitions and defaults
├── actions/
│   └── summarize.ts             # Summarization action handlers
└── services/
    ├── llm-service.ts           # OpenRouter API, model fallback logic
    └── content-extractor.ts     # URL fetching, HTML→Markdown conversion
```

### Key Components

**SummarizePlugin** (`main.ts`)
- Registers commands and context menu
- Initializes services and public API
- Manages settings persistence

**LLMService** (`services/llm-service.ts`)
- OpenRouter API communication
- Streaming and non-streaming completions
- Auto-free model fallback on rate limits
- Model list fetching and normalization

**ContentExtractor** (`services/content-extractor.ts`)
- URL shortener resolution
- GitHub URL conversion
- Jina Reader integration for JS-heavy sites
- HTML parsing with readability heuristics
- Turndown for HTML→Markdown conversion

**SummarizeAction** (`actions/summarize.ts`)
- Command handlers for URL, selection, and note summarization
- URL extraction from text
- Summary formatting and insertion

**SummarizeSettingTab** (`settings.ts`)
- Tabbed settings interface
- Model browser with filtering, sorting, and selection
- Benchmark fetching (Arena, OpenLLM)
- Free model ranking with drag-and-drop

## Requirements

- Obsidian v1.0.0+
- OpenRouter API key (free tier available)

## License

MIT
