# Coding Yuan Asset Slot

This folder holds the Coding猿 visual identity assets.

- `concept.png`: original generated concept image, kept as the high-resolution source.
- `concept-display.jpg`: optimized UI display version.
- `concept-display.png`: resized lossless derivative, kept for future image processing.
- `model-manifest.json`: GLB loading switch. Keep `model` as `null` until a real model is available.
- `coding-yuan.glb`: optional future 3D character model slot.

When adding `coding-yuan.glb`, keep it original or properly licensed. Recommended animation clips:

- `idle`
- `typing`
- `scan`
- `selected`

Runtime behavior:

- If `model-manifest.json` points to a GLB path, the Three.js scene loads it with `GLTFLoader`.
- If `model` is `null`, missing, or fails to load, the scene uses the procedural Coding猿 operator.
- The model is normalized to fit inside each project node, so keep the source model centered and facing forward.
- Prefer a humanoid rig. Skinned meshes are cloned with `SkeletonUtils`.

Model target:

- Format: binary glTF (`.glb`)
- Suggested size: under 3 MB before texture compression, under 1.5 MB if possible
- Orientation: face toward negative Z in Blender/Three.js convention, or test and rotate if needed
- Texture style: dark tactical suit, teal visor, restrained gold/cyan accents

After adding the model, update `model-manifest.json`:

```json
{
  "model": "/assets/coding-yuan/coding-yuan.glb",
  "clips": {
    "idle": "idle",
    "typing": "typing",
    "scan": "scan",
    "selected": "selected"
  }
}
```
