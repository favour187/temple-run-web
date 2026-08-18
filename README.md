# Idol Rush 🕷️🥇

**Idol Rush** is a Temple Run–style endless runner: you've snatched the
golden idol from the temple, and the giant guardian spider is right behind
you. Built for the browser with the **real 3D assets** from the open-source
Unity clone [`kenmaz/TempleRun-Unity`](https://github.com/kenmaz/TempleRun-Unity).

## 🌋 The spectacle (things you haven't seen in a runner)

- **The world collapses behind you.** The ground disintegrates into a glowing
  golden void that chases the guardian's heels — columns of golden light and
  embers rise from the crumbling edge right at the bottom of the screen,
  while the road edges stay clean and readable.
- **Day → sunset → night cycle.** A custom GLSL sky shader renders the sun,
  a procedural starfield, the moon and a sunset band as you run. At night
  torches along the path light up and fireflies drift over the trail.
- **GOLD RUSH.** Collect 10 idols and your thief turns solid gold:
  invincible, magnetic, double score, with a golden particle trail, a
  full-screen gold flash and an audio fanfare.
- **A full character.** The thief is a complete stylized adventurer — face
  with eyes, hair under a banded fedora, leather vest, waving red scarf,
  satchel, gloved hands, backpack with bedroll, and a lantern that glows at
  night. Full run/jump/slide/tumble animation set.
- **The guardian roars.** Every ~15 s the spider lunges — screen shake, red
  vignette pulse and a synthesized roar.
- **Full juice suite**: dust under your boots, idol bursts, shield shatters,
  screen shake, speed-based FOV kick, blob shadows, synthesized WebAudio SFX.

No Unity, no plugins — pure **Three.js + WebGL**, deployable to **Render** as a
static site.

## ▶️ Play

- **⬅ ➡ / A D** — change lane
- **⬆ / Space** — jump rocks & logs
- **⬇ / S** — slide under hanging branches
- Swipe on touch screens; tap to jump, swipe down to slide
- **🥇 Grab idols** — +25 m each
- **🧲 Magnet** — pulls nearby idols to you (8 s)
- **🛡 Shield** — smash straight through one obstacle (6 s)
- **🕐 Slow-mo** — time warp for tight dodges (5 s)
- **⚡ Nitro** — speed burst, wind streaks, ×1.5 score (5 s)
- **👻 Ghost** — phase straight through obstacles (6 s)
- **✨ Near-miss combos** — shave past obstacles for bonus meters (×5 max)
- **P / Esc** pause · **M** mute · milestones every 250 m · last 5 runs on the menu
- Outrun the giant guardian spider. Speed keeps climbing — and so does it.

## 🚀 Deploy to Render

### Option A — Blueprint (recommended, one click)

1. Push this folder to GitHub:

   ```bash
   cd temple-run-web
   git init
   git add .
   git commit -m "Temple Run web edition"
   git branch -M main
   git remote add origin https://github.com/<you>/<repo>.git
   git push -u origin main
   ```

2. Render dashboard → **New → Blueprint** → select the repo → **Apply**.

   The included [`render.yaml`](render.yaml) creates the static site
   automatically (`staticPublishPath: .`). Every `git push` redeploys.

### Option B — Manual static site

Render dashboard → **New → Static Site** → connect the repo → set:

| Setting | Value |
|---|---|
| Build command | *(leave empty)* |
| Publish directory | `.` |

### Option C — Docker (Web Service)

Render → **New → Web Service** → the included `Dockerfile` + `nginx.conf`
serve the site behind nginx with correct `.glb` MIME types and caching.

All three work on Render's **free tier**. Custom domains:
Dashboard → Settings → Custom Domains.

## 🏃 Run locally

```bash
cd temple-run-web
python3 -m http.server 8000
# open http://localhost:8000
```

## 🗂 What's inside

```
index.html              UI shell + import map
game.js                 full game (three.js, no build step)
LICENSE                 MIT
render.yaml             Render Blueprint (static site)
Dockerfile, nginx.conf  alternative Web-Service deploy
lib/three.module.js     Three.js r160 (vendored, MIT)
lib/addons/             GLTFLoader + BufferGeometryUtils
assets/models/*.glb     palm, bamboo, banana, rock, spider — converted from
                        the repo's original FBX files (textures embedded)
assets/textures/        grass & path (Unity Terrain Assets) + Sunny1 skybox
```

Total payload ≈ 2.5 MB — no external CDNs, fully self-contained.

## 🔧 How the 3D assets were produced

The Unity repo ships old **FBX 6.0/6.1/7.3** files (some big-endian, some with
zlib-compressed arrays and bogus end-offsets) that modern Blender rejects.
They were converted to glTF/GLB with a custom converter (in
`../temple-run-web-tools/`):

- `fbx2glb.py` — FBX 6.0/6.1/7.3 binary parser + GLB writer (handles BE/LE,
  compressed arrays, per-face materials/textures, model transforms)
- `tex-index.json` + `tex-pool/` — PSD/TIF/TGA textures converted to PNG/JPEG
- geometry validated against the `ufbx` parser (vertex/tri counts match)

## ⚖️ Attribution & licensing

- Game code (this repo): MIT license.
- 3D assets: Unity's free **Terrain Assets** sample pack, the third-party
  *Infestor* spider, and Unity skyboxes — all shipped inside the public
  `kenmaz/TempleRun-Unity` clone (which has no LICENSE file; assets are for
  learning/non-commercial use).
- *Temple Run* is a trademark of Imangi Studios; this is an independent
  fan-made homage using none of their art or code.
- Three.js: MIT.
