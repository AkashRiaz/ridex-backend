export const ATTRIBUTE_TYPES = [
  "TEXT",
  "NUMBER",
  "SELECT",
  "MULTI_SELECT",
  "BOOLEAN",
] as const;

export type TAttributeType = (typeof ATTRIBUTE_TYPES)[number];

export interface IAttributeOption {
  value: string;
  label: string;
}

/*
 * One dynamic spec field of a vehicle type.
 * `key` is the property name inside VehicleModel.defaultSpecs / Listing.specs.
 */
export interface IVehicleAttribute {
  key: string;
  label: string;
  type: TAttributeType;
  unit?: string;
  options?: IAttributeOption[];
  min?: number;
  max?: number;
  step?: number;
  required: boolean;
  filterable: boolean;
  showInCard: boolean;
  group: string;
  sortOrder: number;
  placeholder?: string;
  helpText?: string;
}

export type TSpecValue = string | number | boolean | string[];

export type TSpecs = Record<string, TSpecValue>;

export interface ICreateVehicleTypePayload {
  name: string;
  slug?: string;
  description?: string;
  icon?: string;
  sortOrder?: number;
  isActive?: boolean;
  attributes?: IVehicleAttribute[];
}

export interface IUpdateVehicleTypePayload {
  name?: string;
  slug?: string;
  description?: string | null;
  icon?: string | null;
  sortOrder?: number;
  isActive?: boolean;
}

export interface IUpdateVehicleTypeAttributesPayload {
  attributes: IVehicleAttribute[];
}
