import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.HERMES_LLM_API_KEY;
  delete process.env.HERMES_LLM_BASE_URL;
  delete process.env.HERMES_LLM_MODEL;
});

describe('Hermes model routing', () => {
  it('uses the configured Hy4 OpenAI-compatible endpoint first', async () => {
    process.env.HERMES_LLM_API_KEY = 'test-key';
    process.env.HERMES_LLM_BASE_URL = 'https://hy4.example/v1';
    process.env.HERMES_LLM_MODEL = 'hy4-preview';
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: '{"summary":"ok"}' } }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    vi.resetModules();

    const { askLLMWithFallback } = await import('../services/_shared/llm-router.js');
    const result = await askLLMWithFallback('hermes', 'inspect factory', { tier: 'hermes' });

    expect(result).toMatchObject({ model: 'hy4-preview', taskUsed: 'hermes' });
    expect(fetchMock).toHaveBeenCalledWith('https://hy4.example/v1/chat/completions', expect.objectContaining({ method: 'POST' }));
  });

  it('falls back to local Ollama when no hosted Hy4 key is configured', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ response: 'local result' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);
    vi.resetModules();

    const { askLLMWithFallback } = await import('../services/_shared/llm-router.js');
    const result = await askLLMWithFallback('hermes', 'inspect factory', { tier: 'hermes' });

    expect(result).toMatchObject({ taskUsed: 'hermes_local', model: 'qwen3.8:latest' });
    expect(fetchMock).toHaveBeenCalledWith('http://localhost:11434/api/generate', expect.any(Object));
  });
});
