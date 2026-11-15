# DMX Studio

Free, open-source DMX platform for lighting and projection mapping. An easy light-show editor for Windows: lay out your lights, drop clips on a timeline, sync them to music, and send it all to real DMX fixtures through a USB-DMX cable. Built to be friendly if you're new to DMX.

## Features

- **Timeline** with colour clips, gradients, snapping, zoom, copy/paste, multi-select and drag-copy
- **Effects** tab: Rainbow Chase, Bass Pulse, Police Strobe, Sunset Fade, Scanner, Breathe, Circle for moving heads and more. Effects are written onto the timeline as ordinary clips you can edit, and you can import/export your own as JSON packs
- **Audio** with beat detection, **accent points** for brightness hits, and a **reference video** panel with trim/slip
- **Cue mode** for triggering looks live (spacebar)
- **Moving heads** with a frame/pose system and motor physics (speed, acceleration, range), so DMX output never asks a head to do the impossible
- **2D and 3D visualizer** with a loadable demo stage
- **Test lights** and **Blackout** buttons, plus autosave
- Output through FTDI-based USB-DMX cables (e.g. DSD TECH) at 40 Hz

## Install

Download `DMX-Studio-Setup-x.y.z.exe` from the Releases page and run it. Windows may show a SmartScreen warning because the app isn't code-signed: choose **More info → Run anyway**.

## Quick start

1. Plug in your USB-DMX cable, pick its COM port at the top, and click **Connect**.
2. In **Fixtures**, add your lights. Set each one's DMX address to match the dial or menu on the physical light.
3. Add clips on the timeline (**+ Clip**), or open **Effects**, choose one and apply it.
4. Press **Play**. Use **Test lights** to check wiring and addresses.

If a light does nothing, the most common cause is a wrong DMX address, so check it against the fixture.

## Development

Requires Node.js 20+ on Windows.

```bash
npm install
npm run dev      # Vite + Electron with hot reload
npm run build    # typecheck + production build
npm run start    # build, then run
npm run dist     # build the Windows installer into release/
```

Stack: Electron, Vite, React, Tailwind, zustand, three.js / react-three-fiber. DMX output runs in an Electron utility process using `serialport`.

## Effect packs

An effect pack is a JSON file with `"format": "dmx-studio-effects"` and a list of effects. Each effect picks an engine (`chase`, `pulse`, `wash`, `flicker`, `orbit`) plus its settings. Export one from the Effects tab to see the exact shape.

## Data

Shows autosave to `%APPDATA%\DMX Studio`. Use **Save as** to keep a show as a file.

## Status

Early (v0.1). No undo yet, and no remote effect storefront yet.
