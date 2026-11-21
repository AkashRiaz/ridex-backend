import { z } from "zod";

export const UserBlockParamZodSchema = z.object({
  userId: z.uuid("Invalid user ID"),
});
