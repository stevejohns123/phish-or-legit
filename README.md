# Phish or Legit

Real-time multiplayer phishing-awareness game. Players join with a 4-character room code and nickname, no login or install.

## Run locally

```bash
npm start
```

Open `http://localhost:3000`.

## Game flow

- 2–12 players
- First player is host; host transfers if they disconnect
- Five rounds; Sender rotates automatically
- Sender receives a private Legit/Phish card and scenario
- Sender has 45 seconds to start writing and 90 seconds to submit a 1–2 sentence message
- Other players vote Real/Fake privately for up to 60 seconds
- Correct voters get 1 point; Sender gets 1 point per player fooled
- Reveal shows the secret card, every vote, correctness, and a phishing-awareness tell
- Reveal lasts 10 seconds
- Sender disconnects receive a 25-second reconnect grace period; if they do not return, the round is skipped
- Player identity uses a browser token in `localStorage`, so quick reconnects do not create duplicate seats
- Room/nickname are restored automatically on page load
- Client sends a heartbeat every 20 seconds
- Empty `/api/create` rooms are cleaned up after 10 minutes

## Deployment

The server uses only Node's built-in HTTP/WebSocket implementation and keeps room state in memory. Use a container/WebSocket-capable host. A host restart or sleep clears active rooms.
