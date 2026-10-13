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
	const server = http.createServer((req, res) => {
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
		if (path.startsWith('/cover/')) {
			const s = state.sounds[path.slice(7)]
			if (!s) return res.writeHead(404).end()
			if (!s.cover)
				return res.writeHead(200, { 'content-type': 'image/svg+xml', 'x-cover-source': 'default' }).end('<svg/>')
			if (req.headers['if-none-match'] === s.etag) return res.writeHead(304).end()
			return res
				.writeHead(200, { 'content-type': 'image/png', etag: s.etag, 'x-cover-source': 'embedded' })
				.end(s.cover)
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
				playing: !!state.playing,
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
					stream: null,
				},
			})
		res.writeHead(404).end()
	})
	return new Promise((r) => server.listen(0, '127.0.0.1', () => r({ server, state, port: server.address().port })))
}
