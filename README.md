# Canasta

Canasta in the browser. No build step and no dependencies. Card faces are drawn with CSS, so the whole site is a handful of static files.

Classic mode is a match of four hands against one, two, or three AI opponents. Four players use partnerships; three players is cutthroat; two players draws two cards and needs two canastas to go out.

House rules is the option selected when the page opens. It is four hands, everyone for themselves. The pack is one more deck than there are players. Each player has a 13-card hand and a 13-card foot, and draws two cards each turn. The opening meld is 50, then 90, then 120, then 150. The discard pile can be taken only when the top card starts a new meld. Going out takes a pure canasta, a mixed canasta, and a wild canasta, then an empty hand and foot. A hand also ends when the stock runs out.

Cards travel between the stock, the hand, the foot, the melds, and the discard pile. The speed control on the lobby and the table changes how fast those moves play.

Serve this folder from any static host:

```bash
python3 -m http.server 8080
```

Then open the site. `file://` will not load the modules.
