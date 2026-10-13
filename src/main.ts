import {
	InstanceBase,
	InstanceStatus,
	type CompanionInputFieldDropdown,
	type SomeCompanionConfigField,
} from '@companion-module/base'
import { GetConfigFields, normalizeBaseUrl, DEFAULT_COVER_SIZE, DEFAULT_URL, type ModuleConfig } from './config.js'
import { UpdateVariableDefinitions, type VariablesSchema } from './variables.js'
import { UpgradeScripts } from './upgrades.js'
import { UpdateActions, type ActionsSchema } from './actions.js'
import { UpdateFeedbacks, type FeedbacksSchema, type NowPlayingSource } from './feedbacks.js'
import { UpdatePresets } from './presets.js'
import { SoundCache, displayName, type CachedSound } from './cache.js'
import {
	HttpError,
	SoundboardClient,
	isStreamUrl,
	soundPath,
	type NowPlaying,
	type SoundboardStatus,
} from './client.js'

export type ModuleSchema = {
	config: ModuleConfig
	secrets: undefined
	actions: ActionsSchema
	feedbacks: FeedbacksSchema
	variables: VariablesSchema
}

export { UpgradeScripts }

const SAVE_DELAY = 5000
const COVER_CONCURRENCY = 4

function withDefaults(config: ModuleConfig): ModuleConfig {
	const num = (value: unknown, fallback: number, min: number) => {
		const n = Number(value)
		return Number.isFinite(n) && n >= min ? n : fallback
	}
	return {
		...config,
		url: typeof config.url === 'string' ? config.url : DEFAULT_URL,
		sort: config.sort === 'plays' ? 'plays' : 'alpha',
		names: config.names === 'title' ? 'title' : 'file',
		metaInterval: num(config.metaInterval, 30, 5),
		statusInterval: num(config.statusInterval, 1000, 0),
		timeout: num(config.timeout, 3000, 250),
		coverSize: Math.min(1024, Math.round(num(config.coverSize, DEFAULT_COVER_SIZE, 16))),
	}
}

function errorMessage(e: unknown): string {
	return e instanceof Error ? e.message : String(e)
}

/** Runs `fn` over `items` with at most `limit` running at once */
async function forEachLimited<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
	const queue = [...items]
	const worker = async () => {
		for (let item = queue.shift(); item !== undefined; item = queue.shift()) await fn(item)
	}
	await Promise.all(Array.from({ length: Math.min(limit, queue.length) }, worker))
}

export default class ModuleInstance extends InstanceBase<ModuleSchema> {
	config!: ModuleConfig // Setup in init()
	readonly cache = new SoundCache()
	client: SoundboardClient | null = null
	nowPlaying: NowPlaying | null = null
	anyPlaying = false

	/** Sound used by each placed play action / cover feedback, keyed `action:<id>` or `feedback:<id>` */
	readonly #uses = new Map<string, string>()
	/** Sounds whose metadata and cover were loaded since (re)configuring, or are loading now */
	readonly #loaded = new Set<string>()
	readonly #loading = new Set<string>()
	#streamImage: { url: string; data: string | null } | null = null

	#metaTimer: NodeJS.Timeout | undefined
	#statusTimer: NodeJS.Timeout | undefined
	#saveTimer: NodeJS.Timeout | undefined
	/** The refresh in flight and the generation it belongs to; one from before a reconfigure does not count */
	#metaRunning: { promise: Promise<void>; generation: number } | null = null
	#statusRunning = false
	#online: boolean | null = null
	#offlineMessage = ''
	#lastUpdate = 0
	#definitionsKey = ''
	#savedCache = ''
	/** Bumped on every reconfigure, so responses from a previous address are dropped */
	#generation = 0

	constructor(internal: unknown) {
		super(internal)
	}

	async init(config: ModuleConfig): Promise<void> {
		this.config = withDefaults(config)
		this.cache.load(this.config.cache, normalizeBaseUrl(this.config.url) ?? '', this.config.coverSize)
		this.#savedCache = JSON.stringify(this.config.cache ?? null)
		this.#lastUpdate = this.cache.updated
		this.updateVariableDefinitions()
		this.#start()
	}

	async destroy(): Promise<void> {
		this.#stop()
		this.#saveNow()
	}

	async configUpdated(config: ModuleConfig): Promise<void> {
		this.#stop()
		// The cache is not a visible field, so an edited config may come back without it; the in-memory copy is current anyway
		this.config = withDefaults({ ...config, cache: this.config.cache })
		const base = normalizeBaseUrl(this.config.url) ?? ''
		if (base !== this.cache.baseUrl) {
			// Another soundboard: its sounds and covers are not ours
			this.cache.load(undefined, base, this.config.coverSize)
			this.#lastUpdate = 0
			this.#savedCache = ''
		} else if (this.config.coverSize !== this.cache.coverSize) {
			// Refetched at the new size by the refresh that #start() runs
			this.cache.covers.clear()
			this.cache.coverSize = this.config.coverSize
		}
		this.#start()
		this.#scheduleSave()
	}

