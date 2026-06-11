# Voice benchmark phrases

Record each phrase as `assets/voice-fixtures/NN.wav` (16 kHz mono):

    arecord -f S16_LE -r 16000 -c 1 -d 8 assets/voice-fixtures/01.wav

01. "prebaci na file panes"
02. "otvori grid"
03. "zatvori grid za voice"
04. "dodaj claude terminal u file panes sa promptom sredi failing testove u Sidebar komponenti"
05. "dodaj codex terminal"
06. "zatvori drugi tab"
07. "preimenuj feature u export import"
08. "switch to the voice feature"
09. "add a claude terminal with prompt refactor the store"
10. "promeni grid stil u kolone"

Expected-transcript ground truth lives next to each wav as `NN.txt` (latinica).

## Running the benchmark

    LD_LIBRARY_PATH="node_modules/@kutalia/whisper-node-addon/dist/linux-x64:$LD_LIBRARY_PATH" \
      node scripts/voice-bench.mjs [modelsDir]

The `LD_LIBRARY_PATH` prefix is required because the native addon's shared
libraries (`libwhisper.so`, `libggml*.so`) live alongside the `.node` file in
`node_modules/@kutalia/whisper-node-addon/dist/linux-x64/` and plain `node`
does not resolve them automatically. With this prefix the addon loads cleanly
in plain Node without Electron.

Download missing models with the `curl` lines printed by the script, then
re-run to get per-phrase latency and word-accuracy numbers.

After recording the fixtures, run the benchmark and update
`DEFAULT_VOICE_CONFIG.modelId` in `src/main/voice/config.ts` if a different
candidate wins (criteria: highest word accuracy with avg latency <= ~2500 ms).
