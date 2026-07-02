import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('configService', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
    process.env.BOT_DB_PATH = ':memory:';
  });

  afterEach(async () => {
    const configService = await import('./configService');
    configService.resetDbForTests();
    process.env = { ...originalEnv };
  });

  it('round-trips config values through set/get', async () => {
    const configService = await import('./configService');
    expect(configService.getConfigValue('rag_api_key')).toBeUndefined();

    configService.setConfigValue('rag_api_key', 'secret-key');
    expect(configService.getConfigValue('rag_api_key')).toBe('secret-key');

    configService.setConfigValue('rag_api_key', 'updated-key');
    expect(configService.getConfigValue('rag_api_key')).toBe('updated-key');
  });

  it('isConfigured() is false when nothing is set', async () => {
    const configService = await import('./configService');
    expect(configService.isConfigured()).toBe(false);
  });

  it('isConfigured() is false when only one of the two required keys is set', async () => {
    const configService = await import('./configService');
    configService.setConfigValue('rag_api_key', 'secret-key');
    expect(configService.isConfigured()).toBe(false);

    configService.resetDbForTests();
    vi.resetModules();
    const configService2 = await import('./configService');
    configService2.setConfigValue('allowed_channel_id', '12345');
    expect(configService2.isConfigured()).toBe(false);
  });

  it('isConfigured() is true when both required keys are set', async () => {
    const configService = await import('./configService');
    configService.setConfigValue('rag_api_key', 'secret-key');
    configService.setConfigValue('allowed_channel_id', '12345');
    expect(configService.isConfigured()).toBe(true);
  });

  it('validateEnv() exits with code 1 and logs when a required var is missing', async () => {
    delete process.env.DISCORD_TOKEN;
    process.env.DISCORD_CLIENT_ID = 'client-id';
    process.env.DISCORD_GUILD_ID = 'guild-id';
    process.env.RAG_API_URL = 'http://localhost:8000';

    const configService = await import('./configService');
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    configService.validateEnv();

    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0][0]).toContain('DISCORD_TOKEN');
    expect(exitSpy).toHaveBeenCalledWith(1);

    exitSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('validateEnv() does not exit when all required vars are present', async () => {
    process.env.DISCORD_TOKEN = 'token';
    process.env.DISCORD_CLIENT_ID = 'client-id';
    process.env.DISCORD_GUILD_ID = 'guild-id';
    process.env.RAG_API_URL = 'http://localhost:8000';

    const configService = await import('./configService');
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    configService.validateEnv();

    expect(errorSpy).not.toHaveBeenCalled();
    expect(exitSpy).not.toHaveBeenCalled();

    exitSpy.mockRestore();
    errorSpy.mockRestore();
  });
});
