// Read-only run of the built module against a real soundboard: no play/stop/volume calls
import assert from 'node:assert/strict'
const { default: Module } = await import('../dist/main.js')
const URL_ = process.argv[2]
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const until = async (fn, what, ms = 10000) => {
	const t = Date.now()
	while (!fn()) {
		if (Date.now() - t > ms) throw new Error('timeout: ' + what)
		await wait(50)
	}
}
const ok = (m) => console.log('✔ ' + m)
const opts = (m) => m.actions.play.options[0].choices
const config = {
	url: URL_.replace(/^https?:\/\//, 'https://'),
	sort: 'alpha',
	metaInterval: 30,
	statusInterval: 1000,
	timeout: 3000,
}

let m = new Module({})
let t = Date.now()
await m.init({ ...config })
await until(() => m.status?.[0] === 'ok' && opts(m).length > 0, 'connected')
ok(
	`connected in ${Date.now() - t} ms, ${opts(m).length} sounds, ${Object.keys(m.presets).length} presets; variables: sound_count=${m.vars.sound_count} connected=${m.vars.connected}`,
)
console.log(
	'   A–Z first 5:',
	opts(m)
		.slice(0, 5)
		.map((c) => c.label)
		.join(' | '),
)

const withCover = [...m.cache.sounds.values()].find((s) => s.has_cover)
const noCover = [...m.cache.sounds.values()].find((s) => !s.has_cover)
t = Date.now()
assert.deepEqual(m.feedbacks.cover.callback({ id: 'fbA', options: { sound: withCover.name } }), {})
await until(() => m.calls.some((c) => c[0] === 'checkById' && c.includes('fbA')), 'cover redraw')
const png64 = m.feedbacks.cover.callback({ id: 'fbA', options: { sound: withCover.name } }).png64
const img = Buffer.from(png64, 'base64')
assert.equal(img.subarray(0, 2).toString('hex'), 'ffd8')
ok(
	`cover feedback for "${withCover.name}": JPEG ${img.length} B (base64 ${png64.length} chars) after ${Date.now() - t} ms`,
)
m.feedbacks.cover.callback({ id: 'fbB', options: { sound: noCover.name } })
await wait(500)
assert.deepEqual(m.feedbacks.cover.callback({ id: 'fbB', options: { sound: noCover.name } }), {})
ok(`no-cover sound "${noCover.name}" → no image, button keeps its style`)

m.calls.length = 0
await m.refreshMeta()
assert.ok(!m.calls.some((c) => c[0] === 'checkById'))
ok('second refresh: cover revalidated (304), no redraw')

await m.configUpdated({ ...config, sort: 'plays' })
await until(() => opts(m)[0]?.label.includes('×'), 'plays order')
console.log(
	'   by plays first 5:',
	opts(m)
		.slice(0, 5)
		.map((c) => c.label)
		.join(' | '),
)
const counts = opts(m).map((c) => +c.label.match(/– (\d+)×$/)[1])
assert.ok(counts.every((c, i) => i === 0 || counts[i - 1] >= c))
ok('sort by plays is descending')

await m.configUpdated({ ...config, sort: 'plays', coverSize: 120 })
await until(() => (m.coverFor(withCover.name)?.length ?? 0) > png64.length, 'cover at 120')
ok(`cover size 120 → refetched, now ${Buffer.from(m.coverFor(withCover.name), 'base64').length} B`)

await wait(1500)
ok(
	`status poll: playing=${m.vars.playing}, now_playing_title="${m.vars.now_playing_title}", stream_title="${m.vars.stream_title}"`,
)

await m.destroy()
const saved = m.saved
ok(
	`saved cache: ${saved.cache.sounds.length} sounds, ${Object.keys(saved.cache.covers).length} cover(s), ${JSON.stringify(saved).length} bytes config`,
)

// offline restart: unreachable address on the same base is not possible, so block requests instead
const realFetch = globalThis.fetch
globalThis.fetch = () => Promise.reject(new Error('network down (simulated)'))
m = new Module({})
await m.init(saved)
await until(() => m.status?.[0] === 'connection_failure', 'offline status')
assert.equal(opts(m).length, saved.cache.sounds.length)
assert.ok(m.feedbacks.cover.callback({ id: 'x', options: { sound: withCover.name } }).png64)
ok(`offline restart from saved config: ${opts(m).length} sounds + cover from cache, status "${m.status[1]}"`)
await m.destroy()
globalThis.fetch = realFetch
console.log('\nlive checks passed')
process.exit(0)
