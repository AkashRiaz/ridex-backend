export interface ICreateBrandPayload {
  name: string;
  slug?: string;
  country?: string;
  description?: string;
  vehicleTypeIds: string[];
  isPopular?: boolean;
  isActive?: boolean;
}

export interface IUpdateBrandPayload {
  name?: string;
  slug?: string;
  country?: string | null;
  description?: string | null;
  vehicleTypeIds?: string[];
  isPopular?: boolean;
  isActive?: boolean;
}
