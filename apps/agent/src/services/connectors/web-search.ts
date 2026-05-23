import { config } from '../../config';
import type { ToolResult } from '../../types';

type GenericChatCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
};

type SearxngResponse = {
  results?: Array<{
    title?: string;
    url?: string;
    content?: string;
    engine?: string;
  }>;
};

function buildSearxngSummary(results: NonNullable<SearxngResponse['results']>): string {
  return results
    .slice(0, 3)
    .map((result, index) => {
      const title = result.title?.trim() || `Result ${index + 1}`;
      const snippet = result.content?.trim() || 'No summary available';
      return `${index + 1}. ${title}: ${snippet}`;
    })
    .join(' ');
}

async function runSearxngSearch(query: string): Promise<ToolResult> {
  if (!config.externalSearch.baseUrl) {
    return {
      success: false,
      message: 'External search is not configured',
    };
  }

  try {
    const url = new URL('/search', `${config.externalSearch.baseUrl}/`);
    url.searchParams.set('q', query);
    url.searchParams.set('format', 'json');

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      return {
        success: false,
        message: `External search failed: ${errorText || response.statusText}`,
      };
    }

    const data = (await response.json()) as SearxngResponse;
    const results = (data.results || []).filter((result) => result.title || result.content || result.url);
    if (results.length === 0) {
      return {
        success: false,
        message: 'External search returned no answer',
      };
    }

    return {
      success: true,
      message: buildSearxngSummary(results),
      data: {
        provider: 'searxng',
        query,
        results: results.slice(0, 5).map((result) => ({
          title: result.title || '',
          url: result.url || '',
          snippet: result.content || '',
          engine: result.engine || '',
        })),
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown external search error';
    return {
      success: false,
      message: `External search failed: ${message}`,
    };
  }
}

async function runChatCompletionsSearch(query: string): Promise<ToolResult> {
  if (!config.externalSearch.apiKey || !config.externalSearch.baseUrl || !config.externalSearch.model) {
    return {
      success: false,
      message: 'External search is not configured',
    };
  }

  try {
    const response = await fetch(`${config.externalSearch.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.externalSearch.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: config.externalSearch.model,
        temperature: 0.1,
        messages: [
          {
            role: 'system',
            content:
              'You are a concise search backend for a business voice assistant. Return short factual summaries for public, non-professional questions only.',
          },
          {
            role: 'user',
            content: query,
          },
        ],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return {
        success: false,
        message: `External search failed: ${errorText || response.statusText}`,
      };
    }

    const data = (await response.json()) as GenericChatCompletionResponse;
    const summary = data.choices?.[0]?.message?.content?.trim();
    if (!summary) {
      return {
        success: false,
        message: 'External search returned no answer',
      };
    }

    return {
      success: true,
      message: summary,
      data: {
        provider: config.externalSearch.provider || 'custom',
        query,
        summary,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown external search error';
    return {
      success: false,
      message: `External search failed: ${message}`,
    };
  }
}

export async function searchExternalKnowledge(query: string): Promise<ToolResult> {
  const trimmedQuery = query.trim();
  if (!trimmedQuery) {
    return {
      success: false,
      message: 'A search query is required',
    };
  }

  if (config.externalSearch.provider === 'searxng') {
    return runSearxngSearch(trimmedQuery);
  }

  return runChatCompletionsSearch(trimmedQuery);
}
