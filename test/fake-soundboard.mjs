// Mimics the mumblesoundboard GET API closely enough for the module: /meta, /meta/<f>, /cover/<f>, /play, /status
import http from 'node:http'
const png = (seed) => Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(64, seed)])
export function createFakeSoundboard(prefix = '') {
	const state = {
		sounds: {
			'zebra.mp3': { title: 'Zebra', count: 1, cover: png(1), etag: 'z1' },
			'airhorn.mp3': { title: 'Airhorn', count: 42, cover: png(2), etag: 'a1' },
			'b c.mp3': { title: null, count: 7, cover: null },
		},
		requests: [],
		delay: 0,
		playing: null,
	}
	const info = (name) => {
		const s = state.sounds[name]
		const e = encodeURIComponent(name)
		return {
			name,
			title: s.title,
			artist: null,
			album: null,
			year: null,
			genre: null,
			duration: 1,
			has_cover: !!s.cover,
			count: s.count,
			play_url: `/play/${e}`,
			cover_url: `/cover/${e}`,
			meta_url: `/meta/${e}`,
		}
	}
	// state.delay (ms) slows every response down, like a busy server
	const handle = (req, res) => {
		let url = new URL(req.url, 'http://x')
		state.requests.push(req.url)
		let path = decodeURIComponent(url.pathname)
		if (prefix) {
			if (!path.startsWith(prefix)) {
				res.writeHead(404).end()
				return
			}
			path = path.slice(prefix.length)
		}
		const json = (o, code = 200) => {
			res.writeHead(code, { 'content-type': 'application/json' }).end(JSON.stringify(o))
		}
		if (path === '/meta') return json(Object.keys(state.sounds).sort().map(info))
		if (path.startsWith('/meta/')) {
			const n = path.slice(6)
			return state.sounds[n] ? json(info(n)) : json({ error: 'File not found' }, 404)
		}
		// ?size=N as in the soundboard: scaled image, size part of the ETag, PNG vinyl as fallback
		const size = url.searchParams.get('size')
		if (size !== null && !/^\d+$/.test(size)) return res.writeHead(400).end('Invalid size')
		const scaled = (img) => (size ? Buffer.concat([img, Buffer.from(`size=${size}`)]) : img)
		if (path === '/now_playing/thumbnail') {
			if (!state.stream)
				return res.writeHead(200, { 'content-type': 'image/svg+xml', 'x-cover-source': 'default' }).end('<svg/>')
			return res.writeHead(200, { 'content-type': 'image/png', 'x-cover-source': 'embedded' }).end(scaled(png(5)))
		}
		if (path.startsWith('/cover/')) {
			const s = state.sounds[path.slice(7)]
			if (!s) return res.writeHead(404).end()
			if (!s.cover) {
				if (size) return res.writeHead(200, { 'content-type': 'image/png', 'x-cover-source': 'default' }).end(png(0))
				return res.writeHead(200, { 'content-type': 'image/svg+xml', 'x-cover-source': 'default' }).end('<svg/>')
			}
			const etag = size ? `${s.etag}-${size}` : s.etag
			if (req.headers['if-none-match'] === etag) return res.writeHead(304).end()
			return res
				.writeHead(200, { 'content-type': 'image/png', etag, 'x-cover-source': 'embedded' })
				.end(scaled(s.cover))
		}
		if (path.startsWith('/play/')) {
			const n = path.slice(6)
			if (!state.sounds[n]) return res.writeHead(404).end('File not found')
			state.sounds[n].count++
			state.playing = n
			return res.writeHead(200).end('Playing')
		}
		if (path === '/play_url') return res.writeHead(200).end('Playing URL')
		if (path === '/stop') {
			state.playing = null
			return res.writeHead(200).end('Stopped')
		}
		if (path === '/status')
			return json({
				playing: !!(state.playing || state.stream),
				// Older soundboards have no playing_sounds; JSON drops the undefined key
				playing_sounds: state.oldStatus ? undefined : (state.playingSounds ?? (state.playing ? [state.playing] : [])),
				now_playing: {
					sound: state.playing
						? {
								name: state.playing,
								title: state.sounds[state.playing].title,
								artist: null,
								album: null,
								has_cover: !!state.sounds[state.playing].cover,
								cover_url: '',
								meta_url: '',
							}
						: null,
					stream: state.stream
						? { title: state.stream, link: '', has_thumbnail: true, thumbnail_url: '/now_playing/thumbnail?v=1t' }
						: null,
				},
			})
		res.writeHead(404).end()
	}
	const server = http.createServer((req, res) =>
		state.delay ? setTimeout(() => handle(req, res), state.delay) : handle(req, res),
	)
	return new Promise((r) => server.listen(0, '127.0.0.1', () => r({ server, state, port: server.address().port })))
}