	getConfigFields(): SomeCompanionConfigField[] {
		return GetConfigFields()
	}

	updateActions(): void {
		UpdateActions(this)
	}

	updateFeedbacks(): void {
		UpdateFeedbacks(this)
	}

	updatePresets(): void {
		UpdatePresets(this)
	}

	updateVariableDefinitions(): void {
		UpdateVariableDefinitions(this)
	}

	// --- lifecycle -------------------------------------------------------------------------------

	#start(): void {
		this.#generation++
		this.#loaded.clear()
		this.#loading.clear()
		this.#online = null
		this.nowPlaying = null
		this.anyPlaying = false
		this.#streamImage = null

		// Definitions come from the cache first, so buttons can be set up while the soundboard is offline
		this.#publishDefinitions(true)
		this.#updateVariables()
		this.checkAllFeedbacks()

		const base = normalizeBaseUrl(this.config.url)
		if (!base) {
			this.client = null
			this.updateStatus(InstanceStatus.BadConfig, 'Enter the soundboard address')
			return
		}
		this.client = new SoundboardClient(base, this.config.timeout)
		this.updateStatus(InstanceStatus.Connecting)

		void this.refreshMeta(true)
		this.#metaTimer = setInterval(() => void this.refreshMeta(), this.config.metaInterval * 1000)
		if (this.config.statusInterval > 0) {
			this.#statusTimer = setInterval(() => void this.#pollStatus(), this.config.statusInterval)
		}
	}

	#stop(): void {
		clearInterval(this.#metaTimer)
		clearInterval(this.#statusTimer)
		this.#metaTimer = undefined
		this.#statusTimer = undefined
		this.#generation++
	}

	#setOnline(online: boolean, message = ''): void {
		const was = this.#online
		this.#online = online
		if (online) {
			if (was !== true) {
				this.updateStatus(InstanceStatus.Ok)
				this.log('info', `Connected to ${this.client?.baseUrl}`)
				// Back after an outage: catch up with changes right away instead of waiting for the next interval
				if (was === false) void this.refreshMeta()
			}
		} else if (was !== false || message !== this.#offlineMessage) {
			const cached = this.cache.sounds.size
			this.updateStatus(
				InstanceStatus.ConnectionFailure,
				cached ? `Unreachable, using ${cached} cached sounds` : 'Unreachable, no cached sounds yet',
			)
			this.log('warn', `Soundboard unreachable: ${message}`)
		}
		this.#offlineMessage = online ? '' : message
		if (was !== online) this.#updateVariables()
	}

	// --- definitions -----------------------------------------------------------------------------

	#choiceLabel(sound: CachedSound): string {
		const name = displayName(sound, this.config.names)
		const label = this.config.names === 'title' && sound.title?.trim() ? `${name} (${sound.name})` : name
		return this.config.sort === 'plays' ? `${label} – ${sound.count}×` : label
	}

	/** Dropdown listing the known sounds in the configured order. Custom values allow file names and stream URLs. */
	soundOption(label: string): CompanionInputFieldDropdown<'sound'> {
		const choices = this.cache
			.sorted(this.config.sort, this.config.names)
			.map((sound) => ({ id: sound.name, label: this.#choiceLabel(sound) }))
		return {
			type: 'dropdown',
			id: 'sound',
			label,
			choices,
			default: choices[0]?.id ?? '',
			allowCustom: true,
			tooltip: 'Pick a sound, or type a file name from the soundboard',
		}
	}

	/** Re-sends actions, feedbacks and presets when the sound list (as users see it) has changed */
	#publishDefinitions(force = false): void {
		const key = JSON.stringify([
			this.label,
			this.config.sort,
			this.config.names,
			this.cache
				.sorted(this.config.sort, this.config.names)
				.map((sound) => [sound.name, this.#choiceLabel(sound), sound.artist, sound.album]),
		])
		if (!force && key === this.#definitionsKey) return
		this.#definitionsKey = key
		this.updateActions()
		this.updateFeedbacks()
		this.updatePresets()
	}

	#updateVariables(): void {
		const sound = this.nowPlaying?.sound ?? null
		this.setVariableValues({
			connected: this.#online === true,
			sound_count: this.cache.sounds.size,
			last_update: this.#lastUpdate ? new Date(this.#lastUpdate).toISOString() : '',
			playing: this.anyPlaying,
			now_playing_name: sound?.name ?? '',
			now_playing_title: sound ? displayName(sound, this.config.names) : '',
			now_playing_artist: sound?.artist ?? '',
			stream_title: this.nowPlaying?.stream?.title ?? '',
		})
	}

	// --- sounds placed on buttons ------------------------------------------------------------------

	/** Records that a placed action/feedback uses a sound, and loads its metadata and cover if not done yet */
	useSound(key: string, name: string): void {
		name = name.trim()
		if (name) this.#uses.set(key, name)
		else this.#uses.delete(key)
		this.#ensureLoaded(name)
	}

	releaseSound(key: string): void {
		this.#uses.delete(key)
	}

	#soundsInUse(): Set<string> {
		const names = new Set(this.#uses.values())
		const playing = this.nowPlaying?.sound?.name
		if (playing) names.add(playing)
		return names
	}

	coverFor(name: string): string | null {
		return this.cache.covers.get(name.trim())?.data ?? null
	}

	nowPlayingImage(source: NowPlayingSource): string | null {
		const sound = this.nowPlaying?.sound
		if (source !== 'stream' && sound) {
			const cover = this.coverFor(sound.name)
			if (cover || source === 'sound') return cover
		}
		if (source !== 'sound') return this.#streamImage?.data ?? null
		return null
	}

	#ensureLoaded(name: string): void {
		const client = this.client
		if (!client || !name || isStreamUrl(name) || this.#loaded.has(name) || this.#loading.has(name)) return
		const generation = this.#generation
		this.#loading.add(name)
		void (async () => {
			try {
				const info = await client.getSound(name)
				if (generation !== this.#generation) return
				if (info && this.cache.upsert(info)) this.#publishDefinitions()
				if (!info) this.log('warn', `Sound "${name}" is not on the soundboard`)
				const changed = await this.#refreshCover(client, name, generation)
				this.#loaded.add(name)
				if (changed) {
					this.#coversChanged([name])
					this.#scheduleSave()
				}
			} catch (e) {
				// Offline: the cached cover stays, and the next metadata refresh retries
				this.log('debug', `Loading "${name}" failed: ${errorMessage(e)}`)
			} finally {
				this.#loading.delete(name)
			}
		})()
	}

	/** Revalidates one cover. Returns true if the image changed. */
	async #refreshCover(client: SoundboardClient, name: string, generation: number): Promise<boolean> {
		if (!name || isStreamUrl(name)) return false
		const sound = this.cache.sounds.get(name)
		const previous = this.cache.covers.get(name)
		if (sound && !sound.has_cover) {
			return this.cache.covers.delete(name)
		}
		let result
		try {
			result = await client.getImage(sound?.cover_url || soundPath('/cover', name), {
				etag: previous?.etag,
				size: this.config.coverSize,
			})
		} catch (e) {
			if (e instanceof HttpError && e.status === 404) result = { kind: 'none' as const }
			else throw e
		}
		if (generation !== this.#generation) return false
		switch (result.kind) {
			case 'unchanged':
				return false
			case 'none':
				return this.cache.covers.delete(name)
			case 'image': {
				const { mime, data, etag } = result
				const changed = previous?.data !== data
				this.cache.covers.set(name, {
					mime,
					data,
					etag,
					fetched: changed ? Date.now() : (previous?.fetched ?? Date.now()),
				})
				return changed
			}
		}
	}

	/** Redraws the feedbacks showing any of these sounds' covers */
	#coversChanged(names: string[]): void {
		if (names.length === 0) return
		const changed = new Set(names)
		const ids: string[] = []
		for (const [key, name] of this.#uses) {
			if (key.startsWith('feedback:') && changed.has(name)) ids.push(key.slice('feedback:'.length))
		}
		if (ids.length) this.checkFeedbacksById(...ids)
		const playing = this.nowPlaying?.sound?.name
		if (playing && changed.has(playing)) this.checkFeedbacks('now_playing_cover')
	}

	// --- polling ---------------------------------------------------------------------------------

	/** Re-reads the sound list and play counts, and revalidates the covers of sounds on buttons */
	async refreshMeta(force = false): Promise<void> {
		if (this.#metaRunning?.generation !== this.#generation) {
			const running = {
				generation: this.#generation,
				promise: this.#doRefreshMeta(force).finally(() => {
					if (this.#metaRunning === running) this.#metaRunning = null
				}),
			}
			this.#metaRunning = running
		}
		return this.#metaRunning.promise
	}

	async #doRefreshMeta(force: boolean): Promise<void> {
		const client = this.client
		if (!client) return
		const generation = this.#generation

		let list
		try {
			list = await client.listSounds()
		} catch (e) {
			if (generation === this.#generation) this.#setOnline(false, errorMessage(e))
			return
		}
		if (generation !== this.#generation) return
		this.#setOnline(true)
		this.#lastUpdate = Date.now()

		const change = this.cache.replaceSounds(list)
		this.#publishDefinitions(force)

		const changedCovers = [...change.removed]
		await forEachLimited([...this.#soundsInUse()], COVER_CONCURRENCY, async (name) => {
			try {
				if (await this.#refreshCover(client, name, generation)) changedCovers.push(name)
				this.#loaded.add(name)
			} catch (e) {
				this.log('debug', `Cover of "${name}" not refreshed: ${errorMessage(e)}`)
			}
		})
		if (generation !== this.#generation) return

		this.#coversChanged(changedCovers)
		this.#updateVariables()
		this.#scheduleSave()
	}

	async #pollStatus(): Promise<void> {
		const client = this.client
		if (!client || this.#statusRunning) return
		const generation = this.#generation
		this.#statusRunning = true
		try {
			const status = await client.status()
			if (generation !== this.#generation) return
			this.#setOnline(true)
			this.#applyStatus(status)
		} catch (e) {
			if (generation !== this.#generation) return
			this.#setOnline(false, errorMessage(e))
			this.#applyStatus({ playing: false })
		} finally {
			this.#statusRunning = false
		}
	}

	#applyStatus(status: SoundboardStatus): void {
		const previousSound = this.nowPlaying?.sound?.name ?? null
		const previousStream = this.#streamImage?.url ?? null
		const previousAny = this.anyPlaying
		const previousStreamTitle = this.nowPlaying?.stream?.title ?? null

		// now_playing is missing on older soundboard versions
		this.nowPlaying = status.now_playing ?? null
		this.anyPlaying = !!status.playing

		const sound = this.nowPlaying?.sound?.name ?? null
		const stream = this.nowPlaying?.stream
		const streamUrl = stream?.has_thumbnail ? stream.thumbnail_url : null

		if (sound !== previousSound) {
			if (sound) this.#ensureLoaded(sound)
			this.checkFeedbacks('playing', 'now_playing_cover')
		}
		if (streamUrl !== previousStream) {
			this.#streamImage = streamUrl ? { url: streamUrl, data: null } : null
			this.checkFeedbacks('now_playing_cover')
			if (streamUrl) void this.#loadStreamImage(streamUrl)
		}
		if (this.anyPlaying !== previousAny) this.checkFeedbacks('any_playing')
		if (sound !== previousSound || this.anyPlaying !== previousAny || (stream?.title ?? null) !== previousStreamTitle) {
			this.#updateVariables()
		}
	}

	async #loadStreamImage(url: string): Promise<void> {
		const client = this.client
		if (!client) return
		try {
			const result = await client.getImage(url, { size: this.config.coverSize })
			if (this.#streamImage?.url !== url) return
			this.#streamImage = { url, data: result.kind === 'image' ? result.data : null }
			this.checkFeedbacks('now_playing_cover')
		} catch (e) {
			this.log('debug', `Stream thumbnail not loaded: ${errorMessage(e)}`)
		}
	}

	/** Polls the status shortly after a command, so "playing" feedbacks react without waiting for the interval */
	#pokeStatus(): void {
		setTimeout(() => void this.#pollStatus(), 150)
	}

	// --- persistence -----------------------------------------------------------------------------

	#scheduleSave(): void {
		if (this.#saveTimer) return
		this.#saveTimer = setTimeout(() => this.#saveNow(), SAVE_DELAY)
	}

	#saveNow(): void {
		clearTimeout(this.#saveTimer)
		this.#saveTimer = undefined
		if (!this.cache.baseUrl) return
		const cache = this.cache.serialize(this.#soundsInUse())
		const json = JSON.stringify(cache)
		if (json === this.#savedCache) return
		this.#savedCache = json
		this.config = { ...this.config, cache }
		this.saveConfig(this.config, undefined)
	}

	// --- commands --------------------------------------------------------------------------------

	#requireClient(): SoundboardClient {
		if (!this.client) throw new Error('Soundboard address is not configured')
		return this.client
	}

	async play(name: string): Promise<void> {
		name = name.trim()
		if (!name) throw new Error('No sound selected')
		await this.#requireClient().play(name, this.cache.sounds.get(name))
		this.#pokeStatus()
	}

	async playUrl(url: string): Promise<void> {
		if (!isStreamUrl(url)) throw new Error(`Not an http(s) URL: "${url}"`)
		await this.#requireClient().playUrl(url)
		this.#pokeStatus()
	}

	async stop(): Promise<void> {
		await this.#requireClient().stop()
		this.#pokeStatus()
	}

	async setVolume(target: 'local' | 'remote', percent: number): Promise<void> {
		if (!Number.isFinite(percent)) throw new Error('Invalid volume')
		await this.#requireClient().setVolume(target, percent)
	}
}
