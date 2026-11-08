/** Minimal structured logger. Azure Functions forwards console output to Application Insights. */
export interface Logger {
  info(message: string, data?: unknown): void;
  warn(message: string, data?: unknown): void;
  error(message: string, data?: unknown): void;
}

export function consoleLogger(): Logger {
  const line = (level: string, message: string, data?: unknown) =>
    data === undefined ? `[${level}] ${message}` : `[${level}] ${message} ${safeJson(data)}`;
  return {
    info: (m, d) => console.info(line('info', m, d)),
    warn: (m, d) => console.warn(line('warn', m, d)),
    error: (m, d) => console.error(line('error', m, d)),
  };
}

export const silentLogger: Logger = { info: () => {}, warn: () => {}, error: () => {} };

function safeJson(data: unknown): string {
  try {
    return JSON.stringify(data);
  } catch {
    return String(data);
  }
}
