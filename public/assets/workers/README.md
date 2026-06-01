# CodingYuan Worker Assets

This directory holds Stage-7 worker room assets.

Current beta behavior:

- `manifest.json` is the source of worker metadata.
- If `coding-ape.glb` is present, the runtime tries it first for CodingYuan.
- If no `.glb` is available, Office uses the bundled procedural worker rig.
- If WebGL is unavailable, Office renders the HTML fallback room and keeps all controls usable.

Required animation names for future `.glb` files:

- `idle`
- `assigned`
- `working`
- `running_command`
- `reviewing`
- `waiting_approval`
- `blocked`
- `completed`
- `reporting`

Keep individual worker models under 8 MB for the first external beta.
