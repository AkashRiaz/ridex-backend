import { z } from "zod";
import { SavedSearchAlertFrequency } from "../../../generated/prisma/enums";
import { SAVED_SEARCH_NAME_MAX } from "./savedSearch.utils";

const name = z
  .string({ message: "Name must be text" })
  .trim()
  .min(1, "Name cannot be empty")
  .max(
    SAVED_SEARCH_NAME_MAX,
    `Name can be at most ${SAVED_SEARCH_NAME_MAX} characters`,
  );

const alertFrequency = z.enum(
  [
    SavedSearchAlertFrequency.INSTANT,
    SavedSearchAlertFrequency.DAILY,
    SavedSearchAlertFrequency.OFF,
  ],
  { message: "Alert frequency must be INSTANT, DAILY or OFF" },
);

const notifyPriceDrops = z.boolean({
  message: "notifyPriceDrops must be true or false",
});

/*
 * `query` = the search page's URL params. They are canonicalised and checked
 * against the search validation (spec.* included) in the service.
 */
export const CreateSavedSearchZodSchema = z.object({
  name: name.optional(),
  query: z
    .record(
      z.string().max(80, "Invalid filter name"),
      z.union([
        z.string().max(500, "A filter value is too long"),
        z.number(),
        z.boolean(),
      ]),
      { message: "query must be an object of search filters" },
    )
    .refine((query) => Object.keys(query).length <= 40, "Too many filters"),
  alertFrequency: alertFrequency.optional(),
  notifyPriceDrops: notifyPriceDrops.optional(),
});

export const UpdateSavedSearchZodSchema = z
  .object({
    name: name.optional(),
    alertFrequency: alertFrequency.optional(),
    notifyPriceDrops: notifyPriceDrops.optional(),
  })
  .refine(
    (payload) =>
      payload.name !== undefined ||
      payload.alertFrequency !== undefined ||
      payload.notifyPriceDrops !== undefined,
    "Nothing to update",
  );
