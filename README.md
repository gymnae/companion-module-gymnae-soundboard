# companion-module-gymnae-soundboard

[Bitfocus Companion](https://bitfocus.io/companion) module for the [Mumble Soundboard](https://github.com/gymnae/mumblesoundboard). It plays sounds and shows their embedded cover art on the buttons. User documentation is in [companion/HELP.md](companion/HELP.md).

Built on `@companion-module/base` 2.2 and Node 26, starting from the official [TypeScript template](https://github.com/bitfocus/companion-module-template-ts).

## Development

```sh
corepack enable   # or install Yarn 4 another way (Node 26 no longer ships corepack)
yarn install
yarn build        # or `yarn dev` to rebuild on change
yarn test         # runs the built module against a fake soundboard (test/)
yarn test:live https://soundboard.example.org   # read-only run against a real soundboard (never plays anything)
yarn package      # writes gymnae-soundboard-<version>.tgz to import into Companion
```

## Installing in Companion

Requires Companion 5.1 or newer.

- **From the package:** on the _Modules_ page, use **Import module package** with the `.tgz` from `yarn package`. Don't use _Import offline module bundle_; that button only takes Bitfocus' multi-module offline bundles and reports "No modules found in bundle".
- **From source, for development:** run `yarn install && yarn build` in the checkout first. Then set the _developer modules path_ in Companion's settings to the folder **above** the checkout. Companion looks for modules in its subfolders, so the checkout folder itself shows "Found 0 extra modules". See [Local modules](https://companion.free/for-developers/module-development/local-modules).

## Soundboard API used

| Purpose                          | Request                                                                     |
| -------------------------------- | --------------------------------------------------------------------------- |
| Sound list, tags, play counts    | `GET /meta`                                                                 |
| Metadata of a newly placed sound | `GET /meta/<file>`                                                          |
| Cover (ETag revalidated)         | `GET /cover/<file>?size=N`; `X-Cover-Source: default` means no cover        |
| Play                             | `GET <play_url>` (`/play/<file>`), or `GET /play_url?url=` for http(s) URLs |
| Stop / volume                    | `GET /stop`, `GET /volume/{local,remote}/<0-100>`                           |
| Now playing                      | `GET /status`, `GET /now_playing/thumbnail?…&size=N`                        |

## Layout

- `src/client.ts`: HTTP client for the soundboard
- `src/cache.ts`: sound and cover cache, persisted in the connection config under the hidden `cache` key
- `src/main.ts`: instance lifecycle, polling, and tracking which sounds are placed on buttons
- `src/actions.ts`, `src/feedbacks.ts`, `src/presets.ts`, `src/variables.ts`: Companion definitions
