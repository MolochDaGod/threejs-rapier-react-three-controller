import { Router, type IRouter } from "express";
import healthRouter from "./health";
import postsRouter from "./posts";
import openaiRouter from "./openai";
import walletRouter from "./wallet";

const router: IRouter = Router();

router.use(healthRouter);
router.use(postsRouter);
router.use(openaiRouter);
router.use(walletRouter);

export default router;
