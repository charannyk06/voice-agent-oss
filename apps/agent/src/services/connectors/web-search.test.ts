import { beforeEach, describe, expect, it, vi } from 'vitest';

const { configMock, fetchMock } = vi.hoisted(() => ({
  configMock: {
    externalSearch: {
      provider: 'searxng',
      apiKey: '',
      model: '',
      baseUrl: 'https://search.example.org',
    },
  },
  fetchMock: vi.fn(),
}));

vi.mock('../../config', () => ({
  config: configMock,
}));

vi.stubGlobal('fetch', fetchMock);

import { searchExternalKnowledge } from './web-search';

describe('searchExternalKnowledge', () => {
  beforeEach(() => {
    fetchMock.mockReset();
  });

  it('uses the SearXNG search API without requiring an API key', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [
          {
            title: 'Example Business support overview',
            url: 'https://example.org/support',
            content: 'Overview of customer support and contact details.',
            engine: 'duckduckgo',
          },
          {
            title: 'Example Business contact page',
            url: 'https://example.org/contact',
            content: 'Main number and location.',
            engine: 'brave',
          },
        ],
      }),
    });

    const result = await searchExternalKnowledge('Example Business customer support');

    expect(fetchMock).toHaveBeenCalledWith(
      'https://search.example.org/search?q=Example+Business+customer+support&format=json',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(result.success).toBe(true);
    expect(result.message).toContain('Example Business support overview');
    expect(result.data).toMatchObject({
      provider: 'searxng',
    });
    expect((result.data as { results: Array<unknown> }).results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: 'Example Business support overview',
          url: 'https://example.org/support',
        }),
      ]),
    );
  });
});
