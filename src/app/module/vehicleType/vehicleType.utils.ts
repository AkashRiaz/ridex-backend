import { validateSpecs } from "../../helper/buildDynamicSpecSchema";
import { IVehicleAttribute } from "./vehicleType.interface";

/*
 * VehicleType.attributes is stored as JSON; it is always written through
 * VehicleAttributesZodSchema, so reading it back as the typed shape is safe.
 */
export const parseAttributes = (value: unknown): IVehicleAttribute[] =>
  Array.isArray(value) ? (value as IVehicleAttribute[]) : [];

type TSpecHolder = { id: string; name: string; defaultSpecs: unknown };

/*
 * Returns every model whose existing default specs would become invalid
 * under a new attribute schema (removed key, new type, removed option,
 * tighter min/max ...). Empty array = the change is safe.
 */
export const findSpecConflicts = (
  attributes: IVehicleAttribute[],
  holders: TSpecHolder[],
) =>
  holders
    .map((holder) => {
      const result = validateSpecs(attributes, holder.defaultSpecs, {
        partial: true,
      });

      return result.success
        ? null
        : { id: holder.id, name: holder.name, reason: result.message };
    })
    .filter((conflict) => conflict !== null);

export const vehicleTypeSortableFields = [
  "name",
  "sortOrder",
  "createdAt",
  "updatedAt",
];
