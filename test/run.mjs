// End-to-end checks: runs the built module against a fake soundboard with a stubbed Companion host
import assert from 'node:assert/strict'
import { createFakeSoundboard } from './fake-soundboard.mjs'
const { default: Module } = await import('../dist/main.js')
const { SoundboardClient } = await import('../dist/client.js')
const { fileLabel } = await import('../dist/cache.js')
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const until = async (fn, what, ms = 3000) => {
	const t = Date.now()
	while (!fn()) {
		if (Date.now() - t > ms) throw new Error('timeout: ' + what)
		await wait(20)
	}
}
const ok = (m) => console.log('✔ ' + m)
const choices = (m, id = 'play') => m.actions[id].options[0].choices.map((c) => c.id)

const sb = await createFakeSoundboard()
const base = { url: `127.0.0.1:${sb.port}`, sort: 'alpha', metaInterval: 5, statusInterval: 200, timeout: 1000 }

// 1. startup: list loaded, alpha order by display name, status ok
let m = new Module({})
await m.init({ ...base })
await until(() => m.status?.[0] === 'ok' && choices(m).length === 3, 'connected + sounds')
assert.deepEqual(choices(m), ['airhorn.mp3', 'b c.mp3', 'zebra.mp3'])
assert.equal(m.actions.play.options[0].allowCustom, true)
assert.deepEqual(m.structure[0].definitions, ['sound:airhorn.mp3', 'sound:b c.mp3', 'sound:zebra.mp3'])
ok(
	'connects, lists sounds A–Z in action dropdown and presets: ' +
		m.actions.play.options[0].choices.map((c) => c.label).join(' | '),
)

// 2. placing a cover feedback fetches metadata + cover, then redraws that feedback
let r = m.feedbacks.cover.callback({ id: 'fb1', options: { sound: 'zebra.mp3' } })
assert.deepEqual(r, {})
await until(() => m.calls.some((c) => c[0] === 'checkById' && c.includes('fb1')), 'redraw fb1')
r = m.feedbacks.cover.callback({ id: 'fb1', options: { sound: 'zebra.mp3' } })
assert.equal(Buffer.from(r.png64, 'base64').subarray(0, 4).toString('hex'), '89504e47')
assert.ok(sb.state.requests.includes('/meta/zebra.mp3'))
assert.ok(sb.state.requests.includes('/cover/zebra.mp3?size=72'), 'cover requested at button size')
ok('new cover feedback polls /meta/<file> + /cover/<file> and gets png64')
// no cover → no image, button keeps own style
m.feedbacks.cover.callback({ id: 'fb2', options: { sound: 'b c.mp3' } })
await wait(200)
assert.deepEqual(m.feedbacks.cover.callback({ id: 'fb2', options: { sound: 'b c.mp3' } }), {})
ok('sound without embedded cover returns no image (default SVG not used)')
r = m.feedbacks.cover.callback({ id: 'fb3', options: { sound: 'zebra.mp3', hide_text: true } })
assert.ok(r.png64)
assert.equal(r.text, '')
assert.deepEqual(m.feedbacks.cover.callback({ id: 'fb4', options: { sound: 'b c.mp3', hide_text: true } }), {})
assert.equal(m.presets['sound:zebra.mp3'].style.text, '')
assert.equal(m.presets['sound:b c.mp3'].style.text, 'b c')
assert.equal(m.presets['sound:zebra.mp3'].feedbacks[1].style.text, '▶')
ok('hide_text clears the text only while a cover is shown; presets show no text for sounds with a cover')
const client = new SoundboardClient(`http://127.0.0.1:${sb.port}`, 1000)
assert.equal((await client.getImage('/cover/b%20c.mp3', { size: 72 })).kind, 'none')
ok('sized fallback (PNG vinyl, X-Cover-Source: default) is also treated as "no cover"')

