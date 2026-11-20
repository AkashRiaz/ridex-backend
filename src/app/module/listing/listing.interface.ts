import { ListingCondition } from "../../../generated/prisma/enums";

export interface ICreateListingDraftPayload {
  vehicleTypeId: string;
  brandId: string;
  vehicleModelId?: string;
  year: number;
}

export interface IUpdateListingPayload {
  vehicleTypeId?: string;
  brandId?: string;
  vehicleModelId?: string | null;
  year?: number;
  title?: string;
  description?: string;
  price?: number;
  isNegotiable?: boolean;
  condition?: ListingCondition;
  mileage?: number;
  color?: string | null;
  specs?: Record<string, unknown>;
  videoUrl?: string | null;
  division?: string;
  district?: string;
  area?: string | null;
  latitude?: number | null;
  longitude?: number | null;
}

export interface IReorderListingImagesPayload {
  order: string[];
  coverImageId?: string;
}

export interface IUpdateListingStatusPayload {
  status: "APPROVED" | "REJECTED";
  reason?: string;
}
