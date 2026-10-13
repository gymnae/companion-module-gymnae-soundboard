import type { SomeCompanionConfigField } from '@companion-module/base'
import type { PersistedCache } from './cache.js'

export type SortOrder = 'alpha' | 'plays'

export type ModuleConfig = {
	url: string
	sort: SortOrder
	metaInterval: number
	statusInterval: number
	timeout: number
	/**
	 * Not shown as a field: the last known sounds and the covers of sounds placed on buttons.
	 * Kept in the connection config so buttons survive a restart while the soundboard is unreachable.
	 */
	cache?: PersistedCache
}

export const DEFAULT_URL = 'http://127.0.0.1:5000'

export function GetConfigFields(): SomeCompanionConfigField[] {
	return [
		{
			type: 'static-text',
			id: 'info',
			width: 12,
			label: 'Mumble Soundboard',
			value:
				'Connects to a Mumble Soundboard (github.com/gymnae/mumblesoundboard). ' +
				'Sound names and cover art are cached, so buttons keep working while the soundboard is offline.',
		},
		{
			type: 'textinput',
			id: 'url',
			label: 'Soundboard address',
			description:
				'Base URL of the soundboard web UI, e.g. http://192.168.1.20:5000 or https://sounds.example.org/board',
			width: 12,
			default: DEFAULT_URL,
			minLength: 1,
		},
		{
			type: 'dropdown',
			id: 'sort',
			label: 'Order sounds by',
			description: 'Order of the sound lists in actions, feedbacks and presets',
			width: 6,
			default: 'alpha',
			choices: [
				{ id: 'alpha', label: 'Alphabet (A–Z)' },
				{ id: 'plays', label: 'Number of plays (most first)' },
			],
		},
		{
			type: 'number',
			id: 'metaInterval',
			label: 'Metadata refresh (seconds)',
			description: 'How often the sound list, play counts and cover art are re-read',
			width: 6,
			default: 30,
			min: 5,
			max: 3600,
		},
		{
			type: 'number',
			id: 'statusInterval',
			label: 'Now-playing poll (ms, 0 = off)',
			description: 'Drives the "playing" feedbacks and now-playing variables',
			width: 6,
			default: 1000,
			min: 0,
			max: 60000,
		},
		{
			type: 'number',
			id: 'timeout',
			label: 'Request timeout (ms)',
			width: 6,
			default: 3000,
			min: 250,
			max: 30000,
		},
	]
}

/** Normalises the configured address to `scheme://host[:port][/path]` without a trailing slash, or null if unusable. */
export function normalizeBaseUrl(raw: string | undefined): string | null {
	let value = (raw ?? '').trim()
	if (!value) return null
	if (!/^https?:\/\//i.test(value)) value = `http://${value}`
	try {
		const url = new URL(value)
		const path = url.pathname.replace(/\/+$/, '')
		return `${url.protocol}//${url.host}${path}`
	} catch {
		return null
	}
}