// 3. cover change at runtime is picked up on the next metadata refresh (ETag revalidation)
const before = m.coverFor('zebra.mp3')
sb.state.sounds['zebra.mp3'].cover = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(64, 9)])
sb.state.sounds['zebra.mp3'].etag = 'z2'
m.calls.length = 0
await m.refreshMeta()
assert.notEqual(m.coverFor('zebra.mp3'), before)
assert.ok(m.calls.some((c) => c[0] === 'checkById' && c.includes('fb1')))
const n304 = sb.state.requests.length
const redraws = m.calls.length
await m.refreshMeta()
assert.ok(sb.state.requests.slice(n304).includes('/cover/zebra.mp3?size=72'))
assert.equal(
	m.calls.filter((c) => c[0] === 'checkById').length,
	m.calls.slice(0, redraws).filter((c) => c[0] === 'checkById').length,
)
ok('changed cover detected (new ETag) and button redrawn; unchanged covers revalidate via 304')

// 4. playing: correct endpoints, status feedback
await m.actions.play.callback({ options: { sound: 'b c.mp3' } })
assert.ok(sb.state.requests.includes('/play/b%20c.mp3'))
await m.actions.play.callback({ options: { sound: 'https://youtu.be/xyz' } })
assert.ok(sb.state.requests.some((u) => u.startsWith('/play_url?url=https%3A%2F%2Fyoutu.be%2Fxyz')))
await m.actions.play.callback({ options: { sound: 'zebra.mp3' } })
await until(() => m.feedbacks.playing.callback({ options: { sound: 'zebra.mp3' } }) === true, 'playing feedback')
assert.equal(m.vars.now_playing_title, 'zebra')
assert.ok(m.feedbacks.now_playing_cover.callback({ options: { source: 'auto' } }).png64)
ok('play uses /play/<encoded file>, URLs go to /play_url; playing + now-playing feedbacks/variables follow /status')
await assert.rejects(m.actions.play.callback({ options: { sound: 'missing.mp3' } }), /404/)
ok('unknown file → action error with HTTP 404')

// 5. sort by plays (via config change), counts in labels
await m.configUpdated({ ...base, sort: 'plays' })
await until(
	() => choices(m)[0] === 'airhorn.mp3' && m.actions.play.options[0].choices[0].label.includes('×'),
	'plays order',
)
assert.deepEqual(choices(m), ['airhorn.mp3', 'b c.mp3', 'zebra.mp3'])
sb.state.sounds['zebra.mp3'].count = 100
await m.refreshMeta()
assert.deepEqual(choices(m), ['zebra.mp3', 'airhorn.mp3', 'b c.mp3'])
ok('sort by number of plays: ' + m.actions.play.options[0].choices.map((c) => c.label).join(' | '))

// 5b. naming: file name by default (underscores as spaces), title tag on request
assert.equal(fileLabel('werner_-_beinhart_-_einn_noch.wav'), 'werner - beinhart - einn noch')
assert.equal(fileLabel('a__b  c.mp3'), 'a b c')
assert.equal(m.presets['sound:zebra.mp3'].name, 'zebra')
await m.configUpdated({ ...base, sort: 'alpha', names: 'title' })
assert.equal(m.actions.play.options[0].choices.find((c) => c.id === 'zebra.mp3').label, 'Zebra (zebra.mp3)')
assert.equal(m.actions.play.options[0].choices.find((c) => c.id === 'b c.mp3').label, 'b c')
assert.equal(m.presets['sound:zebra.mp3'].name, 'Zebra')
await m.configUpdated({ ...base, sort: 'plays' })
ok('names: file name by default, title tag (with file name) when "Name sounds by" is title')

