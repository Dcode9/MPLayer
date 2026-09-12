# Phase 7 status

The phase7-upload.js file was temporarily broken by incomplete pushes.

**To restore on any machine / CI:**

```bash
bash scripts/restore-phase7.sh
# or:
git show 1fc37a64a976a7faab324e3328f6ff9bcf92c0a6:scripts/phase7-upload.js > scripts/phase7-upload.js
```

Then re-apply the near-black left-title / right-album thumbnail patch (palette + SVG layout only).
