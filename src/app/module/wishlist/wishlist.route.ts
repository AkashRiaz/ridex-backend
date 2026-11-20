import { Router } from "express";
import { auth } from "../../middleware/checkAuth";
import { WishlistController } from "./wishlist.controller";

const router = Router();

router.get("/", auth(), WishlistController.getMyWishlist);

router.get("/ids", auth(), WishlistController.getMyWishlistIds);

router.post("/:listingId", auth(), WishlistController.addToWishlist);

router.delete("/:listingId", auth(), WishlistController.removeFromWishlist);

export const WishlistRoutes = router;
