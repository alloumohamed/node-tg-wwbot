# Werewolf Arabic Telegram Bot

Requires Node >= 22.5 (uses built-in node:sqlite).

    npm install
    BOT_TOKEN=xxx ADMIN_IDS=123 npm start

Env: MIN_PLAYERS, JOIN_TIME, TIME_DAY, TIME_NIGHT, TIME_LYNCH, ERROR_CHAT_ID, DATA_DIR, BOT_DELAY_MIN, BOT_DELAY_MAX
Language packs: drop JSON files in data/lang (name = pack name), choose with /setlang.
GIFs: ADMIN_IDS users reply to a GIF with /setgif <Key>; see /gifs.
Tests: node src/selftest.js, node src/selftest_bots.js
