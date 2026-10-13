import { combineRgb, type CompanionPresetDefinitions, type CompanionPresetSection } from '@companion-module/base'
import { displayName } from './cache.js'
import type { ModuleSchema } from './main.js'
import type ModuleInstance from './main.js'

const WHITE = combineRgb(255, 255, 255)
const BLACK = combineRgb(0, 0, 0)
const PLAYING = combineRgb(0, 255, 0)

export function UpdatePresets(self: ModuleInstance): void {
	const presets: CompanionPresetDefinitions<ModuleSchema> = {}
	const soundIds: string[] = []

	for (const sound of self.cache.sorted(self.config.sort)) {
		const id = `sound:${sound.name}`
		const label = displayName(sound)
		soundIds.push(id)
		presets[id] = {
			type: 'simple',
			name: label,
			keywords: [sound.name, sound.artist, sound.album].filter((k): k is string => !!k),
			style: {
				text: label,
				size: '14',
				color: WHITE,
				bgcolor: BLACK,
				alignment: 'center:bottom',
				pngalignment: 'center:center',
				show_topbar: false,
			},
			steps: [{ down: [{ actionId: 'play', options: { sound: sound.name } }], up: [] }],
			feedbacks: [
				{ feedbackId: 'cover', options: { sound: sound.name } },
				{ feedbackId: 'playing', options: { sound: sound.name }, style: { color: PLAYING, text: `▶ ${label}` } },
			],
		}
	}

	presets['stop'] = {
		type: 'simple',
		name: 'Stop all',
		style: { text: 'STOP', size: '24', color: WHITE, bgcolor: combineRgb(102, 0, 0), show_topbar: false },
		steps: [{ down: [{ actionId: 'stop', options: {} }], up: [] }],
		feedbacks: [{ feedbackId: 'any_playing', options: {}, style: { bgcolor: combineRgb(204, 0, 0) } }],
	}
	presets['now_playing'] = {
		type: 'simple',
		name: 'Now playing (press to stop)',
		style: {
			text: `$(${self.label}:now_playing_title)`,
			size: '7',
			color: WHITE,
			bgcolor: BLACK,
			alignment: 'center:bottom',
			pngalignment: 'center:center',
			show_topbar: false,
		},
		steps: [{ down: [{ actionId: 'stop', options: {} }], up: [] }],
		feedbacks: [{ feedbackId: 'now_playing_cover', options: { source: 'auto' } }],
	}
	presets['refresh'] = {
		type: 'simple',
		name: 'Refresh sounds',
		style: { text: 'Refresh\nsounds', size: '14', color: WHITE, bgcolor: combineRgb(0, 0, 102), show_topbar: false },
		steps: [{ down: [{ actionId: 'refresh', options: {} }], up: [] }],
		feedbacks: [],
	}

	const structure: CompanionPresetSection<ModuleSchema>[] = [
		{
			id: 'sounds',
			name: 'Sounds',
			description:
				soundIds.length > 0
					? `${soundIds.length} sounds, ordered ${self.config.sort === 'plays' ? 'by number of plays' : 'alphabetically'}`
					: 'No sounds known yet – check the soundboard address',
			definitions: soundIds,
		},
		{
			id: 'control',
			name: 'Control',
			definitions: ['stop', 'now_playing', 'refresh'],
		},
	]

	self.setPresetDefinitions(structure, presets)
}
