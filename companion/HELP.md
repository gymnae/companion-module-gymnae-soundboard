## Mumble Soundboard

Plays sounds on a [Mumble Soundboard](https://github.com/gymnae/mumblesoundboard) and shows each sound's embedded cover art on its button.

### Configuration

- **Soundboard address**: base URL of the soundboard web UI, e.g. `http://192.168.1.20:5000`. `http://` is added if missing. A sub-path behind a reverse proxy works too (`https://example.org/board`).
- **Name sounds by**: _File name_ (default) or _Title tag_. File names are shown without extension and with underscores as spaces, so long names wrap on buttons. Title tags are often placeholders such as "Untitled Project" or the game a clip came from; with _Title tag_, sounds without one still use the file name.
- **Order sounds by**: _Alphabet_ or _Number of plays_. This sets the order of the sound lists in actions, feedbacks and presets. With _Number of plays_, the lists also show the play counts.
- **Metadata refresh**: how often the sound list, play counts and covers are re-read (default 30 s).
- **Cover size**: covers and stream thumbnails are requested scaled down to fit this many pixels (default 72, Companion's standard button size). Raise it if covers look soft on larger buttons. Changing it refetches the covers. Soundboard versions without the `?size=` option ignore it and send full-size covers.
- **Now-playing poll**: how often `/status` is read for the _playing_ feedbacks and the now-playing variables (default 1000 ms, 0 = off).

### Quick start

Open **Presets → Sounds** and drag a sound onto a button. The button plays the sound, shows its cover and highlights while it plays. Buttons for sounds with a cover show no text; the others show the sound's name (see _Name sounds by_).

### Actions

- **Play sound**: pick a sound from the list. You can also type a file name, or an `http(s)://` URL, which is played as a web stream.
- **Play web stream / YouTube URL**
- **Stop all sounds**
- **Set volume**: for sound files or web streams, 0–100 %
- **Refresh sound list and covers**: refreshes right away instead of waiting for the next interval

### Feedbacks

- **Sound cover art**: uses the cover embedded in the file (MP3, M4A, FLAC, Ogg) as the button image. If the file has no cover, the button keeps its own style. With _Hide button text while the cover is shown_, the button text is cleared while a cover is displayed. On layered buttons, the button needs an image element for the cover to appear.
- **Sound cover art (image data)**: the same image as base64 data, for an image element on layered buttons.
- **Sound is playing**: true while the sound is the newest one still playing.
- **Anything is playing**
- **Now playing cover art**: the cover of the current sound, or the thumbnail of the running web stream.

### Variables

`connected`, `sound_count`, `last_update`, `playing`, `now_playing_name`, `now_playing_title`, `now_playing_artist`, `stream_title`

### Caching and offline behaviour

When you place a button, the module loads that sound's metadata and cover immediately. After that, every metadata refresh re-checks them with an ETag request, so a changed cover appears automatically.

Sound names, play counts and the covers of sounds on your buttons are stored in the connection's configuration. This copy holds up to 256 covers. If the soundboard is unreachable, including at Companion startup, the sound lists and button images come from this copy. The connection shows a warning, and pressing a button logs an error until the soundboard is back. Changing the soundboard address clears the copy.
