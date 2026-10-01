# Canasta

Classic Canasta in the browser. No build step and no dependencies. Card faces are drawn with CSS, so the whole site is a handful of static files.

A match is four hands. Play alone against one, two, or three AI opponents. Four players use standard partnerships; three players is cutthroat; two players draws two cards and needs two canastas to go out.

Serve this folder from any static host:

```bash
python3 -m http.server 8080
```

Then open the site. `file://` will not load the modules.
