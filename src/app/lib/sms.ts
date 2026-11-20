import { config } from "../config";

/*
 * SMS adapter. Every SMS goes through `smsClient.send` so a real
 * gateway (e.g. a local BD provider) can be plugged in without
 * touching any service code.
 */

export interface ISmsAdapter {
  send(to: string, message: string): Promise<void>;
}

const consoleSmsAdapter: ISmsAdapter = {
  send: async (to, message) => {
    console.log(`[SMS:console] to=${to} message="${message}"`);
  },
};

const adapters: Record<string, ISmsAdapter> = {
  console: consoleSmsAdapter,
};

const resolveAdapter = (): ISmsAdapter => {
  const adapter = adapters[config.sms_provider];

  if (!adapter) {
    console.warn(
      `SMS provider "${config.sms_provider}" is not implemented. Falling back to console.`,
    );
    return consoleSmsAdapter;
  }

  return adapter;
};

export const smsClient = resolveAdapter();
