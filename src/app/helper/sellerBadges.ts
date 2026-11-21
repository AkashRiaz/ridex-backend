import { Prisma } from "../../generated/prisma/client";

/*
 * Public seller summary used by listing cards, listing detail and seller profiles.
 * Never includes email or phone.
 */
export const sellerSummarySelect = {
  id: true,
  name: true,
  imageUrl: true,
  role: true,
  phoneVerified: true,
  idVerifiedAt: true,
  dealerVerifiedAt: true,
  ratingAverage: true,
  ratingCount: true,
} satisfies Prisma.UserSelect;

type TSellerSummaryRow = Prisma.UserGetPayload<{
  select: typeof sellerSummarySelect;
}>;

export const toSellerBadges = (user: {
  phoneVerified: boolean;
  idVerifiedAt: Date | null;
  dealerVerifiedAt: Date | null;
}) => ({
  phoneVerified: user.phoneVerified,
  idVerified: Boolean(user.idVerifiedAt),
  dealerVerified: Boolean(user.dealerVerifiedAt),
});

export const toSellerSummary = (user: TSellerSummaryRow) => ({
  id: user.id,
  name: user.name,
  imageUrl: user.imageUrl,
  role: user.role,
  ratingAverage: Math.round(user.ratingAverage * 10) / 10,
  ratingCount: user.ratingCount,
  badges: toSellerBadges(user),
});
