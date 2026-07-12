import { Router, type IRouter } from "express";
import { requireAuth } from "../../middlewares/requireAuth";
import conversationsRouter from "./conversations";
import chatRouter from "./chat";
import imageRouter from "./image";

const router: IRouter = Router();

// Conversations are private per user — every assistant endpoint requires a
// valid session, and each handler additionally scopes its queries by owner.
router.use("/openai", requireAuth);
router.use(conversationsRouter);
router.use(chatRouter);
router.use(imageRouter);

export default router;
