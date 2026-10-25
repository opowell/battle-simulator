The Browser (`browser/`): the UI for everything the server knows about — games,
battle specs, scenarios, sessions, recordings — and the game screen sessions are
played on (`browser/play/`). Nothing game-specific belongs in the UI, has to be
strictly generic.

What a game needs beyond its `toGrid` and its `ui.*` flags it ships itself, in
its own folder, as **UI plugins** (`games/<name>/ui/`, listed in the game
definition's `uiPlugins`). The slots and what each is handed are in
`browser/play/plugins.js`. `src/gate.test.js` fails if a file here imports a
game or names one in code.
