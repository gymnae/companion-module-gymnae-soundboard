/** Thin HTTP client for the Mumble Soundboard's GET API (see its README, "Sound metadata and cover art"). */

/** One record of `GET /meta` / `GET /meta/<file>` */
export type SoundInfo = {
	name: string
	title: string | null
	artist: string | null
	album: string | null
	year: string | null
	genre: string | null
	duration: number | null
	has_cover: boolean
	count: number
	play_url: string
	cover_url: string
	meta_url: string
}

export type NowPlaying = {
	sound: { name: string; title: string | null; artist: string | null; has_cover: boolean; cover_url: string } | null
	stream: { title: string; link: string; has_thumbnail: boolean; thumbnail_url: string } | null
}

/** The subset of `GET /status` this module uses */
export type SoundboardStatus = {
	playing: boolean
	now_playing?: NowPlaying
}

export type ImageData = { mime: string; data: string; etag: string | null }

export type ImageResult = { kind: 'unchanged' } | { kind: 'none' } | ({ kind: 'image' } & ImageData)

export class HttpError extends Error {
	constructor(
		readonly status: number,
		message: string,
	) {
		super(message)
	}
}

export function isStreamUrl(value: string): boolean {
	return /^https?:\/\//i.test(value.trim())
}

/** `/play/<file>` style path for a sound name, percent-encoded per segment */
export function soundPath(prefix: string, name: string): string {
	return `${prefix}/${name.split('/').map(encodeURIComponent).join('/')}`
}

export class SoundboardClient {
	readonly #base: string
	readonly #prefix: string
	readonly #timeout: number

	/** @param baseUrl normalised base URL without trailing slash */
	constructor(baseUrl: string, timeout: number) {
		this.#base = baseUrl
		this.#prefix = new URL(baseUrl).pathname.replace(/\/+$/, '')
		this.#timeout = timeout
	}

	get baseUrl(): string {
		return this.#base
	}

	/**
	 * Absolute URL for a server path. Paths from the API (`play_url`, `cover_url`, …) are root-relative;
	 * if the soundboard sits under a sub-path behind a proxy that does not rewrite them, add the prefix.
	 */
	url(path: string): string {
		if (/^https?:\/\//i.test(path)) return path
		if (!path.startsWith('/')) path = `/${path}`
		if (this.#prefix && (path === this.#prefix || path.startsWith(`${this.#prefix}/`))) {
			path = path.slice(this.#prefix.length)
		}
		return this.#base + path
	}

	async #get(path: string, headers?: Record<string, string>): Promise<Response> {
		const url = this.url(path)
		let response: Response
		try {
			response = await fetch(url, { headers, signal: AbortSignal.timeout(this.#timeout) })
		} catch (e) {
			const reason = e instanceof Error ? (e.name === 'TimeoutError' ? 'timed out' : e.message) : String(e)
			throw new Error(`${url}: ${reason}`, { cause: e })
		}
		if (!response.ok && response.status !== 304) {
			const body = (await response.text().catch(() => '')).trim().slice(0, 200)
			throw new HttpError(response.status, `${url}: HTTP ${response.status}${body ? ` – ${body}` : ''}`)
		}
		return response
	}

	async #json<T>(path: string): Promise<T> {
		const response = await this.#get(path)
		return (await response.json()) as T
	}

	async listSounds(): Promise<SoundInfo[]> {
		const list = await this.#json<SoundInfo[]>('/meta')
		if (!Array.isArray(list)) throw new Error('Unexpected /meta response')
		return list
	}

	/** Fresh metadata for one sound, or null if the soundboard does not know it */
	async getSound(name: string): Promise<SoundInfo | null> {
		try {
			return await this.#json<SoundInfo>(soundPath('/meta', name))
		} catch (e) {
			if (e instanceof HttpError && e.status === 404) return null
			throw e
		}
	}

	async status(): Promise<SoundboardStatus> {
		return this.#json<SoundboardStatus>('/status')
	}

	/**
	 * Fetches an image, revalidating with the previous ETag.
	 * The soundboard answers with its generic fallback cover (`X-Cover-Source: default`) when a file
	 * has no artwork; that is reported as `none` so buttons keep their own style.
	 */
	async getImage(path: string, etag?: string | null): Promise<ImageResult> {
		const response = await this.#get(path, etag ? { 'If-None-Match': etag } : undefined)
		if (response.status === 304) return { kind: 'unchanged' }
		if (response.headers.get('x-cover-source') === 'default') {
			await response.body?.cancel()
			return { kind: 'none' }
		}
		const mime = (response.headers.get('content-type') ?? 'image/jpeg').split(';')[0].trim()
		const data = Buffer.from(await response.arrayBuffer()).toString('base64')
		if (!data) return { kind: 'none' }
		return { kind: 'image', mime, data, etag: response.headers.get('etag') }
	}

	/**
	 * Plays a sound file by name, or a web stream when given an http(s) URL.
	 * Files use the `play_url` the soundboard advertised, falling back to `/play/<file>`.
	 */
	async play(nameOrUrl: string, known?: { play_url?: string | null }): Promise<void> {
		const value = nameOrUrl.trim()
		if (isStreamUrl(value)) {
			await this.playUrl(value)
		} else {
			await this.#get(known?.play_url || soundPath('/play', value))
		}
	}

	async playUrl(url: string): Promise<void> {
		await this.#get(`/play_url?url=${encodeURIComponent(url.trim())}`)
	}

	async stop(): Promise<void> {
		await this.#get('/stop')
	}

	async setVolume(target: 'local' | 'remote', percent: number): Promise<void> {
		const value = Math.round(Math.min(100, Math.max(0, percent)))
		await this.#get(`/volume/${target}/${value}`)
	}
}
