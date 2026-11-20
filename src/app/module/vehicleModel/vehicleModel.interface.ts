export interface ICreateVehicleModelPayload {
  brandId: string;
  vehicleTypeId: string;
  name: string;
  slug?: string;
  yearFrom?: number;
  yearTo?: number;
  defaultSpecs?: Record<string, unknown>;
  isActive?: boolean;
}

export interface IUpdateVehicleModelPayload {
  brandId?: string;
  vehicleTypeId?: string;
  name?: string;
  slug?: string;
  yearFrom?: number | null;
  yearTo?: number | null;
  defaultSpecs?: Record<string, unknown>;
  isActive?: boolean;
}
