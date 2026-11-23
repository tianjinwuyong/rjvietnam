# Virtual-factory avatar model credits

## Bundled models

All three bundled GLBs are **derivatives of one CC0 rigged human** and are stored locally at
`apps/web/public/virtual-factory/models/`. No CDN, runtime download, or external API is involved.

| File | Source asset | Author / creator | Exact license | Permitted redistribution |
| --- | --- | --- | --- | --- |
| `worker-slate.glb` | [`avatars/mpfb.glb`](https://github.com/met4citizen/TalkingHead/blob/main/avatars/mpfb.glb) in `met4citizen/TalkingHead` | met4citizen (TalkingHead demo avatar), assembled from MakeHuman / [MPFB2](https://github.com/makehumancommunity/mpfb2) CC0 base mesh, rig, weights, system skin, eyes, eyebrows, eyelashes, teeth, tongue, `ponytail01` hair, `female_casualsuit01` outfit, plus CC0 "Faceunits 01" / "Visemes 02" packs | **CC0 1.0 Universal** (explicitly stated in the TalkingHead README asset-license section: "Example avatar `mpfb.glb` ... is licensed under CC0") | Yes — CC0 permits copying, modification and redistribution, including commercial use, with no attribution requirement (credit appreciated). Our derivatives are CC0 as well. |
| `worker-teal.glb` | same CC0 `mpfb.glb`; clothing/hair tint + baseline expression morphs changed | same as above (derivative modifications by this project) | **CC0 1.0 Universal** | Yes, same as above. |
| `worker-amber.glb` | same CC0 `mpfb.glb`; clothing/hair tint + baseline expression morphs changed | same as above (derivative modifications by this project) | **CC0 1.0 Universal** | Yes, same as above. |

Primary license evidence: `README.md` of `met4citizen/TalkingHead`, section "Licenses, attributions and
notes related to the `index.html` web app assets", plus the repository's MPFB build notes
(`blender/MPFB/MPFB.md`) documenting that the avatar is generated from MakeHuman/MPFB CC0 assets.
CC0 1.0 deed: <https://creativecommons.org/public-domain/cc0/>.

### What was changed to make the derivatives

- Texture maps downsampled (diffuse/normal 1024px JPEG; alpha eyes/hair 768px PNG).
- All **66** ARKit/viseme morph-target deltas on the body mesh preserved as core glTF **sparse accessors**; unused buffer views from non-face meshes removed.
- Size: **35.1 MB source → 6.05 MB per variant** (3 files, 18.15 MB total).
- Three deterministic variants differ only in **clothing and hair tint** plus a small baseline
  facial-morph pose. Skin material/texture is unchanged in every variant.
- The source GLB asset and the build provenance are retained under `.qwen/tmp/vf-assets/` and the
  scratch build script is `.qwen/tmp/vf-build-assets.mjs` (both untracked, not part of the app).

### Capabilities and honest limitations

- Rig: 67-joint Mixamo-compatible humanoid skeleton; `SkeletonUtils.clone` gives every employee
  independent bones while geometry/materials/textures stay shared.
- Face: 66 morph targets — ARKit face units (`browInnerUp`, `eyeBlinkLeft`, `mouthFrownRight`, …)
  and Oculus visemes (`viseme_aa`, `viseme_FF`, `viseme_O`, …). Blink, focus, concern,
  acknowledgment and viseme lip-sync all drive these real morphs.
- **No embedded animation clips** in the CC0 source. Idle / walk / work / greet clips are generated
  procedurally at runtime from the rig (`avatarAssets.ts:createHumanClips`); each avatar gets its own
  `AnimationMixer` and actions. They are simple bone rotations, not authored mocap.
- **No audible speech.** Lip-sync is deterministic viseme animation derived from the localized
  bubble text (live data deltas or the selection greeting). No Web Speech API audio is used, so
  there are no speech-boundary events to sync against.
- All bundled variants share one realistic female base mesh. They are visually distinguished by
  clothing/hair colour, ID badge colour, supervisor hard hats and a subtle baseline expression —
  not by different face geometry. This is a documented limitation of the available verified CC0
  full-body human with face morphs.

## Bundled office prop models — Poly Haven, CC0 1.0

Four office props are bundled under `apps/web/public/virtual-factory/props/<asset-id>/` and
are loaded at runtime by `floor/Workstations.tsx` through `floor/propAssets.tsx`: the desk,
a drawer cabinet, a shelf and a clamp-on desk lamp. **Three of the four are drawn** — desk,
cabinet and lamp. `Shelf_01` ships and is measured but is deliberately not placed: at its
0.6 scale it stands 1.25 m tall, i.e. above the 0.735 m desk line the floor is held to
(`MAX_FLOOR_BOX_TOP` in `floor/Zones.tsx`), and it stood between the camera and the worker.
Poly Haven publishes model assets as a
`.gltf` + a `.bin` + jpg textures rather than one `.glb`, so each folder holds exactly that
set. Every file was downloaded from the `1k` gltf thread of
`https://api.polyhaven.com/files/<asset-id>` and its **md5 verified against the API
manifest before it was written to disk** (the verification is in the download step itself —
a mismatch aborts that asset, and the workstation then keeps its procedural fallback).

**Total shipped: 6,231,391 bytes (5.94 MiB, 20 files).** No CDN, no runtime download and no
external API call: the app reads only these local paths, exactly like the avatar GLBs above.

| File | Source URL | Author / creator | Exact license | Modifications | Attribution |
| --- | --- | --- | --- | --- | --- |
| `props/metal_office_desk/` (`metal_office_desk.gltf` + `.bin` + 3 jpg) | <https://polyhaven.com/a/metal_office_desk> | Ulan Cabanilla ("All"), Poly Haven ("Metal Office Desk", Furniture/Tables/Desks, published 2026-03-20) | **CC0 1.0 Universal** | none to the files. At load the 9 primitives are baked into asset space and merged into one geometry (1 material); scaled and turned 180° as a scene-graph transform so the work surface lands on the workstation contract | none required; credited here |
| `props/drawer_cabinet/` (`drawer_cabinet.gltf` + `.bin` + 3 jpg) | <https://polyhaven.com/a/drawer_cabinet> | Ulan Cabanilla ("All"), Poly Haven ("Drawer Cabinet", Furniture/Storage Furniture/Drawers & Dressers, published 2020-08-27) | **CC0 1.0 Universal** | none to the files. 5 primitives merged into one geometry; uniform 0.3508 scale, turned 180° so the drawer fronts face the worker | none required; credited here |
| `props/Shelf_01/` (`Shelf_01.gltf` + `.bin` + 3 jpg) | <https://polyhaven.com/a/Shelf_01> | Gabriel Radić ("All"), Poly Haven ("Shelf 01", Furniture/Storage Furniture/Shelving & Bookcases, published 2020-03-30) | **CC0 1.0 Universal** | none to the files. Single primitive; uniform 0.6 scale (1.25 m tall), turned 90° so its width runs along z. **Not drawn**: 1.25 m is above the desk height line and it occluded the camera | none required; credited here |
| `props/desk_lamp_arm_01/` (`desk_lamp_arm_01.gltf` + `.bin` + 3 jpg) | <https://polyhaven.com/a/desk_lamp_arm_01> | Kuutti Siitonen ("Modeling & texturing"), Yann Kervran ("Rigging"), Poly Haven ("Desk Lamp Arm 01", Lighting/Floor & Desk/Desk Lamps, published 2022-08-31) | **CC0 1.0 Universal** | none to the files. Two primitives merged per material (body + light head — the gltf already carries `emissiveFactor` for the head, so no material override was needed); uniform 0.55 scale, clamped to the back edge of the work surface | none required; credited here |

Licence evidence, checked 2026-11-23:

- <https://polyhaven.com/license> — Poly Haven publishes its assets under **CC0 1.0 Universal**,
  the public-domain dedication: "no attribution required", copying, modification, redistribution
  and commercial use all permitted. Deed: <https://creativecommons.org/public-domain/cc0/>.
- Each row above names the asset page that states the same licence for that file, and the exact
  `files/<id>` manifest the bytes came from.
- Author names, display names, categories and publish dates come from Poly Haven's own asset
  data (`https://api.polyhaven.com/assets`), fetched today — they are courtesy, not a licence
  requirement, because CC0 asks for none.

### Downloaded files (md5 verified against the `files/<id>` manifest)

| Path (under `apps/web/public/virtual-factory/props/`) | Bytes | md5 |
| --- | --- | --- |
| `metal_office_desk/metal_office_desk.gltf` | 13,510 | `723956efef6da35ad41494efa5c3b820` |
| `metal_office_desk/metal_office_desk.bin` | 229,700 | `96f258b9a64d36ca011f44de23da7c65` |
| `metal_office_desk/textures/metal_office_desk_diff_1k.jpg` | 470,831 | `6a27263c95811fa902ddea6476d610e9` |
| `metal_office_desk/textures/metal_office_desk_nor_gl_1k.jpg` | 170,875 | `bcf6793df61d9b5f097f2b9518866c45` |
| `metal_office_desk/textures/metal_office_desk_arm_1k.jpg` | 721,614 | `fb76b1e17f07592608d3f144fce4bfce` |
| `drawer_cabinet/drawer_cabinet.gltf` | 8,031 | `4ee75e02d0a2c383c61950c614d78cf8` |
| `drawer_cabinet/drawer_cabinet.bin` | 798,852 | `1f0d93118e12628d0b79c7dd8d11b80e` |
| `drawer_cabinet/textures/drawer_cabinet_diff_1k.jpg` | 150,011 | `bb0311ae77d1779bc5b37396a029f6f3` |
| `drawer_cabinet/textures/drawer_cabinet_nor_gl_1k.jpg` | 61,593 | `151891cdd9db147046f951525f849f7f` |
| `drawer_cabinet/textures/drawer_cabinet_arm_1k.jpg` | 124,942 | `ce7a177bd99d4aa87a95f84dab5eb7a6` |
| `Shelf_01/Shelf_01.gltf` | 2,617 | `9e852782eeae96108206c888d2b68df1` |
| `Shelf_01/Shelf_01.bin` | 12,676 | `bf2ff8bef60025c079565fd1926b8476` |
| `Shelf_01/textures/Shelf_01_diff_1k.jpg` | 153,220 | `965ce260ce114308026fe98260cd482a` |
| `Shelf_01/textures/Shelf_01_nor_gl_1k.jpg` | 231,393 | `3ccf77ba277b06f29e3e68233a83bae7` |
| `Shelf_01/textures/Shelf_01_arm_1k.jpg` | 205,542 | `b0044e2cc568cd2a7f906ca56f473542` |
| `desk_lamp_arm_01/desk_lamp_arm_01.gltf` | 4,453 | `29b204485d30e66ee3f183ef45bf4bb3` |
| `desk_lamp_arm_01/desk_lamp_arm_01.bin` | 736,804 | `29ffa5bb6bee35b066e46073124fee1a` |
| `desk_lamp_arm_01/textures/desk_lamp_arm_01_diff_1k.jpg` | 702,522 | `a5c1bf5465da39ca6ca9039dd4e3fd66` |
| `desk_lamp_arm_01/textures/desk_lamp_arm_01_nor_gl_1k.jpg` | 651,826 | `5aabbfe920ea6726d5299be7d6224551` |
| `desk_lamp_arm_01/textures/desk_lamp_arm_01_arm_1k.jpg` | 780,379 | `0b887af80f561216baa3da94d001d51a` |

`.gltf` buffers and images are referenced by relative URI, so the `.bin` and the `textures/`
folder must stay beside each `.gltf`; the loader resolves them under
`/virtual-factory/props/<asset-id>/`. Every URI referenced by a `.gltf` was confirmed present
on disk (no missing-file warnings from the manifest check).

Re-deriving the set (scratch tooling, not part of the app): `.qwen/tmp/vf-props-fetch.mjs`
downloads the `1k` gltf threads, verifies each md5 against the API manifest and writes
`.qwen/tmp/vf-props-manifest.json`; `.qwen/tmp/vf-props-measure.mjs` prints the per-primitive
bounds that `floor/propLayout.ts` quotes; `.qwen/tmp/vf-props-verify.mjs` re-fits those bounds
with three.js's own matrix composition and asserts the contract lines above.

### How the props are placed

`floor/propLayout.ts` holds each asset's bounds **as measured off its own gltf accessors**
(POSITION min/max transformed by the node matrices — not eyeballed, not read off a preview)
and fits those bounds onto the workstation geometry contract the avatar lane is tuned to:
the desk's work surface comes out at y = 0.735 spanning z = 0.27…0.89 centred on x = 0, the
side props stay inside that band so they never block the seat approach (`z < 0.2`) or reach
the aisle, and the lamp clamps onto the back edge. Free-standing storage is only drawn where
the row's actual pitch leaves room for it (`hasSidePropRoom`), so overflow rings and the
1.5 m IT row keep just desk + chair + monitor.

### What is still procedural, and why

Poly Haven publishes **no** ergonomic office chair, **no** monitor, **no** keyboard and **no**
mouse, so those four stay built in code in `floor/Workstations.tsx` — to real proportions and
with rounded/bevelled geometry (rounded boxes, capsules, a lathe gas lift, a 5-star base with
castors, a 19.05 mm-pitch keycap grid, a thin-bezel panel with a UI glow), not flat boxes.

The five office-prop GLBs that used to sit in this folder (`office-desk.glb`, `office-chair.glb`,
`computer-monitor.glb`, `keyboard.glb`, `computer-mouse.glb`) had **no establishable provenance**
— no source URL, no license metadata in the file, no download script or credit note anywhere in
the repository — so they were never wired into the app and have been taken out of the shipped
asset tree. They are not restored or referenced here; nothing in `props/` is unverified any more.
See "Candidates examined and rejected" below for the same reasoning applied to avatar sources.

## Candidates examined and rejected (license or technical reason)

| Candidate | Reason for rejection |
| --- | --- |
| Ready Player Me avatars (`models.readyplayer.me`, `brunette.glb`, `avatar_fixed.glb`) | TalkingHead's own license notes mark them **CC BY-NC 4.0** / non-commercial; not safe for a commercial factory console. The RPM CDN is also DNS-unreachable in this environment. |
| Avaturn `avatar.glb` / Avatoon demo GLB | Documented "for non-commercial use" (`rootExtras.created_by = "Avaturn.me"`); repo MIT license does not cover the bundled avatar. |
| AvatarSDK / VRoid demo GLBs | Non-commercial per TalkingHead license notes; no verified redistribution right. |
| Mixamo/FBX assets (e.g. Soldier.glb, avatar-stage demo) | Rig + walk/idle clips but **no facial morph targets**; raw Mixamo files may not be redistributed outside the project team per TalkingHead's notes. |
| `humanforge` CC0 sample (`demo/sample.glb`, `body.glb.gz`) | Assets are CC0, but the prebuilt sample has no skeleton or morphs (morphs are applied by their runtime from `shapes.bin`); building export GLBs would require adding dev dependencies, which is out of scope. |
