import { Router } from "express";

const router = Router();

router.get("/config", (_req, res) => {
  const acrcloudEnabled = Boolean(
    process.env.ACRCLOUD_HOST &&
      process.env.ACRCLOUD_ACCESS_KEY &&
      process.env.ACRCLOUD_ACCESS_SECRET,
  );
  const lyricSearchEnabled = Boolean(process.env.GENIUS_ACCESS_TOKEN);
  res.json({ acrcloudEnabled, lyricSearchEnabled });
});

export default router;
