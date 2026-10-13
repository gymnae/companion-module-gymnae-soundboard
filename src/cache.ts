import type { ImageData, SoundInfo } from './client.js'
import type { SortOrder } from './config.js'

/** What is remembered about a sound between restarts */
export type CachedSound = {
	name: string
	title: string | null
	artist: string | null
	album: string | null
	count: number
	has_cover: boolean
	play_url: string | null
	cover_url: string | null
}

export type CachedCover = ImageData & { fetched: number }

/** JSON stored under `config.cache` */
export type PersistedCache = {
	version: 1
	baseUrl: string
	/** Size the covers were requested at; covers of another size are dropped on load */
	coverSize?: number
	updated: number
	sounds: CachedSound[]
	covers: { [name: string]: CachedCover }
}

// Covers are stored in the connection config, so keep that bounded: enough for a few full surfaces.
// Button-sized covers are a few KB each; the length limits only matter for soundboards that ignore ?size=.
const MAX_PERSISTED_COVERS = 256
const MAX_PERSISTED_COVER_LENGTH = 1024 * 1024 // base64 characters per cover
const MAX_PERSISTED_TOTAL_LENGTH = 8 * 1024 * 1024

function toCached(info: SoundInfo): CachedSound {
	return {
		name: info.name,
		title: info.title ?? null,
		artist: info.artist ?? null,
		album: info.album ?? null,
		count: Number(info.count) || 0,
		has_cover: !!info.has_cover,
		play_url: info.play_url ?? null,
		cover_url: info.cover_url ?? null,
	}
}

/** Title tag, or the file name without extension */
export function displayName(sound: Pick<CachedSound, 'name' | 'title'>): string {
	return sound.title?.trim() || sound.name.replace(/\.[^./]+$/, '')
}

const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true })

export type ListChange = { list: boolean; counts: boolean; removed: string[]; coverFlagChanged: string[] }

export class SoundCache {
	readonly sounds = new Map<string, CachedSound>()
	readonly covers = new Map<string, CachedCover>()
	baseUrl = ''
	coverSize = 0
	updated = 0

	load(data: PersistedCache | undefined, baseUrl: string, coverSize: number): void {
		this.sounds.clear()
		this.covers.clear()
		this.baseUrl = baseUrl
		this.coverSize = coverSize
		this.updated = 0
		if (!data || data.version !== 1 || data.baseUrl !== baseUrl) return
		this.updated = data.updated || 0
		for (const sound of data.sounds ?? []) {
			if (sound && typeof sound.name === 'string') this.sounds.set(sound.name, sound)
		}
		if (data.coverSize !== coverSize) return
		for (const [name, cover] of Object.entries(data.covers ?? {})) {
			if (cover && typeof cover.data === 'string') this.covers.set(name, cover)
		}
	}

	/** Replace the sound list with a fresh `/meta` result */
	replaceSounds(list: SoundInfo[]): ListChange {
		const change: ListChange = { list: false, counts: false, removed: [], coverFlagChanged: [] }
		const next = new Map<string, CachedSound>()
		for (const info of list) {
			if (!info || typeof info.name !== 'string') continue
			const sound = toCached(info)
			const prev = this.sounds.get(sound.name)
			if (!prev || prev.title !== sound.title || prev.artist !== sound.artist) change.list = true
			if (prev && prev.has_cover !== sound.has_cover) change.coverFlagChanged.push(sound.name)
			if (!prev || prev.count !== sound.count) change.counts = true
			next.set(sound.name, sound)
		}
		for (const name of this.sounds.keys()) {
			if (!next.has(name)) {
				change.list = true
				change.removed.push(name)
				this.covers.delete(name)
			}
		}
		this.sounds.clear()
		for (const [name, sound] of next) this.sounds.set(name, sound)
		if (change.list || change.counts) this.updated = Date.now()
		return change
	}

	/** Merge one fresh `/meta/<file>` record. Returns true if this changed the list as shown to users */
	upsert(info: SoundInfo): boolean {
		const sound = toCached(info)
		const prev = this.sounds.get(sound.name)
		this.sounds.set(sound.name, sound)
		return !prev || prev.title !== sound.title || prev.count !== sound.count
	}

	sorted(order: SortOrder): CachedSound[] {
		const list = [...this.sounds.values()]
		const alpha = (a: CachedSound, b: CachedSound) =>
			collator.compare(displayName(a), displayName(b)) || collator.compare(a.name, b.name)
		return list.sort(order === 'plays' ? (a, b) => b.count - a.count || alpha(a, b) : alpha)
	}

	/**
	 * Serialise for the connection config. Covers of sounds in `inUse` win, then the most recently
	 * fetched ones, within the size limits; the rest stays in memory only and is refetched after a restart.
	 */
	serialize(inUse: ReadonlySet<string>): PersistedCache {
		const candidates = [...this.covers.entries()]
			.filter(([, cover]) => cover.data.length <= MAX_PERSISTED_COVER_LENGTH)
			.sort(([a, ca], [b, cb]) => Number(inUse.has(b)) - Number(inUse.has(a)) || cb.fetched - ca.fetched)

		const covers: PersistedCache['covers'] = {}
		let total = 0
		let count = 0
		for (const [name, cover] of candidates) {
			if (count >= MAX_PERSISTED_COVERS || total + cover.data.length > MAX_PERSISTED_TOTAL_LENGTH) continue
			covers[name] = cover
			total += cover.data.length
			count++
		}
		return {
			version: 1,
			baseUrl: this.baseUrl,
			coverSize: this.coverSize,
			updated: this.updated,
			sounds: [...this.sounds.values()],
			covers,
		}
	}
}
