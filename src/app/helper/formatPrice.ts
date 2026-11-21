import { config } from "../config";

// "BDT 1,25,000" — plain text for notification bodies and emails
export const formatPrice = (value: number | string) =>
  `${config.currency} ${Number(value).toLocaleString(config.currency_locale, { maximumFractionDigits: 0 })}`;