// 5b. cover size: changing it refetches covers at the new size; stream thumbnails are sized too
m.calls.length = 0
// Two quick config changes against a slow server: the second must not wait for the first's (now stale) refresh
sb.state.playing = null // otherwise the now-playing poll reloads zebra's cover and hides the problem
await until(() => !m.nowPlaying?.sound, 'nothing playing')
sb.state.delay = 300
await m.configUpdated({ ...base, sort: 'plays', coverSize: 72 })
await m.configUpdated({ ...base, sort: 'plays', coverSize: 96 })
await until(
	() =>
		Buffer.from(m.coverFor('zebra.mp3') ?? '', 'base64')
			.toString()
			.endsWith('size=96'),
	'cover at 96',
)
assert.ok(sb.state.requests.includes('/cover/zebra.mp3?size=96'))
assert.ok(m.calls.some((c) => c[0] === 'checkById' && c.includes('fb1')))
ok('changing "Cover size" refetches covers with ?size=96 and redraws the buttons, even during a running refresh')
sb.state.delay = 0
sb.state.stream = 'YouTube: test'
sb.state.playing = null
await until(() => sb.state.requests.includes('/now_playing/thumbnail?v=1t&size=96'), 'thumbnail request')
await until(() => !!m.feedbacks.now_playing_cover.callback({ options: { source: 'stream' } }).png64, 'thumbnail')
assert.equal(m.vars.stream_title, 'YouTube: test')
sb.state.stream = null
ok('stream thumbnail requested with &size=96 next to its existing ?v= parameter')

// 6. cache persisted in config
await m.destroy()
const saved = m.saved
assert.equal(saved.cache.sounds.length, 3)
assert.ok(saved.cache.covers['zebra.mp3'] && !saved.cache.covers['b c.mp3'])
assert.equal(saved.cache.coverSize, 96)
ok(
	`cache saved via saveConfig (${saved.cache.sounds.length} sounds, ${Object.keys(saved.cache.covers).length} covers, ${JSON.stringify(saved.cache).length} bytes)`,
)

// 7. soundboard offline: start from saved config does not fail
sb.server.close()
sb.server.closeAllConnections()
m = new Module({})
await m.init(saved)
assert.deepEqual(choices(m), ['zebra.mp3', 'airhorn.mp3', 'b c.mp3'])
assert.ok(m.feedbacks.cover.callback({ id: 'x', options: { sound: 'zebra.mp3' } }).png64)
await until(() => m.status?.[0] === 'connection_failure', 'offline status')
ok(`offline start: sounds + covers from cache, status "${m.status[1]}"`)
const other = new Module({})
await other.init({ ...saved, coverSize: saved.coverSize + 8 })
assert.equal(choices(other).length, 3)
assert.equal(other.coverFor('zebra.mp3'), null)
await other.destroy()
ok('cached covers of another size are dropped on load, cached sounds kept')
await assert.rejects(m.actions.play.callback({ options: { sound: 'zebra.mp3' } }))
ok('play while offline reports an error instead of crashing')
// UI edit that drops the hidden cache field keeps the cache
await m.configUpdated({ ...base, sort: 'alpha' })
assert.equal(choices(m).length, 3)
ok('config edit without hidden cache field keeps cached sounds')
// different address → cache dropped
await m.configUpdated({ ...base, url: 'http://127.0.0.1:1' })
assert.equal(choices(m).length, 0)
ok('changing to another soundboard address clears the old cache')
await m.configUpdated({ ...base, url: '' })
assert.equal(m.status[0], 'bad_config')
ok('empty address → bad config status')
await m.destroy()

// 8. soundboard behind a sub-path reverse proxy
const sub = await createFakeSoundboard('/board')
m = new Module({})
await m.init({ ...base, url: `http://127.0.0.1:${sub.port}/board/` })
await until(() => choices(m).length === 3, 'sub-path list')
await m.actions.play.callback({ options: { sound: 'airhorn.mp3' } })
assert.ok(sub.state.requests.includes('/board/play/airhorn.mp3'))
ok('sub-path base URL (…/board/) works, server paths are prefixed')
await m.destroy()
sub.server.close()
sub.server.closeAllConnections()
console.log('\nall checks passed')
process.exit(0)
