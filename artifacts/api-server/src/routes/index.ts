import { Router, type IRouter } from "express";
import healthRouter from "./health";
import identifyRouter from "./identify";
import lyricSearchRouter from "./lyric-search";
import configRouter from "./config";
import userDataRouter from "./user-data";

const router: IRouter = Router();

router.use(healthRouter);
router.use(configRouter);
router.use(identifyRouter);
router.use(lyricSearchRouter);
router.use(userDataRouter);

export default router;
